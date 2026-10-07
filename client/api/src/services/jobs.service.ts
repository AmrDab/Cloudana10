/**
 * Work jobs: enqueue with a hold, assignment to nodes, signed submit → ledger.
 * docs/BUILD_SPEC_V1.md §5 ("Assignment", "/work/submit").
 *
 * status: queued → assigned → done | failed; an expired assignment is re-queued.
 */
import { createHash } from "node:crypto";
import { getD1 } from "../lib/storage.js";
import { getEnv } from "../config/env.js";
import { normalizeAddress } from "../lib/eth.js";
import { log } from "../lib/logger.js";
import { capture, hold } from "./balance.service.js";
import { getNode, nextThroughput, type NodeRow } from "./nodes.service.js";
import { recordJobRewards } from "./ledger.service.js";
import { feeUcld, getPriceQuote } from "./pricing.service.js";
import { getWorkType } from "./work-types.js";
import type { POUWCertificate } from "../../../../pouw/src/types.js";

const L = log.api;

export interface WorkJobRow {
  id: string;
  owner: string;
  work_type: string;
  n: number;
  a_json: string;
  b_json: string;
  price_ucld: number;
  public: number;
  status: "queued" | "assigned" | "done" | "failed";
  node: string | null;
  sigma: string | null;
  seed_source: string | null;
  draw_seed: string | null;
  eligible_hash: string | null;
  cluster_ok: number | null;
  assigned_at: number | null;
  expires_at: number | null;
  result_json: string | null;
  cert_z: string | null;
  created_at: number;
  completed_at: number | null;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// ─── Pure assignment helpers ──────────────────────────────────────────────────

export interface Candidate {
  address: string;
  payout: string;
  weight: number;
}

function byAddress(a: Candidate, b: Candidate): number {
  return a.address < b.address ? -1 : a.address > b.address ? 1 : 0;
}

/** sha256 of the sorted "addr:weight" list — lets anyone replay who was eligible. */
export function eligibleHash(candidates: Candidate[]): string {
  return sha256([...candidates].sort(byAddress).map((c) => `${c.address}:${c.weight}`).join(","));
}

/** Deterministic weighted draw: the first 52 bits of draw_seed pick a point on the cumulative weights (sorted by address). */
export function weightedDraw(drawSeedHex: string, candidates: Candidate[]): string {
  if (candidates.length === 0) throw new Error("weightedDraw: no candidates");
  const sorted = [...candidates].sort(byAddress);
  const total = sorted.reduce((s, c) => s + Math.max(c.weight, 0), 0);
  if (total <= 0) return sorted[parseInt(drawSeedHex.slice(0, 8), 16) % sorted.length].address;
  const u = parseInt(drawSeedHex.slice(0, 13), 16) / 2 ** 52;
  const target = u * total;
  let acc = 0;
  for (const c of sorted) {
    acc += Math.max(c.weight, 0);
    if (target < acc) return c.address;
  }
  return sorted[sorted.length - 1].address;
}

/**
 * Per-operator cluster gate (cluster = payout wallet). Lane B is withheld for everyone when fewer
 * than nMin distinct wallets are eligible, and only for `operator` when that wallet holds more than
 * sCap of eligible throughput — other operators keep their subsidy. The share check is skipped when
 * only one wallet exists and nMin ≤ 1 (single-node local dev).
 */
export function clusterTest(candidates: Candidate[], nMin: number, sCap: number, operator: string): boolean {
  const byWallet = new Map<string, number>();
  for (const c of candidates) byWallet.set(c.payout, (byWallet.get(c.payout) ?? 0) + Math.max(c.weight, 0));
  if (byWallet.size < nMin) return false;
  if (byWallet.size === 1 && nMin <= 1) return true;
  const total = [...byWallet.values()].reduce((a, b) => a + b, 0);
  if (total <= 0) return false;
  return (byWallet.get(operator) ?? 0) / total <= sCap;
}

/** Latest block hash from CHAIN_RPC_URL; "local:<ms>" when unavailable (the prefix flags the fallback). */
export async function fetchSeedSource(): Promise<string> {
  const url = getEnv().CHAIN_RPC_URL;
  if (url) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: ["latest", false] }),
        signal: AbortSignal.timeout(2000),
      });
      const body = (await res.json()) as { result?: { hash?: string } };
      if (body.result?.hash && /^0x[0-9a-fA-F]{64}$/.test(body.result.hash)) return body.result.hash;
    } catch {
      /* fall through */
    }
  }
  return `local:${Date.now()}`;
}

// ─── Enqueue / read ───────────────────────────────────────────────────────────

export interface JobSummary {
  id: string;
  workType: string;
  n: number;
  priceUcld: number;
  public: boolean;
  status: string;
  node: string | null;
  createdAt: number;
  assignedAt: number | null;
  completedAt: number | null;
}

export function toSummary(r: WorkJobRow): JobSummary {
  return {
    id: r.id,
    workType: r.work_type,
    n: r.n,
    priceUcld: r.price_ucld,
    public: r.public === 1,
    status: r.status,
    node: r.node,
    createdAt: r.created_at,
    assignedAt: r.assigned_at,
    completedAt: r.completed_at,
  };
}

