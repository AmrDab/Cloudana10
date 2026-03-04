/**
 * pouw.ts — Proof of Useful Work engine (TypeScript)
 *
 * Based on Komargodski & Weinstein 2025:
 * "Proofs of Useful Work from Arbitrary Matrix Multiplication"
 *
 * This module handles:
 *  - POUW certificate construction and verification
 *  - Seed computation for replay-attack prevention
 *  - Transcript hash generation (simulated for browser/demo; GPU-accelerated in provider node)
 *  - Difficulty checking
 *
 * The key insight: the transcript z = {C^(ℓ)_{i,j}} forces the prover to compute
 * every intermediate block of A'*B' where A'=A+E, B'=B+F and E,F are low-rank random
 * matrices derived from the seed σ. You can't fake z without doing the actual work.
 */

import { keccak256, encodePacked, type Hex } from "viem";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Difficulty target: proof accepted iff uint256(transcriptHash) < DIFFICULTY_TARGET.
 * Equivalent to requiring ~16 leading zero bits.
 */
export const DIFFICULTY_TARGET =
  BigInt("0x0000ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");

/** Default matrix dimension for demo/browser (real GPU work uses n=512+) */
export const DEFAULT_MATRIX_DIM = 8;

/** Default block tile size (r parameter from the paper) */
export const DEFAULT_BLOCK_SIZE = 2;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface POUWCertificate {
  /** Unique job identifier — binds proof to this specific job */
  jobId: Hex;
  /** Replay-prevention seed = keccak256(jobId + blockHash + chainId) */
  seed: Hex;
  /** Matrix dimension n (square matrices A, B ∈ F^{n×n}) */
  matrixDim: number;
  /** Tile size r for block matrix multiplication */
  blockSize: number;
  /** keccak256 of all (n/r)^3 intermediate block hashes — the PoW artifact */
  transcriptHash: Hex;
  /** keccak256 of the output matrix C = A*B */
  resultHash: Hex;
  /** Difficulty target at time of proof */
  difficulty: bigint;
  /** Provider's wallet address */
  providerAddress: Hex;
  /** Timestamp of proof generation */
  timestamp: number;
}

export interface TranscriptResult {
  transcriptHash: Hex;
  resultHash: Hex;
  /** Number of intermediate blocks computed: (n/r)^3 */
  blockCount: number;
}

export interface NoiseMatrices {
  EL: number[][];  // n×r
  ER: number[][];  // r×n
  FL: number[][];  // n×r
  FR: number[][];  // r×n
}

// ─── Seed Computation (Replay Prevention) ─────────────────────────────────────

/**
 * Compute the replay-prevention seed for a job.
 *
 * seed = keccak256(jobId || blockHash || chainId)
 *
 * The block hash is unknowable before block confirmation, so providers
 * cannot precompute transcripts for future jobs. This is the σ freshness
 * property from Definition 5.1 of the paper.
 *
 * @param jobId     Job identifier (bytes32 hex)
 * @param blockHash Block hash when job was assigned
 * @param chainId   Chain ID (prevents cross-chain replay)
 */
export function computeSeed(jobId: Hex, blockHash: Hex, chainId: number): Hex {
  return keccak256(
    encodePacked(
      ["bytes32", "bytes32", "uint256"],
      [jobId, blockHash, BigInt(chainId)]
    )
  );
}

// ─── Noise Matrix Generation ───────────────────────────────────────────────────

/**
 * Generate low-rank noise matrices from seed.
 *
 * From the paper: E = E_L · E_R, F = F_L · F_R where
 * E_L, F_L ∈ F_q^{n×r}, E_R, F_R ∈ F_q^{r×n}
 *
 * Each r×r submatrix of E and F is marginally uniform (Lemma 6.5),
 * making every intermediate block hard to compute without doing real MatMul.
 *
 * We use a keccak256 chain as a PRNG seeded by σ.
 */
export function generateNoiseMatrices(seed: Hex, n: number, r: number): NoiseMatrices {
  const q = 251; // Small prime field for demo (real: q ≈ 2^64)
  let prngState = seed;

  function nextField(): number {
    prngState = keccak256(encodePacked(["bytes32"], [prngState]));
    return Number(BigInt(prngState) % BigInt(q));
  }

  function genMatrix(rows: number, cols: number): number[][] {
    return Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => nextField())
    );
  }

  return {
    EL: genMatrix(n, r),
    ER: genMatrix(r, n),
    FL: genMatrix(n, r),
    FR: genMatrix(r, n),
  };
}

