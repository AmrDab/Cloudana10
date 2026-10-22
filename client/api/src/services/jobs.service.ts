/**
 * Work jobs: enqueue with a hold, assignment to nodes, signed submit → ledger.
 * docs/BUILD_SPEC_V1.md §5 ("Assignment", "/work/submit").
 *
 * status: queued → assigned → done | failed; an expired assignment is re-queued.
 */
import { createHash, createHmac } from "node:crypto";
import { getD1 } from "../lib/storage.js";
import { getArtifactStore } from "../lib/artifacts.js";
import { registerObject } from "./storage.service.js";
import { getEnv } from "../config/env.js";
import { normalizeAddress } from "../lib/eth.js";
import { log } from "../lib/logger.js";
import { hold, release } from "./balance.service.js";
import { getNode, nextThroughput, setNodeSuspended, type NodeRow } from "./nodes.service.js";
import { epochOf, jobRewardStatements } from "./ledger.service.js";
import { feeUcld, getPriceQuote } from "./pricing.service.js";
import { getWorkType } from "./work-types.js";
import type { POUWCertificate } from "../../../../pouw/src/types.js";

const L = log.api;

export interface WorkJobRow {
  id: string;
  owner: string;
  work_type: string;
  n: number;
  /** null once the job is done and its matrices moved to `artifact`. */
  a_json: string | null;
  b_json: string | null;
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
  /** Failed verifications so far (schema.ts migration; null on rows from before it). */
  attempts: number | null;
  /** Artifact-store key of the job's matrices once they left D1 (docs/V4_STORAGE_PHASE1_CONTRACT.md §A). */
  artifact: string | null;
  /** The eligible set the draw ran over, sorted by address (JSON Candidate[]), so anyone can replay the draw. */
  eligible_json: string | null;
  /** Set in the transaction that captured the fee and wrote the rewards (submitWork); null = result accepted without a fee. */
  fee_captured_at: number | null;
  /** Sampled transcript re-execution (submitWork): null = not sampled. Never shown to the node. */
  sample_check: "passed" | "failed" | null;
}

export interface JobMatrices {
  n: number;
  matrixA: number[];
  matrixB: number[];
  matrixC: number[] | null;
}

/** A job's matrices: inline while they are still in D1, else from its artifact (null if neither is readable). */
export async function jobMatrices(
  row: Pick<WorkJobRow, "n" | "a_json" | "b_json" | "result_json" | "artifact">,
): Promise<JobMatrices | null> {
  if (row.a_json !== null && row.b_json !== null) {
    return {
      n: row.n,
      matrixA: JSON.parse(row.a_json) as number[],
      matrixB: JSON.parse(row.b_json) as number[],
      matrixC: row.result_json ? (JSON.parse(row.result_json) as number[]) : null,
    };
  }
  if (!row.artifact) return null;
  const bytes = await getArtifactStore()?.get(row.artifact);
  return bytes ? (JSON.parse(new TextDecoder().decode(bytes)) as JobMatrices) : null;
}

/**
 * Moves finished jobs' matrices out of D1 into the artifact store, oldest first, `limit` per run (cron). The columns
 * are cleared only after the put succeeded; a failed put leaves the row for the next run.
 */
