/**
 * Block-based MatMul_r with transcript recording.
 * Algorithm 6.1 from "Proofs of Useful Work from Arbitrary Matrix Multiplication"
 * (Komargodski & Weinstein, 2025).
 *
 * Records ALL intermediate r×r partial sums into a rolling SHA-256 hash.
 * This transcript hash is the core source of hardness — not the output.
 */

import { createHash } from "node:crypto";
import { Matrix, matCreate, matGetBlock, matSetBlock, matMul, matAdd, matToBytes } from "./matrix.js";

export interface MatMulResult {
  C: Matrix;
  transcriptHash: string; // SHA-256 hex digest of all intermediate block states
  intermediateCount: number;
}

/**
 * Block-based matrix multiplication recording intermediate states.
 *
 * For n×n matrices with block size r (n must be divisible by r):
 *   nb = n / r blocks per dimension
 *   Records nb³ intermediate r×r matrices into the transcript.
 *   Complexity: O(n³) main computation + O(n³/r³ × r²) = O(n³) transcript hashing.
 */
export function matMulWithTranscript(A: Matrix, B: Matrix, r: number): MatMulResult {
  const n = A.rows;
  // Ensure n is divisible by r (pad if needed — here we require exact divisibility)
  if (n % r !== 0) throw new Error(`Matrix dimension ${n} must be divisible by block size ${r}`);
  const nb = n / r; // number of blocks per dimension

  const C = matCreate(n, n);
  const hasher = createHash("sha256");
  let intermediateCount = 0;

  // Loop order: for each output block (i, j), accumulate across k blocks
  // Transcript records C_{i,j}^{(l)} after each accumulation step
  for (let i = 0; i < nb; i++) {
    for (let j = 0; j < nb; j++) {
      let Cij = matCreate(r, r); // starts as zero

      for (let l = 0; l < nb; l++) {
        // C_{i,j}^{(l)} = C_{i,j}^{(l-1)} + A_{i,l} × B_{l,j}
        const Ail = matGetBlock(A, i * r, l * r, r);
        const Blj = matGetBlock(B, l * r, j * r, r);
        Cij = matAdd(Cij, matMul(Ail, Blj));

        // Record this intermediate state into the transcript
        hasher.update(matToBytes(Cij));
        intermediateCount++;
      }

      matSetBlock(C, i * r, j * r, Cij);
    }
  }

  return {
    C,
    transcriptHash: hasher.digest("hex"),
    intermediateCount,
  };
}