// ─── Matrix Arithmetic (over finite field) ────────────────────────────────────

function matMul(A: number[][], B: number[][], q = 251): number[][] {
  const n = A.length;
  const m = B[0].length;
  const k = B.length;
  const C = Array.from({ length: n }, () => new Array(m).fill(0));
  for (let i = 0; i < n; i++)
    for (let l = 0; l < k; l++)
      for (let j = 0; j < m; j++)
        C[i][j] = (C[i][j] + A[i][l] * B[l][j]) % q;
  return C;
}

function matAdd(A: number[][], B: number[][], q = 251): number[][] {
  return A.map((row, i) => row.map((v, j) => (v + B[i][j]) % q));
}

function hashMatrix(M: number[][]): Hex {
  const flat = M.flat();
  const encoded = encodePacked(
    flat.map(() => "uint8" as const),
    flat.map(v => v)
  );
  return keccak256(encoded);
}

// ─── Transcript Hash Generation ───────────────────────────────────────────────

/**
 * Generate the POUW transcript hash.
 *
 * This simulates the block matrix multiplication transcript:
 *   - Encodes A' = A + E, B' = B + F (using noise from seed)
 *   - Computes all (n/r)^3 intermediate blocks C'^(ℓ)_{i,j}
 *   - Hashes each intermediate block
 *   - Returns keccak256 of all intermediate hashes
 *
 * In the browser/demo, A and B are random matrices. In the real provider node,
 * A and B are the actual workload matrices (neural network weights, etc.).
 *
 * @param n     Matrix dimension
 * @param r     Block tile size
 * @param seed  Replay-prevention seed (determines noise matrices)
 */
export function generateTranscriptHash(n: number, r: number, seed: Hex): TranscriptResult {
  if (n % r !== 0) throw new Error("blockSize must divide matrixDim");

  const q = 251;
  const blocks = n / r;

  // Generate noise matrices from seed
  const { EL, ER, FL, FR } = generateNoiseMatrices(seed, n, r);

  // E = EL * ER, F = FL * FR
  const E = matMul(EL, ER, q);
  const F = matMul(FL, FR, q);

  // Generate random workload matrices A, B (seeded from seed for reproducibility)
  // In production: these come from the actual job payload
  let prng = keccak256(encodePacked(["bytes32", "string"], [seed, "AB"]));
  const nextVal = () => {
    prng = keccak256(encodePacked(["bytes32"], [prng]));
    return Number(BigInt(prng) % BigInt(q));
  };

  const A = Array.from({ length: n }, () => Array.from({ length: n }, nextVal));
  const B = Array.from({ length: n }, () => Array.from({ length: n }, nextVal));

  // Encode: A' = A + E, B' = B + F
  const Ap = matAdd(A, E, q);
  const Bp = matAdd(B, F, q);

  // Block MatMul transcript: compute all (n/r)^3 intermediate C'^(ℓ)_{i,j}
  const intermediateHashes: Hex[] = [];

  // Initialize C' as zero
  const Cp: number[][][] = Array.from({ length: blocks }, () =>
    Array.from({ length: blocks }, () => new Array(r * r).fill(0))
  );

  for (let i = 0; i < blocks; i++) {
    for (let j = 0; j < blocks; j++) {
      // Extract r×r block C_{i,j}
      let Cblock = Array.from({ length: r }, () => new Array(r).fill(0));
      for (let l = 0; l < blocks; l++) {
        // Extract A'_{i,l} and B'_{l,j} blocks
        const Ablock = Array.from({ length: r }, (_, bi) =>
          Ap[i * r + bi].slice(l * r, l * r + r)
        );
        const Bblock = Array.from({ length: r }, (_, bi) =>
          Bp[l * r + bi].slice(j * r, j * r + r)
        );

        // C += A_{i,l} * B_{l,j}
        const product = matMul(Ablock, Bblock, q);
        Cblock = matAdd(Cblock, product, q);

        // Record intermediate hash — this is the transcript!
        intermediateHashes.push(hashMatrix(Cblock));
      }
    }
  }

  // Transcript hash = keccak256 of all intermediate hashes
  const allHashes = encodePacked(
    intermediateHashes.map(() => "bytes32" as const),
    intermediateHashes
  );
  const transcriptHash = keccak256(allHashes);

  // Decode: C = C' - noise terms (simplified; real decode uses 5 MatMul ops)
  const resultMatrix = matMul(A, B, q);
  const resultHash = hashMatrix(resultMatrix);

  return {
    transcriptHash,
    resultHash,
    blockCount: intermediateHashes.length,
  };
}

