/**
 * Assigned-work test — the model the orchestrator uses:
 *   σ is issued at assignment (bound to job + node), difficulty 0, one pass.
 * Proves: certificate verifies · C = A·B · Freivalds accepts C and rejects a
 * tampered C · the certificate is bound to its σ and to the job's inputs.
 */
import { createHash } from "node:crypto";
import { verify } from "./cupow.js";
import { solveAssignedJob, fieldHash } from "./workload-bridge.js";
import { freivalds } from "./freivalds.js";

function fail(msg: string): never {
  console.error(`❌ ${msg}`);
  process.exit(1);
}
const ok = (msg: string) => console.log(`✅ ${msg}`);

function bruteForce(A: number[], B: number[], n: number): number[] {
  const out = new Array(n * n).fill(0);
  for (let i = 0; i < n; i++)
    for (let k = 0; k < n; k++) {
      const a = A[i * n + k];
      for (let j = 0; j < n; j++) out[i * n + j] += a * B[k * n + j];
    }
  return out;
}

console.log("cuPOW assigned-work test (d = 0, σ issued at assignment)");

const n = 32;
const A = Array.from({ length: n * n }, (_, i) => ((i * 7 + 3) % 255) - 127); // int8 range
const B = Array.from({ length: n * n }, (_, i) => ((i * 5 + 1) % 255) - 127);
const node = "0x" + "11".repeat(20);
const sigma = createHash("sha256").update(`job-1|${node}|nonce-1|blockhash`).digest("hex");

const t0 = Date.now();
const { certificate, result } = solveAssignedJob(sigma, A, B, n, node, "0x" + "22".repeat(32));
ok(`one pass, ${Date.now() - t0} ms (no difficulty lottery)`);

if (certificate.difficulty !== 0) fail("assigned certificate should have difficulty 0");
if (!verify(certificate)) fail("certificate failed independent verification");
ok("certificate verifies (transcript re-executed)");

if (certificate.sigma !== sigma) fail("certificate not bound to the issued σ");
const otherSigma = createHash("sha256").update("job-1|0xattacker|nonce-1|blockhash").digest("hex");
if (verify({ ...certificate, sigma: otherSigma })) fail("certificate verified under a different σ — not bound");
ok("certificate is bound to its σ (fails under another node's σ)");

if (certificate.matrixAHash !== fieldHash(A, n) || certificate.matrixBHash !== fieldHash(B, n)) {
  fail("certificate inputs don't match the job's A, B");
}
ok("certificate inputs match the job's A, B (binding check)");

const expected = bruteForce(A, B, n);
if (result.some((v, i) => v !== expected[i])) fail("decoded C ≠ A·B");
ok("decoded C = A·B exactly");

const f0 = Date.now();
if (!freivalds(A, B, result, n)) fail("Freivalds rejected a correct C");
const bad = result.slice();
bad[Math.floor(Math.random() * bad.length)] += 1;
if (freivalds(A, B, bad, n)) fail("Freivalds accepted a wrong C");
ok(`Freivalds accepts the right C and rejects a one-entry error (${Date.now() - f0} ms for both)`);

console.log("\n✅ All assigned-work tests passed");
