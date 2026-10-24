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
import { afterNodeSuspended, getNode, nextThroughput, type NodeRow } from "./nodes.service.js";
import { epochOf, jobRewardStatements, type JobRewards } from "./ledger.service.js";
import { feeUcld, getPriceQuote } from "./pricing.service.js";
import { getWorkType, type WorkType } from "./work-types.js";
import { compareVersions } from "./instruction-signing.service.js";
import type { POUWCertificate } from "../../../../pouw/src/types.js";
import { checkCommitment, checkOpening, type Commitment, type SegmentOpening, type Tensor } from "../../../../shared/verification.js";

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
  sample_check: "passed" | "failed" | "reversed" | null;
  /** Challenge-mode jobs (B-26): the job's input (JSON; matmul keeps a_json/b_json), null for matmul. */
  input_json?: string | null;
  /** The node's commitment (JSON), stored before the challenge is drawn; one per assignment. */
  commitment_json?: string | null;
  /** The drawn segment indices (JSON number[]); never shown before the commitment is stored. */
  challenge_json?: string | null;
  /** The answer deadline (ms); null for matmul and once the job left 'assigned'. */
  challenge_expires_at?: number | null;
  /** The node's payout wallet when the commitment was stored: what a failed challenge claws. */
  commit_payout?: string | null;
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
  /** matmul */
  n?: number;
  matrixA?: number[];
  matrixB?: number[];
  /** Challenge-mode work types (int8-mlp): the job's input. */
  input?: unknown;
  public?: boolean;
  /** Optional user ceiling (µCLD). The orchestrator sets the price; above the ceiling the job is not queued. */
  maxPriceUcld?: number;
}): Promise<EnqueueResult> {
  const wt = getWorkType(input.workType);
  if (!wt) return { ok: false, code: "validation_failed", message: `unknown workType "${input.workType}"` };
  const challenge = wt.mode === "challenge";
  const jobInput = challenge ? input.input : input;
  const invalid = wt.validate(jobInput);
  if (invalid) return { ok: false, code: "validation_failed", message: invalid };

  const owner = normalizeAddress(input.owner);
  const quote = await getPriceQuote();
  const price = feeUcld(wt.meter(jobInput), quote.priceNcldPerTmac, quote.baseFeeUcld);
  if (input.maxPriceUcld !== undefined && price > input.maxPriceUcld) {
    return { ok: false, code: "unprocessable", message: `Price ${price} µCLD is above your ceiling of ${input.maxPriceUcld} µCLD` };
  }
  const held = await hold(owner, price);
  if (!held) return { ok: false, code: "unprocessable", message: `Insufficient credits: job costs ${price} µCLD` };

  const id = crypto.randomUUID();
  if (challenge) {
    // The input stays in D1 (moving it to the artifact store is a follow-up, B-26); `n` is the model width d.
    await getD1()
      .prepare(
        "INSERT INTO work_jobs (id, owner, work_type, n, input_json, price_ucld, public, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)",
      )
      .bind(id, owner, wt.id, (jobInput as { d: number }).d, JSON.stringify(jobInput), price, input.public === false ? 0 : 1, Date.now())
      .run();
  } else {
    await getD1()
      .prepare(
        "INSERT INTO work_jobs (id, owner, work_type, n, a_json, b_json, price_ucld, public, status, created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)",
      )
      .bind(id, owner, wt.id, input.n, JSON.stringify(input.matrixA), JSON.stringify(input.matrixB), price, input.public === false ? 0 : 1, Date.now())
      .run();
  }

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
  // A job with an open challenge is not re-queued: its deadline passing is a failed check (sweepChallenges).
  await db
    .prepare(`UPDATE work_jobs SET ${CLEAR_ASSIGNMENT} WHERE status = 'assigned' AND expires_at < ? AND challenge_expires_at IS NULL`)
    .bind(now)
    .run();

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
      // A type that needs a newer agent is drawn only among nodes on it (int8-mlp ≥ 1.7.0); the network floor is unchanged.
      .filter((n) => !wt.minAgent || (!!n.agent_version && compareVersions(n.agent_version, wt.minAgent) >= 0))
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
  /** Challenge-mode jobs only (matrixA and matrixB are then empty): the job's input. */
  input?: unknown;
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
    // A job with an open challenge was already submitted: the node answers it, it is not handed out again.
    .prepare(
      "SELECT * FROM work_jobs WHERE node = ? AND status = 'assigned' AND expires_at >= ? AND challenge_expires_at IS NULL ORDER BY assigned_at LIMIT 1",
    )
    .bind(normalizeAddress(node), now)
    .first<WorkJobRow>();
  if (!r) return null;
  if (r.input_json) {
    return { jobId: r.id, workType: r.work_type, n: r.n, matrixA: [], matrixB: [], sigma: r.sigma!, expiresAt: r.expires_at!, input: JSON.parse(r.input_json) };
  }
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

/**
 * The segments a challenge-mode job opens (ENGINEERING_BACKLOG B-26): `s` of `0..m-1`, sorted, by a partial
 * Fisher–Yates over the successive 32-bit words of HMAC-SHA256("seg:" + jobId + ":" + σ + ":" + chainRoot), keyed like
 * sampledForCheck. The chain root is the node's commitment, so the draw exists only once the commitment does, and a
 * node cannot predict it (no key) or grind it (one commitment per assignment). Draws of more than 8 (int8-model, up to
 * 16) read words 8–15 from a second HMAC over the same message + ":2"; draws of up to 8 are unchanged.
 */
export function segmentDraw(jobId: string, sigma: string, chainRoot: string, m: number, s: number): number[] {
  if (!Number.isInteger(m) || !Number.isInteger(s) || s < 0 || s > m || s > 16) throw new Error(`segmentDraw: cannot draw ${s} of ${m}`);
  const key = sha256(`cloudana-sample:${getEnv().JWT_SECRET}`);
  const msg = `seg:${jobId}:${sigma}:${chainRoot}`;
  const first = createHmac("sha256", key).update(msg).digest();
  const mac = s > 8 ? Buffer.concat([first, createHmac("sha256", key).update(`${msg}:2`).digest()]) : first;
  const idx = Array.from({ length: m }, (_, i) => i);
  for (let i = 0; i < s; i++) {
    const j = i + (mac.readUInt32BE(i * 4) % (m - i));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, s).sort((a, b) => a - b);
}

const suspensionReason = (jobId: string) => `sampled transcript check failed on job ${jobId}`;
const segmentSuspensionReason = (jobId: string) => `sampled segment check failed on job ${jobId}`;

/**
 * What a failed sampled check does, as statements for submitWork's batch, placed before its "done" update and run only
 * while the job is still this node's assignment: a submit that lost a race (the job is already done) changes nothing,
 * and nothing after the batch can leave the node active and paid.
 *  1. The claw covers every A/B entry in an epoch after the open one (closeEpochs only closes earlier ones, so the two
 *     never race; pay already posted needs the guardian veto) that is paid to the node's payout wallet — whichever of
 *     its nodes earned it, fleet nodes included: an operator running a modified agent on many nodes keeps none of it —
 *     or was earned by the node's own jobs (under a wallet it was bound to before), plus the failing job's own A/B
 *     (written clawed just before). Coverage is recorded in reward_claws, also for entries an earlier failed check
 *     already took, so reversing that one (POST /v1/admin/claws/{jobId}/reverse: a false positive, a leaked fleet
 *     token) leaves them clawed. Entries clawed another way (no claw row) are not covered. Then every covered pending
 *     entry is clawed.
 *  2. The node: one more failure (no jobs_done, no throughput sample, so cheating speed earns no draw weight), and
 *     suspended (the B-8 state; an admin lifts it).
 */
function caughtStatements(jobId: string, node: string, nodeRow: NodeRow, now: number, reason = suspensionReason(jobId)): D1PreparedStatement[] {
  const db = getD1();
  const stillAssigned = "EXISTS (SELECT 1 FROM work_jobs WHERE id = ?1 AND status = 'assigned' AND node = ?2)";
  return [
    db
      .prepare(
        "INSERT OR IGNORE INTO reward_claws (entry_id, job_id) SELECT id, ?1 FROM reward_entries " +
          "WHERE lane IN ('A','B') AND epoch > ?3 " +
          "AND (address = ?4 OR job_id = ?1 OR job_id IN (SELECT id FROM work_jobs WHERE node = ?2 AND status = 'done')) " +
          "AND (status = 'pending' OR job_id = ?1 OR (status = 'clawed' AND EXISTS (SELECT 1 FROM reward_claws c WHERE c.entry_id = reward_entries.id))) " +
          `AND ${stillAssigned}`,
      )
      .bind(jobId, node, epochOf(now), normalizeAddress(nodeRow.payout!)),
    db
      .prepare(`UPDATE reward_entries SET status = 'clawed' WHERE status = 'pending' AND id IN (SELECT entry_id FROM reward_claws WHERE job_id = ?1) AND ${stillAssigned}`)
      .bind(jobId, node),
    db
      .prepare(
        `UPDATE nodes SET jobs_failed = jobs_failed + 1, state = 'suspended', state_reason = ?3, state_at = ?4 WHERE address = ?2 AND ${stillAssigned}`,
      )
      .bind(jobId, node, reason, now),
  ];
}

export type SubmitResult =
  | { ok: true; units: number; earned: { laneAUcld: number; laneBUcld: number }; vestsAt: number; heldUntil: number }
  | { ok: false; code: "not_found" | "conflict" | "unprocessable" | "validation_failed"; message: string };

/** A challenge-mode submit that bound: the segments to open, and by when (ms). */
export type ChallengeResult = { ok: true; challenge: { segments: number[]; deadline: number } };

/** matmul submits a certificate; challenge-mode work types submit a commitment and the result tensor. */
export type WorkSubmission =
  | { jobId: string; certificate: POUWCertificate; result: number[] }
  | { jobId: string; commitment: Commitment; result: Tensor };

export async function submitWork(nodeAddress: string, input: { jobId: string; certificate: POUWCertificate; result: number[] }, now?: number): Promise<SubmitResult>;
export async function submitWork(nodeAddress: string, input: WorkSubmission, now?: number): Promise<SubmitResult | ChallengeResult>;
export async function submitWork(nodeAddress: string, input: WorkSubmission, now = Date.now()): Promise<SubmitResult | ChallengeResult> {
  const node = normalizeAddress(nodeAddress);
  // The guard columns first: a stray, late or repeated submit never loads the job's matrices or input.
  const g = await getD1()
    .prepare(
      "SELECT status, node, expires_at, work_type, cert_z, challenge_json, challenge_expires_at, commitment_json IS NOT NULL AS committed " +
        "FROM work_jobs WHERE id = ?",
    )
    .bind(input.jobId)
    .first<Pick<WorkJobRow, "status" | "node" | "expires_at" | "work_type" | "cert_z" | "challenge_json" | "challenge_expires_at"> & { committed: number }>();
  if (!g) return { ok: false, code: "not_found", message: "job not found" };
  if (g.committed) {
    // A repeat of the stored commitment by the same node — its first response was lost — gets the challenge already
    // drawn and stored (the draw is deterministic; nothing is drawn again). The chain root binds σ, so an equal root is
    // the same commitment under the same σ. Any other commitment: one per assignment, so a node cannot grind the draw.
    const repeat = "commitment" in input && input.commitment?.chainRoot === g.cert_z;
    if (repeat && g.status === "assigned" && g.node === node && g.challenge_json && g.challenge_expires_at) {
      return { ok: true, challenge: { segments: JSON.parse(g.challenge_json) as number[], deadline: g.challenge_expires_at } };
    }
    return { ok: false, code: "conflict", message: "a commitment was already submitted for this assignment" };
  }
  if (g.status !== "assigned" || g.node !== node || (g.expires_at ?? 0) < now) {
    return { ok: false, code: "conflict", message: "job is not assigned to this node (or the assignment expired)" };
  }
  const wt = getWorkType(g.work_type)!;
  // The body must be the job's kind: a refusal of the request, not a failed check of the node's work.
  if ((wt.mode === "challenge") !== ("commitment" in input)) {
    return {
      ok: false,
      code: "validation_failed",
      message: wt.mode === "challenge" ? `this is a ${wt.id} job: submit { jobId, commitment, result }` : `this is a ${wt.id} job: submit { jobId, certificate, result }`,
    };
  }
  const nodeRow = await getNode(node);
  if (!nodeRow?.payout) return { ok: false, code: "conflict", message: "bind this node first" };
  const job = await getWorkJob(input.jobId);
  if (!job) return { ok: false, code: "not_found", message: "job not found" };

  if (wt.mode === "challenge") return submitCommitment(job, node, nodeRow.payout, wt, input as Extract<WorkSubmission, { commitment: Commitment }>, now);
  return submitInline(job, node, nodeRow, wt, input as Extract<WorkSubmission, { certificate: POUWCertificate }>, now);
}

/** A verification failure that is not a catch: refused, re-queued, failed for good after MAX_JOB_ATTEMPTS. */
async function refuse(job: WorkJobRow, node: string, reason: string, now: number): Promise<SubmitResult> {
  const db = getD1();
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
  L.warn(`[work] rejected ${job.id} from ${node.slice(0, 10)}…: ${reason}${giveUp ? " — job failed, hold released" : ""}`);
  return { ok: false, code: "unprocessable", message: reason };
}

type Booked = { done: false } | { done: true; captured: boolean; split: JobRewards; clawed: number };

/**
 * Settles a verified job in one transaction: the fee is authorised on the job row only while the owner's hold covers
 * it, captured only when that authorisation happened in this very batch, the reward entries are written under the same
 * condition, and the result lands last. A failure anywhere rolls the whole thing back, so the node's retry is a clean
 * second attempt; a job is never done with its fee still held, and a fee is never captured without its rewards (nor
 * minted without its capture). `caught` (matmul's sampled transcript failure) writes the provider's entries clawed and
 * adds the claw and the suspension.
 */
async function bookVerified(
  job: WorkJobRow,
  node: string,
  nodeRow: NodeRow,
  now: number,
  out: { resultJson: string; certZ: string; sampleCheck: WorkJobRow["sample_check"]; caught: boolean },
): Promise<Booked> {
  const db = getD1();
  const owner = normalizeAddress(job.owner);
  const { statements: rewardStmts, rewards: split } = jobRewardStatements(
    { jobId: job.id, workType: job.work_type, provider: nodeRow.payout!, feeUcld: job.price_ucld, clusterOk: job.cluster_ok === 1, now },
    { capturedAt: now, node, clawed: out.caught },
  );
  const caughtStmts = out.caught ? caughtStatements(job.id, node, nodeRow, now) : [];
  const doneAt = 2 + rewardStmts.length + caughtStmts.length;
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
    ...caughtStmts,
    db
      .prepare(
        "UPDATE work_jobs SET status = 'done', result_json = ?, cert_z = ?, completed_at = ?, sample_check = ? WHERE id = ? AND status = 'assigned' AND node = ?",
      )
      .bind(out.resultJson, out.certZ, now, out.sampleCheck, job.id, node),
  ]);
  const done = results[doneAt];
  if ((done?.meta?.changes ?? 0) === 0) return { done: false };

  // Invariant: nothing is minted for a fee that was not captured. The hold is taken at enqueue and released only when
  // the job fails for good, so a missing hold is a bug or tampering — the verified result still goes to the owner (the
  // node did the work), but no reward entries were written, so the epoch close neither mints for it nor burns its fee.
  const captured = (results[0]?.meta?.changes ?? 0) > 0;
  if (!captured) {
    L.error(`[work] capture of ${job.price_ucld} µCLD from ${job.owner} failed for job ${job.id} (hold missing) — result accepted, no rewards recorded`);
  }
  const clawed = out.caught ? (results[2 + rewardStmts.length + 1]?.meta?.changes ?? 0) : 0; // the UPDATE after the coverage INSERT
  return { done: true, captured, split, clawed };
}

