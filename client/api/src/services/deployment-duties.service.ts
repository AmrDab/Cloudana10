/**
 * Orchestrator duties for hosted deployments (V3 §4, docs/IMPL_SPEC_2026-10.md).
 *
 * Global duties run from the cron (runDutiesCron — integration wires the Worker `scheduled` handler),
 * never from a heartbeat, so a swarm of node keys cannot make every heartbeat scan the whole table:
 *   G1. re-queue live deployments of nodes silent for DEAD_NODE_FACTOR × NODE_ACTIVE_SECONDS
 *   G2. preempt the youngest interruptible workstation for on-demand work no online node can take
 *   G3. matmul job assignment (jobs.service runAssignment)
 *
 * Per-node duties run inside that node's heartbeat (runDeploymentDuties):
 *   N1. auto-stop this node's workstations past maxHours
 *   N2. assign queued deployments this node can run (capability + fleet + resource fit; GPUs for workstations)
 *   N3. probe this node's running/unreachable deployments that are due (content hash when the row has one)
 *   N4. bill this node's running deployments for each full hour since last_billed_at
 *   N5. return the node's instructions: "start" for assigned, "stop" for stopped-but-unconfirmed
 *       and for deployments taken from this node while it was offline
 * plus the node's own status reports (POST /nodes/deployments/{id}/status).
 */
import { createHash } from "node:crypto";
import { getD1 } from "../lib/storage.js";
import { getEnv } from "../config/env.js";
import { log } from "../lib/logger.js";
import { normalizeAddress } from "../lib/eth.js";
import { hold } from "./balance.service.js";
import {
  HOUR_MS,
  addEvent,
  awaitingSecrets,
  chargeHour,
  endDeployment,
  getDeploymentRow,
  type DeploymentRow,
} from "./deployments.service.js";
import { endpointAllowed, type ApiKind, type ContainerSpec, type DeploymentKind, type WorkstationSpec } from "./deployment-spec.js";
import { gpusFit, type Gpu, type GpuRequest } from "./workstation.js";
import { runAssignment } from "./jobs.service.js";
import { WORKSTATION_TEMPLATES } from "./template-workstations.js";
import type { NodeManifest } from "./nodes.service.js";

/** Live deployments per node, per kind. */
export const NODE_CAPACITY: Record<DeploymentKind, number> = { static: 20, container: 5 };
const PROBE_TIMEOUT_MS = 3000;
const PROBE_MAX_BYTES = 4 * 1024 * 1024;
/** Hours billed per heartbeat at most (a long-silent orchestrator catches up over a few beats). */
const MAX_HOURS_PER_BEAT = 24;
/** RAM kept back for the host when fitting containers onto a node. */
const HOST_RESERVE_MB = 1024;

export interface NodeInstruction {
  id: string;
  /** "purge" = stop and also delete the workstation's volume (owner asked, DELETE ?purge=1). */
  action: "start" | "stop" | "purge";
  kind: ApiKind;
  /** Full spec (container env included) for "start"; null for "stop". */
  spec: Record<string, unknown> | null;
  sealedEnv?: string;
  /** Containers/workstations: the image is on the curated list (or IMAGE_ALLOWLIST). The agent refuses others. */
  imageAllowed?: boolean;
}

const LIVE = "('assigned','running','unreachable')";
/** A node silent for this many NODE_ACTIVE_SECONDS has gone offline: its deployments are re-queued. */
export const DEAD_NODE_FACTOR = 3;

/**
 * Re-queue the live deployments of `rows` (their nodes went offline or were unbound). Billing pauses
 * (last_billed_at cleared) and the current hour's hold stays held for the next node. The old node is
 * owed a "stop" (deployment_stale_nodes) in case it comes back still serving. Secrets were sealed to
 * the old node's key, so they are cleared and the next start waits for the owner to re-seal.
 */
