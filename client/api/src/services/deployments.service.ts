/**
 * Hosted deployments (docs/V3_CONTRACT.md §2–§4): static sites and containers run by node agents.
 *
 * status: queued → assigned → running ⇄ unreachable → stopped | failed
 * Money: the first hour is held at create; billing (deployment-duties.service) captures each
 * full hour and re-holds the next. held_ucld tracks what is held for this deployment, so a hold
 * is settled exactly once (conditional UPDATE … WHERE held_ucld = ?).
 * Stop: status becomes 'stopped' at once; stop_acked_at stays NULL until the node confirms with
 * POST /nodes/deployments/{id}/status {status:"stopped"} (heartbeats carry action "stop" until then).
 */
import { getD1 } from "../lib/storage.js";
import { normalizeAddress } from "../lib/eth.js";
import { log } from "../lib/logger.js";
import { getEnv } from "../config/env.js";
import { capture, hold, release } from "./balance.service.js";
import { recordHostingRewards } from "./ledger.service.js";
import {
  checkSpec,
  priceUcldPerHour,
  redactSpec,
  type ApiKind,
  type ContainerSpec,
  type DeploymentKind,
  type StaticSpec,
  type WorkstationSpec,
} from "./deployment-spec.js";
import { eligibleGpus, type Gpu } from "./workstation.js";
import { TemplateService } from "./template.service.js";

export const HOUR_MS = 3_600_000;

export type DeploymentStatus = "queued" | "assigned" | "running" | "unreachable" | "stopped" | "failed";

export interface DeploymentRow {
  id: string;
  owner: string;
  template_id: string | null;
  name: string;
  kind: DeploymentKind;
  spec_json: string;
  sealed_env: string | null;
  price_ucld_per_hour: number;
  status: DeploymentStatus;
  status_reason: string | null;
  node: string | null;
  endpoint: string | null;
  assigned_at: number | null;
  started_at: number | null;
  stopped_at: number | null;
  last_billed_at: number | null;
  last_probe_at: number | null;
  probe_fail: number;
  created_at: number;
  held_ucld: number;
  stop_acked_at: number | null;
  /** 1 = a workstation (stored with kind "container"; docs/WORKSTATIONS.md). */
  workstation: number;
  /** Workstation sshd as "host:port", reported by the node. */
  ssh_endpoint: string | null;
  /** Workstation web token the node could not put in the URL (owner-only, detail view only). */
  web_token: string | null;
  /** 1 = the node owes a "purge" (container + volume) instead of a plain stop. */
  purge_pending: number;
  /** Static sites: the file the probe fetches and the sha256 hex it must serve (db/migrations-hosting.ts). */
  probe_path: string | null;
  probe_hash: string | null;
}

/** Hostname under which the gateway serves sites: https://{id}.{SITES_DOMAIN}. */
export function sitesDomain(): string {
  // Integration: add `SITES_DOMAIN: z.string().default("sites.cloudana.io")` to envSchema; until then the
  // parsed env strips the key, so fall back to the raw variable.
  return (getEnv() as { SITES_DOMAIN?: string }).SITES_DOMAIN ?? process.env.SITES_DOMAIN ?? "sites.cloudana.io";
}

/** The deployment's public URL through the gateway (null for workstations, which connect by token URL/SSH). */
export const publicUrl = (r: Pick<DeploymentRow, "id" | "workstation">) =>
  r.workstation ? null : `https://${r.id}.${sitesDomain()}`;

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** index.html if present, else the first file (sorted by path), with the sha256 hex of its bytes. */
export async function staticProbe(spec: StaticSpec): Promise<{ path: string; hash: string }> {
  const file = spec.files.find((f) => f.path === "index.html") ?? [...spec.files].sort((a, b) => (a.path < b.path ? -1 : 1))[0];
  const bytes = Uint8Array.from(atob(file.contentBase64), (c) => c.charCodeAt(0));
  return { path: file.path, hash: toHex(await crypto.subtle.digest("SHA-256", bytes)) };
}

/** Workstation-only fields of a Deployment (docs/WORKSTATIONS.md §4). */
export interface WorkstationView {
  tier: WorkstationSpec["tier"];
  maxHours: number;
  /** Hours since it started running on its current node (0 before). */
  hoursUsed: number;
  /** maxHours − hoursUsed, ≥ 0; 0 once stopped. */
  hoursLeft: number;
  /** Present while running/unreachable: web = the endpoint as reported (may carry a token); ssh = a ready command. */
  connect: { web?: string; ssh?: string; webToken?: string };
  /** Once assigned: the requested count and the node's matching GPU names. */
  gpu: { count: number; names: string[] } | null;
}