/** After a verified, uncaught job: the node's count and throughput sample, and what it earned. */
async function creditNode(
  node: string,
  nodeRow: NodeRow,
  job: WorkJobRow,
  units: number,
  booked: Extract<Booked, { done: true }>,
  now: number,
): Promise<SubmitResult> {
  const rewards = booked.captured ? booked.split : { laneAUcld: 0, laneBUcld: 0, treasuryUcld: 0, vestsAt: now, epoch: epochOf(now), heldUntil: now };
  const seconds = (now - (job.assigned_at ?? now)) / 1000;
  await getD1()
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

/** Best effort after a suspension: the fleet hint and the node's deployments (the claw and the suspension stand). */
async function afterCaught(job: Pick<WorkJobRow, "id">, node: string, nodeRow: NodeRow, now: number, reason = suspensionReason(job.id)): Promise<void> {
  try {
    if (nodeRow.fleet_id) {
      // A fleet node pays the fleet owner's wallet: tell them which fleet, in case the node is not theirs (a leaked token).
      const fleet = await getD1().prepare("SELECT name FROM fleets WHERE id = ?").bind(nodeRow.fleet_id).first<{ name: string | null }>();
      L.warn(
        `[work] the node is in fleet "${fleet?.name ?? "?"}" (${nodeRow.fleet_id}): if this node is not yours, revoke the fleet's ` +
          `token and ask an admin to reverse the claw (POST /v1/admin/claws/${job.id}/reverse)`,
      );
    }
    await afterNodeSuspended(node, reason, now);
  } catch (err) {
    L.warn(`[work] after suspending ${node.slice(0, 10)}…: a best-effort step failed (the claw and the suspension stand):`, err);
  }
}

/** matmul: certificate and result in the submit; Freivalds on every job, the transcript on a sampled one (B-6). */
async function submitInline(
  job: WorkJobRow,
  node: string,
  nodeRow: NodeRow,
  wt: WorkType<any>,
  input: { jobId: string; certificate: POUWCertificate; result: number[] },
  now: number,
): Promise<SubmitResult> {
  const jobInput = { n: job.n, matrixA: JSON.parse(job.a_json!) as number[], matrixB: JSON.parse(job.b_json!) as number[] };
  // Freivalds and the binding checks on every job; the n³ transcript re-execution on a sampled one (B-6).
  const sampled = sampledForCheck(job.id, job.sigma!);
  const verdict = wt.verify!({ job: { ...jobInput, sigma: job.sigma! }, certificate: input.certificate, result: input.result }, { transcript: sampled });
  // Caught: a sampled job whose answer is right (every cheap check passed) but whose transcript is not — the work was
  // not done as proven. The verified result is kept and the fee captured (and burned), but the provider's pay is
  // clawed, this job's and its held pay, and this node is suspended. Any other failure is refused and re-queued.
  const caught = !verdict.ok && verdict.stage === "transcript";

  if (!verdict.ok && !caught) return refuse(job, node, verdict.reason, now);

  const booked = await bookVerified(job, node, nodeRow, now, {
    resultJson: JSON.stringify(input.result),
    certZ: input.certificate.z,
    sampleCheck: caught ? "failed" : sampled ? "passed" : null,
    caught,
  });
  if (!booked.done) return { ok: false, code: "conflict", message: "job was already completed" };

  if (caught) {
    // The claw, the failure count and the suspension are already committed with the result; what is left is best effort.
    L.warn(
      `[work] ${suspensionReason(job.id)} from ${node}: result kept, ${booked.clawed} held entries of payout wallet ` +
        `${normalizeAddress(nodeRow.payout!)} clawed, node suspended`,
    );
    await afterCaught(job, node, nodeRow, now);
    return {
      ok: false,
      code: "unprocessable",
      message: "sampled transcript check failed: the result is kept, the payout wallet's held pay is clawed and this node is suspended",
    };
  }
  return creditNode(node, nodeRow, job, wt.meter(jobInput), booked, now);
}

/// ─── Challenge mode: commit, then challenge, then answer (ENGINEERING_BACKLOG B-26) ─────────────────────────────

function challengeJob(job: WorkJobRow, wt: WorkType<any>) {
  const input = JSON.parse(job.input_json!) as unknown;
  return { input, plan: wt.plan!(input), inputs: wt.inputs!(input) };
}

/**
 * Bind the node's commitment to the job (σ, the job's own inputs, the plan, the result) and only then draw the
 * segments it must open: the commitment, the result, the draw and the deadline land in one write, before the draw is
 * returned. The write holds only for the σ that was checked and an assignment that has not expired, so a commitment
 * can never bind a σ that an expire-and-reassign replaced in between. A commitment that does not bind is refused like
 * any failed matmul check (re-queued, failed after MAX_JOB_ATTEMPTS, no claw). The job stays 'assigned' until the
 * answer, so every guard on 'assigned' still holds.
 */
async function submitCommitment(
  job: WorkJobRow,
  node: string,
  payout: string,
  wt: WorkType<any>,
  sub: { jobId: string; commitment: Commitment; result: Tensor },
  now: number,
): Promise<SubmitResult | ChallengeResult> {
  const { input, plan, inputs } = challengeJob(job, wt);
  const bound = checkCommitment(job.sigma!, inputs, plan, sub.commitment, sub.result, wt.resultSig!(input));
  if (!bound.ok) return refuse(job, node, bound.reason, now);

  // Only the fields the checks read are stored.
  const c: Commitment = {
    inputHash: sub.commitment.inputHash,
    outputHash: sub.commitment.outputHash,
    chainRoot: sub.commitment.chainRoot,
    segments: sub.commitment.segments.map((s) => ({ idx: s.idx, outHash: s.outHash })),
  };
  const segments = segmentDraw(job.id, job.sigma!, c.chainRoot, plan.length, wt.samples!(input));
  const deadline = now + getEnv().CHALLENGE_TTL_SECONDS * 1000;
  const res = await getD1()
    .prepare(
      "UPDATE work_jobs SET commitment_json = ?, cert_z = ?, result_json = ?, challenge_json = ?, challenge_expires_at = ?, expires_at = ?, " +
        "commit_payout = ? WHERE id = ? AND status = 'assigned' AND node = ? AND commitment_json IS NULL AND sigma = ? AND expires_at >= ?",
    )
    .bind(JSON.stringify(c), c.chainRoot, JSON.stringify(sub.result), JSON.stringify(segments), deadline, deadline, normalizeAddress(payout), job.id, node, job.sigma, now)
    .run();
  if ((res.meta?.changes ?? 0) === 0) {
    return { ok: false, code: "conflict", message: "the assignment changed or a commitment was already submitted; nothing was stored" };
  }
  return { ok: true, challenge: { segments, deadline } };
}

/** What a failed challenge needs of the job: no input, no result. */
type CaughtJob = Pick<WorkJobRow, "id" | "owner" | "price_ucld" | "commit_payout">;

/**
 * A failed challenge (a wrong or mismatched opening, or no answer in time), in one batch: the payout wallet's held pay
 * is clawed and the node suspended (caughtStatements, unchanged), the owner's hold released, and the job failed — last,
 * so `stillAssigned` holds for every statement before it and a second, racing catch changes nothing. No pay was booked
 * for this job, so the claw takes the wallet's other held pay; the owner is not charged and the result is dropped
 * (nothing proved it). Not re-queued in Phase 0.
 */
async function caughtChallenge(job: CaughtJob, node: string, nodeRow: NodeRow | null, reason: string, now: number): Promise<SubmitResult> {
  const db = getD1();
  const why = segmentSuspensionReason(job.id);
  const stillAssigned = "EXISTS (SELECT 1 FROM work_jobs WHERE id = ?1 AND status = 'assigned' AND node = ?2)";
  // The wallet snapshotted at commit time, whatever the node's binding says now: unbinding (or being unbound by any
  // route) mid-challenge evades nothing. The suspension is part of the same statements, so it always lands.
  const payout = job.commit_payout ?? nodeRow?.payout ?? null;
  const stmts = payout
    ? caughtStatements(job.id, node, { ...(nodeRow ?? ({ address: node } as NodeRow)), payout }, now, why)
    : [
        db
          .prepare(`UPDATE nodes SET jobs_failed = jobs_failed + 1, state = 'suspended', state_reason = ?3, state_at = ?4 WHERE address = ?2 AND ${stillAssigned}`)
          .bind(job.id, node, why, now),
      ];
  const results = await db.batch([
    ...stmts,
    db
      .prepare(
        "UPDATE balances SET held_ucld = held_ucld - ?3, balance_ucld = balance_ucld + ?3, updated_at = ?4 WHERE address = ?5 AND held_ucld >= ?3 " +
          `AND ${stillAssigned}`,
      )
      .bind(job.id, node, job.price_ucld, new Date(now).toISOString(), normalizeAddress(job.owner)),
    db
      .prepare(
        "UPDATE work_jobs SET status = 'failed', sample_check = 'failed', result_json = NULL, completed_at = ?, expires_at = NULL, " +
          "challenge_expires_at = NULL WHERE id = ? AND status = 'assigned' AND node = ?",
      )
      .bind(now, job.id, node),
  ]);
  if ((results[stmts.length + 1]?.meta?.changes ?? 0) > 0) {
    const clawed = payout ? (results[1]?.meta?.changes ?? 0) : 0; // the UPDATE after the coverage INSERT
    L.warn(`[work] ${why} from ${node} (${reason}): job failed, hold released, ${clawed} held entries of ${payout ?? "no wallet"} clawed, node suspended`);
    if (nodeRow) await afterCaught(job, node, nodeRow, now, why);
  }
  return {
    ok: false,
    code: "unprocessable",
    message: `sampled segment check failed (${reason}): the job failed, the payout wallet's held pay is clawed and this node is suspended`,
  };
}

/**
 * POST /v1/work/answer: the openings of exactly the challenged segments, before the deadline. Each is checked against
 * the stored commitment (shared/verification.ts checkOpening, job inputs from the job). Pass → settled like a matmul
 * job (bookVerified, sample_check 'passed'); anything else → caughtChallenge.
 */
export async function answerChallenge(
  nodeAddress: string,
  input: { jobId: string; openings: SegmentOpening[] },
  now = Date.now(),
): Promise<SubmitResult> {
  const node = normalizeAddress(nodeAddress);
  // The guard columns first: a stray or replayed answer never loads the job's input and result.
  const g = await getD1()
    .prepare("SELECT status, node, commitment_json IS NOT NULL AND challenge_json IS NOT NULL AS open FROM work_jobs WHERE id = ?")
    .bind(input.jobId)
    .first<{ status: string; node: string | null; open: number }>();
  if (!g) return { ok: false, code: "not_found", message: "job not found" };
  if (g.status !== "assigned" || g.node !== node || !g.open) return { ok: false, code: "conflict", message: "no open challenge for this node on this job" };
  const job = await getWorkJob(input.jobId);
  if (!job || job.status !== "assigned" || job.node !== node || !job.commitment_json || !job.challenge_json) {
    return { ok: false, code: "conflict", message: "no open challenge for this node on this job" };
  }
  const nodeRow = await getNode(node);
  if ((job.challenge_expires_at ?? 0) < now) return caughtChallenge(job, node, nodeRow, "answered after the deadline", now);

  const wt = getWorkType(job.work_type)!;
  const { input: jobInput, plan, inputs } = challengeJob(job, wt);
  const commitment = JSON.parse(job.commitment_json) as Commitment;
  const drawn = JSON.parse(job.challenge_json) as number[];
  const openings = Array.isArray(input.openings) ? input.openings : [];
  const opened = openings.map((o) => o?.idx).sort((a, b) => a - b);
  if (opened.length !== drawn.length || opened.some((v, i) => v !== drawn[i])) {
    return caughtChallenge(job, node, nodeRow, "the answer must open exactly the challenged segments", now);
  }
  for (const o of openings) {
    const spec = plan[o.idx];
    const v = checkOpening(spec, o, commitment, inputs, wt.kernel!(jobInput, spec.op));
    if (!v.ok && v.stage) return caughtChallenge(job, node, nodeRow, v.reason, now);
    // No stage: the job's own data does not fit its plan. Not the node's fault, and validate() makes it unreachable.
    if (!v.ok) {
      // Not the node's fault (validate() should make it unreachable): fail the job and refund the owner, no claw.
      const r = await getD1()
        .prepare("UPDATE work_jobs SET status = 'failed', completed_at = ?, expires_at = NULL, challenge_expires_at = NULL WHERE id = ? AND status = 'assigned' AND node = ?")
        .bind(now, job.id, node)
        .run();
      if ((r.meta?.changes ?? 0) > 0) await release(job.owner, job.price_ucld);
      L.error(`[work] job ${job.id} does not fit its own plan (${v.reason}): failed and refunded, node not blamed`);
      return { ok: false, code: "conflict", message: "this job's own data does not fit its plan: it was failed and refunded" };
    }
  }
  // Paid to the wallet the node was bound to when it committed (the one a failure would have clawed).
  const payTo = job.commit_payout ?? nodeRow?.payout;
  if (!nodeRow || !payTo) return { ok: false, code: "conflict", message: "bind this node first" };

  const booked = await bookVerified(job, node, { ...nodeRow, payout: payTo }, now, { resultJson: job.result_json!, certZ: job.cert_z!, sampleCheck: "passed", caught: false });
  if (!booked.done) return { ok: false, code: "conflict", message: "job was already completed" };
  return creditNode(node, nodeRow, job, wt.meter(jobInput), booked, now);
}

/**
 * The sweep's grace after a deadline: an answer that reached the API in time but is still being checked (or a clock
 * a few seconds apart) is not raced by the cron. The answer path itself keeps the strict deadline.
 */
export const SWEEP_GRACE_MS = 10_000;

/**
 * Cron: a challenge not answered by its deadline (plus SWEEP_GRACE_MS) is a failed check. Reads only the columns a
 * catch needs; one job that throws is logged and the rest of the batch still runs. Returns the jobs caught.
 */
export async function sweepChallenges(now = Date.now(), limit = 50): Promise<number> {
  const rows =
    (
      await getD1()
        .prepare(
          "SELECT id, owner, price_ucld, node, commit_payout FROM work_jobs WHERE status = 'assigned' AND challenge_expires_at < ? " +
            "ORDER BY challenge_expires_at LIMIT ?",
        )
        .bind(now - SWEEP_GRACE_MS, limit)
        .all<CaughtJob & { node: string }>()
    ).results ?? [];
  let caught = 0;
  for (const job of rows) {
    try {
      await caughtChallenge(job, job.node, await getNode(job.node), "no answer before the deadline", now);
      caught++;
    } catch (err) {
      L.error(`[work] challenge sweep of job ${job.id} failed (the rest of the batch continues):`, err);
    }
  }
  return caught;
}