// ─── Certificate Builder ──────────────────────────────────────────────────────

/**
 * Build a complete POUW certificate for a job.
 *
 * In production, this runs on the provider node (GPU-accelerated).
 * In the browser/demo, it uses small matrices for illustration.
 */
export function buildPOUWCertificate(params: {
  jobId: Hex;
  blockHash: Hex;
  chainId: number;
  providerAddress: Hex;
  matrixDim?: number;
  blockSize?: number;
}): POUWCertificate {
  const n = params.matrixDim ?? DEFAULT_MATRIX_DIM;
  const r = params.blockSize ?? DEFAULT_BLOCK_SIZE;

  const seed = computeSeed(params.jobId, params.blockHash, params.chainId);
  const { transcriptHash, resultHash } = generateTranscriptHash(n, r, seed);

  return {
    jobId: params.jobId,
    seed,
    matrixDim: n,
    blockSize: r,
    transcriptHash,
    resultHash,
    difficulty: DIFFICULTY_TARGET,
    providerAddress: params.providerAddress,
    timestamp: Date.now(),
  };
}

// ─── Verification ─────────────────────────────────────────────────────────────

/**
 * Verify a POUW certificate (client-side / challenger verification).
 *
 * Checks:
 *  1. Seed integrity: recompute from jobId + blockHash + chainId
 *  2. Difficulty: transcriptHash < DIFFICULTY_TARGET
 *  3. Transcript integrity: recompute transcript and compare
 *
 * Note: Full cryptographic verification happens on-chain via POUWVerifier.sol.
 * This is the off-chain pre-check used by challengers.
 */
export function verifyPOUWCertificate(
  cert: POUWCertificate,
  blockHash: Hex,
  chainId: number
): { valid: boolean; reason?: string } {
  // 1. Verify difficulty
  if (BigInt(cert.transcriptHash) >= DIFFICULTY_TARGET) {
    return { valid: false, reason: "Difficulty not met" };
  }

  // 2. Verify seed
  const expectedSeed = computeSeed(cert.jobId, blockHash, chainId);
  if (cert.seed !== expectedSeed) {
    return { valid: false, reason: "Invalid seed (possible replay attack)" };
  }

  // 3. Verify transcript (regenerate and compare)
  try {
    const { transcriptHash } = generateTranscriptHash(cert.matrixDim, cert.blockSize, cert.seed);
    if (transcriptHash !== cert.transcriptHash) {
      return { valid: false, reason: "Transcript hash mismatch (fake work detected)" };
    }
  } catch (e) {
    return { valid: false, reason: `Transcript verification error: ${e}` };
  }

  return { valid: true };
}

/**
 * Quick difficulty check only (no transcript recompute).
 * Used for fast pre-screening.
 */
export function checkDifficulty(transcriptHash: Hex): boolean {
  return BigInt(transcriptHash) < DIFFICULTY_TARGET;
}

/**
 * Check if a seed has been used before (replay detection).
 * In production, this checks against the on-chain usedSeeds mapping.
 */
export function checkReplayAttack(seed: Hex, knownSeeds: Set<Hex>): boolean {
  return knownSeeds.has(seed);
}

/**
 * Format certificate for display (truncate hashes).
 */
export function formatCertForDisplay(cert: POUWCertificate) {
  const truncate = (h: string) => `${h.slice(0, 10)}...${h.slice(-6)}`;
  return {
    jobId: truncate(cert.jobId),
    seed: truncate(cert.seed),
    transcriptHash: truncate(cert.transcriptHash),
    resultHash: truncate(cert.resultHash),
    matrixDim: `${cert.matrixDim}×${cert.matrixDim}`,
    blockSize: cert.blockSize,
    difficultyMet: checkDifficulty(cert.transcriptHash),
    timestamp: new Date(cert.timestamp).toLocaleString(),
  };
}
