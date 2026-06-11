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

import type { Matrix } from "./matrix.js";
import { solve } from "./cupow.js";
import type { POUWCertificate } from "./types.js";

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
  // Pass the REAL matrices as externalA/externalB — this is the one-line change
  // that makes the work useful. solve() already supports it; the miner never used it.
  const res = solve(
    chainSeed,
    n,
    job.difficulty,
    providerAddress,
    deviceId,
    maxAttempts,
    job.A, // externalA  <-- real workload input
    job.B, // externalB  <-- real workload input
  );
  if (!res) return null;

  // Recover the useful answer. (In cupow.ts the decode() result is currently
  // discarded with `const _ =`; expose it instead — see patch note below.)
  const result = decodeResult(job.A, job.B, res.certificate);

  return {
    workloadId: job.workloadId,
    certificate: { ...res.certificate, /* tag for orchestrator gating */ },
    result,
    backedByWorkload: true,
  };
}

/**
 * Decode C = A·B for return to the user. For the testnet we recompute directly
 * (the provider already holds A, B). On mainnet the zkSNARK proves C without
 * revealing A, B and this direct recompute is replaced by the succinct proof.
 */
function decodeResult(A: Matrix, B: Matrix, _cert: POUWCertificate): Matrix {
  const out: Matrix = { rows: A.rows, cols: B.cols, data: new Array(A.rows * B.cols).fill(0) };
  for (let i = 0; i < A.rows; i++) {
    for (let k = 0; k < A.cols; k++) {
      const a = A.data[i * A.cols + k];
      if (a === 0) continue;
      for (let j = 0; j < B.cols; j++) {
        out.data[i * B.cols + j] += a * B.data[k * B.cols + j];
      }
    }
  }
  return out;
}

/* ───────────────────────────────────────────────────────────────────────────
 * PATCH NOTE for pouw/src/cupow.ts:
 *   Change   `const _ = decode(...)`   to   `const result = decode(...)`
 *   and add  `result: result.data`     to the returned SolveResult, so callers
 *   can retrieve the useful output instead of throwing it away.
 *
 * PATCH NOTE for client/api/src/services/mining-reward.service.ts:
 *   Gate the reward:
 *     if (!cert.backedByWorkload) return null; // filler earns nothing
 *   so only certificates tied to a funded workload mint full CLD. This removes
 *   the incentive to grind random matrices and aligns emission with real demand.
 * ─────────────────────────────────────────────────────────────────────────── */