async function requeueRows(rows: DeploymentRow[], reason: string, now: number): Promise<number> {
  const db = getD1();
  let requeued = 0;
  for (const row of rows) {
    const reseal = row.sealed_env !== null;
    const spec = reseal ? JSON.stringify({ ...JSON.parse(row.spec_json), expectsSecrets: true }) : row.spec_json;
    const r = await db
      .prepare(
        "UPDATE deployments SET status = 'queued', status_reason = ?, node = NULL, endpoint = NULL, ssh_endpoint = NULL, web_token = NULL, " +
          "assigned_at = NULL, last_billed_at = NULL, last_probe_at = NULL, probe_fail = 0, sealed_env = NULL, spec_json = ? " +
          "WHERE id = ? AND status = ? AND node = ?",
      )
      .bind(reason, spec, row.id, row.status, row.node)
      .run();
    if ((r.meta?.changes ?? 0) === 0) continue;
    requeued++;
    await db
      .prepare("INSERT OR IGNORE INTO deployment_stale_nodes (deployment_id, node, at) VALUES (?, ?, ?)")
      .bind(row.id, row.node, now)
      .run();
    await addEvent(row.id, "warn", `${reason} — re-queued`, now);
    if (reseal) await addEvent(row.id, "warn", "secrets were sealed to the old node — re-seal them for the next node", now);
  }
  return requeued;
}

/** G1: re-queue live deployments whose node went offline (all of them, or one owner's). */
export async function requeueDeadNodeDeployments(now = Date.now(), owner?: string): Promise<number> {
  const cutoff = now - DEAD_NODE_FACTOR * getEnv().NODE_ACTIVE_SECONDS * 1000;
  const rows = await getD1()
    .prepare(
      `SELECT d.* FROM deployments d LEFT JOIN nodes n ON n.address = d.node ` +
        `WHERE d.status IN ${LIVE} AND COALESCE(n.last_seen, 0) < ?${owner ? " AND d.owner = ?" : ""}`,
    )
    .bind(...(owner ? [cutoff, normalizeAddress(owner)] : [cutoff]))
    .all<DeploymentRow>();
  return requeueRows(rows.results ?? [], "node went offline", now);
}

/** Re-queue everything live on `nodes` (they were unbound: fleet revoked or node evicted). */
export async function requeueNodeDeployments(nodes: string[], reason: string, now = Date.now()): Promise<number> {
  if (nodes.length === 0) return 0;
  const rows = await getD1()
    .prepare(`SELECT * FROM deployments WHERE status IN ${LIVE} AND node IN (${nodes.map(() => "?").join(",")})`)
    .bind(...nodes.map(normalizeAddress))
    .all<DeploymentRow>();
  return requeueRows(rows.results ?? [], reason, now);
}

type Queued = Pick<DeploymentRow, "id" | "kind" | "spec_json" | "sealed_env" | "workstation">;

/** What a node has in use for containers + workstations (they share NODE_CAPACITY.container). */
interface NodeState {
  caps: string[];
  gpus: Gpu[];
  /** Millicores / MB the node has for tenants (manifest minus a host reserve). */
  cpuCapacity: number;
  memCapacityMb: number;
  containers: number;
  gpusUsed: number;
  cpuUsed: number;
  memUsedMb: number;
}

type NodeHardware = Pick<NodeManifest, "cpuThreads" | "ramGB" | "gpus">;

function nodeState(caps: string[], hw: Partial<NodeHardware> | null | undefined): NodeState {
  return {
    caps,
    gpus: (hw?.gpus ?? []) as Gpu[],
    cpuCapacity: Math.max(0, (hw?.cpuThreads ?? 0) * 1000),
    memCapacityMb: Math.max(0, (hw?.ramGB ?? 0) * 1024 - HOST_RESERVE_MB),
    containers: 0,
    gpusUsed: 0,
    cpuUsed: 0,
    memUsedMb: 0,
  };
}

const specOf = (r: Pick<DeploymentRow, "spec_json">) => JSON.parse(r.spec_json) as ContainerSpec & Partial<WorkstationSpec>;
const gpuRequest = (r: Pick<DeploymentRow, "workstation" | "spec_json">): GpuRequest | undefined => (r.workstation ? specOf(r).gpu : undefined);
const gpusHeld = (r: Pick<DeploymentRow, "workstation" | "spec_json">) => gpuRequest(r)?.count ?? 0;

/**
 * docs/WORKSTATIONS.md §3 + spec: container capability, gpu capability if GPUs are asked for, free matching
 * GPUs, ≤ 5 per node, and the spec's cpu/memMb must fit what the node has left.
 */
function fits(q: Pick<DeploymentRow, "workstation" | "spec_json">, n: NodeState): boolean {
  if (!n.caps.includes("container") || n.containers >= NODE_CAPACITY.container) return false;
  const req = gpuRequest(q);
  if (req && req.count > 0 && !n.caps.includes("gpu")) return false;
  const spec = specOf(q);
  if (n.cpuUsed + (spec.cpu ?? 0) > n.cpuCapacity || n.memUsedMb + (spec.memMb ?? 0) > n.memCapacityMb) return false;
  return gpusFit(n.gpus, n.gpusUsed, req);
}

