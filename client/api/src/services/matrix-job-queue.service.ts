/**
 * Matrix Job Queue — the supply of REAL work that makes PoUW useful.
 *
 * Tier-3 matrix workloads are decomposed into (A, B) multiplication jobs and
 * queued here. Miners claim a job (GET /v1/pouw/job), mine their certificate ON
 * that job's matrices via the workload bridge, and submit certificate + result
 * together. Full mining rewards are gated on a completed job from this queue —
 * random filler earns only a capped fraction (see mining-reward.service).
 *
 * Storage: D1/SQLite via the shared storage shim (persistent on both the edge
 * Worker and the Node orchestrator). Falls back to in-memory only if the DB is
 * unavailable, and says so loudly — a restart then drops queued jobs (testnet
 * acceptable, logged, never silent).
 */

import { createHash } from "node:crypto";
import { getD1 } from "../lib/storage.js";
import { log } from "../lib/logger.js";

const L = log.pouw;

export interface MatrixJob {
  id: string;
  n: number;
  matrixA: number[];
  matrixB: number[];
  difficulty: number;
  status: "queued" | "claimed" | "done";
  provider?: string;
  claimedAt?: number;
  expiresAt?: number;
  createdAt: number;
  resultHash?: string;
  completedAt?: number;
}

/** How long a claim lasts before the job is reassignable. */
const CLAIM_TTL_MS = Number(process.env.POUW_JOB_CLAIM_TTL_MS ?? 5 * 60 * 1000);

// ─── Storage bootstrap (D1 first, loud in-memory fallback) ──────────────────

let dbReady: boolean | null = null;
const memory = new Map<string, MatrixJob>();

