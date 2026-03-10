/**
 * cuPOW: Core Proof of Useful Work algorithm.
 *
 * Implementation of "Proofs of Useful Work from Arbitrary Matrix Multiplication"
 * (Komargodski & Weinstein, IACR ePrint 2025/685).
 *
 * Algorithm overview (Algorithm 6.4 from the paper):
 *   1. Encode(σ, A, B) → generate low-rank noise E = E_L·E_R, F = F_L·F_R
 *      where E_L, E_R, F_L, F_R are derived deterministically from σ via RNG.
 *   2. Compute noisy product: C' = MatMul_r(A+E, B+F), recording all intermediate blocks.
 *   3. Hash the transcript: z = H(σ || H(transcript) || H(A) || H(B)).
 *   4. If z < difficulty threshold → valid certificate found.
 *   5. Decode: C = C' - A·F - E·B - E·F (cost O(n²·r), vs O(n³) for the main multiply).
 *
 * Security: The intermediate blocks of the noisy multiply are marginally uniform (each
 * r×r tile is random), making it impossible to shortcut computing the full transcript.
 * The output C' alone can be computed cheaply (E, F are low-rank), so the HARDNESS
 * comes from the TRANSCRIPT, not the output.
 */

import { createHash } from "node:crypto";
import { Matrix, matCreate, matAdd, matSub, matMul, matRandom, matToBytes } from "./matrix.js";
import { matMulWithTranscript } from "./matmul.js";
import type { POUWCertificate, SolveResult } from "./types.js";

// ─── Utilities ───────────────────────────────────────────────────────────────