function addUsage(n: NodeState, r: Pick<DeploymentRow, "workstation" | "spec_json">, sign: 1 | -1): void {
  const spec = specOf(r);
  n.containers += sign;
  n.gpusUsed += sign * gpusHeld(r);
  n.cpuUsed += sign * (spec.cpu ?? 0);
  n.memUsedMb += sign * (spec.memMb ?? 0);
}

async function claim(node: string, q: Queued, now: number): Promise<boolean> {
  const db = getD1();
  const r = await db
    .prepare("UPDATE deployments SET status = 'assigned', node = ?, assigned_at = ? WHERE id = ? AND status = 'queued'")
    .bind(node, now, q.id)
    .run();
  if ((r.meta?.changes ?? 0) === 0) return false;
  // Back on the node that lost it: its "start" replaces the owed stop.
  await db.prepare("DELETE FROM deployment_stale_nodes WHERE deployment_id = ? AND node = ?").bind(q.id, node).run();
  await addEvent(q.id, "info", `assigned to node ${node}`, now);
  if (awaitingSecrets(q)) await addEvent(q.id, "info", "waiting for sealed secrets", now);
  return true;
}

/**
 * N2. Static sites go to any bound hosting node. Containers and workstations go only to nodes that announced
 * `container` AND belong to a fleet (testnet: home nodes do compute + static hosting only).
 */
async function assign(node: string, capabilities: string[], hw: NodeHardware | null, fleetId: string | null, now: number): Promise<void> {
  const db = getD1();
  if (capabilities.includes("hosting")) {
    const live = await db
      .prepare(`SELECT COUNT(*) AS n FROM deployments WHERE node = ? AND kind = 'static' AND status IN ${LIVE}`)
      .bind(node)
      .first<{ n: number }>();
    const room = NODE_CAPACITY.static - (live?.n ?? 0);
    if (room > 0) {
      const queued = await db
        .prepare(
          "SELECT id, kind, spec_json, sealed_env, workstation, status_reason FROM deployments WHERE status = 'queued' AND kind = 'static' " +
            "ORDER BY created_at LIMIT ?",
        )
        .bind(room + 5)
        .all<Queued & Pick<DeploymentRow, "status_reason">>();
      let taken = 0;
      for (const q of queued.results ?? []) {
        if (taken >= room) break;
        if (q.status_reason?.startsWith(nodeRefusalPrefix(node))) continue; // this node just refused it
        if (await claim(node, q, now)) taken++;
      }
    }
  }
  if (!capabilities.includes("container") || !fleetId) return;
  const live = await db
    .prepare(`SELECT workstation, spec_json FROM deployments WHERE node = ? AND kind = 'container' AND status IN ${LIVE}`)
    .bind(node)
    .all<Pick<DeploymentRow, "workstation" | "spec_json">>();
  const state = nodeState(capabilities, hw);
  for (const r of live.results ?? []) addUsage(state, r, 1);
  if (state.containers >= NODE_CAPACITY.container) return;
  // Containers and workstations in arrival order; one that does not fit here does not block the rest.
  const queued = await db
    .prepare(
      "SELECT id, kind, spec_json, sealed_env, workstation, status_reason FROM deployments WHERE status = 'queued' AND kind = 'container' " +
        "ORDER BY created_at LIMIT 50",
    )
    .all<Queued & Pick<DeploymentRow, "status_reason">>();
  for (const q of queued.results ?? []) {
    if (state.containers >= NODE_CAPACITY.container) break;
    if (q.status_reason === gpuRefusalReason(node) || q.status_reason?.startsWith(nodeRefusalPrefix(node))) continue; // this node just refused it
    if (fits(q, state) && (await claim(node, q, now))) addUsage(state, q, 1);
  }
}

/** When a deployment started on its node (youngest = largest). */
const startedAt = (r: DeploymentRow) => r.started_at ?? r.assigned_at ?? r.created_at;

/**
 * G2. Preemption (docs/WORKSTATIONS.md §3): a queued on-demand container/workstation that no online fleet node
 * can take now stops the youngest interruptible workstation whose node would then fit it. Elapsed time is
 * billed pro rata (endDeployment → settleHold); the volume is the node's to keep. On-demand is never preempted.
 */
