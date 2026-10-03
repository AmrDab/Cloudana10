/**
 * Orchestrator duties for hosted deployments, run inside a node's heartbeat (V3 §4):
 *   0. re-queue live deployments of nodes silent for DEAD_NODE_FACTOR × NODE_ACTIVE_SECONDS
 *   0b. auto-stop this node's workstations past maxHours; preempt the youngest interruptible workstation
 *      for on-demand work no online node can take (docs/WORKSTATIONS.md §3)
 *   1. assign queued deployments this node can run (capability + capacity; GPUs for workstations)
 *   2. probe this node's running/unreachable deployments that are due
 *   3. bill this node's running deployments for each full hour since last_billed_at
 *   4. return the node's instructions: "start" for assigned, "stop" for stopped-but-unconfirmed
 *      and for deployments taken from this node while it was offline
 * plus the node's own status reports (POST /nodes/deployments/{id}/status).
 */
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
import { endpointAllowed, type ApiKind, type DeploymentKind, type WorkstationSpec } from "./deployment-spec.js";
import { gpusFit, type Gpu, type GpuRequest } from "./workstation.js";

/** Live deployments per node, per kind. */
export const NODE_CAPACITY: Record<DeploymentKind, number> = { static: 20, container: 5 };
const PROBE_TIMEOUT_MS = 3000;
/** Hours billed per heartbeat at most (a long-silent orchestrator catches up over a few beats). */
const MAX_HOURS_PER_BEAT = 24;

export interface NodeInstruction {
  id: string;
  /** "purge" = stop and also delete the workstation's volume (owner asked, DELETE ?purge=1). */
  action: "start" | "stop" | "purge";
  kind: ApiKind;
  /** Full spec (container env included) for "start"; null for "stop". */
  spec: Record<string, unknown> | null;
  sealedEnv?: string;
}

const LIVE = "('assigned','running','unreachable')";
/** A node silent for this many NODE_ACTIVE_SECONDS has gone offline: its deployments are re-queued. */
export const DEAD_NODE_FACTOR = 3;

/**
 * Re-queue live deployments whose node went offline (all of them, or one owner's). Billing pauses
 * (last_billed_at cleared) and the current hour's hold stays held for the next node. The old node is
 * owed a "stop" (deployment_stale_nodes) in case it comes back still serving. Secrets were sealed to
 * the old node's key, so they are cleared and the next start waits for the owner to re-seal.
 */
export async function requeueDeadNodeDeployments(now = Date.now(), owner?: string): Promise<number> {
  const db = getD1();
  const cutoff = now - DEAD_NODE_FACTOR * getEnv().NODE_ACTIVE_SECONDS * 1000;
  const rows = await db
    .prepare(
      `SELECT d.* FROM deployments d LEFT JOIN nodes n ON n.address = d.node ` +
        `WHERE d.status IN ${LIVE} AND COALESCE(n.last_seen, 0) < ?${owner ? " AND d.owner = ?" : ""}`,
    )
    .bind(...(owner ? [cutoff, normalizeAddress(owner)] : [cutoff]))
    .all<DeploymentRow>();
  let requeued = 0;
  for (const row of rows.results ?? []) {
    const reseal = row.sealed_env !== null;
    const spec = reseal ? JSON.stringify({ ...JSON.parse(row.spec_json), expectsSecrets: true }) : row.spec_json;
    const r = await db
      .prepare(
        "UPDATE deployments SET status = 'queued', status_reason = 'node went offline', node = NULL, endpoint = NULL, ssh_endpoint = NULL, web_token = NULL, " +
          "assigned_at = NULL, last_billed_at = NULL, last_probe_at = NULL, probe_fail = 0, sealed_env = NULL, spec_json = ? " +
          "WHERE id = ? AND status = ? AND node = ?",
      )
      .bind(spec, row.id, row.status, row.node)
      .run();
    if ((r.meta?.changes ?? 0) === 0) continue;
    requeued++;
    await db
      .prepare("INSERT OR IGNORE INTO deployment_stale_nodes (deployment_id, node, at) VALUES (?, ?, ?)")
      .bind(row.id, row.node, now)
      .run();
    await addEvent(row.id, "warn", "node went offline — re-queued", now);
    if (reseal) await addEvent(row.id, "warn", "secrets were sealed to the old node — re-seal them for the next node", now);
  }
  return requeued;
}

