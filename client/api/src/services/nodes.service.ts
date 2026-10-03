/**
 * Provider nodes: identity (own key), payout binding, liveness.
 * A node earns only once a payout wallet is bound; assignment skips unbound nodes.
 */
import { verifyMessage } from "viem";
import { getD1 } from "../lib/storage.js";
import { normalizeAddress } from "../lib/eth.js";
import { getEnv } from "../config/env.js";

export interface NodeRow {
  address: string;
  payout: string | null;
  manifest_json: string | null;
  work_types: string | null;
  throughput_mmac_s: number;
  jobs_done: number;
  jobs_failed: number;
  announced_at: number | null;
  bind_code?: string | null;
  fleet_id?: string | null;
  pubkey?: string | null;
  bound_at: number | null;
  last_seen: number | null;
}

export interface NodeManifest {
  cpuThreads: number;
  ramGB: number;
  gpus: { name: string; vramGB: number }[];
  os: string;
}

export const BIND_MAX_AGE_MS = 10 * 60_000;
const BIND_MAX_SKEW_MS = 60_000;

export function bindingMessage(node: string, payout: string, issuedIso: string): string {
  return `Cloudana node binding\nNode: ${node.toLowerCase()}\nPayout: ${payout.toLowerCase()}\nIssued: ${issuedIso}`;
}

export async function getNode(address: string): Promise<NodeRow | null> {
  return getD1().prepare("SELECT * FROM nodes WHERE address = ?").bind(normalizeAddress(address)).first<NodeRow>();
}

/**
 * Register or refresh a node. The benchmark is kept in the manifest for display
 * only: the assignment weight (throughput_mmac_s) moves only from verified work.
 */
export async function announceNode(
  address: string,
  manifest: NodeManifest,
  benchmarkMmacPerSec: number,
  workTypes: string[],
  pubkey?: string,
): Promise<NodeRow> {
  const now = Date.now();
  const key = normalizeAddress(address);
  await getD1()
    .prepare(
      "INSERT INTO nodes (address, manifest_json, work_types, announced_at, last_seen, pubkey) VALUES (?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(address) DO UPDATE SET manifest_json = excluded.manifest_json, work_types = excluded.work_types, " +
        "announced_at = excluded.announced_at, last_seen = excluded.last_seen, pubkey = COALESCE(excluded.pubkey, nodes.pubkey)",
    )
    .bind(key, JSON.stringify({ ...manifest, benchmarkMmacPerSec }), JSON.stringify(workTypes), now, now, pubkey ?? null)
    .run();
  const row = (await getNode(key))!;
  if (!row.payout && !row.bind_code) {
    // Issued to the node only (announce is node-signed), so only its operator can bind it.
    const code = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
    await getD1().prepare("UPDATE nodes SET bind_code = ? WHERE address = ? AND payout IS NULL").bind(code, key).run();
    row.bind_code = code;
  }
  return row;
}

/**
 * Bind an announced node to a fleet owner's payout (a live fleet token was
 * presented, so no wallet signature or bind code is needed). First binding
 * still wins: a node bound to another wallet is refused; one bound to the same
 * wallet just moves into this fleet.
 */
export async function bindNodeToFleet(node: string, fleet: { id: string; owner: string }): Promise<BindResult> {
  const key = normalizeAddress(node);
  await getD1()
    .prepare(
      "UPDATE nodes SET payout = ?, fleet_id = ?, bound_at = COALESCE(bound_at, ?), bind_code = NULL " +
        "WHERE address = ? AND (payout IS NULL OR payout = ?)",
    )
    .bind(fleet.owner, fleet.id, Date.now(), key, fleet.owner)
    .run();
  const after = await getNode(key);
  if (!after) return { ok: false, code: "not_found", message: "unknown node" };
  return after.payout === fleet.owner && after.fleet_id === fleet.id
    ? { ok: true }
    : { ok: false, code: "conflict", message: "node is already bound to another payout wallet" };
}

export type BindResult = { ok: true } | { ok: false; code: "bad_request" | "unauthorized" | "not_found" | "conflict"; message: string };

/**
 * Bind a payout wallet to a node, proven by the payout wallet's signature over
 * the exact binding message (Issued within 10 minutes). First binding wins;
 * re-binding to the same wallet is a no-op, to a different one is refused.
 */