export async function preemptForOnDemand(now = Date.now()): Promise<number> {
  const db = getD1();
  const queued = await db
    .prepare(
      "SELECT id, kind, spec_json, sealed_env, workstation FROM deployments WHERE status = 'queued' AND kind = 'container' " +
        "AND (workstation = 0 OR json_extract(spec_json, '$.tier') = 'on-demand') ORDER BY created_at LIMIT 20",
    )
    .all<Queued>();
  if (!queued.results?.length) return 0;
  const nodes = await db
    .prepare("SELECT address, work_types, manifest_json FROM nodes WHERE payout IS NOT NULL AND fleet_id IS NOT NULL AND last_seen >= ?")
    .bind(now - getEnv().NODE_ACTIVE_SECONDS * 1000)
    .all<{ address: string; work_types: string | null; manifest_json: string | null }>();
  const states = new Map<string, NodeState & { victims: DeploymentRow[] }>();
  for (const n of nodes.results ?? []) {
    const caps = JSON.parse(n.work_types ?? "[]") as string[];
    if (!caps.includes("container")) continue;
    states.set(n.address, { ...nodeState(caps, JSON.parse(n.manifest_json ?? "{}")), victims: [] });
  }
  const live = await db.prepare(`SELECT * FROM deployments WHERE kind = 'container' AND status IN ${LIVE}`).all<DeploymentRow>();
  for (const r of live.results ?? []) {
    const s = r.node ? states.get(r.node) : undefined;
    if (!s) continue;
    addUsage(s, r, 1);
    if (r.workstation && (JSON.parse(r.spec_json) as WorkstationSpec).tier === "interruptible") s.victims.push(r);
  }
  let preempted = 0;
  for (const q of queued.results) {
    const fitting = [...states.values()].find((s) => fits(q, s));
    if (fitting) {
      addUsage(fitting, q, 1); // it will be assigned there; do not count that room twice
      continue;
    }
    let best: { s: NodeState & { victims: DeploymentRow[] }; v: DeploymentRow } | null = null;
    for (const s of states.values()) {
      for (const v of s.victims) {
        const trial = { ...s };
        addUsage(trial, v, -1);
        if (fits(q, trial) && (!best || startedAt(v) > startedAt(best.v))) best = { s, v };
      }
    }
    if (!best) continue;
    if (!(await endDeployment(best.v, "stopped", "preempted by on-demand work", { acked: false, level: "warn", now }))) continue;
    preempted++;
    best.s.victims = best.s.victims.filter((v) => v.id !== best!.v.id);
    addUsage(best.s, best.v, -1);
    addUsage(best.s, q, 1);
  }
  return preempted;
}

/** N1. Auto-stop (docs/WORKSTATIONS.md §3): this node's workstations past startedAt + maxHours. */
async function autoStop(node: string, now: number): Promise<void> {
  const rows = await getD1()
    .prepare(
      "SELECT * FROM deployments WHERE node = ? AND workstation = 1 AND status IN ('running','unreachable') AND started_at IS NOT NULL " +
        "AND started_at + json_extract(spec_json, '$.maxHours') * ? <= ?",
    )
    .bind(node, HOUR_MS, now)
    .all<DeploymentRow>();
  for (const r of rows.results ?? []) await endDeployment(r, "stopped", "max hours reached", { acked: false, now });
}

/** A reported endpoint may carry a token path/query (Jupyter, code-server): probe only its origin then. */
export function probeTarget(endpoint: string): string {
  const u = new URL(endpoint);
  return u.pathname === "/" && !u.search && !u.hash ? endpoint : `${u.origin}/`;
}

/** URL of the content probe: `probePath` (relative, no leading slash) under the endpoint's origin. */
export function probeUrl(endpoint: string, probePath: string): string {
  return `${new URL(endpoint).origin}/${probePath.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/")}`;
}

export const sha256Hex = (data: ArrayBuffer | Uint8Array) => createHash("sha256").update(new Uint8Array(data)).digest("hex");

/**
 * One probe. With a content hash: GET the probe path and require sha256(body) == probe_hash (a node that
 * points its endpoint at any live site, or serves other content, fails). Without one: reachability (2xx/3xx).
 */
