/**
 * Hosted deployments (docs/V3_CONTRACT.md §2–§4): static sites and containers run by node agents.
 * GPU endpoints (docs/V4_ENDPOINTS_CONTRACT.md): a parent row (replicas > 0, never on a node) plus one relayed
 * container row per replica (parent_id). The parent's visible status is derived from its replicas.
 *
 * status: queued → assigned → running ⇄ unreachable → stopped | failed
 * Money: the first hour is held at create; billing (deployment-duties.service) captures each
 * full hour and re-holds the next. held_ucld tracks what is held for this deployment, so a hold
 * is settled exactly once (conditional UPDATE … WHERE held_ucld = ?).
 * Stop: status becomes 'stopped' at once; stop_acked_at stays NULL until the node confirms with
 * POST /nodes/deployments/{id}/status {status:"stopped"} (heartbeats carry action "stop" until then).
 */
import { getD1 } from "../lib/storage.js";
import { getRelay } from "../lib/relay.js";
import { readCapped } from "../lib/read-capped.js";
import { compareVersions } from "./instruction-signing.service.js";
import { createHash, randomBytes } from "node:crypto";
import { normalizeAddress } from "../lib/eth.js";
import { log } from "../lib/logger.js";
import { getEnv } from "../config/env.js";
import { capture, hold, release } from "./balance.service.js";
import { recordHostingRewards } from "./ledger.service.js";
import {
  checkSpec,
  imageAllowed,
  priceUcldPerHour,
  priceUsdPerHour,
  redactSpec,
  replicaSpec,
  type ApiKind,
  type ContainerSpec,
  type DeploymentKind,
  type EndpointSpec,
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
  /** 1 = served through the node's relay socket (docs/V4_RELAY_CONTRACT.md); endpoint stays null. */
  relayed: number;
  /** Workstation web token the node could not put in the URL (owner-only, detail view only). */
  web_token: string | null;
  /** 1 = the node owes a "purge" (container + volume) instead of a plain stop. */
  purge_pending: number;
  /** Static sites: the file the probe fetches and the sha256 hex it must serve (db/migrations-hosting.ts). Endpoint replicas: the health path (no hash). */
  probe_path: string | null;
  probe_hash: string | null;
  /** Endpoint replica: the parent (endpoint) row. */
  parent_id: string | null;
  /** > 0 = an endpoint parent row (docs/V4_ENDPOINTS_CONTRACT.md). */
  replicas: number;
  /** The node's `docker logs` tail from its last failed report. */
  last_logs: string | null;
  last_ok_at: number | null;
  /** Inconclusive probes in a row (the relay binding failed); INCONCLUSIVE_MAX of them count as a failure. */
  probe_inconclusive: number | null;
  /** Start timeouts so far: assigned, start sent, never reported (deployment-duties G4). */
  start_attempts: number | null;
}

export const isEndpoint = (r: Pick<DeploymentRow, "replicas">) => r.replicas > 0;

/** Hostname under which the gateway serves sites: https://{id}.{SITES_DOMAIN}. */
export function sitesDomain(): string {
  // Integration: add `SITES_DOMAIN: z.string().default("sites.cloudana.io")` to envSchema; until then the
  // parsed env strips the key, so fall back to the raw variable.
  return (getEnv() as { SITES_DOMAIN?: string }).SITES_DOMAIN ?? process.env.SITES_DOMAIN ?? "sites.cloudana.io";
}

/** The deployment's public URL through the gateway (null for direct workstations, which connect by token URL/SSH). */
export const publicUrl = (r: Pick<DeploymentRow, "id" | "workstation" | "relayed" | "parent_id">) =>
  (r.workstation && !r.relayed) || r.parent_id ? null : `https://${r.id}.${sitesDomain()}`;

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