type Queued = Pick<DeploymentRow, "id" | "kind" | "spec_json" | "sealed_env" | "workstation">;

/** What a node has in use for containers + workstations (they share NODE_CAPACITY.container). */
interface NodeState {
  caps: string[];
  gpus: Gpu[];
  containers: number;
  gpusUsed: number;
}

const gpuRequest = (r: Pick<DeploymentRow, "workstation" | "spec_json">): GpuRequest | undefined =>
  r.workstation ? (JSON.parse(r.spec_json) as WorkstationSpec).gpu : undefined;
const gpusHeld = (r: Pick<DeploymentRow, "workstation" | "spec_json">) => gpuRequest(r)?.count ?? 0;

/** docs/WORKSTATIONS.md §3: container capability, gpu capability if GPUs are asked for, free matching GPUs, ≤ 5 per node. */
function fits(q: Pick<DeploymentRow, "workstation" | "spec_json">, n: NodeState): boolean {
  if (!n.caps.includes("container") || n.containers >= NODE_CAPACITY.container) return false;
  const req = gpuRequest(q);
  if (req && req.count > 0 && !n.caps.includes("gpu")) return false;
  return gpusFit(n.gpus, n.gpusUsed, req);
}

function addUsage(n: NodeState, r: Pick<DeploymentRow, "workstation" | "spec_json">, sign: 1 | -1): void {
  n.containers += sign;
  n.gpusUsed += sign * gpusHeld(r);
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

async function assign(node: string, capabilities: string[], gpus: Gpu[], now: number): Promise<void> {
  const db = getD1();
  if (capabilities.includes("hosting")) {
    const live = await db
      .prepare(`SELECT COUNT(*) AS n FROM deployments WHERE node = ? AND kind = 'static' AND status IN ${LIVE}`)
      .bind(node)
      .first<{ n: number }>();
    const room = NODE_CAPACITY.static - (live?.n ?? 0);
    if (room > 0) {
      const queued = await db
        .prepare("SELECT id, kind, spec_json, sealed_env, workstation FROM deployments WHERE status = 'queued' AND kind = 'static' ORDER BY created_at LIMIT ?")
        .bind(room)
        .all<Queued>();
      for (const q of queued.results ?? []) await claim(node, q, now);
    }
  }
  if (!capabilities.includes("container")) return;
  const live = await db
    .prepare(`SELECT workstation, spec_json FROM deployments WHERE node = ? AND kind = 'container' AND status IN ${LIVE}`)
    .bind(node)
    .all<Pick<DeploymentRow, "workstation" | "spec_json">>();
  const state: NodeState = { caps: capabilities, gpus, containers: 0, gpusUsed: 0 };
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
    if (q.status_reason === gpuRefusalReason(node)) continue; // this node just refused it for lack of GPUs
    if (fits(q, state) && (await claim(node, q, now))) addUsage(state, q, 1);
  }
}

/** When a deployment started on its node (youngest = largest). */
const startedAt = (r: DeploymentRow) => r.started_at ?? r.assigned_at ?? r.created_at;

/**
 * Preemption (docs/WORKSTATIONS.md §3): a queued on-demand container/workstation that no online node can
 * take now stops the youngest interruptible workstation whose node would then fit it. Elapsed time is
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
    .prepare("SELECT address, work_types, manifest_json FROM nodes WHERE payout IS NOT NULL AND last_seen >= ?")
    .bind(now - getEnv().NODE_ACTIVE_SECONDS * 1000)
    .all<{ address: string; work_types: string | null; manifest_json: string | null }>();
  const states = new Map<string, NodeState & { victims: DeploymentRow[] }>();
  for (const n of nodes.results ?? []) {
    const caps = JSON.parse(n.work_types ?? "[]") as string[];
    if (!caps.includes("container")) continue;
    const gpus = (JSON.parse(n.manifest_json ?? "{}").gpus ?? []) as Gpu[];
    states.set(n.address, { caps, gpus, containers: 0, gpusUsed: 0, victims: [] });
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
        const trial = { ...s, containers: s.containers - 1, gpusUsed: s.gpusUsed - gpusHeld(v) };
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

/** Auto-stop (docs/WORKSTATIONS.md §3): this node's workstations past startedAt + maxHours. */
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

