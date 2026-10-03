/**
 * workload-bridge.ts — THE KEYSTONE FIX.
 *
 * PROBLEM (audit finding #1): the miner called solve() with matRandom() every
 * time, so CLD was minted for multiplying THROWAWAY random matrices. That is
 * Proof of *Work*, not Proof of *Useful* Work. The whole differentiation lived
 * in a function signature and nowhere else.
 *
 * FIX: the miner pulls a real (A, B) matmul pair from a pending user workload,
 * mines the PoUW certificate ON THAT MATRIX, and returns the DECODED result C=A·B
 * to the user as the actual job output. Reward is GATED on `backedByWorkload`, so
 * a provider grinding random filler earns ~nothing — closing the farm exploit
 * (audit finding #3) at the same time.
 *
 * Non-matrix workloads (Tier 1 web hosting, Tier 2 batch) do NOT go through PoUW;
 * they use the challenger network. PoUW is the Tier-3 path for matrix-heavy AI/ML
 * and scientific compute, exactly as the multi-tier design intends.
 */

import { PRIME_N, type Matrix } from "./matrix.js";
import { solve, solveAssigned, matHash } from "./cupow.js";
import type { POUWCertificate } from "./types.js";

/* ── Signed ↔ field conversion ────────────────────────────────────────────────
 * cuPOW arithmetic runs over F_p (p = 1e9+7). Real workloads use signed integers,
 * so the bridge (a) maps inputs into canonical field form and (b) lifts outputs
 * back to signed via the centered lift. Exact integer recovery requires the
 * products not to wrap: |entries| ≤ B with n·B² < p/2. maxAbsEntry() enforces it.
 */
const HALF_P = (PRIME_N - 1) / 2;

/** Largest |entry| for which C = A·B is exactly recoverable at dimension n. */
export function maxAbsEntry(n: number): number {
  return Math.floor(Math.sqrt(HALF_P / n));
}

function toField(m: Matrix, bound: number, label: string): Matrix {
  const data = new Array(m.data.length);
  for (let i = 0; i < m.data.length; i++) {
    const v = m.data[i];
    if (!Number.isInteger(v)) throw new Error(`${label}[${i}] is not an integer (quantize workload inputs first)`);
    if (Math.abs(v) > bound) throw new Error(`${label}[${i}]=${v} exceeds exactness bound ±${bound} for n=${m.rows}`);
    data[i] = ((v % PRIME_N) + PRIME_N) % PRIME_N;
  }
  return { rows: m.rows, cols: m.cols, data };
}

/** Centered lift: field element → signed integer in (-p/2, p/2]. */
function liftSigned(v: number): number {
  return v > HALF_P ? v - PRIME_N : v;
}

/** A real unit of useful work pulled from the workload queue. */
export interface WorkloadMatrixJob {
  workloadId: string;
  /** Real input matrices from the user's AI/ML or scientific job. */
  A: Matrix;
  B: Matrix;
  /** Difficulty the network currently requires for this tier. */
  difficulty: number;
  /** Deadline (unix ms) — past this the job is reassigned. */
  expiresAt: number;
}

/** Result the provider returns: the useful output PLUS the proof it did the work. */
export interface BackedSolveResult {
  workloadId: string;
  certificate: POUWCertificate;
  /** The decoded C = A·B — the actual answer the user paid for. */
  result: Matrix;
  backedByWorkload: true;
}

/**
 * Mine a PoUW certificate ON a real workload. The certificate's z is the proof;
 * the decoded C is the deliverable. Both are submitted together so the orchestrator
 * can (a) verify the proof and (b) hand the result back to the user.
 */
export function solveBacked(
  chainSeed: string,
  job: WorkloadMatrixJob,
  providerAddress: string,
  deviceId: string,
  maxAttempts = 500,
): BackedSolveResult | null {
  const n = job.A.rows;
  const bound = maxAbsEntry(n);
  // Map the user's signed integers into canonical field form (throws if the
  // workload exceeds the exact-recovery bound — reject at intake, not mid-mine).
  const A = toField(job.A, bound, "A");
  const B = toField(job.B, bound, "B");

  // Pass the REAL matrices as externalA/externalB — the change that makes the
  // work useful. solve() supports it; the filler path simply never used it.
  const res = solve(
    chainSeed,
    n,
    job.difficulty,
    providerAddress,
    deviceId,
    maxAttempts,
    A, // externalA  <-- real workload input
    B, // externalB  <-- real workload input
  );
  if (!res) return null;

  // The useful answer decoded inside solve(), lifted back to signed integers.
  const result: Matrix = {
    rows: job.A.rows,
    cols: job.B.cols,
    data: res.result.map(liftSigned),
  };

  return {
    workloadId: job.workloadId,
    certificate: { ...res.certificate, workloadId: job.workloadId },
    result,
    backedByWorkload: true,
  };
}

/** Field-form matrix from a user's signed n×n data (throws past the exactness bound). */
export function toFieldMatrix(data: number[], n: number, label = "M"): Matrix {
  return toField({ rows: n, cols: n, data }, maxAbsEntry(n), label);
}

/** The hash a certificate must carry for this signed input — used to bind a certificate to its job. */
export function fieldHash(data: number[], n: number): string {
  return matHash(toFieldMatrix(data, n));
}

/** Result of an assigned solve: certificate + the useful answer as signed integers. */
export interface AssignedSolveResult {
  certificate: POUWCertificate;
  result: number[];
}

/**
 * Solve an orchestrator-assigned job (difficulty 0, σ issued by the orchestrator).
 * A and B are the user's signed integers; the result is C = A·B, signed.
 */
export function solveAssignedJob(
  sigma: string,
  A: number[],
  B: number[],
  n: number,
  providerAddress: string,
  deviceId: string,
): AssignedSolveResult {
  const res = solveAssigned(sigma, toFieldMatrix(A, n, "A"), toFieldMatrix(B, n, "B"), providerAddress, deviceId);
  return { certificate: res.certificate, result: res.result.map(liftSigned) };
}

/* ───────────────────────────────────────────────────────────────────────────
 * STATUS (2026-07-03): both patch points are APPLIED.
 *   - cupow.ts solve() now returns `result` (the decoded C = A·B).
 *   - mining-reward.service.ts gates full rewards on a live, claimed workload;
 *     filler certificates earn a reduced fraction under a per-provider daily cap.
 * The bridge itself is consumed by provider-node-server/src/pouw-miner.ts, which
 * claims jobs from GET /v1/pouw/job and submits result + workloadId together.
 * ─────────────────────────────────────────────────────────────────────────── */
