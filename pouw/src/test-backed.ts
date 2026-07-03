/**
 * Backed-work test — proves TRUE Proof of USEFUL Work end to end:
 *   1. A "user workload" provides real matrices A, B.
 *   2. solveBacked() mines a certificate ON those matrices.
 *   3. The certificate verifies independently.
 *   4. The decoded result equals the brute-force A·B — the user gets their answer.
 *   5. The certificate carries the workloadId the reward gate requires.
 */

import { createHash } from "node:crypto";
import { verify } from "./cupow.js";
import { solveBacked, type WorkloadMatrixJob } from "./workload-bridge.js";
import type { Matrix } from "./matrix.js";

function fail(msg: string): never {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

function bruteForce(A: Matrix, B: Matrix): number[] {
  const out = new Array(A.rows * B.cols).fill(0);
  for (let i = 0; i < A.rows; i++)
    for (let k = 0; k < A.cols; k++) {
      const a = A.data[i * A.cols + k];
      for (let j = 0; j < B.cols; j++) out[i * B.cols + j] += a * B.data[k * B.cols + j];
    }
  return out;
}

console.log("cuPOW backed-work test (true PoUW)");

const n = 16;
const A: Matrix = { rows: n, cols: n, data: Array.from({ length: n * n }, (_, i) => ((i * 7 + 3) % 10) - 4) };
const B: Matrix = { rows: n, cols: n, data: Array.from({ length: n * n }, (_, i) => ((i * 5 + 1) % 9) - 4 ) };

const job: WorkloadMatrixJob = {
  workloadId: "wl-test-0001",
  A,
  B,
  difficulty: 4,
  expiresAt: Date.now() + 60_000,
};

const chainSeed = createHash("sha256").update("backed-test-seed").digest("hex");
const t0 = Date.now();
const backed = solveBacked(chainSeed, job, "0x" + "11".repeat(20), "0x" + "22".repeat(32), 5000);

if (!backed) fail("no certificate found within attempt budget (raise maxAttempts)");
console.log(`✅ Certificate mined on REAL workload matrices in ${((Date.now() - t0) / 1000).toFixed(2)}s`);

if (backed.workloadId !== "wl-test-0001") fail("workloadId missing from BackedSolveResult");
if (backed.certificate.workloadId !== "wl-test-0001") fail("workloadId not stamped on certificate — reward gating would fail");
console.log("✅ Certificate carries workloadId (reward-gate ready)");

if (!verify(backed.certificate)) fail("certificate failed independent verification");
console.log("✅ Certificate verifies independently");

const expected = bruteForce(A, B);
const got = backed.result.data;
if (got.length !== expected.length) fail(`result length ${got.length} != ${expected.length}`);
for (let i = 0; i < expected.length; i++) {
  if (got[i] !== expected[i]) fail(`result mismatch at index ${i}: got ${got[i]}, expected ${expected[i]}`);
}
console.log("✅ Decoded result EQUALS A·B — the user gets the answer they paid for");

console.log("\n✅ All backed-work tests passed — the work is genuinely useful");