export async function probeOne(endpoint: string, probe?: { path: string; hash: string } | null): Promise<boolean> {
  try {
    if (probe) {
      const res = await fetch(probeUrl(endpoint, probe.path), { method: "GET", redirect: "manual", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      if (res.status !== 200) {
        await res.body?.cancel().catch(() => undefined);
        return false;
      }
      const len = Number(res.headers.get("content-length") ?? 0);
      if (len > PROBE_MAX_BYTES) {
        await res.body?.cancel().catch(() => undefined);
        return false;
      }
      const body = await res.arrayBuffer();
      return body.byteLength <= PROBE_MAX_BYTES && sha256Hex(body) === probe.hash.toLowerCase();
    }
    const res = await fetch(probeTarget(endpoint), { method: "GET", redirect: "manual", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    await res.body?.cancel().catch(() => undefined);
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  }
}

const probeOf = (r: DeploymentRow) => (r.probe_path && r.probe_hash ? { path: r.probe_path, hash: r.probe_hash } : null);

/** N3. */
async function probe(node: string, now: number): Promise<void> {
  const env = getEnv();
  const db = getD1();
  const due = await db
    .prepare(
      "SELECT * FROM deployments WHERE node = ? AND status IN ('running','unreachable') AND endpoint IS NOT NULL " +
        "AND (last_probe_at IS NULL OR last_probe_at <= ?)",
    )
    .bind(node, now - env.DEPLOY_PROBE_SECONDS * 1000)
    .all<DeploymentRow>();
  const rows = due.results ?? [];
  const results = await Promise.all(rows.map((r) => (endpointAllowed(r.endpoint!, env.DEV_MODE) ? probeOne(r.endpoint!, probeOf(r)) : false)));
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (results[i]) {
      if (row.status === "unreachable") {
        // Billing resumes with a fresh hour: the outage and the partial hour before it are not charged.
        await db
          .prepare(
            "UPDATE deployments SET status = 'running', status_reason = NULL, probe_fail = 0, last_probe_at = ?, last_billed_at = ? " +
              "WHERE id = ? AND status = 'unreachable'",
          )
          .bind(now, now, row.id)
          .run();
        await addEvent(row.id, "info", "probe ok — reachable again; billing resumed", now);
      } else {
        await db.prepare("UPDATE deployments SET probe_fail = 0, last_probe_at = ? WHERE id = ?").bind(now, row.id).run();
      }
      continue;
    }
    const fails = row.probe_fail + 1;
    const toUnreachable = row.status === "running" && fails >= env.DEPLOY_PROBE_FAILS;
    await db
      .prepare(
        `UPDATE deployments SET probe_fail = ?, last_probe_at = ?${toUnreachable ? ", status = 'unreachable', status_reason = ?" : ""} ` +
          "WHERE id = ? AND status = ?",
      )
      .bind(...(toUnreachable ? [fails, now, `${fails} failed probes`, row.id, row.status] : [fails, now, row.id, row.status]))
      .run();
    const what = probeOf(row) ? "content probe failed" : "probe failed";
    if (toUnreachable) await addEvent(row.id, "error", `unreachable after ${fails} failed probes — billing paused`, now);
    else if (row.status === "running") await addEvent(row.id, "warn", `${what} (${fails}/${env.DEPLOY_PROBE_FAILS})`, now);
  }
}

/** N4. */
async function bill(node: string, now: number): Promise<void> {
  const db = getD1();
  const due = await db
    .prepare("SELECT * FROM deployments WHERE node = ? AND status = 'running' AND last_billed_at IS NOT NULL AND last_billed_at <= ?")
    .bind(node, now - HOUR_MS)
    .all<DeploymentRow>();
  for (const start of due.results ?? []) {
    let row = start;
    for (let h = 0; h < MAX_HOURS_PER_BEAT && row.last_billed_at! + HOUR_MS <= now; h++) {
      const fee = row.price_ucld_per_hour;
      const next = row.last_billed_at! + HOUR_MS;
      // Claim this hour first (held_ucld → 0) so a concurrent heartbeat cannot bill it twice.
      const claimed = await db
        .prepare("UPDATE deployments SET held_ucld = 0, last_billed_at = ? WHERE id = ? AND status = 'running' AND last_billed_at = ? AND held_ucld = ?")
        .bind(next, row.id, row.last_billed_at, fee)
        .run();
      if ((claimed.meta?.changes ?? 0) === 0) break;
      await chargeHour(row, fee, now);
      await addEvent(row.id, "info", `billed ${fee} µCLD for one hour`, now);
      if (await hold(row.owner, fee)) {
        await db.prepare("UPDATE deployments SET held_ucld = ? WHERE id = ?").bind(fee, row.id).run();
        row = { ...row, last_billed_at: next, held_ucld: fee };
      } else {
        await endDeployment({ ...row, last_billed_at: next, held_ucld: 0 }, "stopped", "out of credits", { acked: false, level: "warn", now });
        break;
      }
    }
  }
}

let curatedImages: Set<string> | null = null;
/** Curated images (workstation templates) plus IMAGE_ALLOWLIST (comma-separated regexes, optional env). */
export function imageAllowed(image: string): boolean {
  curatedImages ??= new Set(WORKSTATION_TEMPLATES.map((t) => t.image).filter((i): i is string => !!i));
  if (curatedImages.has(image)) return true;
  const extra = process.env.IMAGE_ALLOWLIST?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  return extra.some((re) => {
    try {
      return new RegExp(`^(?:${re})$`).test(image);
    } catch {
      return false;
    }
  });
}

/** N5. */
async function instructions(node: string): Promise<NodeInstruction[]> {
  const db = getD1();
  const rows = await db
    .prepare(
      "SELECT * FROM deployments WHERE node = ? AND (status = 'assigned' OR (status IN ('stopped','failed') AND stop_acked_at IS NULL)) " +
        "ORDER BY created_at",
    )
    .bind(node)
    .all<DeploymentRow>();
  const stale = await db
    .prepare(
      "SELECT d.id, d.kind, d.workstation FROM deployment_stale_nodes s JOIN deployments d ON d.id = s.deployment_id WHERE s.node = ? ORDER BY s.at",
    )
    .bind(node)
    .all<Pick<DeploymentRow, "id" | "kind" | "workstation">>();
  const kindOf = (r: Pick<DeploymentRow, "kind" | "workstation">): ApiKind => (r.workstation ? "workstation" : r.kind);
  // A container expecting secrets gets "start" only once sealed_env is set (PATCH …/secrets).
  const own: NodeInstruction[] = (rows.results ?? []).filter((r) => r.status !== "assigned" || !awaitingSecrets(r)).map((r) => {
    if (r.status !== "assigned") return { id: r.id, action: r.purge_pending ? "purge" : "stop", kind: kindOf(r), spec: null };
    const spec = JSON.parse(r.spec_json) as Record<string, unknown>;
    return {
      id: r.id,
      action: "start",
      kind: kindOf(r),
      spec,
      ...(r.sealed_env && { sealedEnv: r.sealed_env }),
      ...(r.kind === "container" && { imageAllowed: imageAllowed(String(spec.image ?? "")) }),
    };
  });
  const all = [...own, ...(stale.results ?? []).map((r): NodeInstruction => ({ id: r.id, action: "stop", kind: kindOf(r), spec: null }))];
  // Stops first, so a preempted workstation frees its GPUs before the work that preempted it starts.
  return [...all.filter((i) => i.action !== "start"), ...all.filter((i) => i.action === "start")];
}

/** Everything a heartbeat does for hosting (per-node duties only). Unbound nodes get no new work but still receive stops. */
export async function runDeploymentDuties(node: string, now = Date.now()): Promise<NodeInstruction[]> {
  const row = await getD1()
    .prepare("SELECT payout, work_types, manifest_json, fleet_id FROM nodes WHERE address = ?")
    .bind(node)
    .first<{ payout: string | null; work_types: string | null; manifest_json: string | null; fleet_id: string | null }>();
  if (!row) return [];
  const hw = JSON.parse(row.manifest_json ?? "{}") as NodeHardware;
  const steps: [string, () => Promise<unknown>][] = [
    ["auto-stop", () => autoStop(node, now)],
    ["assign", () => (row.payout ? assign(node, JSON.parse(row.work_types ?? "[]") as string[], hw, row.fleet_id, now) : Promise.resolve())],
    ["probe", () => probe(node, now)],
    ["bill", () => bill(node, now)],
  ];
  for (const [name, step] of steps) {
    try {
      await step();
    } catch (err) {
      log.api.warn(`[deployments] ${name} on heartbeat failed:`, err);
    }
  }
  return instructions(node);
}

export interface DutiesCronResult {
  requeued: number;
  preempted: number;
  assigned: number;
}

/** Worker bindings as the `scheduled` handler receives them (integration passes `env` through). */
interface CronBindings {
  DB?: D1Database;
  CLOUDANA_KV?: KVNamespace;
  [key: string]: unknown;
}

/**
 * Global duties, run from the cron (every minute is right: NODE_ACTIVE_SECONDS × DEAD_NODE_FACTOR ≫ 60 s).
 * With Worker bindings given, storage and env are initialised first (the `scheduled` handler has no request
 * middleware). Each step is isolated: one failing never skips the others.
 */
export async function runDutiesCron(env?: CronBindings, now = Date.now()): Promise<DutiesCronResult> {
  if (env?.DB && env.CLOUDANA_KV) {
    const { initStorage } = await import("../lib/storage.js");
    const { resetEnv } = await import("../config/env.js");
    let changed = false;
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === "string" && process.env[key] !== value) {
        process.env[key] = value;
        changed = true;
      }
    }
    if (changed) resetEnv();
    initStorage(env.DB, env.CLOUDANA_KV);
  }
  const out: DutiesCronResult = { requeued: 0, preempted: 0, assigned: 0 };
  const steps: [keyof DutiesCronResult, () => Promise<number>][] = [
    ["requeued", () => requeueDeadNodeDeployments(now)],
    ["preempted", () => preemptForOnDemand(now)],
    ["assigned", () => runAssignment(now)],
  ];
  for (const [name, step] of steps) {
    try {
      out[name] = await step();
    } catch (err) {
      log.api.warn(`[duties-cron] ${name} failed:`, err);
    }
  }
  return out;
}

/** The agent's message when `docker run --gpus` finds fewer free GPUs than assigned. */
const GPU_REFUSAL = /not enough free GPUs/i;
/** status_reason of a workstation re-queued after a GPU refusal; assign() skips that node for it. */
export const gpuRefusalReason = (node: string) => `not enough free GPUs on node ${node}`;
/** The agent reports `failed` with this prefix when it cannot serve a deployment at all (e.g. its endpoint was refused). */
export const NODE_CANNOT_SERVE = "node cannot serve:";
const nodeRefusalPrefix = (node: string) => `refused by node ${node}:`;

export type StatusReport = { status: "running" | "failed" | "stopped"; endpoint?: string; sshEndpoint?: string; webToken?: string; message?: string };
export type ReportResult = { ok: true; status: string } | { ok: false; code: "not_found" | "conflict" | "validation_failed"; message: string };

const hostOf = (url: string) => new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "");