export interface Deployment extends Partial<WorkstationView> {
  id: string;
  templateId: string | null;
  name: string;
  kind: ApiKind;
  status: DeploymentStatus;
  statusReason: string | null;
  node: string | null;
  endpoint: string | null;
  /** Public gateway URL (https://{id}.{SITES_DOMAIN}); null for workstations. */
  url: string | null;
  priceUcldPerHour: number;
  createdAt: number;
  assignedAt: number | null;
  startedAt: number | null;
  stoppedAt: number | null;
  lastProbeAt: number | null;
  probeOk: boolean | null;
  spec: Record<string, unknown>;
}

export interface DeploymentEvent {
  at: number;
  level: "info" | "warn" | "error";
  message: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** "ssh -p <port> <user>@<host>" from a "host:port" endpoint. */
export function sshCommand(sshEndpoint: string, user = "root"): string {
  const i = sshEndpoint.lastIndexOf(":");
  return `ssh -p ${sshEndpoint.slice(i + 1)} ${user}@${sshEndpoint.slice(0, i).replace(/^\[|\]$/g, "")}`;
}

function workstationView(r: DeploymentRow, spec: WorkstationSpec, nodeGpus: Gpu[] | undefined, now: number, detail: boolean): WorkstationView {
  const used = r.started_at === null ? 0 : Math.max(0, ((r.stopped_at ?? now) - r.started_at) / HOUR_MS);
  const ended = r.status === "stopped" || r.status === "failed";
  const live = r.status === "running" || r.status === "unreachable";
  const count = spec.gpu?.count ?? 0;
  return {
    tier: spec.tier,
    maxHours: spec.maxHours,
    hoursUsed: round2(used),
    hoursLeft: ended ? 0 : round2(Math.max(0, spec.maxHours - used)),
    connect: live
      ? {
          ...(spec.access.web && r.endpoint && { web: r.endpoint }),
          ...(spec.access.ssh && r.ssh_endpoint && { ssh: sshCommand(r.ssh_endpoint, spec.access.ssh.user) }),
          ...(detail && r.web_token && { webToken: r.web_token }),
        }
      : {},
    gpu: r.node && nodeGpus ? { count, names: eligibleGpus(nodeGpus, spec.gpu ?? { count }).slice(0, count).map((g) => g.name) } : null,
  };
}

/**
 * `nodeGpus` = the assigned node's manifest GPUs (workstations only; see presentDeployments).
 * `detail` adds secrets meant for the single-deployment view only (connect.webToken).
 */
export function toDeployment(r: DeploymentRow, nodeGpus?: Gpu[], now = Date.now(), detail = false): Deployment {
  const spec = JSON.parse(r.spec_json);
  return {
    id: r.id,
    templateId: r.template_id,
    name: r.name,
    kind: r.workstation ? "workstation" : r.kind,
    status: r.status,
    statusReason: r.status_reason,
    node: r.node,
    endpoint: r.endpoint,
    url: publicUrl(r),
    priceUcldPerHour: r.price_ucld_per_hour,
    createdAt: r.created_at,
    assignedAt: r.assigned_at,
    startedAt: r.started_at,
    stoppedAt: r.stopped_at,
    lastProbeAt: r.last_probe_at,
    probeOk: r.last_probe_at === null ? null : r.probe_fail === 0,
    spec: redactSpec(r.kind, spec),
    ...(r.workstation ? workstationView(r, spec as WorkstationSpec, nodeGpus, now, detail) : {}),
  };
}

/** toDeployment for many rows, loading the manifests of nodes that run workstations. */
export async function presentDeployments(rows: DeploymentRow[], detail = false): Promise<Deployment[]> {
  const nodes = [...new Set(rows.filter((r) => r.workstation && r.node).map((r) => r.node!))];
  const gpus = new Map<string, Gpu[]>();
  if (nodes.length) {
    const res = await getD1()
      .prepare(`SELECT address, manifest_json FROM nodes WHERE address IN (${nodes.map(() => "?").join(",")})`)
      .bind(...nodes)
      .all<{ address: string; manifest_json: string | null }>();
    for (const n of res.results ?? []) gpus.set(n.address, (JSON.parse(n.manifest_json ?? "{}").gpus ?? []) as Gpu[]);
  }
  const now = Date.now();
  return rows.map((r) => toDeployment(r, r.node ? gpus.get(r.node) ?? [] : undefined, now, detail));
}

export async function addEvent(id: string, level: DeploymentEvent["level"], message: string, now = Date.now()): Promise<void> {
  await getD1()
    .prepare("INSERT INTO deployment_events (id, deployment_id, at, level, message) VALUES (?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), id, now, level, message.slice(0, 500))
    .run();
}

export async function getDeploymentRow(id: string): Promise<DeploymentRow | null> {
  return getD1().prepare("SELECT * FROM deployments WHERE id = ?").bind(id).first<DeploymentRow>();
}

/** The owner's deployment, or null (another owner's answers the same as a missing one). */
export async function getOwnedRow(owner: string, id: string): Promise<DeploymentRow | null> {
  const row = await getDeploymentRow(id);
  return row && row.owner === normalizeAddress(owner) ? row : null;
}

/** Bound nodes seen within NODE_ACTIVE_SECONDS that advertise `capability`. */
export async function capableNodesOnline(capability: string, now = Date.now()): Promise<number> {
  const row = await getD1()
    .prepare(
      "SELECT COUNT(*) AS n FROM nodes, json_each(nodes.work_types) w " +
        "WHERE nodes.payout IS NOT NULL AND nodes.last_seen >= ? AND w.value = ?",
    )
    .bind(now - getEnv().NODE_ACTIVE_SECONDS * 1000, capability)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** A container whose start must wait for sealed secrets (V3 §6: they are sealed to the assigned node). */
export function awaitingSecrets(r: Pick<DeploymentRow, "kind" | "spec_json" | "sealed_env">): boolean {
  return r.kind === "container" && !r.sealed_env && (JSON.parse(r.spec_json) as ContainerSpec).expectsSecrets === true;
}

export const capabilityFor = (kind: DeploymentKind) => (kind === "static" ? "hosting" : "container");

/** The capability a new deployment waits for: "gpu" for a GPU workstation. */
function neededCapability(kind: ApiKind, spec: unknown): string {
  if (kind === "workstation" && ((spec as WorkstationSpec).gpu?.count ?? 0) > 0) return "gpu";
  return capabilityFor(kind === "static" ? "static" : "container");
}

export type CreateResult =
  | { ok: true; id: string; priceUcldPerHour: number }
  | { ok: false; code: "validation_failed" | "payload_too_large" | "unprocessable"; message: string; details?: unknown };

export async function createDeployment(input: {
  owner: string;
  templateId?: string;
  name: string;
  kind: ApiKind;
  spec: unknown;
}): Promise<CreateResult> {
  const checked = checkSpec(input.kind, input.spec);
  if (!checked.ok) return checked;
  const price = priceUcldPerHour(input.kind, checked.spec);
  if (input.kind === "container" && input.templateId && !(checked.spec as ContainerSpec).expectsSecrets) {
    // A template that declares secretEnv means the browser will seal secrets after assignment.
    const t = await new TemplateService().getTemplateById(input.templateId);
    if (t?.secretEnv?.length) (checked.spec as ContainerSpec).expectsSecrets = true;
  }
  if (input.kind === "workstation" && input.templateId) {
    // The node agent reads these from the spec; the template is their source when the console leaves them out.
    const t = await new TemplateService().getTemplateById(input.templateId);
    const w = checked.spec as WorkstationSpec;
    if (t?.kind === "workstation") {
      w.workdir ??= t.workdir;
      w.sshPort ??= t.sshPort;
      w.tokenEnv ??= t.tokenEnv;
      w.tokenQuery ??= t.tokenQuery;
      for (const k of ["workdir", "sshPort", "tokenEnv", "tokenQuery"] as const) if (w[k] === undefined) delete w[k];
    }
  }
  const owner = normalizeAddress(input.owner);
  if (!(await hold(owner, price))) {
    return { ok: false, code: "unprocessable", message: `Insufficient credits: the first hour costs ${price} µCLD` };
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  await getD1()
    .prepare(
      "INSERT INTO deployments (id, owner, template_id, name, kind, spec_json, price_ucld_per_hour, status, held_ucld, created_at, workstation) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)",
    )
    .bind(
      id, owner, input.templateId ?? null, input.name, input.kind === "static" ? "static" : "container",
      JSON.stringify(checked.spec), price, price, now, input.kind === "workstation" ? 1 : 0,
    )
    .run();
  if (input.kind === "static") {
    // Separate statement so creation keeps working on a database that has not run HOSTING_MIGRATIONS yet
    // (the probe then has no hash to check, as for rows uploaded before the migration).
    const probe = await staticProbe(checked.spec as StaticSpec);
    await getD1()
      .prepare("UPDATE deployments SET probe_path = ?, probe_hash = ? WHERE id = ?")
      .bind(probe.path, probe.hash, id)
      .run()
      .catch((err) => log.api.warn("[deployments] probe columns not written (run HOSTING_MIGRATIONS):", err));
  }
  await addEvent(id, "info", `queued at ${price} µCLD/hour; first hour held`, now);
  if ((await capableNodesOnline(neededCapability(input.kind, checked.spec), now)) === 0) {
    await addEvent(id, "warn", "waiting for a capable node", now);
  }
  return { ok: true, id, priceUcldPerHour: price };
}

export async function listDeployments(owner: string, limit = 100): Promise<Deployment[]> {
  const rows = await getD1()
    .prepare("SELECT * FROM deployments WHERE owner = ? ORDER BY created_at DESC LIMIT ?")
    .bind(normalizeAddress(owner), limit)
    .all<DeploymentRow>();
  return presentDeployments(rows.results ?? []);
}

export async function listEvents(id: string, limit = 50): Promise<DeploymentEvent[]> {
  const rows = await getD1()
    .prepare("SELECT at, level, message FROM deployment_events WHERE deployment_id = ? ORDER BY at DESC, rowid DESC LIMIT ?")
    .bind(id, limit)
    .all<DeploymentEvent>();
  return rows.results ?? [];
}

export async function nodePubkey(node: string | null): Promise<string | null> {
  if (!node) return null;
  const row = await getD1().prepare("SELECT pubkey FROM nodes WHERE address = ?").bind(node).first<{ pubkey: string | null }>();
  return row?.pubkey ?? null;
}

export type Update = { ok: true } | { ok: false; code: "not_found" | "conflict" | "validation_failed"; message: string };

export async function setSealedEnv(owner: string, id: string, sealedEnv: string): Promise<Update> {
  const row = await getOwnedRow(owner, id);
  if (!row) return { ok: false, code: "not_found", message: "deployment not found" };
  if (row.kind !== "container") return { ok: false, code: "validation_failed", message: "sealed secrets are for containers only" };
  const r = await getD1()
    .prepare("UPDATE deployments SET sealed_env = ? WHERE id = ? AND status IN ('queued','assigned')")
    .bind(sealedEnv, id)
    .run();
  if ((r.meta?.changes ?? 0) === 0) {
    return { ok: false, code: "conflict", message: `secrets can only change while queued or assigned (status is ${row.status})` };
  }
  await addEvent(id, "info", "sealed secrets updated");
  return { ok: true };
}

/**
 * Settle the hold when a deployment ends. A running deployment pays the elapsed part of its
 * current hour (pro rata, credited to the provider like a full hour); otherwise the hold is released.
 */
export async function settleHold(row: DeploymentRow, now = Date.now()): Promise<void> {
  if (row.held_ucld <= 0) return;
  const db = getD1();
  const r = await db.prepare("UPDATE deployments SET held_ucld = 0 WHERE id = ? AND held_ucld = ?").bind(row.id, row.held_ucld).run();
  if ((r.meta?.changes ?? 0) === 0) return; // already settled elsewhere
  let charged = 0;
  if (row.status === "running" && row.last_billed_at !== null && row.node) {
    const elapsed = Math.max(0, Math.min(HOUR_MS, now - row.last_billed_at));
    charged = Math.min(row.held_ucld, Math.floor((row.price_ucld_per_hour * elapsed) / HOUR_MS));
  }
  if (charged > 0) await chargeHour(row, charged, now);
  if (row.held_ucld - charged > 0) await release(row.owner, row.held_ucld - charged);
}

/** Capture `fee` from the owner's hold and credit the node's payout wallet (lane A + treasury, no lane B). */
export async function chargeHour(row: DeploymentRow, fee: number, now = Date.now()): Promise<void> {
  const db = getD1();
  await capture(row.owner, fee);
  const payout = await db.prepare("SELECT payout FROM nodes WHERE address = ?").bind(row.node).first<{ payout: string | null }>();
  const billId = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO deployment_bills (id, deployment_id, owner, node, provider, fee_ucld, billed_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(billId, row.id, row.owner, row.node, payout?.payout ?? null, fee, now)
    .run();
  if (payout?.payout) {
    await recordHostingRewards({
      billId,
      workType: row.kind === "static" ? "hosting" : "container",
      provider: payout.payout,
      feeUcld: fee,
      now,
    });
  }
}

/**
 * Move a live deployment to 'stopped' (or 'failed') and settle its hold. `acked` = the node
 * already knows (it reported this itself, or the deployment never reached a node).
 */
export async function endDeployment(
  row: DeploymentRow,
  status: "stopped" | "failed",
  reason: string,
  opts: { acked: boolean; level?: DeploymentEvent["level"]; now?: number } = { acked: false },
): Promise<boolean> {
  const now = opts.now ?? Date.now();
  const acked = opts.acked || !row.node ? now : null;
  const r = await getD1()
    .prepare(
      "UPDATE deployments SET status = ?, status_reason = ?, stopped_at = ?, stop_acked_at = ? " +
        "WHERE id = ? AND status = ?",
    )
    .bind(status, reason, now, acked, row.id, row.status)
    .run();
  if ((r.meta?.changes ?? 0) === 0) return false;
  await settleHold(row, now);
  await addEvent(row.id, opts.level ?? (status === "failed" ? "error" : "info"), `${status}: ${reason}`, now);
  return true;
}

/** Owner raises a workstation's maxHours while it is assigned or running (docs/WORKSTATIONS.md §3). */
export async function extendWorkstation(owner: string, id: string, maxHours: number): Promise<Update> {
  const row = await getOwnedRow(owner, id);
  if (!row) return { ok: false, code: "not_found", message: "deployment not found" };
  if (!row.workstation) return { ok: false, code: "validation_failed", message: "maxHours applies to workstations only" };
  const spec = JSON.parse(row.spec_json) as WorkstationSpec;
  if (maxHours <= spec.maxHours) {
    return { ok: false, code: "validation_failed", message: `maxHours can only be extended (currently ${spec.maxHours})` };
  }
  const r = await getD1()
    .prepare("UPDATE deployments SET spec_json = ? WHERE id = ? AND status IN ('assigned','running') AND spec_json = ?")
    .bind(JSON.stringify({ ...spec, maxHours }), id, row.spec_json)
    .run();
  if ((r.meta?.changes ?? 0) === 0) {
    return { ok: false, code: "conflict", message: `maxHours can only change while assigned or running (status is ${row.status})` };
  }
  await addEvent(id, "info", `extended to ${maxHours} h`);
  return { ok: true };
}

/**
 * Owner stop. `purge` (workstations): the node also deletes the volume now ("purge" instead of "stop",
 * until it confirms); without it the volume is kept keepDays. Purge also works on an already stopped one.
 */
export async function stopDeployment(owner: string, id: string, purge = false): Promise<Update> {
  const row = await getOwnedRow(owner, id);
  if (!row) return { ok: false, code: "not_found", message: "deployment not found" };
  if (purge && !row.workstation) return { ok: false, code: "validation_failed", message: "purge applies to workstations only" };
  const ended = row.status === "stopped" || row.status === "failed";
  if (!ended && !(await endDeployment(row, "stopped", "stopped by owner"))) {
    return { ok: false, code: "conflict", message: "deployment changed while stopping — retry" };
  }
  if (purge && row.node) {
    const r = await getD1()
      .prepare("UPDATE deployments SET purge_pending = 1, stop_acked_at = NULL WHERE id = ? AND purge_pending = 0")
      .bind(id)
      .run();
    if ((r.meta?.changes ?? 0) > 0) await addEvent(id, "info", "volume purge requested");
  }
  return { ok: true };
}

/** What the gateway needs to proxy a site (public: no owner, no secrets). */
export interface PublicRoute {
  id: string;
  state: DeploymentStatus;
  /** The node endpoint while running; null otherwise. */
  endpoint: string | null;
  kind: DeploymentKind;
}

/** Route info for static/container deployments; null for a missing id or a workstation (its URL may carry a token). */
export async function publicRoute(id: string): Promise<PublicRoute | null> {
  const row = await getDeploymentRow(id);
  if (!row || row.workstation) return null;
  return { id: row.id, state: row.status, endpoint: row.status === "running" ? row.endpoint : null, kind: row.kind };
}

/**
 * Admin stop (internal key): status 'stopped', reason 'admin'. Like an owner stop, the node then receives
 * action "stop" on its heartbeats until it confirms (stop_acked_at stays NULL). Idempotent once ended.
 */
export async function adminStop(id: string): Promise<Update> {
  const row = await getDeploymentRow(id);
  if (!row) return { ok: false, code: "not_found", message: "deployment not found" };
  if (row.status === "stopped" || row.status === "failed") return { ok: true };
  if (!(await endDeployment(row, "stopped", "admin", { acked: false, level: "warn" }))) {
    return { ok: false, code: "conflict", message: "deployment changed while stopping — retry" };
  }
  return { ok: true };
}