/** Deterministic xorshift32 PRNG seeded from a hex string. NOT cryptographically secure. */
function makePRNG(hexSeed: string): () => number {
  const bytes = Buffer.from(hexSeed.padEnd(8, "0").slice(0, 8), "hex");
  let state = bytes.readUInt32BE(0);
  if (state === 0) state = 0xdeadbeef;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

/** Choose block size r = max(4, floor(n^0.3)), rounded to nearest factor of n. */
export function chooseBlockSize(n: number): number {
  let r = Math.max(4, Math.floor(Math.pow(n, 0.3)));
  // Find the nearest divisor of n >= r
  while (n % r !== 0 && r <= n) r++;
  return r > n ? n : r;
}

/** Generate low-rank noise matrix: E = E_L · E_R (both derived from sigma + label). */
function generateLowRankNoise(
  sigma: string,
  label: string,
  n: number,
  r: number,
): { EL: Matrix; ER: Matrix; E: Matrix } {
  const seed = createHash("sha256").update(sigma + label).digest("hex");
  const rng = makePRNG(seed);
  const EL = matRandom(n, r, rng);
  const ER = matRandom(r, n, rng);
  const E = matMul(EL, ER);
  return { EL, ER, E };
}

/** SHA-256 of a matrix's raw bytes. */
export function matHash(m: Matrix): string {
  return createHash("sha256").update(matToBytes(m)).digest("hex");
}

/** Compute the final proof hash z from the four components. */
function computeZ(
  sigma: string,
  transcriptHash: string,
  matrixAHash: string,
  matrixBHash: string,
): string {
  return createHash("sha256")
    .update(sigma)
    .update(transcriptHash)
    .update(matrixAHash)
    .update(matrixBHash)
    .digest("hex");
}

/** Check if z has at least `difficulty` leading zero bits. */
export function meetsDifficulty(z: string, difficulty: number): boolean {
  const fullBytes = Math.floor(difficulty / 8);
  const remainBits = difficulty % 8;
  const hex = z.slice(0, fullBytes * 2);
  if (hex !== "00".repeat(fullBytes)) return false;
  if (remainBits === 0) return true;
  const nextByte = parseInt(z.slice(fullBytes * 2, fullBytes * 2 + 2), 16);
  return nextByte < (1 << (8 - remainBits));
}

// ─── Encode / Decode ─────────────────────────────────────────────────────────

interface Encoding {
  Aprime: Matrix;
  Bprime: Matrix;
  EL: Matrix;
  ER: Matrix;
  FL: Matrix;
  FR: Matrix;
}

function encode(sigma: string, A: Matrix, B: Matrix, r: number): Encoding {
  const { EL, ER, E } = generateLowRankNoise(sigma, "noise_E", A.rows, r);
  const { EL: FL, ER: FR, E: F } = generateLowRankNoise(sigma, "noise_F", B.rows, r);
  return {
    Aprime: matAdd(A, E),
    Bprime: matAdd(B, F),
    EL, ER, FL, FR,
  };
}

/**
 * Decode C = A·B from C' = (A+E)·(B+F).
 *
 * Expansion: C' = AB + AF + EB + EF
 * So:        C  = C' - AF - EB - EF
 *
 * Cost: 4× O(n²·r) multiplications (EL·ER, FL·FR steps are already O(n²·r)).
 */
function decode(
  A: Matrix,
  B: Matrix,
  Cprime: Matrix,
  EL: Matrix,
  ER: Matrix,
  FL: Matrix,
  FR: Matrix,
): Matrix {
  const F = matMul(FL, FR);   // F = FL·FR  — O(n²·r)
  const E = matMul(EL, ER);   // E = EL·ER  — O(n²·r)
  const AF = matMul(matMul(A, FL), FR); // A·F = (A·FL)·FR — O(n²·r)
  const EB = matMul(E, B);              // E·B              — O(n²·r)
  const EF = matMul(E, F);              // E·F              — O(n²·r)
  return matSub(matSub(matSub(Cprime, AF), EB), EF);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Solve: attempt to find a valid POUW certificate.
 *
 * Each attempt picks a fresh nonce-modified sigma, generates noise,
 * runs the block MatMul with transcript, and checks if z < difficulty.
 *
 * @param chainSeed     - Hex string from latest chain block hash (the "sigma" seed pool).
 * @param n             - Matrix dimension. Must be at least 8. Typical testnet: 64–256.
 * @param difficulty    - Leading zero bits required (testnet: 8–20; mainnet: higher).
 * @param providerAddress - Provider wallet address.
 * @param deviceId      - Provider device ID.
 * @param maxAttempts   - Max iterations before returning null.
 * @param externalA     - Optional: use real workload matrix A (AI/ML use case).
 * @param externalB     - Optional: use real workload matrix B.
 */
export function solve(
  chainSeed: string,
  n: number,
  difficulty: number,
  providerAddress: string,
  deviceId: string,
  maxAttempts = 500,
  externalA?: Matrix,
  externalB?: Matrix,
): SolveResult | null {
  const r = chooseBlockSize(n);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Each attempt uses a different sigma derived from chainSeed + attempt number
    const sigma = createHash("sha256")
      .update(chainSeed)
      .update(attempt.toString())
      .digest("hex");

    // Pick matrices (real workload or random)
    const rng = makePRNG(createHash("sha256").update(sigma + "matrices").digest("hex"));
    const A = externalA ?? matRandom(n, n, rng);
    const B = externalB ?? matRandom(n, n, rng);

    // Encode: A' = A+E, B' = B+F
    const { Aprime, Bprime, EL, ER, FL, FR } = encode(sigma, A, B, r);

    // Run block MatMul_r, recording all intermediate blocks into transcript hash
    const { C: Cprime, transcriptHash } = matMulWithTranscript(Aprime, Bprime, r);

    // Compute proof hash
    const matrixAHash = matHash(A);
    const matrixBHash = matHash(B);
    const z = computeZ(sigma, transcriptHash, matrixAHash, matrixBHash);

    if (meetsDifficulty(z, difficulty)) {
      // Decode: recover A·B (the useful result)
      const _ = decode(A, B, Cprime, EL, ER, FL, FR); // noqa: for testnet we don't need result

      return {
        certificate: {
          sigma,
          n,
          r,
          matrixAHash,
          matrixBHash,
          transcriptHash,
          z,
          difficulty,
          timestamp: Date.now(),
          providerAddress,
          deviceId,
          matrixA: A.data,
          matrixB: B.data,
        },
      };
    }
  }

  return null;
}

/**
 * Verify a POUW certificate.
 *
 * Re-derives noise from sigma, re-runs block MatMul, recomputes transcript hash, checks z.
 * For testnet: orchestrator provides A and B from the certificate (no privacy).
 * For mainnet: zkSNARK would replace this with a succinct proof check.
 *
 * Returns true if the certificate is valid.
 */
export function verify(cert: POUWCertificate): boolean {
  const { sigma, n, r, matrixAHash, matrixBHash, transcriptHash, z, difficulty } = cert;

  // Reconstruct matrices from submitted data
  const A: Matrix = { rows: n, cols: n, data: cert.matrixA };
  const B: Matrix = { rows: n, cols: n, data: cert.matrixB };

  // Check matrix hashes
  if (matHash(A) !== matrixAHash) return false;
  if (matHash(B) !== matrixBHash) return false;

  // Re-run encode with same sigma
  const { Aprime, Bprime } = encode(sigma, A, B, r);

  // Re-run block MatMul and check transcript hash matches
  const { transcriptHash: recomputedTranscript } = matMulWithTranscript(Aprime, Bprime, r);
  if (recomputedTranscript !== transcriptHash) return false;

  // Recompute z
  const recomputedZ = computeZ(sigma, transcriptHash, matrixAHash, matrixBHash);
  if (recomputedZ !== z) return false;

  // Check difficulty
  if (!meetsDifficulty(z, difficulty)) return false;

  return true;
}