/** One replica of an endpoint, as shown under its parent. */
export interface ReplicaView {
  id: string;
  status: DeploymentStatus;
  statusReason: string | null;
  node: string | null;
  startedAt: number | null;
  probeOk: boolean | null;
  /** True while the replica expects sealed secrets that have not arrived (PATCH /deployments/{replicaId}/secrets). */
  awaitingSecrets: boolean;
  /** Detail only, once a node with a key is assigned: seal this replica's secrets to it (it must derive to `node`). */
  nodePubkey?: string;
  /** Detail only: the node's log tail from this replica's last failure. */
  logs?: string;
}

export interface Deployment extends Partial<WorkstationView> {
  id: string;
  templateId: string | null;
  name: string;
  kind: ApiKind;
  /** Endpoint replicas: the endpoint they belong to. */
  parentId?: string;
  /** Endpoints: replicas in creation order, and who may call it. */
  replicas?: ReplicaView[];
  auth?: EndpointSpec["auth"];
  /** Detail only: the node's log tail from the last failure. */
  logs?: string;
  status: DeploymentStatus;
  statusReason: string | null;
  /** True while a start waits for sealed secrets (an endpoint: while any replica does). */
  awaitingSecrets: boolean;
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
          // Relayed: the gateway URL plus the app's path (token included); direct: the endpoint as reported.
          ...(spec.access.web && r.endpoint && { web: r.relayed ? `https://${r.id}.${sitesDomain()}${r.endpoint}` : r.endpoint }),
          ...(spec.access.ssh && r.ssh_endpoint && { ssh: sshCommand(r.ssh_endpoint, spec.access.ssh.user) }),
          ...(detail && r.web_token && { webToken: r.web_token }),
        }
      : {},
    gpu: r.node && nodeGpus ? { count, names: eligibleGpus(nodeGpus, spec.gpu ?? { count }).slice(0, count).map((g) => g.name) } : null,
  };
}

/**
 * An endpoint's status is its replicas': running while any replica serves; otherwise the most advanced replica
 * state; failed/stopped only once every replica (or the parent itself) has ended.
 */
export function endpointStatus(parent: Pick<DeploymentRow, "status">, replicas: Pick<DeploymentRow, "status">[]): DeploymentStatus {
  if (parent.status === "stopped" || parent.status === "failed") return parent.status;
  for (const s of ["running", "unreachable", "assigned", "queued", "failed"] as const) if (replicas.some((r) => r.status === s)) return s;
  return "stopped";
}

const replicaView = (r: DeploymentRow, detail: boolean, pubkeys?: Map<string, string | null>): ReplicaView => ({
  id: r.id,
  status: r.status,
  statusReason: r.status_reason,
  node: r.node,
  startedAt: r.started_at,
  probeOk: r.last_probe_at === null ? null : r.probe_fail === 0,
  awaitingSecrets: awaitingSecrets(r),
  ...(detail && r.node && pubkeys?.get(r.node) && { nodePubkey: pubkeys.get(r.node)! }),
  ...(detail && r.last_logs && { logs: r.last_logs }),
});

/**
 * `nodeGpus` = the assigned node's manifest GPUs (workstations only; see presentDeployments).
 * `replicas` = an endpoint's replica rows (presentDeployments loads them).
 * `detail` adds what the single-deployment view alone shows (connect.webToken, logs).
 */
