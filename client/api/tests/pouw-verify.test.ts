/**
 * The matmul verdict /v1/work/submit uses (work-types.ts `matmul.verify`) against the two attacks found in
 * docs/POUW_REVIEW.md §2: a right transcript with C shifted by multiples of p (passes Freivalds mod p), and a
 * certificate computed over A + 2³² (its int32 hash equals A's).
 */
import { describe, it, expect } from "vitest";
import { solveAssignedJob, maxAbsEntry, toFieldMatrix, fieldHash } from "../../../pouw/src/index.js";
import { solveAssigned } from "../../../pouw/src/cupow.js";
import { matmul } from "../src/services/work-types.js";

const P = 1_000_000_007;
const n = 16;
const sigma = "ab".repeat(32);
const node = "0x" + "11".repeat(20);
const device = "0x" + "22".repeat(32);

function job(seed: number) {
  const bound = maxAbsEntry(n);
  let x = seed;
  const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) % (2 * bound + 1)) - bound;
  const matrixA = Array.from({ length: n * n }, rnd);
  const matrixB = Array.from({ length: n * n }, rnd);
  return { n, matrixA, matrixB, sigma };
}

describe("matmul.verify", () => {
  it("accepts an honest certificate and answer", () => {
    const j = job(1);
    const { certificate, result } = solveAssignedJob(sigma, j.matrixA, j.matrixB, n, node, device);
    expect(matmul.verify({ job: j, certificate, result })).toEqual({ ok: true });
  });

  it("refuses an answer shifted by p, in one entry or all of them (equal mod p, wrong over the integers)", () => {
    const j = job(2);
    const { certificate, result } = solveAssignedJob(sigma, j.matrixA, j.matrixB, n, node, device);
    const one = [...result];
    one[5] += P;
    const all = result.map((v) => v - P);
    const multiple = result.map((v, i) => v + (i % 3) * P);
    for (const bad of [one, all, multiple]) {
      const v = matmul.verify({ job: j, certificate, result: bad });
      expect(v.ok).toBe(false);
      expect(v.ok === false && v.reason).toMatch(/within ±/);
    }
  });

  it("refuses a certificate whose transcript is over a different matrix with the same int32 hash", () => {
    const j = job(3);
    const fA = toFieldMatrix(j.matrixA, n, "A");
    const fB = toFieldMatrix(j.matrixB, n, "B");
    // A + 2³²: a different matrix mod p, but writeInt32BE(v | 0) hashes it exactly like A.
    const shifted = { ...fA, data: fA.data.map((v) => v + 2 ** 32) };
    const forged = solveAssigned(sigma, shifted, fB, node, device);
    expect(forged.certificate.matrixAHash).toBe(fieldHash(j.matrixA, n)); // the binding check alone passes
    const honest = solveAssignedJob(sigma, j.matrixA, j.matrixB, n, node, device);
    // The true C is submitted; the transcript is re-run over the job's own A, so the forged proof fails.
    const v = matmul.verify({ job: j, certificate: forged.certificate, result: honest.result });
    expect(v.ok === false && v.reason).toMatch(/transcript/);
  });

  it("checks the answer before re-executing: a wrong C is refused without the transcript", () => {
    const j = job(4);
    const { certificate, result } = solveAssignedJob(sigma, j.matrixA, j.matrixB, n, node, device);
    const wrong = [...result];
    wrong[0] += 1;
    const garbage = { ...certificate, transcriptHash: "ff".repeat(32) };
    const v = matmul.verify({ job: j, certificate: garbage, result: wrong });
    expect(v.ok === false && v.reason).toMatch(/Freivalds/);
  });
});
