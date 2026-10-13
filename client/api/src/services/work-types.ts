/**
 * WorkType registry (STRATEGY_NOTES §11b): the shared pipeline — node identity,
 * assignment, ledger, settlement — is generic; a WorkType supplies only what
 * differs per resource. "matmul" is the only one registered in v1.
 */
import type { POUWCertificate } from "../../../../pouw/src/types.js";
import { verify as cupowVerify } from "../../../../pouw/src/cupow.js";
import { chooseBlockSize, fieldHash, freivalds, maxAbsEntry, toFieldMatrix } from "../../../../pouw/src/index.js";

export interface WorkJobInput {
  n: number;
  matrixA: number[];
  matrixB: number[];
}

export interface Submission {
  job: WorkJobInput & { sigma: string };
  certificate: POUWCertificate;
  result: number[];
}

export type Verdict = { ok: true } | { ok: false; reason: string };

export interface PlantedTask {
  n: number;
  matrixA: number[];
  matrixB: number[];
  matrixC: number[];
  expected: "valid" | "invalid";
}

export interface WorkType {
  id: string;
  /** What a node must advertise to be eligible (v1: the work type id in its workTypes). */
  requirements(job: WorkJobInput): { workType: string };
  /** Input check at intake; returns an error message or null. */
  validate(job: WorkJobInput): string | null;
  /** Protocol-computed units — never self-reported. */
  meter(job: WorkJobInput): number;
  /** The proof for this resource. */
  verify(submission: Submission): Verdict;
  /** A known-answer task; `corrupt` flips one entry of C so the right verdict is "invalid". */
  plantedTask(base?: { n: number; matrixA: number[]; matrixB: number[]; matrixC: number[] }, corrupt?: boolean): PlantedTask;
}

export const MATMUL_N_MIN = 8;
export const MATMUL_N_MAX = 256;

function randomInt(maxExclusive: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % maxExclusive;
}

/** Plain signed-integer C = A·B (exact while |entries| ≤ maxAbsEntry(n)). */
export function matMulSigned(A: number[], B: number[], n: number): number[] {
  const C = new Array<number>(n * n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < n; k++) {
      const a = A[i * n + k];
      if (a === 0) continue;
      for (let j = 0; j < n; j++) C[i * n + j] += a * B[k * n + j];
    }
  }
  return C;
}

export const matmul: WorkType = {
  id: "matmul",

  requirements: () => ({ workType: "matmul" }),

  validate({ n, matrixA, matrixB }) {
    if (!Number.isInteger(n) || n < MATMUL_N_MIN || n > MATMUL_N_MAX) return `n must be an integer in [${MATMUL_N_MIN}, ${MATMUL_N_MAX}]`;
    if (matrixA.length !== n * n || matrixB.length !== n * n) return `matrices must have n*n = ${n * n} entries`;
    const bound = maxAbsEntry(n);
    for (const [label, m] of [["matrixA", matrixA], ["matrixB", matrixB]] as const) {
      for (let i = 0; i < m.length; i++) {
        if (!Number.isInteger(m[i]) || Math.abs(m[i]) > bound) return `${label}[${i}] must be an integer within ±${bound} for n=${n}`;
      }
    }
    return null;
  },

  meter: ({ n }) => n * n * n,

  verify({ job, certificate, result }) {
    const { n } = job;
    if (!certificate || typeof certificate !== "object") return { ok: false, reason: "certificate missing" };
    if (certificate.sigma !== job.sigma) return { ok: false, reason: "certificate sigma does not match the assignment" };
    if (certificate.n !== n) return { ok: false, reason: "certificate n does not match the job" };
    if (certificate.r !== chooseBlockSize(n)) return { ok: false, reason: "certificate block size r is not the protocol's" };
    if (certificate.matrixAHash !== fieldHash(job.matrixA, n) || certificate.matrixBHash !== fieldHash(job.matrixB, n)) {
      return { ok: false, reason: "certificate is not for this job's matrices (A/B hash mismatch)" };
    }
    // The answer first: n² work, so a wrong or garbage submission is refused before the n³ re-execution.
    // Every entry of A·B is within ±n·bound² < p/2 (bound = maxAbsEntry(n)), so with that bound the mod-p Freivalds
    // check is exact over the integers: a C shifted by multiples of p is refused (docs/POUW_REVIEW.md §2, g3–g5).
    const bound = maxAbsEntry(n);
    const cMax = n * bound * bound;
    if (!Array.isArray(result) || result.length !== n * n || !result.every((v) => Number.isSafeInteger(v) && Math.abs(v) <= cMax)) {
      return { ok: false, reason: `result must be n*n = ${n * n} integers within ±${cMax}` };
    }
    if (!freivalds(job.matrixA, job.matrixB, result, n)) return { ok: false, reason: "result is not A·B (Freivalds check failed)" };
    // Re-execute over the job's own matrices, never the copies the node sent: the int32 hash encoding wraps, so a
    // certificate over A + 2³² would otherwise bind to A (docs/POUW_REVIEW.md §2, h).
    let transcriptOk = false;
    try {
      transcriptOk = cupowVerify({ ...certificate, matrixA: toFieldMatrix(job.matrixA, n).data, matrixB: toFieldMatrix(job.matrixB, n).data });
    } catch {
      transcriptOk = false;
    }
    if (!transcriptOk) return { ok: false, reason: "certificate transcript failed verification" };
    return { ok: true };
  },

  plantedTask(base, corrupt = true) {
    let task = base;
    if (!task) {
      const n = 16;
      const bound = 9;
      const rnd = () => Array.from({ length: n * n }, () => randomInt(2 * bound + 1) - bound);
      const matrixA = rnd();
      const matrixB = rnd();
      task = { n, matrixA, matrixB, matrixC: matMulSigned(matrixA, matrixB, n) };
    }
    const matrixC = task.matrixC.slice();
    if (corrupt) matrixC[randomInt(matrixC.length)] += 1 + randomInt(9);
    return { n: task.n, matrixA: task.matrixA, matrixB: task.matrixB, matrixC, expected: corrupt ? "invalid" : "valid" };
  },
};

const REGISTRY = new Map<string, WorkType>([[matmul.id, matmul]]);

export function getWorkType(id: string): WorkType | undefined {
  return REGISTRY.get(id);
}

export function workTypeIds(): string[] {
  return [...REGISTRY.keys()];
}