export function toDeployment(
  r: DeploymentRow,
  nodeGpus?: Gpu[],
  now = Date.now(),
  detail = false,
  replicas: DeploymentRow[] = [],
  pubkeys?: Map<string, string | null>,
): Deployment {
  const spec = JSON.parse(r.spec_json);
  const endpoint = isEndpoint(r);
  return {
    id: r.id,
    templateId: r.template_id,
    name: r.name,
    kind: r.workstation ? "workstation" : endpoint ? "endpoint" : r.kind,
    status: endpoint ? endpointStatus(r, replicas) : r.status,
    statusReason: r.status_reason,
    awaitingSecrets: endpoint ? replicas.some(awaitingSecrets) : awaitingSecrets(r),
    node: r.node,
    endpoint: r.endpoint,
    url: publicUrl(r),
    // An endpoint's price is what all its replicas cost per hour.
    priceUcldPerHour: r.price_ucld_per_hour * (endpoint ? r.replicas : 1),
    createdAt: r.created_at,
    assignedAt: r.assigned_at,
    startedAt: r.started_at,
    stoppedAt: r.stopped_at,
    lastProbeAt: r.last_probe_at,
    probeOk: r.last_probe_at === null ? null : r.probe_fail === 0,
    spec: redactSpec(r.kind, spec),
    ...(r.parent_id && { parentId: r.parent_id }),
    ...(endpoint && { replicas: replicas.map((x) => replicaView(x, detail, pubkeys)), auth: (spec as EndpointSpec).auth }),
    ...(detail && r.last_logs && { logs: r.last_logs }),
    ...(r.workstation ? workstationView(r, spec as WorkstationSpec, nodeGpus, now, detail) : {}),
  };
}

/** The replica rows of `parents` (creation order), keyed by parent id. */
export async function replicasOf(parents: string[]): Promise<Map<string, DeploymentRow[]>> {
  const out = new Map<string, DeploymentRow[]>();
  if (parents.length === 0) return out;
  const res = await getD1()
    .prepare(`SELECT * FROM deployments WHERE parent_id IN (${parents.map(() => "?").join(",")}) ORDER BY created_at, rowid`)
    .bind(...parents)
    .all<DeploymentRow>();
  for (const r of res.results ?? []) out.set(r.parent_id!, [...(out.get(r.parent_id!) ?? []), r]);
  return out;
}

/**
 * toDeployment for many rows, loading the replicas of endpoints and, in one statement, the manifests of nodes that run
 * workstations plus (detail only) the keys of nodes that hold replicas — so the owner can seal each replica's secrets.
 */
