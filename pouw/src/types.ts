/** A submitted POUW mining certificate. */
export interface POUWCertificate {
  /** Chain seed — SHA-256 of latest block hash + nonce attempt number. */
  sigma: string;
  /** Matrix dimension n (both matrices are n×n). */
  n: number;
  /** Block size r (rank of noise matrices). Typically floor(n^0.3), min 4. */
  r: number;
  /** SHA-256 of matrix A (flat row-major bytes). */
  matrixAHash: string;
  /** SHA-256 of matrix B. */
  matrixBHash: string;
  /** SHA-256 transcript hash of all intermediate block states of (A+E)·(B+F). */
  transcriptHash: string;
  /**
   * Final proof hash z = SHA-256(sigma || transcriptHash || matrixAHash || matrixBHash).
   * Must satisfy z < difficulty threshold (leading zero bits).
   */
  z: string;
  /** Number of leading zero bits required in z. */
  difficulty: number;
  /** Unix ms timestamp of when this certificate was mined. */
  timestamp: number;
  /** Provider's wallet address (0x...). */
  providerAddress: string;
  /** Provider's device ID (0x bytes32). */
  deviceId: string;
  /**
   * The flat array data of matrices A and B — submitted alongside the certificate
   * so the orchestrator can independently re-verify the transcript.
   * (Testnet only; mainnet will use zkSNARK to keep A, B private.)
   */
  matrixA: number[];
  matrixB: number[];
}

/** Result of a successful solve() call. */
export interface SolveResult {
  certificate: POUWCertificate;
}

/** Summary stats returned by the mining loop. */
export interface MiningStats {
  attempts: number;
  found: number;
  hashRate: number; // attempts per second
  lastCertificate?: POUWCertificate;
}
