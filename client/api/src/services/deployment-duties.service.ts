/**
 * Orchestrator duties for hosted deployments (V3 §4, docs/IMPL_SPEC_2026-10.md).
 *
 * Global duties run from the cron (runDutiesCron — integration wires the Worker `scheduled` handler),
 * never from a heartbeat, so a swarm of node keys cannot make every heartbeat scan the whole table:
 *   G1. re-queue live deployments of nodes silent for DEAD_NODE_FACTOR × NODE_ACTIVE_SECONDS
 *   G2. preempt the youngest interruptible workstation for on-demand work no online node can take
 *   G3. matmul job assignment (jobs.service runAssignment)
 *   G4. take back deployments a live node never started within DEPLOY_START_TIMEOUT_*; fail after DEPLOY_START_ATTEMPTS
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
  SEALED_V2_MIN_AGENT,
  addEvent,
  awaitingSecrets,
  carriesSecrets,
  chargeHour,
  endDeployment,
  getDeploymentRow,
  type DeploymentRow,
} from "./deployments.service.js";
import { compareVersions } from "./instruction-signing.service.js";

/** Whether a node's agent opens v2 (deployment-bound) sealed secrets; older agents never get a deployment that has any. */
export const opensSealedV2 = (agentVersion: string | null | undefined): boolean =>
  !!agentVersion && compareVersions(agentVersion, SEALED_V2_MIN_AGENT) >= 0;

/** Capability of a node that runs images outside the curated list (agent: CLOUDANA_ANY_IMAGE=1). */
export const ANY_IMAGE_CAPABILITY = "any-image";
import { endpointAllowed, imageAllowed, type ApiKind, type ContainerSpec, type DeploymentKind, type WorkstationSpec } from "./deployment-spec.js";
export { imageAllowed };
import { gpusFit, type Gpu, type GpuRequest } from "./workstation.js";
import { runAssignment } from "./jobs.service.js";
import { getRelay } from "../lib/relay.js";
import { readCapped } from "../lib/read-capped.js";
/** Hosting probes in flight per node at once (the hub reserves PROBE_SLOTS for all of the API's checks). */
const HOSTING_PROBES_AT_ONCE = 2;
import type { NodeManifest } from "./nodes.service.js";

/** Live deployments per node, per kind. */
export const NODE_CAPACITY: Record<DeploymentKind, number> = { static: 20, container: 5 };
const PROBE_TIMEOUT_MS = 3000;
/** Probes through the relay cross one more hop (Worker → Durable Object → node socket). */
const RELAY_PROBE_TIMEOUT_MS = 5000;
const PROBE_MAX_BYTES = 4 * 1024 * 1024;
/** Inconclusive probes in a row before the next one counts as a failure. */
const INCONCLUSIVE_MAX = 3;
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
  /** "start": serve it through the node's relay socket (fixed at placement; docs/V4_RELAY_CONTRACT.md). */
  relayed?: boolean;
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
async function requeueRows(rows: DeploymentRow[], reason: string, now: number, opts: { settleHour?: boolean } = {}): Promise<number> {
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
    if (opts.settleHour) await settleElapsed(row, now);
  }
  return requeued;
}

/**
 * A row that was serving until its re-queue (the node is still up; its app failed its probes) pays the elapsed part
 * of the hour it was in, so a tenant whose health path fails at minute 57 does not get 57 free GPU minutes each hour.
 * The hold is then topped back up to a full hour for the next node; an owner who cannot cover that has nothing to
 * re-place, so the (already re-queued) row ends as out of credits and the rest of its hold goes back.
 */