export async function moveJobArtifacts(limit = 20): Promise<number> {
  const store = getArtifactStore();
  if (!store) return 0;
  const db = getD1();
  const rows =
    (
      await db
        .prepare(
          "SELECT id, n, a_json, b_json, result_json FROM work_jobs WHERE status = 'done' AND artifact IS NULL " +
            "AND a_json IS NOT NULL ORDER BY completed_at LIMIT ?",
        )
        .bind(limit)
        .all<{ id: string; n: number; a_json: string; b_json: string; result_json: string | null }>()
    ).results ?? [];
  let moved = 0;
  for (const r of rows) {
    const key = `jobs/${r.id}.json`;
    const body = new TextEncoder().encode(`{"n":${r.n},"matrixA":${r.a_json},"matrixB":${r.b_json},"matrixC":${r.result_json ?? "null"}}`);
    try {
      await store.put(key, body);
      await registerObject(key, body.byteLength); // provider copies (docs/V4_STORAGE_PHASE1_CONTRACT.md §B); idempotent
    } catch (err) {
      console.error(`[artifacts] put ${key} failed:`, err);
      continue;
    }
    const res = await db
      .prepare("UPDATE work_jobs SET a_json = NULL, b_json = NULL, result_json = NULL, artifact = ? WHERE id = ? AND artifact IS NULL")
      .bind(key, r.id)
      .run();
    if ((res.meta?.changes ?? 0) > 0) moved++;
  }
  return moved;
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
/** What the draw needs: the replay functions take this, so published records (no payout) replay too. */
export type Weighted = Pick<Candidate, "address" | "weight">;
/** A candidate as published at GET /v1/draws/{id}: the payout wallet is replaced by an opaque per-operator id. */
export interface PublicCandidate extends Weighted {
  operator: string;
}
/**
 * Opaque per-operator id: a keyed hash of the payout wallet. The key derives from INSTRUCTION_SIGNING_KEY, so the
 * epoch leaves (which name payout wallets) cannot be joined back to the eligible set without it; the id only has to
 * be consistent, not reproducible — the replay groups weight by it and never recomputes it. No key (local stacks):
 * an unkeyed hash, which the published key then makes mappable.
 */
export const operatorId = (payout: string) => {
  const key = getEnv().INSTRUCTION_SIGNING_KEY;
  const salt = key ? sha256(`cloudana-operator-id:${key}`) : "";
  return sha256(`operator:${salt}:${normalizeAddress(payout)}`).slice(0, 16);
};

function byAddress(a: Weighted, b: Weighted): number {
  return a.address < b.address ? -1 : a.address > b.address ? 1 : 0;
}

/** sha256 of the sorted "addr:weight" list — lets anyone replay who was eligible. */
export function eligibleHash(candidates: Weighted[]): string {
  return sha256([...candidates].sort(byAddress).map((c) => `${c.address}:${c.weight}`).join(","));
}

/** Deterministic weighted draw: the first 52 bits of draw_seed pick a point on the cumulative weights (sorted by address). */
export function weightedDraw(drawSeedHex: string, candidates: Weighted[]): string {
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
  const price = feeUcld(wt.meter(input), quote.priceNcldPerTmac, quote.baseFeeUcld);
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

/** Verification failures after which a job is failed and its hold released (docs/V4_VERIFIED_SERVICES.md F2). */
export const MAX_JOB_ATTEMPTS = 3;

const CLEAR_ASSIGNMENT =
  "status = 'queued', node = NULL, sigma = NULL, seed_source = NULL, draw_seed = NULL, " +
  "eligible_hash = NULL, eligible_json = NULL, cluster_ok = NULL, assigned_at = NULL, expires_at = NULL";

/** The eligible set as it is stored and published: sorted by address, weights as drawn. */
export const sortedCandidates = (candidates: Candidate[]): Candidate[] =>
  [...candidates].sort(byAddress).map((c) => ({ address: c.address, payout: c.payout, weight: c.weight }));

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
      "SELECT * FROM nodes WHERE payout IS NOT NULL AND state = 'active' AND last_seen >= ? " +
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
        "UPDATE work_jobs SET status = 'assigned', node = ?, sigma = ?, seed_source = ?, draw_seed = ?, eligible_hash = ?, eligible_json = ?, " +
          "cluster_ok = ?, assigned_at = ?, expires_at = ? WHERE id = ? AND status = 'queued' " +
          "AND NOT EXISTS (SELECT 1 FROM work_jobs WHERE node = ? AND status = 'assigned')",
      )
      .bind(
        node, sigma, seedSource, drawSeed, eligibleHash(eligible), JSON.stringify(sortedCandidates(eligible)),
        clusterOk, now, now + env.ASSIGNMENT_TTL_SECONDS * 1000, job.id, node,
      )
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

/**
 * The public draw record of a job (DECENTRALIZATION_ROADMAP.md phase 1 "publish the draw"): everything needed to
 * replay the assignment without trusting the orchestrator — drawSeed = sha256(seedSource ‖ jobId), eligibleHash =
 * sha256 of the sorted "address:weight" list, node = weightedDraw(drawSeed, eligible). No matrices, no owner.
 * σ is published only once the job is done (it binds the transcript to the assignment while the job is live).
 */
export interface DrawRecord {
  jobId: string;
  status: WorkJobRow["status"];
  node: string | null;
  seedSource: string | null;
  drawSeed: string | null;
  eligibleHash: string | null;
  eligible: PublicCandidate[] | null;
  clusterOk: boolean | null;
  assignedAt: number | null;
  completedAt: number | null;
  sigma: string | null;
  certZ: string | null;
  /** seedSource is a chain block hash (not the "local:" fallback) and the eligible set was recorded. */
  replayable: boolean;
}

export async function getDrawRecord(id: string): Promise<DrawRecord | null> {
  const r = await getWorkJob(id);
  if (!r) return null;
  const stored = r.eligible_json ? (JSON.parse(r.eligible_json) as Candidate[]) : null;
  // Published without payout wallets: address and weight are all the replay needs; the operator id lets anyone see
  // how the weight was spread over operators. It hides the wallet only of operators never drawn into a paid job: the
  // epoch job lists name the payout wallet of each job's node, so joining them maps every operator that has won one.
  const eligible = stored ? stored.map((c) => ({ address: c.address, weight: c.weight, operator: operatorId(c.payout) })) : null;
  return {
    jobId: r.id,
    status: r.status,
    node: r.node,
    seedSource: r.seed_source,
    drawSeed: r.draw_seed,
    eligibleHash: r.eligible_hash,
    eligible,
    clusterOk: r.cluster_ok === null ? null : r.cluster_ok === 1,
    assignedAt: r.assigned_at,
    completedAt: r.completed_at,
    sigma: r.status === "done" ? r.sigma : null,
    certZ: r.cert_z,
    // A job that failed for good keeps its node (see submitWork), so its draw stays replayable: the record still says
    // who was drawn, and that they failed. Rows failed before that change have no node: nothing to replay against.
    replayable: !!r.node && !!eligible && !!r.seed_source && !r.seed_source.startsWith("local:"),
  };
}

/** Pure replay of a draw record: what an outsider checks (scripts/verify/replay.ts uses it too). */
export function replayDraw(d: Pick<DrawRecord, "jobId" | "node" | "seedSource" | "drawSeed" | "eligibleHash" | "eligible">): {
  seedOk: boolean;
  eligibleOk: boolean;
  drawOk: boolean;
  ok: boolean;
} {
  const seedOk = !!d.seedSource && !!d.drawSeed && sha256(d.seedSource + d.jobId) === d.drawSeed;
  const eligibleOk = !!d.eligible && !!d.eligibleHash && eligibleHash(d.eligible) === d.eligibleHash;
  const drawOk = seedOk && !!d.eligible && d.eligible.length > 0 && !!d.node && weightedDraw(d.drawSeed!, d.eligible) === d.node;
  return { seedOk, eligibleOk, drawOk, ok: seedOk && eligibleOk && drawOk };
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
    matrixA: JSON.parse(r.a_json!),
    matrixB: JSON.parse(r.b_json!),
    sigma: r.sigma!,
    expiresAt: r.expires_at!,
  };
}