async function probeOne(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    await res.body?.cancel().catch(() => undefined);
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  }
}

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
  const results = await Promise.all(rows.map((r) => (endpointAllowed(r.endpoint!, env.DEV_MODE) ? probeOne(probeTarget(r.endpoint!)) : false)));
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
    if (toUnreachable) await addEvent(row.id, "error", `unreachable after ${fails} failed probes — billing paused`, now);
    else if (row.status === "running") await addEvent(row.id, "warn", `probe failed (${fails}/${env.DEPLOY_PROBE_FAILS})`, now);
  }
}

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
  const own: NodeInstruction[] = (rows.results ?? []).filter((r) => r.status !== "assigned" || !awaitingSecrets(r)).map((r) =>
    r.status === "assigned"
      ? { id: r.id, action: "start", kind: kindOf(r), spec: JSON.parse(r.spec_json), ...(r.sealed_env && { sealedEnv: r.sealed_env }) }
      : { id: r.id, action: r.purge_pending ? "purge" : "stop", kind: kindOf(r), spec: null },
  );
  const all = [...own, ...(stale.results ?? []).map((r): NodeInstruction => ({ id: r.id, action: "stop", kind: kindOf(r), spec: null }))];
  // Stops first, so a preempted workstation frees its GPUs before the work that preempted it starts.
  return [...all.filter((i) => i.action !== "start"), ...all.filter((i) => i.action === "start")];
}

/** Everything a heartbeat does for hosting. Unbound nodes get no new work but still receive stops. */
export async function runDeploymentDuties(node: string, now = Date.now()): Promise<NodeInstruction[]> {
  const row = await getD1()
    .prepare("SELECT payout, work_types, manifest_json FROM nodes WHERE address = ?")
    .bind(node)
    .first<{ payout: string | null; work_types: string | null; manifest_json: string | null }>();
  if (!row) return [];
  const gpus = (JSON.parse(row.manifest_json ?? "{}").gpus ?? []) as Gpu[];
  const steps: [string, () => Promise<unknown>][] = [
    ["requeue", () => requeueDeadNodeDeployments(now)],
    ["auto-stop", () => autoStop(node, now)],
    ["preempt", () => preemptForOnDemand(now)],
    ["assign", () => (row.payout ? assign(node, JSON.parse(row.work_types ?? "[]") as string[], gpus, now) : Promise.resolve())],
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

/** The agent's message when `docker run --gpus` finds fewer free GPUs than assigned. */
const GPU_REFUSAL = /not enough free GPUs/i;
/** status_reason of a workstation re-queued after a GPU refusal; assign() skips that node for it. */
export const gpuRefusalReason = (node: string) => `not enough free GPUs on node ${node}`;

export type StatusReport = { status: "running" | "failed" | "stopped"; endpoint?: string; sshEndpoint?: string; webToken?: string; message?: string };
export type ReportResult = { ok: true; status: string } | { ok: false; code: "not_found" | "conflict" | "validation_failed"; message: string };

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
  if (report.status === "failed" && row.workstation && GPU_REFUSAL.test(report.message ?? "")) {
    // Our GPU accounting over-assigned (something else holds the node's GPUs): queue it again, not failed.
    const r = await db
      .prepare(
        "UPDATE deployments SET status = 'queued', status_reason = ?, node = NULL, endpoint = NULL, ssh_endpoint = NULL, web_token = NULL, " +
          "assigned_at = NULL, started_at = NULL, last_billed_at = NULL, last_probe_at = NULL, probe_fail = 0 WHERE id = ? AND status = ? AND node = ?",
      )
      .bind(gpuRefusalReason(node), id, row.status, node)
      .run();
    if ((r.meta?.changes ?? 0) > 0) await addEvent(id, "warn", `node ${node} had not enough free GPUs — re-queued`, now);
    return { ok: true, status: "queued" };
  }
  const reason = report.message?.trim() || (report.status === "failed" ? "failed on node" : "stopped by node");
  await endDeployment(row, report.status, reason, { acked: true, now });
  return { ok: true, status: report.status };
}