async function settleElapsed(row: DeploymentRow, now: number): Promise<void> {
  if (row.status !== "running" || row.last_billed_at === null || row.held_ucld <= 0 || !row.node) return;
  const elapsed = Math.max(0, Math.min(HOUR_MS, now - row.last_billed_at));
  const charged = Math.min(row.held_ucld, Math.floor((row.price_ucld_per_hour * elapsed) / HOUR_MS));
  if (charged <= 0) return;
  await chargeHour(row, charged, now);
  await addEvent(row.id, "info", `billed ${charged} µCLD for the ${Math.round(elapsed / 60_000)} min served before the re-queue`, now);
  if (await hold(row.owner, charged)) return;
  const remaining = row.held_ucld - charged;
  await getD1().prepare("UPDATE deployments SET held_ucld = ? WHERE id = ?").bind(remaining, row.id).run();
  await endDeployment({ ...row, status: "queued", node: null, last_billed_at: null, held_ucld: remaining }, "stopped", "out of credits", { acked: true, level: "warn", now });
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

/**
 * G4. A deployment that was assigned (its "start" went out on heartbeats) but never reported running or failed within
 * its start timeout is taken back from that node. Without this a node that keeps heartbeating without starting it
 * (a wedged agent, a pull that never ends, an image the engine rejects silently) holds the deployment and the owner's
 * first-hour hold for ever: dead-node re-queue (G1) only fires for silent nodes. It goes back to the queue with that
 * node recorded as having refused it (assign() skips the node for it) and the node owed a "stop" should it start late;
 * after DEPLOY_START_ATTEMPTS timeouts on as many nodes it fails and the hold is released. Rows still waiting for the
 * owner's sealed secrets are not counted: no start was sent.
 */
export async function requeueStuckAssigned(now = Date.now()): Promise<number> {
  const env = getEnv();
  const db = getD1();
  const shortest = Math.min(env.DEPLOY_START_TIMEOUT_SECONDS, env.DEPLOY_START_TIMEOUT_STATIC_SECONDS) * 1000;
  const rows = await db
    .prepare("SELECT * FROM deployments WHERE status = 'assigned' AND node IS NOT NULL AND assigned_at IS NOT NULL AND assigned_at <= ?")
    .bind(now - shortest)
    .all<DeploymentRow>();
  let n = 0;
  for (const row of rows.results ?? []) {
    const timeoutMs = (row.kind === "static" ? env.DEPLOY_START_TIMEOUT_STATIC_SECONDS : env.DEPLOY_START_TIMEOUT_SECONDS) * 1000;
    if (row.assigned_at! > now - timeoutMs || awaitingSecrets(row)) continue;
    const attempts = (row.start_attempts ?? 0) + 1;
    const minutes = Math.round(timeoutMs / 60_000);
    if (attempts >= env.DEPLOY_START_ATTEMPTS) {
      // endDeployment leaves stop_acked_at NULL (the node may still start it late and must be told to stop) and
      // releases the whole hold: nothing was served.
      const ended = await endDeployment(row, "failed", `not started by ${attempts} nodes within ${minutes} min each`, { acked: false, level: "error", now });
      if (ended) n++;
      continue;
    }
    const r = await db
      .prepare("UPDATE deployments SET start_attempts = ? WHERE id = ? AND status = 'assigned' AND node = ? AND COALESCE(start_attempts, 0) = ?")
      .bind(attempts, row.id, row.node, attempts - 1)
      .run();
    if ((r.meta?.changes ?? 0) === 0) continue;
    n += await requeueRows([row], `${nodeRefusalPrefix(row.node!)} did not start it within ${minutes} min`, now);
  }
  return n;
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

type Queued = Pick<DeploymentRow, "id" | "kind" | "spec_json" | "sealed_env" | "workstation" | "parent_id">;
const QUEUED_COLS = "id, kind, spec_json, sealed_env, workstation, parent_id, status_reason";

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
const gpuRequest = (r: Pick<DeploymentRow, "workstation" | "spec_json">): GpuRequest | undefined => specOf(r).gpu;
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

async function claim(node: string, q: Queued, now: number, relayed: boolean): Promise<boolean> {
  // Workstations need WebSockets (Jupyter kernels, terminals), which the relay does not carry yet: they stay direct.
  relayed = relayed && !q.workstation;
  const db = getD1();
  const r = await db
    .prepare("UPDATE deployments SET status = 'assigned', node = ?, assigned_at = ?, relayed = ? WHERE id = ? AND status = 'queued'")
    .bind(node, now, relayed ? 1 : 0, q.id)
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
async function assign(
  node: string,
  capabilities: string[],
  hw: NodeHardware | null,
  fleetId: string | null,
  now: number,
  relayed: boolean,
  publicHost: boolean,
  agentVersion: string | null,
): Promise<void> {
  const db = getD1();
  if (capabilities.includes("hosting")) {
    const live = await db
      .prepare(`SELECT COUNT(*) AS n FROM deployments WHERE node = ? AND kind = 'static' AND status IN ${LIVE}`)
      .bind(node)
      .first<{ n: number }>();
    const room = NODE_CAPACITY.static - (live?.n ?? 0);
    if (room > 0) {
      const queued = await db
        .prepare(`SELECT ${QUEUED_COLS} FROM deployments WHERE status = 'queued' AND kind = 'static' ORDER BY created_at LIMIT ?`)
        .bind(room + 5)
        .all<Queued & Pick<DeploymentRow, "status_reason">>();
      let taken = 0;
      for (const q of queued.results ?? []) {
        if (taken >= room) break;
        if (q.status_reason?.startsWith(nodeRefusalPrefix(node))) continue; // this node just refused it
        if (await claim(node, q, now, relayed)) taken++;
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
  // Containers, workstations and endpoint replicas in arrival order; one that does not fit here does not block the
  // rest. Endpoint parents (replicas > 0) are never placed: their replicas are.
  const queued = await db
    .prepare(`SELECT ${QUEUED_COLS} FROM deployments WHERE status = 'queued' AND kind = 'container' AND replicas = 0 ORDER BY created_at LIMIT 50`)
    .all<Queued & Pick<DeploymentRow, "status_reason">>();
  for (const q of queued.results ?? []) {
    if (state.containers >= NODE_CAPACITY.container) break;
    if (q.status_reason === gpuRefusalReason(node) || q.status_reason?.startsWith(nodeRefusalPrefix(node))) continue; // this node just refused it
    if (q.workstation && !publicHost) continue; // workstations stay direct (WebSockets, SSH): a verified public host only
    if (carriesSecrets(q) && !opensSealedV2(agentVersion)) continue; // its secrets are bound to the deployment; this agent cannot open them
    if (q.parent_id && !(await replicaFits(node, q, relayed, capabilities))) continue;
    if (fits(q, state) && (await claim(node, q, now, relayed))) addUsage(state, q, 1);
  }
}

/**
 * docs/V4_ENDPOINTS_CONTRACT.md: a replica needs a relay node (its traffic is POSTs through the hub), a node that
 * runs its image (curated, or `any-image`), and no sibling replica already on this node.
 */
async function replicaFits(node: string, q: Queued, relayed: boolean, capabilities: string[]): Promise<boolean> {
  if (!relayed) return false;
  if (!imageAllowed(specOf(q).image) && !capabilities.includes(ANY_IMAGE_CAPABILITY)) return false;
  const sibling = await getD1()
    .prepare(`SELECT 1 FROM deployments WHERE parent_id = ? AND node = ? AND status IN ${LIVE} LIMIT 1`)
    .bind(q.parent_id, node)
    .first();
  return !sibling;
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
      "SELECT id, kind, spec_json, sealed_env, workstation, parent_id FROM deployments WHERE status = 'queued' AND kind = 'container' " +
        "AND replicas = 0 AND parent_id IS NULL AND (workstation = 0 OR json_extract(spec_json, '$.tier') = 'on-demand') ORDER BY created_at LIMIT 20",
    )
    .all<Queued>();
  if (!queued.results?.length) return 0;
  const nodes = await db
    .prepare("SELECT address, work_types, manifest_json, public_host, agent_version FROM nodes WHERE payout IS NOT NULL AND fleet_id IS NOT NULL AND state = 'active' AND last_seen >= ?")
    .bind(now - getEnv().NODE_ACTIVE_SECONDS * 1000)
    .all<{ address: string; work_types: string | null; manifest_json: string | null; public_host: string | null; agent_version: string | null }>();
  type Candidate = NodeState & { victims: DeploymentRow[]; publicHost: boolean; sealedV2: boolean };
  const states = new Map<string, Candidate>();
  for (const n of nodes.results ?? []) {
    const caps = JSON.parse(n.work_types ?? "[]") as string[];
    if (!caps.includes("container")) continue;
    states.set(n.address, { ...nodeState(caps, JSON.parse(n.manifest_json ?? "{}")), victims: [], publicHost: !!n.public_host, sealedV2: opensSealedV2(n.agent_version) });
  }
  // Same rules as assign(): workstations only on a verified public host; secrets only on an agent that opens them.
  const canTake = (q: Queued, s: Candidate) => (!q.workstation || s.publicHost) && (!carriesSecrets(q) || s.sealedV2);
  const live = await db.prepare(`SELECT * FROM deployments WHERE kind = 'container' AND status IN ${LIVE}`).all<DeploymentRow>();
  for (const r of live.results ?? []) {
    const s = r.node ? states.get(r.node) : undefined;
    if (!s) continue;
    addUsage(s, r, 1);
    if (r.workstation && (JSON.parse(r.spec_json) as WorkstationSpec).tier === "interruptible") s.victims.push(r);
  }
  let preempted = 0;
  for (const q of queued.results) {
    const fitting = [...states.values()].find((s) => canTake(q, s) && fits(q, s));
    if (fitting) {
      addUsage(fitting, q, 1); // it will be assigned there; do not count that room twice
      continue;
    }
    let best: { s: Candidate; v: DeploymentRow } | null = null;
    for (const s of states.values()) {
      if (!canTake(q, s)) continue;
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
    const url = probe ? probeUrl(endpoint, probe.path) : probeTarget(endpoint);
    const res = await fetch(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return await probePassed(res, probe);
  } catch {
    return false;
  }
}

/**
 * With a content hash: 200 and sha256(body) == hash, reading at most PROBE_MAX_BYTES (relayed responses carry no
 * content-length, so the cap is enforced while reading). Without: reachability (2xx/3xx). A body that breaks off throws.
 */
async function probePassed(res: Response, probe?: { path: string; hash: string } | null): Promise<boolean> {
  if (!probe) {
    await res.body?.cancel().catch(() => undefined);
    return res.status >= 200 && res.status < 400;
  }
  if (res.status !== 200 || Number(res.headers.get("content-length") ?? 0) > PROBE_MAX_BYTES) {
    await res.body?.cancel().catch(() => undefined);
    return false;
  }
  const body = await readCapped(res, PROBE_MAX_BYTES);
  return body !== null && sha256Hex(body) === probe.hash.toLowerCase();
}

/** "inconclusive": nobody reached the app, so the probe neither passes nor counts as a failure. */
export type ProbeResult = boolean | "inconclusive";

/**
 * The same probe through the node's relay socket (docs/V4_RELAY_CONTRACT.md): the node can only answer for a
 * deployment it serves, so a content hash still proves the right site is up. No relay binding → fails (billing
 * pauses rather than charging for something nobody checked). Probes carry `x-relay-probe: 1`, which the hub admits
 * into slots visitor traffic can never fill (shared PROBE_SLOTS), so load never refuses a probe: `busy`, a timeout, offline
 * or not serving all fail (a node that answered `busy` to dodge checks kept billing before — docs/V4_REVIEW_STORAGE.md
 * #5). Only the relay call itself failing (the binding) is inconclusive: once the node has answered, a body that breaks
 * off or runs past the deadline fails (a node could otherwise answer 200 and abort to dodge every content check).
 */
export async function probeRelayed(
  node: string,
  row: Pick<DeploymentRow, "id" | "kind" | "probe_path" | "probe_hash">,
  opts: { busyInconclusive?: boolean } = {},
): Promise<ProbeResult> {
  const relay = getRelay();
  if (!relay) return false;
  const probe = row.probe_path && row.probe_hash ? { path: row.probe_path, hash: row.probe_hash } : null;
  // A content probe fetches its file; an endpoint replica its health path (stored verbatim, no hash); else "/".
  const path = probe ? `/${probe.path.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/")}` : row.probe_path || "/";
  let res: Response;
  try {
    res = await relay(node, "/proxy", {
      method: "GET",
      headers: { "x-relay-dep": row.id, "x-relay-class": row.kind === "static" ? "site" : "endpoint", "x-relay-path": path, "x-relay-probe": "1" },
      signal: AbortSignal.timeout(RELAY_PROBE_TIMEOUT_MS),
    });
  } catch (err) {
    return (err as Error)?.name === "TimeoutError" ? false : "inconclusive";
  }
  if (opts.busyInconclusive && res.headers.get("x-relay-error") === "busy") {
    await res.body?.cancel().catch(() => undefined);
    return "inconclusive";
  }
  try {
    return await probePassed(res, probe);
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
      "SELECT * FROM deployments WHERE node = ? AND status IN ('running','unreachable') AND (endpoint IS NOT NULL OR relayed = 1) " +
        "AND (last_probe_at IS NULL OR last_probe_at <= ?)",
    )
    .bind(node, now - env.DEPLOY_PROBE_SECONDS * 1000)
    .all<DeploymentRow>();
  const rows = due.results ?? [];
  // A few probes in flight per node at once, within the slots the hub reserves for the API's checks.
  const results: ProbeResult[] = [];
  for (let i = 0; i < rows.length; i += HOSTING_PROBES_AT_ONCE) {
    results.push(...(await Promise.all(rows.slice(i, i + HOSTING_PROBES_AT_ONCE).map((r) => probeRow(node, r)))));
  }
  for (let i = 0; i < rows.length; i++) await recordProbe(node, rows[i], results[i], now);
}

/** One probe of one running/unreachable deployment on `node` (through the relay, or direct for a legacy node). */
function probeRow(node: string, r: DeploymentRow, opts: { busyInconclusive?: boolean } = {}): Promise<ProbeResult> {
  if (r.relayed) return probeRelayed(node, r, opts);
  return endpointAllowed(r.endpoint!, getEnv().DEV_MODE) ? probeOne(r.endpoint!, probeOf(r)) : Promise.resolve(false);
}

/**
 * Time since `row` last passed a probe (or was last billed, if later): what an outage leaves uncharged. Moving
 * last_billed_at forward by this much charges the time served before the outage and none of the outage itself.
 */
function unservedMs(row: Pick<DeploymentRow, "last_billed_at" | "last_ok_at">, now: number): number {
  if (row.last_billed_at === null) return 0;
  return Math.max(0, now - Math.max(row.last_billed_at, row.last_ok_at ?? 0));
}

/** What a probe result does to its deployment: the same for scheduled probes and for those a report triggers. */
async function recordProbe(node: string, row: DeploymentRow, result: ProbeResult, now: number): Promise<void> {
  const env = getEnv();
  const db = getD1();
  if (result === "inconclusive") {
    // Nobody reached the app: try again next time, counting nothing either way — up to INCONCLUSIVE_MAX in a row,
    // then it counts as a failure (nothing a node does should keep it unchecked for good).
    if ((row.probe_inconclusive ?? 0) + 1 < INCONCLUSIVE_MAX) {
      await db.prepare("UPDATE deployments SET last_probe_at = ?, probe_inconclusive = COALESCE(probe_inconclusive, 0) + 1 WHERE id = ?").bind(now, row.id).run();
      return;
    }
    result = false;
  }
  if ((row.probe_inconclusive ?? 0) > 0) {
    await db.prepare("UPDATE deployments SET probe_inconclusive = 0 WHERE id = ?").bind(row.id).run();
  }
  if (result) {
    if (row.status === "unreachable") {
      // Billing resumes: the outage (since the last passing probe) is not charged, the time served before it is.
      const billedTo = row.last_billed_at === null ? now : row.last_billed_at + unservedMs(row, now);
      await db
        .prepare(
          "UPDATE deployments SET status = 'running', status_reason = NULL, probe_fail = 0, last_probe_at = ?, last_ok_at = ?, last_billed_at = ? " +
            "WHERE id = ? AND status = 'unreachable'",
        )
        .bind(now, now, billedTo, row.id)
        .run();
      await addEvent(row.id, "info", "probe ok — reachable again; billing resumed", now);
    } else {
      await db.prepare("UPDATE deployments SET probe_fail = 0, last_probe_at = ?, last_ok_at = ? WHERE id = ?").bind(now, now, row.id).run();
    }
    return;
  }
  const fails = row.probe_fail + 1;
  const toUnreachable = row.status === "running" && fails >= env.DEPLOY_PROBE_FAILS;
  if (toUnreachable && row.parent_id) {
    // An endpoint replica is replaced, not waited for: back to the queue for another node. This node is owed a stop
    // and is skipped for this replica (nodeRefusalPrefix) so it cannot reclaim it while that stop is still running;
    // the part of the hour it served is billed (the app, not the node, failed).
    await requeueRows([row], `${nodeRefusalPrefix(node)} replica failed ${fails} health probes`, now, { settleHour: true });
    return;
  }
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

// ── Report a problem (docs/V4_VERIFIED_SERVICES.md §5) ──────────────────────
/** Reports one owner may file per UTC day. */
export const REPORTS_PER_DAY = 5;

export interface ReportOutcome {
  /** The deployment (or endpoint replica) that was probed. */
  id: string;
  /** null: the check could not reach the node (inconclusive) or there was nothing running to check. */
  probeOk: boolean | null;
  /** µCLD of the current hour that will not be charged. */
  forgivenUcld: number;
  message: string;
}

export type ProblemReportResult =
  | { ok: true; results: ReportOutcome[] }
  | { ok: false; code: "not_found" | "conflict" | "rate_limited"; message: string };

/**
 * The owner says it's broken: probe it now (through the relay, like the scheduled probes). If that probe fails (or
 * can't reach the node while the last scheduled one had failed), the time since the last passing probe is not charged
 * (last_billed_at moves forward by it) and the failure counts like any other. A passing probe changes nothing, and
 * failing a check on purpose gains at most the minute since the last scheduled probe. An endpoint reports each live
 * replica. ≤ REPORTS_PER_DAY per owner per UTC day, claimed before probing so parallel reports can't exceed it.
 */
export async function reportProblem(owner: string, id: string, note: string | undefined, now = Date.now()): Promise<ProblemReportResult> {
  const db = getD1();
  const who = normalizeAddress(owner);
  const row = await getDeploymentRow(id);
  if (!row || row.owner !== who || row.parent_id) return { ok: false, code: "not_found", message: "deployment not found" };
  const live =
    row.replicas > 0
      ? ((await db.prepare("SELECT * FROM deployments WHERE parent_id = ? AND status IN ('running','unreachable') ORDER BY created_at").bind(id).all<DeploymentRow>()).results ?? [])
      : row.status === "running" || row.status === "unreachable"
        ? [row]
        : [];
  // Only what the scheduled probes can reach: on a node, through the relay or at a reported endpoint.
  const targets = live.filter((t) => t.node && (t.relayed || t.endpoint));
  if (targets.length === 0) return { ok: false, code: "conflict", message: `nothing is running to check (status ${row.status})` };
  const reportId = crypto.randomUUID();
  const claimed = await db
    .prepare(
      "INSERT INTO deployment_reports (id, deployment_id, owner, at, note) SELECT ?, ?, ?, ?, ? " +
        "WHERE (SELECT COUNT(*) FROM deployment_reports WHERE owner = ? AND at >= ?) < ?",
    )
    .bind(reportId, id, who, now, note?.slice(0, 500) ?? null, who, now - (now % 86_400_000), REPORTS_PER_DAY)
    .run();
  if ((claimed.meta?.changes ?? 0) === 0) {
    return { ok: false, code: "rate_limited", message: `at most ${REPORTS_PER_DAY} reports a day; the network probes every minute anyway` };
  }

  // Replicas sit on different nodes (anti-affinity): probe them together, then record one by one. A report's probe
  // that finds the hub's probe slots taken (scheduled probes in flight) is inconclusive, not the app failing.
  const probed = await Promise.all(targets.map((t) => probeRow(t.node!, t, { busyInconclusive: true })));
  const results: ReportOutcome[] = [];
  for (const [i, t] of targets.entries()) {
    const node = t.node!;
    const result = probed[i];
    const failing = result === false || (result === "inconclusive" && t.probe_fail > 0);
    const skip = failing && t.status === "running" ? unservedMs(t, now) : 0;
    let forgiven = 0;
    let current = t;
    if (skip > 0) {
      const r = await db
        .prepare("UPDATE deployments SET last_billed_at = ? WHERE id = ? AND status = 'running' AND last_billed_at = ?")
        .bind(t.last_billed_at! + skip, t.id, t.last_billed_at)
        .run();
      if ((r.meta?.changes ?? 0) > 0) {
        forgiven = Math.floor((t.price_ucld_per_hour * skip) / HOUR_MS);
        current = { ...t, last_billed_at: t.last_billed_at! + skip };
      }
    }
    await recordProbe(node, current, result, now);
    const message =
      result === "inconclusive"
        ? forgiven > 0
          ? "the check could not reach the node and the last one had failed: the time since its last passing check is not charged"
          : "the check could not reach the node; the network keeps probing every minute"
        : result
          ? t.status === "unreachable"
            ? "probe ok: reachable again, billing resumes"
            : "probe ok: it answered the network's check; if it is still broken for you, check your app's logs"
          : t.status === "unreachable"
            ? "probe failed: already unreachable, billing was paused"
            : "probe failed: the time since its last passing check is not charged";
    await addEvent(t.id, result === false ? "warn" : "info", `reported by the owner — ${message}`, now);
    results.push({ id: t.id, probeOk: result === "inconclusive" ? null : result, forgivenUcld: forgiven, message });
  }
  await db
    .prepare("UPDATE deployment_reports SET probe_ok = ?, forgiven_ucld = ? WHERE id = ?")
    .bind(
      results.every((r) => r.probeOk === true) ? 1 : results.some((r) => r.probeOk === false) ? 0 : null,
      results.reduce((s, r) => s + r.forgivenUcld, 0),
      reportId,
    )
    .run();
  if (row.replicas > 0) await addEvent(id, "info", `reported by the owner: ${results.filter((r) => r.probeOk === false).length} of ${results.length} replicas failed the check`, now);
  return { ok: true, results };
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
      relayed: !!r.relayed,
    };
  });
  const all = [...own, ...(stale.results ?? []).map((r): NodeInstruction => ({ id: r.id, action: "stop", kind: kindOf(r), spec: null }))];
  // Stops first, so a preempted workstation frees its GPUs before the work that preempted it starts.
  return [...all.filter((i) => i.action !== "start"), ...all.filter((i) => i.action === "start")];
}

/** The node columns the per-node duties read (a NodeRow has them; the heartbeat passes its own read in). */
export interface DutiesNodeRow {
  payout: string | null;
  work_types: string | null;
  manifest_json: string | null;
  fleet_id?: string | null;
  relay_at?: number | null;
  public_host?: string | null;
  agent_version?: string | null;
  /** B-8: only an `active` node takes new work (null on old rows = active). */
  state?: string | null;
}

/**
 * What there is to do for one node, in one statement (B-5): every per-node duty below scans a table, and on an idle
 * node every scan comes back empty. Counting first costs one round trip and lets the idle heartbeat skip the rest.
 */
export interface NodeActivity {
  /** Live deployments (assigned / running / unreachable) on this node. */
  live: number;
  /** Running or unreachable workstations (auto-stop candidates). */
  workstations: number;
  /** Running rows with a full hour since last_billed_at. */
  billable: number;
  /** Running / unreachable rows whose probe is due. */
  probeDue: number;
  /** Queued static sites and queued container rows (any owner) — the only thing assign() could pick up. */
  queuedStatic: number;
  queuedContainer: number;
  /** Instructions owed: assigned rows ("start") and stopped/failed rows the node has not confirmed ("stop"/"purge"). */
  owed: number;
  /** Stops owed for deployments taken from this node while it was offline. */
  stale: number;
  /** Unexpired matmul assignments for this node (jobs.service getActiveAssignment would return one). */
  assignedJobs: number;
}

export async function nodeActivity(node: string, now = Date.now()): Promise<NodeActivity> {
  const env = getEnv();
  const row = await getD1()
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM deployments WHERE node = ?1 AND status IN ${LIVE}) AS live,
        (SELECT COUNT(*) FROM deployments WHERE node = ?1 AND workstation = 1 AND status IN ('running','unreachable') AND started_at IS NOT NULL) AS workstations,
        (SELECT COUNT(*) FROM deployments WHERE node = ?1 AND status = 'running' AND last_billed_at IS NOT NULL AND last_billed_at <= ?2) AS billable,
        (SELECT COUNT(*) FROM deployments WHERE node = ?1 AND status IN ('running','unreachable') AND (endpoint IS NOT NULL OR relayed = 1) AND (last_probe_at IS NULL OR last_probe_at <= ?3)) AS probeDue,
        (SELECT COUNT(*) FROM deployments WHERE status = 'queued' AND kind = 'static') AS queuedStatic,
        (SELECT COUNT(*) FROM deployments WHERE status = 'queued' AND kind = 'container' AND replicas = 0) AS queuedContainer,
        (SELECT COUNT(*) FROM deployments WHERE node = ?1 AND (status = 'assigned' OR (status IN ('stopped','failed') AND stop_acked_at IS NULL))) AS owed,
        (SELECT COUNT(*) FROM deployment_stale_nodes WHERE node = ?1) AS stale,
        (SELECT COUNT(*) FROM work_jobs WHERE node = ?1 AND status = 'assigned' AND expires_at >= ?4) AS assignedJobs`,
    )
    .bind(node, now - HOUR_MS, now - env.DEPLOY_PROBE_SECONDS * 1000, now)
    .first<NodeActivity>();
  return row ?? { live: 0, workstations: 0, billable: 0, probeDue: 0, queuedStatic: 0, queuedContainer: 0, owed: 0, stale: 0, assignedJobs: 0 };
}

/**
 * Everything a heartbeat does for hosting (per-node duties only). Unbound nodes get no new work but still receive
 * stops. `ctx.row` and `ctx.activity` let the heartbeat pass in what it already read; otherwise they are fetched here.
 */
export async function runDeploymentDuties(
  node: string,
  now = Date.now(),
  ctx: { row?: DutiesNodeRow | null; activity?: NodeActivity } = {},
): Promise<NodeInstruction[]> {
  const row =
    ctx.row !== undefined
      ? ctx.row
      : await getD1()
          .prepare("SELECT payout, work_types, manifest_json, fleet_id, relay_at, public_host, agent_version, state FROM nodes WHERE address = ?")
          .bind(node)
          .first<DutiesNodeRow>();
  if (!row) return [];
  const act = ctx.activity ?? (await nodeActivity(node, now));
  const hw = JSON.parse(row.manifest_json ?? "{}") as NodeHardware;
  const caps = JSON.parse(row.work_types ?? "[]") as string[];
  // A relay node takes new hosting work only while its socket is up (fresh `relay: true` heartbeat); a legacy node
  // kept its hosting capabilities only with a verified public host (routes/v1/nodes.ts announce).
  const relayed = caps.includes("relay");
  const reachable = !relayed || (row.relay_at ?? 0) >= now - getEnv().RELAY_FRESH_SECONDS * 1000;
  const active = (row.state ?? "active") === "active";
  const couldAssign =
    !!row.payout && reachable && active && ((act.queuedStatic > 0 && caps.includes("hosting")) || (act.queuedContainer > 0 && caps.includes("container") && !!row.fleet_id));
  const steps: [string, boolean, () => Promise<unknown>][] = [
    ["auto-stop", act.workstations > 0, () => autoStop(node, now)],
    ["assign", couldAssign, () => assign(node, caps, hw, row.fleet_id ?? null, now, relayed, !!row.public_host, row.agent_version ?? null)],
    ["probe", act.probeDue > 0, () => probe(node, now)],
    ["bill", act.billable > 0, () => bill(node, now)],
  ];
  // Any step that ran may have changed what is owed (assign claims a start; auto-stop, a failed probe or an empty
  // balance owe a stop): then the instructions are read regardless of the snapshot taken before.
  let ran = false;
  for (const [name, due, step] of steps) {
    if (!due) continue;
    ran = true;
    try {
      await step();
    } catch (err) {
      log.api.warn(`[deployments] ${name} on heartbeat failed:`, err);
    }
  }
  if (!ran && act.owed === 0 && act.stale === 0) return [];
  return instructions(node);
}

export interface DutiesCronResult {
  requeued: number;
  /** Assigned deployments taken back from a node that never started them (or failed after DEPLOY_START_ATTEMPTS). */
  stuck: number;
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
  const out: DutiesCronResult = { requeued: 0, stuck: 0, preempted: 0, assigned: 0 };
  const steps: [keyof DutiesCronResult, () => Promise<number>][] = [
    ["requeued", () => requeueDeadNodeDeployments(now)],
    ["stuck", () => requeueStuckAssigned(now)],
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
/** status_reason of a container re-queued after a GPU refusal; assign() skips that node for it. */
export const gpuRefusalReason = (node: string) => `not enough free GPUs on node ${node}`;
/** The agent reports `failed` with this prefix when it cannot serve a deployment at all (e.g. its endpoint was refused). */
export const NODE_CANNOT_SERVE = "node cannot serve:";
const nodeRefusalPrefix = (node: string) => `refused by node ${node}:`;

export type StatusReport = {
  status: "running" | "failed" | "stopped";
  endpoint?: string;
  sshEndpoint?: string;
  webToken?: string;
  /** Relayed workstations: path + query of the web app (stored in `endpoint`, which holds a path for relayed rows). */
  webPath?: string;
  message?: string;
  /** failed: the container's log tail (shown to the owner on GET /deployments/{id}). */
  logs?: string;
};
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
    // Relayed deployments have no public endpoint: traffic reaches them through the node's relay socket.
    if (row.relayed) report = { ...report, endpoint: row.workstation && report.webPath?.startsWith("/") ? report.webPath : undefined };
    else if (report.webPath) return { ok: false, code: "validation_failed", message: "webPath is for relayed deployments only" };
    const dev = getEnv().DEV_MODE;
    if (report.endpoint && !row.relayed && !endpointAllowed(report.endpoint, dev)) {
      return { ok: false, code: "validation_failed", message: "endpoint must be a public http(s) address" };
    }
    if (report.webToken && !row.workstation) {
      return { ok: false, code: "validation_failed", message: "webToken is for workstations only" };
    }
    if (report.sshEndpoint && (!row.workstation || !endpointAllowed(`http://${report.sshEndpoint}`, dev))) {
      return { ok: false, code: "validation_failed", message: "sshEndpoint must be a public host:port of a workstation" };
    }
    // Billing fraud guard: endpoints must live on the host the node announced, never on some other live site.
    // (A relayed row's endpoint is a path on the gateway, so only its SSH endpoint is checked.)
    if ((report.endpoint && !row.relayed) || report.sshEndpoint) {
      const n = await db.prepare("SELECT public_host FROM nodes WHERE address = ?").bind(node).first<{ public_host: string | null }>();
      const announced = n?.public_host?.toLowerCase() ?? null;
      const hosts = [!row.relayed && report.endpoint && hostOf(report.endpoint), report.sshEndpoint && hostOf(`http://${report.sshEndpoint}`)].filter(Boolean);
      if (!announced || hosts.some((h) => h !== announced)) {
        return { ok: false, code: "validation_failed", message: "endpoint host must be the node's announced public host" };
      }
    }
    // A workstation with SSH access only has no web endpoint.
    if (row.status === "assigned" && !row.relayed && !report.endpoint && !(row.workstation && report.sshEndpoint)) {
      return { ok: false, code: "validation_failed", message: "endpoint is required when a deployment starts running" };
    }
    if (row.status === "assigned") {
      const r = await db
        .prepare(
          "UPDATE deployments SET status = 'running', status_reason = NULL, endpoint = ?, ssh_endpoint = ?, web_token = ?, started_at = ?, " +
            "last_billed_at = ?, probe_fail = 0, start_attempts = 0 WHERE id = ? AND status = 'assigned'",
        )
        .bind(report.endpoint ?? null, report.sshEndpoint ?? null, report.webToken ?? null, now, now, id)
        .run();
      const at = [report.endpoint ?? (row.relayed ? "the relay" : null), report.sshEndpoint && `ssh ${report.sshEndpoint}`].filter(Boolean).join(" · ");
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
  if (report.logs) await db.prepare("UPDATE deployments SET last_logs = ? WHERE id = ?").bind(report.logs, id).run();
  const gpuRefusal = report.status === "failed" && row.kind === "container" && GPU_REFUSAL.test(message);
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