export type EnqueueResult =
  | { ok: true; jobId: string; priceUcld: number; balanceUcld: number }
  | { ok: false; code: "validation_failed" | "unprocessable"; message: string };

export async function enqueueWorkJob(input: {
  owner: string;
  workType: string;
  n: number;
  matrixA: number[];
  matrixB: number[];
  public?: boolean;
  /** Optional user ceiling (µCLD). The orchestrator sets the price; above the ceiling the job is not queued. */
  maxPriceUcld?: number;
}): Promise<EnqueueResult> {
  const wt = getWorkType(input.workType);
  if (!wt) return { ok: false, code: "validation_failed", message: `unknown workType "${input.workType}"` };
  const invalid = wt.validate(input);
  if (invalid) return { ok: false, code: "validation_failed", message: invalid };

  const owner = normalizeAddress(input.owner);
  const quote = await getPriceQuote();
  const price = feeUcld(wt.meter(input), quote.priceNcldPerTmac, getEnv().BASE_FEE_UCLD);
  if (input.maxPriceUcld !== undefined && price > input.maxPriceUcld) {
    return { ok: false, code: "unprocessable", message: `Price ${price} µCLD is above your ceiling of ${input.maxPriceUcld} µCLD` };
  }
  const held = await hold(owner, price);
  if (!held) return { ok: false, code: "unprocessable", message: `Insufficient credits: job costs ${price} µCLD` };

  const id = crypto.randomUUID();
  await getD1()
    .prepare(
      "INSERT INTO work_jobs (id, owner, work_type, n, a_json, b_json, price_ucld, public, status, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)",
    )
    .bind(id, owner, wt.id, input.n, JSON.stringify(input.matrixA), JSON.stringify(input.matrixB), price, input.public === false ? 0 : 1, Date.now())
    .run();

  try {
    await runAssignment();
  } catch (err) {
    L.warn("[jobs] assignment after enqueue failed:", err);
  }
  return { ok: true, jobId: id, priceUcld: price, balanceUcld: held.balanceUcld };
}

export async function getWorkJob(id: string): Promise<WorkJobRow | null> {
  return getD1().prepare("SELECT * FROM work_jobs WHERE id = ?").bind(id).first<WorkJobRow>();
}

export async function listWorkJobs(owner: string, limit = 50): Promise<JobSummary[]> {
  const rows = await getD1()
    .prepare("SELECT * FROM work_jobs WHERE owner = ? ORDER BY created_at DESC LIMIT ?")
    .bind(normalizeAddress(owner), limit)
    .all<WorkJobRow>();
  return (rows.results ?? []).map(toSummary);
}

// ─── Assignment ───────────────────────────────────────────────────────────────

const CLEAR_ASSIGNMENT =
  "status = 'queued', node = NULL, sigma = NULL, seed_source = NULL, draw_seed = NULL, " +
  "eligible_hash = NULL, cluster_ok = NULL, assigned_at = NULL, expires_at = NULL";

/** Expire stale assignments, then assign queued jobs (oldest first) to eligible nodes. Returns the number assigned. */
export async function runAssignment(now = Date.now()): Promise<number> {
  const env = getEnv();
  const db = getD1();
  await db.prepare(`UPDATE work_jobs SET ${CLEAR_ASSIGNMENT} WHERE status = 'assigned' AND expires_at < ?`).bind(now).run();

  const queued = await db
    .prepare("SELECT id, work_type FROM work_jobs WHERE status = 'queued' ORDER BY created_at LIMIT 50")
    .all<{ id: string; work_type: string }>();
  if (!queued.results?.length) return 0;

  const nodes = await db
    .prepare(
      "SELECT * FROM nodes WHERE payout IS NOT NULL AND last_seen >= ? " +
        "AND address NOT IN (SELECT node FROM work_jobs WHERE status = 'assigned' AND node IS NOT NULL)",
    )
    .bind(now - env.NODE_ACTIVE_SECONDS * 1000)
    .all<NodeRow>();
  const pool = new Map((nodes.results ?? []).map((n) => [n.address, n]));
  if (pool.size === 0) return 0;

  const seedSource = await fetchSeedSource();
  let assigned = 0;
  for (const job of queued.results) {
    const wt = getWorkType(job.work_type);
    if (!wt) continue;
    const need = wt.requirements({ n: 0, matrixA: [], matrixB: [] }).workType;
    const eligible: Candidate[] = [...pool.values()]
      .filter((n) => (JSON.parse(n.work_types ?? "[]") as string[]).includes(need))
      .map((n) => ({ address: n.address, payout: n.payout!, weight: n.throughput_mmac_s }));
    if (eligible.length === 0) continue;

    const drawSeed = sha256(seedSource + job.id);
    const node = weightedDraw(drawSeed, eligible);
    const nonce = crypto.randomUUID();
    const sigma = sha256(job.id + node + nonce + seedSource);
    const clusterOk = clusterTest(eligible, env.CLUSTER_N_MIN, env.CLUSTER_S_CAP, pool.get(node)!.payout!) ? 1 : 0;

    const r = await db
      .prepare(
        "UPDATE work_jobs SET status = 'assigned', node = ?, sigma = ?, seed_source = ?, draw_seed = ?, eligible_hash = ?, " +
          "cluster_ok = ?, assigned_at = ?, expires_at = ? WHERE id = ? AND status = 'queued' " +
          "AND NOT EXISTS (SELECT 1 FROM work_jobs WHERE node = ? AND status = 'assigned')",
      )
      .bind(node, sigma, seedSource, drawSeed, eligibleHash(eligible), clusterOk, now, now + env.ASSIGNMENT_TTL_SECONDS * 1000, job.id, node)
      .run();
    pool.delete(node);
    if ((r.meta?.changes ?? 0) > 0) assigned++;
    if (pool.size === 0) break;
  }
  return assigned;
}