export async function bindNode(node: string, payout: string, message: string, signature: string, code: string): Promise<BindResult> {
  const nodeKey = normalizeAddress(node);
  const payoutKey = normalizeAddress(payout);
  const issued = /\nIssued: (.+)$/.exec(message)?.[1] ?? "";
  if (message !== bindingMessage(nodeKey, payoutKey, issued)) {
    return { ok: false, code: "bad_request", message: "message is not the node binding message for this node and payout" };
  }
  const issuedMs = Date.parse(issued);
  const age = Date.now() - issuedMs;
  if (!Number.isFinite(issuedMs) || age > BIND_MAX_AGE_MS || age < -BIND_MAX_SKEW_MS) {
    return { ok: false, code: "bad_request", message: "binding message expired (Issued must be within 10 minutes)" };
  }
  let valid = false;
  try {
    valid = await verifyMessage({ address: payoutKey, message, signature: signature as `0x${string}` });
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, code: "unauthorized", message: "signature is not from the payout wallet" };

  const existing = await getNode(nodeKey);
  if (!existing) return { ok: false, code: "not_found", message: "unknown node — start the node agent first" };
  if (existing.payout === payoutKey) return { ok: true };
  if (existing.payout) return { ok: false, code: "conflict", message: "node is already bound to another payout wallet" };
  if (!existing.bind_code || existing.bind_code !== code) {
    return { ok: false, code: "unauthorized", message: "bind code does not match — use the link your node agent printed" };
  }

  await getD1()
    .prepare("UPDATE nodes SET payout = ?, bound_at = ?, bind_code = NULL WHERE address = ? AND payout IS NULL AND bind_code = ?")
    .bind(payoutKey, Date.now(), nodeKey, code)
    .run();
  const after = await getNode(nodeKey);
  return after?.payout === payoutKey
    ? { ok: true }
    : { ok: false, code: "conflict", message: "node is already bound to another payout wallet" };
}

export interface MyNode {
  address: string;
  lastSeen: number | null;
  online: boolean;
  boundAt: number | null;
  manifest: (NodeManifest & { benchmarkMmacPerSec?: number }) | null;
  throughputMmacPerSec: number;
  workTypes: string[];
  fleetId: string | null;
  jobsDone: number;
  jobsFailed: number;
  earnedUcld: number;
  deploymentsRunning: number;
}

/**
 * Nodes bound to a payout wallet. earnedUcld = lane A + B entries (not clawed) paid to that
 * wallet for jobs this node completed (reward_entries → work_jobs.node), plus hosting lane A for
 * hours this node served (reward_entries.job_id = deployment_bills.id → deployment_bills.node).
 */
export async function listNodesForPayout(payout: string, now = Date.now()): Promise<MyNode[]> {
  const rows = await getD1()
    .prepare(
      "SELECT n.*, (SELECT COALESCE(SUM(r.amount_ucld), 0) FROM reward_entries r JOIN work_jobs w ON w.id = r.job_id " +
        "WHERE w.node = n.address AND r.address = n.payout AND r.lane IN ('A','B') AND r.status != 'clawed') " +
        "+ (SELECT COALESCE(SUM(r.amount_ucld), 0) FROM reward_entries r JOIN deployment_bills b ON b.id = r.job_id " +
        "WHERE b.node = n.address AND r.address = n.payout AND r.lane = 'A' AND r.status != 'clawed') AS earned_ucld, " +
        "(SELECT COUNT(*) FROM deployments d WHERE d.node = n.address AND d.status = 'running') AS deployments_running " +
        "FROM nodes n WHERE n.payout = ? ORDER BY n.bound_at, n.address",
    )
    .bind(normalizeAddress(payout))
    .all<NodeRow & { earned_ucld: number; deployments_running: number }>();
  const cutoff = now - getEnv().NODE_ACTIVE_SECONDS * 1000;
  return (rows.results ?? []).map((r) => ({
    address: r.address,
    lastSeen: r.last_seen,
    online: (r.last_seen ?? 0) >= cutoff,
    boundAt: r.bound_at,
    manifest: r.manifest_json ? (JSON.parse(r.manifest_json) as MyNode["manifest"]) : null,
    throughputMmacPerSec: r.throughput_mmac_s,
    workTypes: r.work_types ? (JSON.parse(r.work_types) as string[]) : [],
    fleetId: r.fleet_id ?? null,
    jobsDone: r.jobs_done,
    jobsFailed: r.jobs_failed,
    earnedUcld: r.earned_ucld,
    deploymentsRunning: r.deployments_running,
  }));
}

export async function touchNode(address: string): Promise<void> {
  await getD1().prepare("UPDATE nodes SET last_seen = ? WHERE address = ?").bind(Date.now(), normalizeAddress(address)).run();
}

/** EMA weight for a new throughput sample. */
export const THROUGHPUT_ALPHA = 0.2;

/** Next throughput from a verified job: n³/1e6 MMAC over the seconds from assignment to submit. */
export function nextThroughput(previous: number, units: number, seconds: number): number {
  const sample = units / 1e6 / Math.max(seconds, 0.001);
  return (1 - THROUGHPUT_ALPHA) * previous + THROUGHPUT_ALPHA * sample;
}