// ─── Submit ───────────────────────────────────────────────────────────────────

/**
 * Whether a submission's transcript is re-executed (ENGINEERING_BACKLOG B-6): the first 32 bits of HMAC-SHA256 over
 * "jobId:σ", keyed by a key derived from JWT_SECRET, are 0 mod k — one job in k. The node knows the job id and σ but
 * not the key, so it cannot tell before it submits; σ carries a fresh nonce per assignment, so a re-queued job is drawn
 * again. k ≤ 1: every job.
 */
export function sampledForCheck(jobId: string, sigma: string, k = getEnv().VERIFY_SAMPLE_K): boolean {
  if (k <= 1) return true;
  const key = sha256(`cloudana-sample:${getEnv().JWT_SECRET}`);
  return createHmac("sha256", key).update(`${jobId}:${sigma}`).digest().readUInt32BE(0) % k === 0;
}

export type SubmitResult =
  | { ok: true; units: number; earned: { laneAUcld: number; laneBUcld: number }; vestsAt: number; heldUntil: number }
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
  const jobInput = { n: job.n, matrixA: JSON.parse(job.a_json!) as number[], matrixB: JSON.parse(job.b_json!) as number[] };
  // Freivalds and the binding checks on every job; the n³ transcript re-execution on a sampled one (B-6).
  const sampled = sampledForCheck(job.id, job.sigma!);
  const verdict = wt.verify({ job: { ...jobInput, sigma: job.sigma! }, certificate: input.certificate, result: input.result }, { transcript: sampled });
  // Caught: a sampled job whose answer is right (every cheap check passed) but whose transcript is not — the work was
  // not done as proven. The verified result is kept and the fee captured (and burned), but the provider's pay is
  // clawed, this job's and all its held pay (wallet-wide), and this node is suspended. Any other failure is refused and
  // re-queued.
  const caught = !verdict.ok && verdict.stage === "transcript";

  if (!verdict.ok && !caught) {
    // A job that keeps failing verification stops after MAX_JOB_ATTEMPTS: it is marked failed and the owner's hold
    // goes back to spendable, instead of re-queuing forever with the fee held.
    const giveUp = (job.attempts ?? 0) + 1 >= MAX_JOB_ATTEMPTS;
    // A job that failed for good keeps `node`: the public draw record then still says who was drawn and failed
    // (nothing selects a node by `node` alone — every guard looks at status = 'assigned').
    const next = giveUp ? "status = 'failed', expires_at = NULL, completed_at = ?" : CLEAR_ASSIGNMENT;
    const update = db
      .prepare(`UPDATE work_jobs SET ${next}, attempts = attempts + 1 WHERE id = ? AND status = 'assigned' AND node = ?`)
      .bind(...(giveUp ? [now, job.id, node] : [job.id, node]));
    const [, res] = await db.batch([
      db.prepare("UPDATE nodes SET jobs_failed = jobs_failed + 1 WHERE address = ?").bind(node),
      update,
    ]);
    if (giveUp && (res?.meta?.changes ?? 0) > 0) await release(job.owner, job.price_ucld);
    L.warn(`[work] rejected ${job.id} from ${node.slice(0, 10)}…: ${verdict.reason}${giveUp ? " — job failed, hold released" : ""}`);
    return { ok: false, code: "unprocessable", message: verdict.reason };
  }

  // One transaction: the fee is authorised on the job row only while the owner's hold covers it, captured only when
  // that authorisation happened in this very batch, the reward entries are written under the same condition, and the
  // result lands last (then, if caught, the claw). A failure anywhere rolls the whole thing back, so the node's retry
  // is a clean second attempt; a job is never done with its fee still held, and a fee is never captured without its
  // rewards (nor minted without its capture).
  const owner = normalizeAddress(job.owner);
  const { statements: rewardStmts, rewards: split } = jobRewardStatements(
    { jobId: job.id, workType: job.work_type, provider: nodeRow.payout, feeUcld: job.price_ucld, clusterOk: job.cluster_ok === 1, now },
    { capturedAt: now, node, clawed: caught },
  );
  const doneAt = 2 + rewardStmts.length;
  const results = await db.batch([
    db
      .prepare(
        "UPDATE work_jobs SET fee_captured_at = ? WHERE id = ? AND status = 'assigned' AND node = ? AND fee_captured_at IS NULL " +
          "AND EXISTS (SELECT 1 FROM balances WHERE address = ? AND held_ucld >= ?)",
      )
      .bind(now, job.id, node, owner, job.price_ucld),
    db
      .prepare(
        "UPDATE balances SET held_ucld = held_ucld - ?, updated_at = ? WHERE address = ? AND held_ucld >= ? " +
          // `status = 'assigned'` as well: two submits in the same millisecond share `now`, and the second one's
          // capture must not ride on the first one's authorisation (its own first statement missed).
          "AND EXISTS (SELECT 1 FROM work_jobs WHERE id = ? AND fee_captured_at = ? AND status = 'assigned' AND node = ?)",
      )
      .bind(job.price_ucld, new Date(now).toISOString(), owner, job.price_ucld, job.id, now, node),
    ...rewardStmts,
    db
      .prepare(
        "UPDATE work_jobs SET status = 'done', result_json = ?, cert_z = ?, completed_at = ?, sample_check = ? WHERE id = ? AND status = 'assigned' AND node = ?",
      )
      .bind(JSON.stringify(input.result), input.certificate.z, now, caught ? "failed" : sampled ? "passed" : null, job.id, node),
    // Caught: claw the provider's held pay — every pending A/B entry, in an epoch after the open one, paid to this node's
    // payout wallet (whichever of its nodes earned it: one operator running several modified nodes keeps none of it)
    // or earned by this node's own done jobs (under a wallet it was bound to before). closeEpochs only closes epochs
    // before the open one, so the two never race; pay already posted or settled needs the guardian veto. Only once this
    // batch's own "done" landed with the failed check.
    ...(caught
      ? [
          db
            .prepare(
              "UPDATE reward_entries SET status = 'clawed' WHERE status = 'pending' AND lane IN ('A','B') AND epoch > ?1 " +
                "AND (address = ?2 OR job_id IN (SELECT id FROM work_jobs WHERE node = ?3 AND status = 'done')) " +
                "AND EXISTS (SELECT 1 FROM work_jobs WHERE id = ?4 AND sample_check = 'failed')",
            )
            .bind(epochOf(now), normalizeAddress(nodeRow.payout), node, job.id),
        ]
      : []),
  ]);
  const done = results[doneAt];
  if ((done?.meta?.changes ?? 0) === 0) return { ok: false, code: "conflict", message: "job was already completed" };

  // Invariant: nothing is minted for a fee that was not captured. The hold is taken at enqueue and released only when
  // the job fails for good, so a missing hold is a bug or tampering — the verified result still goes to the owner (the
  // node did the work), but no reward entries were written, so the epoch close neither mints for it nor burns its fee.
  const captured = (results[0]?.meta?.changes ?? 0) > 0;
  if (!captured) {
    L.error(`[work] capture of ${job.price_ucld} µCLD from ${job.owner} failed for job ${job.id} (hold missing) — result accepted, no rewards recorded`);
  }
  if (caught) {
    // A failure for the node: no jobs_done and no throughput sample, so cheating speed earns no draw weight.
    await db.prepare("UPDATE nodes SET jobs_failed = jobs_failed + 1 WHERE address = ?").bind(node).run();
    const reason = `sampled transcript check failed on job ${job.id}`;
    await setNodeSuspended(node, true, reason, now);
    L.warn(`[work] ${reason} from ${node.slice(0, 10)}…: result kept, ${results[doneAt + 1]?.meta?.changes ?? 0} held entries clawed, node suspended`);
    return {
      ok: false,
      code: "unprocessable",
      message: "sampled transcript check failed: the result is kept, the payout wallet's held pay is clawed and this node is suspended",
    };
  }
  const rewards = captured ? split : { laneAUcld: 0, laneBUcld: 0, treasuryUcld: 0, vestsAt: now, epoch: epochOf(now), heldUntil: now };
  const units = wt.meter(jobInput);
  const seconds = (now - (job.assigned_at ?? now)) / 1000;
  await db
    .prepare("UPDATE nodes SET jobs_done = jobs_done + 1, throughput_mmac_s = ? WHERE address = ?")
    .bind(nextThroughput(nodeRow.throughput_mmac_s, units, seconds), node)
    .run();

  return {
    ok: true,
    units,
    earned: { laneAUcld: rewards.laneAUcld, laneBUcld: rewards.laneBUcld },
    vestsAt: rewards.vestsAt,
    heldUntil: rewards.heldUntil,
  };
}