async function ensureTable(): Promise<boolean> {
  if (dbReady !== null) return dbReady;
  try {
    const db = getD1();
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS pouw_matrix_jobs (
           id TEXT PRIMARY KEY,
           n INTEGER NOT NULL,
           a_json TEXT NOT NULL,
           b_json TEXT NOT NULL,
           difficulty INTEGER NOT NULL,
           status TEXT NOT NULL DEFAULT 'queued',
           provider TEXT,
           claimed_at INTEGER,
           expires_at INTEGER,
           created_at INTEGER NOT NULL,
           result_json TEXT,
           result_hash TEXT,
           completed_at INTEGER
         )`,
      )
      .run();
    dbReady = true;
  } catch (err) {
    L.warn("[POUW:queue] DB unavailable — using IN-MEMORY job queue (jobs lost on restart):", err);
    dbReady = false;
  }
  return dbReady;
}

function rowToJob(row: any): MatrixJob {
  return {
    id: row.id,
    n: row.n,
    matrixA: JSON.parse(row.a_json),
    matrixB: JSON.parse(row.b_json),
    difficulty: row.difficulty,
    status: row.status,
    provider: row.provider ?? undefined,
    claimedAt: row.claimed_at ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    createdAt: row.created_at,
    resultHash: row.result_hash ?? undefined,
    completedAt: row.completed_at ?? undefined,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Enqueue a real matrix job. Matrices are signed integers (bridge handles field form). */
export async function enqueueJob(input: {
  n: number;
  matrixA: number[];
  matrixB: number[];
  difficulty: number;
}): Promise<MatrixJob> {
  const job: MatrixJob = {
    id: "mj-" + createHash("sha256").update(`${Date.now()}|${Math.random()}`).digest("hex").slice(0, 20),
    n: input.n,
    matrixA: input.matrixA,
    matrixB: input.matrixB,
    difficulty: input.difficulty,
    status: "queued",
    createdAt: Date.now(),
  };

  if (await ensureTable()) {
    const db = getD1();
    await db
      .prepare(
        `INSERT INTO pouw_matrix_jobs (id, n, a_json, b_json, difficulty, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'queued', ?)`,
      )
      .bind(job.id, job.n, JSON.stringify(job.matrixA), JSON.stringify(job.matrixB), job.difficulty, job.createdAt)
      .run();
  } else {
    memory.set(job.id, job);
  }

  L.info(`[POUW:queue] Enqueued job ${job.id} (n=${job.n}, d=${job.difficulty})`);
  return job;
}

/**
 * Claim the oldest available job for a provider. Jobs whose previous claim
 * expired are reassignable. Returns null when the queue is empty (miner then
 * falls back to capped filler mining).
 */
export async function claimJob(provider: string): Promise<MatrixJob | null> {
  const now = Date.now();
  const p = provider.toLowerCase();

  if (await ensureTable()) {
    const db = getD1();
    const row = await db
      .prepare(
        `SELECT * FROM pouw_matrix_jobs
         WHERE status = 'queued' OR (status = 'claimed' AND expires_at < ?)
         ORDER BY created_at ASC LIMIT 1`,
      )
      .bind(now)
      .first();
    if (!row) return null;
    const expiresAt = now + CLAIM_TTL_MS;
    await db
      .prepare(`UPDATE pouw_matrix_jobs SET status='claimed', provider=?, claimed_at=?, expires_at=? WHERE id=?`)
      .bind(p, now, expiresAt, (row as any).id)
      .run();
    const job = rowToJob(row);
    job.status = "claimed";
    job.provider = p;
    job.claimedAt = now;
    job.expiresAt = expiresAt;
    return job;
  }

  for (const job of memory.values()) {
    const reassignable = job.status === "queued" || (job.status === "claimed" && (job.expiresAt ?? 0) < now);
    if (reassignable) {
      job.status = "claimed";
      job.provider = p;
      job.claimedAt = now;
      job.expiresAt = now + CLAIM_TTL_MS;
      return job;
    }
  }
  return null;
}

/**
 * Mark a job complete. Validates the job exists, is claimed by THIS provider,
 * and the claim hasn't expired. Returns true when the completion is accepted —
 * this is the condition full mining rewards hang on.
 */
export async function completeJob(
  jobId: string,
  provider: string,
  result: number[],
): Promise<boolean> {
  const now = Date.now();
  const p = provider.toLowerCase();
  const resultHash = createHash("sha256").update(JSON.stringify(result)).digest("hex");

  if (await ensureTable()) {
    const db = getD1();
    const row = await db.prepare(`SELECT * FROM pouw_matrix_jobs WHERE id=?`).bind(jobId).first();
    if (!row) return false;
    const job = rowToJob(row);
    if (job.status !== "claimed" || job.provider !== p || (job.expiresAt ?? 0) < now) return false;
    if (result.length !== job.n * job.n) return false;
    await db
      .prepare(`UPDATE pouw_matrix_jobs SET status='done', result_json=?, result_hash=?, completed_at=? WHERE id=?`)
      .bind(JSON.stringify(result), resultHash, now, jobId)
      .run();
    L.success(`[POUW:queue] Job ${jobId} completed by ${p.slice(0, 10)}… (result ${resultHash.slice(0, 12)}…)`);
    return true;
  }

  const job = memory.get(jobId);
  if (!job || job.status !== "claimed" || job.provider !== p || (job.expiresAt ?? 0) < now) return false;
  if (result.length !== job.n * job.n) return false;
  job.status = "done";
  job.resultHash = resultHash;
  job.completedAt = now;
  return true;
}

/** Fetch a job (status + result hash; result data for the workload owner). */
export async function getJob(jobId: string): Promise<(MatrixJob & { result?: number[] }) | null> {
  if (await ensureTable()) {
    const db = getD1();
    const row = await db.prepare(`SELECT * FROM pouw_matrix_jobs WHERE id=?`).bind(jobId).first();
    if (!row) return null;
    const job = rowToJob(row) as MatrixJob & { result?: number[] };
    if ((row as any).result_json) job.result = JSON.parse((row as any).result_json);
    return job;
  }
  return memory.get(jobId) ?? null;
}