export interface Assignment {
  jobId: string;
  workType: string;
  n: number;
  matrixA: number[];
  matrixB: number[];
  sigma: string;
  expiresAt: number;
}

export async function getActiveAssignment(node: string, now = Date.now()): Promise<Assignment | null> {
  const r = await getD1()
    .prepare("SELECT * FROM work_jobs WHERE node = ? AND status = 'assigned' AND expires_at >= ? ORDER BY assigned_at LIMIT 1")
    .bind(normalizeAddress(node), now)
    .first<WorkJobRow>();
  if (!r) return null;
  return {
    jobId: r.id,
    workType: r.work_type,
    n: r.n,
    matrixA: JSON.parse(r.a_json),
    matrixB: JSON.parse(r.b_json),
    sigma: r.sigma!,
    expiresAt: r.expires_at!,
  };
}

// ─── Submit ───────────────────────────────────────────────────────────────────

export type SubmitResult =
  | { ok: true; units: number; earned: { laneAUcld: number; laneBUcld: number }; vestsAt: number }
  | { ok: false; code: "not_found" | "conflict" | "unprocessable"; message: string };

export async function submitWork(
  nodeAddress: string,
  input: { jobId: string; certificate: POUWCertificate; result: number[] },
  now = Date.now(),
): Promise<SubmitResult> {
  const db = getD1();
  const node = normalizeAddress(nodeAddress);
  const job = await getWorkJob(input.jobId);
  if (!job) return { ok: false, code: "not_found", message: "job not found" };
  if (job.status !== "assigned" || job.node !== node || (job.expires_at ?? 0) < now) {
    return { ok: false, code: "conflict", message: "job is not assigned to this node (or the assignment expired)" };
  }
  const nodeRow = await getNode(node);
  if (!nodeRow?.payout) return { ok: false, code: "conflict", message: "bind this node first" };

  const wt = getWorkType(job.work_type)!;
  const jobInput = { n: job.n, matrixA: JSON.parse(job.a_json) as number[], matrixB: JSON.parse(job.b_json) as number[] };
  const verdict = wt.verify({ job: { ...jobInput, sigma: job.sigma! }, certificate: input.certificate, result: input.result });

  if (!verdict.ok) {
    await db.batch([
      db.prepare("UPDATE nodes SET jobs_failed = jobs_failed + 1 WHERE address = ?").bind(node),
      db.prepare(`UPDATE work_jobs SET ${CLEAR_ASSIGNMENT} WHERE id = ? AND status = 'assigned' AND node = ?`).bind(job.id, node),
    ]);
    L.warn(`[work] rejected ${job.id} from ${node.slice(0, 10)}…: ${verdict.reason}`);
    return { ok: false, code: "unprocessable", message: verdict.reason };
  }

  const done = await db
    .prepare(
      "UPDATE work_jobs SET status = 'done', result_json = ?, cert_z = ?, completed_at = ? WHERE id = ? AND status = 'assigned' AND node = ?",
    )
    .bind(JSON.stringify(input.result), input.certificate.z, now, job.id, node)
    .run();
  if ((done.meta?.changes ?? 0) === 0) return { ok: false, code: "conflict", message: "job was already completed" };

  if (!(await capture(job.owner, job.price_ucld))) {
    L.error(`[work] capture of ${job.price_ucld} µCLD from ${job.owner} failed for job ${job.id} (hold missing)`);
  }
  const rewards = await recordJobRewards({
    jobId: job.id,
    workType: job.work_type,
    provider: nodeRow.payout,
    feeUcld: job.price_ucld,
    clusterOk: job.cluster_ok === 1,
    now,
  });
  const units = wt.meter(jobInput);
  const seconds = (now - (job.assigned_at ?? now)) / 1000;
  await db
    .prepare("UPDATE nodes SET jobs_done = jobs_done + 1, throughput_mmac_s = ? WHERE address = ?")
    .bind(nextThroughput(nodeRow.throughput_mmac_s, units, seconds), node)
    .run();

  return { ok: true, units, earned: { laneAUcld: rewards.laneAUcld, laneBUcld: rewards.laneBUcld }, vestsAt: rewards.vestsAt };
}