/** A node reports what happened to a deployment it was given. */
export async function reportDeploymentStatus(node: string, id: string, report: StatusReport, now = Date.now()): Promise<ReportResult> {
  const db = getD1();
  const row = await getDeploymentRow(id);
  if (row && row.node !== node && report.status !== "running") {
    // A node that lost this deployment while offline confirms the stop it was owed.
    const r = await db.prepare("DELETE FROM deployment_stale_nodes WHERE deployment_id = ? AND node = ?").bind(id, node).run();
    if ((r.meta?.changes ?? 0) > 0) {
      await addEvent(id, "info", `previous node ${node} confirmed ${report.status}`, now);
      return { ok: true, status: "stopped" };
    }
  }
  if (!row || row.node !== node) return { ok: false, code: "not_found", message: "deployment not found on this node" };

  if (report.status === "running") {
    if (row.status === "stopped" || row.status === "failed") {
      // e.g. the agent re-reporting saved deployments on boot: accept, and owe it a stop again.
      if (row.stop_acked_at !== null) {
        await db.prepare("UPDATE deployments SET stop_acked_at = NULL WHERE id = ?").bind(id).run();
        await addEvent(id, "warn", "node reports it is still running — stop re-sent", now);
      }
      return { ok: true, status: row.status };
    }
    const dev = getEnv().DEV_MODE;
    if (report.endpoint && !endpointAllowed(report.endpoint, dev)) {
      return { ok: false, code: "validation_failed", message: "endpoint must be a public http(s) address" };
    }
    if (report.webToken && !row.workstation) {
      return { ok: false, code: "validation_failed", message: "webToken is for workstations only" };
    }
    if (report.sshEndpoint && (!row.workstation || !endpointAllowed(`http://${report.sshEndpoint}`, dev))) {
      return { ok: false, code: "validation_failed", message: "sshEndpoint must be a public host:port of a workstation" };
    }
    // Billing fraud guard: endpoints must live on the host the node announced, never on some other live site.
    if (report.endpoint || report.sshEndpoint) {
      const n = await db.prepare("SELECT public_host FROM nodes WHERE address = ?").bind(node).first<{ public_host: string | null }>();
      const announced = n?.public_host?.toLowerCase() ?? null;
      const hosts = [report.endpoint && hostOf(report.endpoint), report.sshEndpoint && hostOf(`http://${report.sshEndpoint}`)].filter(Boolean);
      if (!announced || hosts.some((h) => h !== announced)) {
        return { ok: false, code: "validation_failed", message: "endpoint host must be the node's announced public host" };
      }
    }
    // A workstation with SSH access only has no web endpoint.
    if (row.status === "assigned" && !report.endpoint && !(row.workstation && report.sshEndpoint)) {
      return { ok: false, code: "validation_failed", message: "endpoint is required when a deployment starts running" };
    }
    if (row.status === "assigned") {
      const r = await db
        .prepare(
          "UPDATE deployments SET status = 'running', status_reason = NULL, endpoint = ?, ssh_endpoint = ?, web_token = ?, started_at = ?, " +
            "last_billed_at = ?, probe_fail = 0 WHERE id = ? AND status = 'assigned'",
        )
        .bind(report.endpoint ?? null, report.sshEndpoint ?? null, report.webToken ?? null, now, now, id)
        .run();
      const at = [report.endpoint, report.sshEndpoint && `ssh ${report.sshEndpoint}`].filter(Boolean).join(" · ");
      if ((r.meta?.changes ?? 0) > 0) await addEvent(id, "info", `running at ${at}${report.message ? ` — ${report.message}` : ""}`, now);
      return { ok: true, status: "running" };
    }
    if (row.status === "running" || row.status === "unreachable") {
      if (report.endpoint && row.endpoint !== report.endpoint) {
        await db.prepare("UPDATE deployments SET endpoint = ? WHERE id = ?").bind(report.endpoint, id).run();
        await addEvent(id, "info", `endpoint changed to ${report.endpoint}`, now);
      }
      if (report.sshEndpoint && row.ssh_endpoint !== report.sshEndpoint) {
        await db.prepare("UPDATE deployments SET ssh_endpoint = ? WHERE id = ?").bind(report.sshEndpoint, id).run();
        await addEvent(id, "info", `ssh endpoint changed to ${report.sshEndpoint}`, now);
      }
      if (report.webToken && row.web_token !== report.webToken) {
        await db.prepare("UPDATE deployments SET web_token = ? WHERE id = ?").bind(report.webToken, id).run();
      }
      return { ok: true, status: row.status };
    }
    return { ok: false, code: "conflict", message: `deployment is ${row.status}` };
  }

  if (row.status === "stopped" || row.status === "failed") {
    if (row.stop_acked_at === null) {
      await db.prepare("UPDATE deployments SET stop_acked_at = ?, purge_pending = 0 WHERE id = ?").bind(now, id).run();
      await addEvent(id, "info", `node confirmed ${report.status}${report.message ? `: ${report.message}` : ""}`, now);
    }
    return { ok: true, status: row.status };
  }
  const message = report.message ?? "";
  const gpuRefusal = report.status === "failed" && row.workstation && GPU_REFUSAL.test(message);
  const cannotServe = report.status === "failed" && row.status === "assigned" && message.startsWith(NODE_CANNOT_SERVE);
  if (gpuRefusal || cannotServe) {
    // Our placement was wrong for this node (GPUs held elsewhere, or the node cannot serve at all):
    // queue it again for another node, not failed. assign() skips this node for it.
    const reason = gpuRefusal ? gpuRefusalReason(node) : `${nodeRefusalPrefix(node)} ${message.slice(NODE_CANNOT_SERVE.length).trim()}`.slice(0, 300);
    const r = await db
      .prepare(
        "UPDATE deployments SET status = 'queued', status_reason = ?, node = NULL, endpoint = NULL, ssh_endpoint = NULL, web_token = NULL, " +
          "assigned_at = NULL, started_at = NULL, last_billed_at = NULL, last_probe_at = NULL, probe_fail = 0 WHERE id = ? AND status = ? AND node = ?",
      )
      .bind(reason, id, row.status, node)
      .run();
    if ((r.meta?.changes ?? 0) > 0) {
      await addEvent(id, "warn", gpuRefusal ? `node ${node} had not enough free GPUs — re-queued` : `node ${node} could not serve it — re-queued`, now);
    }
    return { ok: true, status: "queued" };
  }
  const reason = message.trim() || (report.status === "failed" ? "failed on node" : "stopped by node");
  await endDeployment(row, report.status, reason, { acked: true, now });
  return { ok: true, status: report.status };
}