export async function presentDeployments(rows: DeploymentRow[], detail = false): Promise<Deployment[]> {
  const replicas = await replicasOf(rows.filter(isEndpoint).map((r) => r.id));
  const nodes = new Set(rows.filter((r) => r.workstation && r.node).map((r) => r.node!));
  if (detail) for (const rs of replicas.values()) for (const r of rs) if (r.node) nodes.add(r.node);
  const gpus = new Map<string, Gpu[]>();
  const pubkeys = new Map<string, string | null>();
  if (nodes.size) {
    const list = [...nodes];
    const res = await getD1()
      .prepare(`SELECT address, manifest_json, pubkey FROM nodes WHERE address IN (${list.map(() => "?").join(",")})`)
      .bind(...list)
      .all<{ address: string; manifest_json: string | null; pubkey: string | null }>();
    for (const n of res.results ?? []) {
      gpus.set(n.address, (JSON.parse(n.manifest_json ?? "{}").gpus ?? []) as Gpu[]);
      pubkeys.set(n.address, n.pubkey);
    }
  }
  const now = Date.now();
  return rows.map((r) => toDeployment(r, r.node ? gpus.get(r.node) ?? [] : undefined, now, detail, replicas.get(r.id) ?? [], pubkeys));
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
export async function capableNodesOnline(capability: string, now = Date.now(), minAgent?: string): Promise<number> {
  const rows =
    (
      await getD1()
        .prepare(
          "SELECT nodes.agent_version AS v FROM nodes, json_each(nodes.work_types) w " +
            "WHERE nodes.payout IS NOT NULL AND nodes.last_seen >= ? AND w.value = ?",
        )
        .bind(now - getEnv().NODE_ACTIVE_SECONDS * 1000, capability)
        .all<{ v: string | null }>()
    ).results ?? [];
  return minAgent ? rows.filter((r) => !!r.v && compareVersions(r.v, minAgent) >= 0).length : rows.length;
}

/** The warning a new deployment gets when no online node could run it (a secret-carrying one needs a newer agent). */
async function capableWarning(kind: string, spec: unknown, now: number): Promise<string | null> {
  const cap = neededCapability(kind as never, spec as never);
  if ((await capableNodesOnline(cap, now)) === 0) return "waiting for a capable node";
  const secrets = (spec as { expectsSecrets?: boolean }).expectsSecrets === true;
  if (secrets && (await capableNodesOnline(cap, now, SEALED_V2_MIN_AGENT)) === 0) {
    return `waiting for a node running agent ${SEALED_V2_MIN_AGENT} or newer (sealed secrets need it)`;
  }
  return null;
}

/** A container whose start must wait for sealed secrets (V3 §6: they are sealed to the assigned node). */
export function awaitingSecrets(r: Pick<DeploymentRow, "kind" | "spec_json" | "sealed_env">): boolean {
  return r.kind === "container" && !r.sealed_env && (JSON.parse(r.spec_json) as ContainerSpec).expectsSecrets === true;
}

/** A container that carries, or will carry, sealed secrets: it may only go to a node whose agent opens v2 payloads. */
export function carriesSecrets(r: Pick<DeploymentRow, "kind" | "spec_json" | "sealed_env">): boolean {
  return r.kind === "container" && (r.sealed_env !== null || (JSON.parse(r.spec_json) as ContainerSpec).expectsSecrets === true);
}

/**
 * Sealed secrets v2 (shared/sealed.ts): bound to the deployment id, so the API cannot move one deployment's secrets
 * into another's container. The first agent that opens them; older agents never receive a deployment with secrets.
 */
export const SEALED_V2_MIN_AGENT = "1.5.0";
/** First byte of a v2 payload (shared/sealed.ts SEALED_V2_TAG; the API does not import the crypto). */
const SEALED_V2_TAG = 0x02;
const SEALED_V2_MIN_BYTES = 1 + 65 + 24 + 16;

/** True when `sealedEnv` has the shape of a v2 payload: the v2 tag, then an uncompressed ephemeral key, nonce and tag. */
export function isSealedV2(sealedEnv: string): boolean {
  let buf: Buffer;
  try {
    buf = Buffer.from(sealedEnv, "base64");
  } catch {
    return false;
  }
  return buf.length >= SEALED_V2_MIN_BYTES && buf[0] === SEALED_V2_TAG && buf[1] === 0x04;
}

export const capabilityFor = (kind: DeploymentKind) => (kind === "static" ? "hosting" : "container");

/** The capability a new deployment waits for: "any-image" / "gpu" when its image or GPUs need it. */
function neededCapability(kind: ApiKind, spec: unknown): string {
  if (kind === "static") return "hosting";
  const c = spec as ContainerSpec;
  if (kind === "endpoint" && !imageAllowed(c.image)) return "any-image";
  if ((c.gpu?.count ?? 0) > 0) return "gpu";
  return "container";
}

export type CreateResult =
  | { ok: true; id: string; priceUcldPerHour: number; priceUsdPerHour: number; usdPerCld: number }
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
  // The dollar price, converted to µCLD at the reference rate now and fixed for this deployment.
  const usd = priceUsdPerHour(input.kind, checked.spec);
  const price = priceUcldPerHour(input.kind, checked.spec);
  const quoted = (n: number) => ({ priceUcldPerHour: price * n, priceUsdPerHour: usd * n, usdPerCld: getEnv().USD_PER_CLD });
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
  const replicas = input.kind === "endpoint" ? (checked.spec as EndpointSpec).replicas : 1;
  if (!(await hold(owner, price * replicas))) {
    const what = replicas > 1 ? `${replicas} replicas cost ${price * replicas} µCLD for the first hour` : `the first hour costs ${price} µCLD`;
    return { ok: false, code: "unprocessable", message: `Insufficient credits: ${what}` };
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  const stmt = getD1().prepare(
    "INSERT INTO deployments (id, owner, template_id, name, kind, spec_json, price_ucld_per_hour, status, held_ucld, created_at, workstation, parent_id, replicas, probe_path) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?)",
  );
  if (input.kind === "endpoint") {
    // The parent holds nothing itself: each replica is its own relayed container with its own hour held.
    const e = checked.spec as EndpointSpec;
    const child = replicaSpec(e);
    const rows = [stmt.bind(id, owner, input.templateId ?? null, input.name, "container", JSON.stringify(e), price, 0, now, 0, null, replicas, null)];
    for (let i = 1; i <= replicas; i++) {
      rows.push(stmt.bind(crypto.randomUUID(), owner, null, `${input.name} #${i}`, "container", JSON.stringify(child), price, price, now + i, 0, id, 0, child.health!.path!));
    }
    await getD1().batch(rows);
    await addEvent(id, "info", `queued ${replicas} replica${replicas > 1 ? "s" : ""} at ${price} µCLD/replica-hour; first hour held`, now);
    const waiting = await capableWarning(input.kind, checked.spec, now);
    if (waiting) await addEvent(id, "warn", waiting, now);
    return { ok: true, id, ...quoted(replicas) };
  }
  await stmt
    .bind(
      id, owner, input.templateId ?? null, input.name, input.kind === "static" ? "static" : "container",
      JSON.stringify(checked.spec), price, price, now, input.kind === "workstation" ? 1 : 0, null, 0, null,
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
  const waiting = await capableWarning(input.kind, checked.spec, now);
  if (waiting) await addEvent(id, "warn", waiting, now);
  return { ok: true, id, ...quoted(1) };
}

export async function listDeployments(owner: string, limit = 100): Promise<Deployment[]> {
  const rows = await getD1()
    .prepare("SELECT * FROM deployments WHERE owner = ? AND parent_id IS NULL ORDER BY created_at DESC LIMIT ?")
    .bind(normalizeAddress(owner), limit)
    .all<DeploymentRow>();
  return presentDeployments(rows.results ?? []);
}

/** An endpoint's events include its replicas', each prefixed with the replica's name. */
export async function listEvents(id: string, limit = 50, replicas: Pick<DeploymentRow, "id" | "name">[] = []): Promise<DeploymentEvent[]> {
  const ids = [id, ...replicas.map((r) => r.id)];
  const rows = await getD1()
    .prepare(
      `SELECT deployment_id, at, level, message FROM deployment_events WHERE deployment_id IN (${ids.map(() => "?").join(",")}) ` +
        "ORDER BY at DESC, rowid DESC LIMIT ?",
    )
    .bind(...ids, limit)
    .all<DeploymentEvent & { deployment_id: string }>();
  const names = new Map(replicas.map((r) => [r.id, r.name]));
  return (rows.results ?? []).map(({ deployment_id, ...e }) => (deployment_id === id ? e : { ...e, message: `${names.get(deployment_id)}: ${e.message}` }));
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
  if (isEndpoint(row)) return { ok: false, code: "validation_failed", message: "seal secrets per replica (each is sealed to its node): PATCH /deployments/{replicaId}/secrets" };
  if (!isSealedV2(sealedEnv)) {
    return {
      ok: false,
      code: "validation_failed",
      message: "sealedEnv must be a v2 payload bound to this deployment (shared/sealed.ts seal(pubkey, plaintext, sealedEnvAad(id))); reload the console and seal again",
    };
  }
  const r = await getD1()
    // Sealing restarts the start clock: the start-timeout duty measures from assigned_at, and a row that waited for
    // its secrets must not be re-queued (sealed_env wiped) minutes after the owner finally sealed them.
    .prepare("UPDATE deployments SET sealed_env = ?, assigned_at = CASE WHEN status = 'assigned' THEN ? ELSE assigned_at END WHERE id = ? AND status IN ('queued','assigned')")
    .bind(sealedEnv, Date.now(), id)
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
  // No reward without a captured fee (as for jobs): a bill whose hold wasn't there mints nothing and burns nothing.
  if (!(await capture(row.owner, fee))) {
    log.api.warn(`[deployments] ${row.id}: hour of ${fee} µCLD not captured (hold missing) — no bill, no reward`);
    return;
  }
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
  if (isEndpoint(row)) await endReplicas(id, "endpoint stopped by owner");
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

/** Stop every live replica of an endpoint; one that changed state meanwhile is re-read and stopped again. */
async function endReplicas(id: string, reason: string, now = Date.now()): Promise<void> {
  const ended = (r: DeploymentRow) => r.status === "stopped" || r.status === "failed";
  for (const r of (await replicasOf([id])).get(id) ?? []) {
    if (ended(r) || (await endDeployment(r, "stopped", reason, { acked: false, now }))) continue;
    const fresh = await getDeploymentRow(r.id);
    if (fresh && !ended(fresh)) await endDeployment(fresh, "stopped", reason, { acked: false, now });
  }
}

/** What the gateway needs to proxy a deployment (internal: the gateway sends X-Internal-Key). */
export interface PublicRoute {
  id: string;
  state: DeploymentStatus;
  kind: DeploymentKind | "endpoint";
  workstation: boolean;
  /** Served through a node's relay socket: the gateway asks the RelayNode of `targets[i].node` for `targets[i].dep`. */
  relayed: boolean;
  /** What serves it while running: one entry per running replica (an endpoint), else at most one. */
  targets: { node: string; dep: string }[];
  /** Legacy direct nodes only: the node's http endpoint while running; null otherwise. */
  endpoint: string | null;
  /** Endpoints: who may call it, and (auth "key") the sha256 of every live key. */
  auth?: EndpointSpec["auth"];
  keys?: string[];
}

/**
 * Route info; null for a missing id, a direct workstation (reached by its own token URL / SSH, not the gateway) and
 * an endpoint replica (reachable only through its endpoint's route, which carries the key check; by its own id it
 * would be an open door around the key).
 */
export async function publicRoute(id: string): Promise<PublicRoute | null> {
  const row = await getDeploymentRow(id);
  if (!row || (row.workstation && !row.relayed) || row.parent_id) return null;
  if (isEndpoint(row)) {
    const replicas = (await replicasOf([id])).get(id) ?? [];
    const auth = (JSON.parse(row.spec_json) as EndpointSpec).auth;
    const keys = auth === "key" ? await liveKeyHashes(id) : undefined;
    return {
      id: row.id,
      state: endpointStatus(row, replicas),
      kind: "endpoint",
      workstation: false,
      relayed: true,
      targets: replicas.filter((r) => r.status === "running" && r.node).map((r) => ({ node: r.node!, dep: r.id })),
      endpoint: null,
      auth,
      ...(keys && { keys }),
    };
  }
  const running = row.status === "running";
  return {
    id: row.id,
    state: row.status,
    kind: row.kind,
    workstation: !!row.workstation,
    relayed: !!row.relayed,
    targets: running && row.node ? [{ node: row.node, dep: row.id }] : [],
    endpoint: running && !row.relayed ? row.endpoint : null,
  };
}

// ── Endpoint keys (docs/V4_ENDPOINTS_CONTRACT.md) ───────────────────────────
export const KEY_PREFIX = "cld_ek_";
export const MAX_KEYS_PER_ENDPOINT = 20;

export interface EndpointKey {
  id: string;
  name: string;
  /** The first 8 characters after cld_ek_, to tell keys apart in a list. */
  prefix: string;
  createdAt: number;
  revokedAt: number | null;
}

export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

export type KeyResult =
  | { ok: true; key: EndpointKey & { key: string } }
  | { ok: false; code: "not_found" | "validation_failed" | "conflict"; message: string };

/** A new key for an endpoint the owner has. The key itself is returned once; only its hash is stored. */
export async function createKey(owner: string, id: string, name: string, now = Date.now()): Promise<KeyResult> {
  const row = await getOwnedRow(owner, id);
  if (!row) return { ok: false, code: "not_found", message: "deployment not found" };
  if (!isEndpoint(row)) return { ok: false, code: "validation_failed", message: "keys are for endpoints only" };
  const db = getD1();
  const n = await db.prepare("SELECT COUNT(*) AS n FROM endpoint_keys WHERE deployment_id = ? AND revoked_at IS NULL").bind(id).first<{ n: number }>();
  if ((n?.n ?? 0) >= MAX_KEYS_PER_ENDPOINT) return { ok: false, code: "conflict", message: `an endpoint has at most ${MAX_KEYS_PER_ENDPOINT} live keys` };
  const key = KEY_PREFIX + randomBytes(24).toString("hex");
  const k = { id: crypto.randomUUID(), name, prefix: key.slice(KEY_PREFIX.length, KEY_PREFIX.length + 8), createdAt: now, revokedAt: null };
  await db
    .prepare("INSERT INTO endpoint_keys (id, deployment_id, name, prefix, hash, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(k.id, id, name, k.prefix, hashKey(key), now)
    .run();
  await addEvent(id, "info", `key "${name}" (${k.prefix}…) created`, now);
  return { ok: true, key: { ...k, key } };
}

export async function listKeys(owner: string, id: string): Promise<EndpointKey[] | null> {
  const row = await getOwnedRow(owner, id);
  if (!row || !isEndpoint(row)) return null;
  const res = await getD1()
    .prepare("SELECT id, name, prefix, created_at, revoked_at FROM endpoint_keys WHERE deployment_id = ? ORDER BY created_at")
    .bind(id)
    .all<{ id: string; name: string; prefix: string; created_at: number; revoked_at: number | null }>();
  return (res.results ?? []).map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, createdAt: k.created_at, revokedAt: k.revoked_at }));
}

export async function revokeKey(owner: string, id: string, keyId: string, now = Date.now()): Promise<Update> {
  const row = await getOwnedRow(owner, id);
  if (!row || !isEndpoint(row)) return { ok: false, code: "not_found", message: "deployment not found" };
  const r = await getD1()
    .prepare("UPDATE endpoint_keys SET revoked_at = ? WHERE id = ? AND deployment_id = ? AND revoked_at IS NULL")
    .bind(now, keyId, id)
    .run();
  if ((r.meta?.changes ?? 0) === 0) return { ok: false, code: "not_found", message: "key not found or already revoked" };
  await addEvent(id, "warn", `key ${keyId.slice(0, 8)}… revoked`, now);
  return { ok: true };
}

async function liveKeyHashes(id: string): Promise<string[]> {
  const res = await getD1().prepare("SELECT hash FROM endpoint_keys WHERE deployment_id = ? AND revoked_at IS NULL").bind(id).all<{ hash: string }>();
  return (res.results ?? []).map((k) => k.hash);
}

/**
 * Admin stop (internal key): status 'stopped', reason 'admin'. Like an owner stop, the node then receives
 * action "stop" on its heartbeats until it confirms (stop_acked_at stays NULL). Idempotent once ended.
 */
export async function adminStop(id: string): Promise<Update> {
  const row = await getDeploymentRow(id);
  if (!row) return { ok: false, code: "not_found", message: "deployment not found" };
  if (isEndpoint(row)) await endReplicas(id, "admin");
  if (row.status === "stopped" || row.status === "failed") return { ok: true };
  if (!(await endDeployment(row, "stopped", "admin", { acked: false, level: "warn" }))) {
    return { ok: false, code: "conflict", message: "deployment changed while stopping — retry" };
  }
  return { ok: true };
}

// ── Container logs through the relay (ENGINEERING_BACKLOG B-14) ─────────────
export const LOGS_TAIL_DEFAULT = 200;
export const LOGS_TAIL_MAX = 1000;
/** Most the API hands back (the agent's ops server keeps the same cap). */
export const LOGS_MAX_BYTES = 64 * 1024;
const LOGS_TIMEOUT_MS = 10_000;
/** Agents from this version serve the reserved relay dep "agent" (`GET /logs/{id}`, node-agent/src/ops.ts). */
export const LOGS_MIN_AGENT = "1.6.0";

export type LogsResult =
  | { ok: true; id: string; node: string | null; tail: number; source: "node" | "last_failure"; logs: string; truncated: boolean }
  | { ok: false; code: "not_found" | "validation_failed" | "conflict" | "not_configured" | "upstream_failed"; message: string };

/**
 * The owner's view of a container's last log lines, read live from its node through the relay (nothing is stored
 * here). A deployment no longer on a node answers with the tail its last failure report kept, if any.
 */
export async function deploymentLogs(owner: string, id: string, tail = LOGS_TAIL_DEFAULT): Promise<LogsResult> {
  const row = await getOwnedRow(owner, id);
  if (!row) return { ok: false, code: "not_found", message: "deployment not found" };
  if (row.kind !== "container") return { ok: false, code: "validation_failed", message: "logs are for containers, workstations and endpoint replicas; a static site has none" };
  if (isEndpoint(row)) {
    return { ok: false, code: "validation_failed", message: "ask a replica: GET /deployments/{replicaId}/logs (replica ids are in GET /deployments/{id}.replicas)" };
  }
  const onNode = !!row.node && (row.status === "assigned" || row.status === "running" || row.status === "unreachable");
  if (!onNode) {
    if (row.last_logs) return { ok: true, id: row.id, node: row.node, tail, source: "last_failure", logs: row.last_logs, truncated: false };
    return { ok: false, code: "conflict", message: `no node runs it now (status ${row.status}) and no failure logs were kept` };
  }
  if (!row.relayed) return { ok: false, code: "conflict", message: "this deployment runs on a direct (public-IP) node; logs are served through the relay only" };
  const relay = getRelay();
  if (!relay) return { ok: false, code: "not_configured", message: "this API runs no relay" };
  let res: Response;
  try {
    res = await relay(row.node!, "/proxy", {
      method: "GET",
      headers: { "x-relay-dep": "agent", "x-relay-class": "endpoint", "x-relay-path": `/logs/${row.id}?tail=${tail}`, "x-relay-probe": "1" },
      signal: AbortSignal.timeout(LOGS_TIMEOUT_MS),
    });
  } catch (err) {
    const timeout = (err as Error)?.name === "TimeoutError";
    return { ok: false, code: "upstream_failed", message: timeout ? "the node did not answer within 10 s" : `relay: ${(err as Error).message}` };
  }
  const relayError = res.headers.get("x-relay-error");
  if (relayError) {
    await res.body?.cancel().catch(() => undefined);
    const why =
      relayError === "not_serving" ? `the node's agent does not serve logs (agents from ${LOGS_MIN_AGENT} do)`
      : relayError === "offline" ? "the node's relay socket is down"
      : `relay: ${relayError}`;
    return { ok: false, code: "upstream_failed", message: why };
  }
  if (res.status === 404) {
    await res.body?.cancel().catch(() => undefined);
    return { ok: false, code: "conflict", message: "the node no longer runs it" };
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    return { ok: false, code: "upstream_failed", message: `the node answered ${res.status}` };
  }
  let text: string;
  try {
    // The node is untrusted: read at most a little over the cap, never its whole stream.
    const bytes = await readCapped(res, LOGS_MAX_BYTES * 2);
    text = bytes ? new TextDecoder().decode(bytes) : "";
    if (!bytes) return { ok: false, code: "upstream_failed", message: "the node sent more than the logs cap" };
  } catch {
    return { ok: false, code: "upstream_failed", message: "the node broke off while sending logs" };
  }
  const over = text.length > LOGS_MAX_BYTES;
  return { ok: true, id: row.id, node: row.node, tail, source: "node", logs: over ? text.slice(-LOGS_MAX_BYTES) : text, truncated: over || res.headers.get("x-cld-truncated") === "1" };
}
