/**
 * WorkType registry (STRATEGY_NOTES §11b): the shared pipeline — node identity, assignment, ledger, settlement — is
 * generic; a WorkType supplies only what differs per resource. Two modes (ENGINEERING_BACKLOG B-26):
 *   inline     all data in the submit, checked there (matmul: Freivalds on every job, the transcript on a sampled one)
 *   challenge  the node commits to a segment chain, the API draws segments to open, the node answers them
 *              (shared/verification.ts; int8-mlp)
 */
import type { POUWCertificate } from "../../../../pouw/src/types.js";
import { verify as cupowVerify } from "../../../../pouw/src/cupow.js";
import { chooseBlockSize, fieldHash, freivalds, maxAbsEntry, toFieldMatrix } from "../../../../pouw/src/index.js";
import type { SegmentKernel, SegmentSpec, Tensor, TensorSig, Verdict } from "../../../../shared/verification.js";
import {
  int8MlpInputs,
  int8MlpKernel,
  int8MlpPlan,
  int8MlpResultSig,
  meterInt8Mlp,
  validateInt8Mlp,
  type Int8MlpInput,
} from "../../../../shared/work-int8-mlp.js";
import {
  int8ModelInputs,
  int8ModelKernel,
  int8ModelPlan,
  int8ModelResultSig,
  meterInt8Model,
  samplesInt8Model,
  validateInt8Model,
  type Int8ModelInput,
} from "../../../../shared/work-int8-model.js";

export type { Verdict };

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

export interface PlantedTask {
  n: number;
  matrixA: number[];
  matrixB: number[];
  matrixC: number[];
  expected: "valid" | "invalid";
}

export interface WorkType<J = WorkJobInput> {
  id: string;
  /** inline: all data in the submit (matmul); challenge: commit, then open segments. */
  mode: "inline" | "challenge";
  /** Eligibility gate for this type only: nodes on an older agent are never drawn for it. */
  minAgent?: string;
  /** What a node must advertise to be eligible (the work type id in its workTypes). */
  requirements(job: J): { workType: string };
  /** Input check at intake; returns an error message or null. */
  validate(job: J): string | null;
  /** Protocol-computed units (MAC-equivalents → fee) — never self-reported. */
  meter(job: J): number;
  /** A known-answer task; `corrupt` flips one entry of C so the right verdict is "invalid" (matmul, verify-feed). */
  plantedTask?(base?: { n: number; matrixA: number[]; matrixB: number[]; matrixC: number[] }, corrupt?: boolean): PlantedTask;
  // ── inline ──
  /**
   * The proof for this resource. The cheap checks always run; `transcript: false` skips the full re-execution
   * (sampled verification, ENGINEERING_BACKLOG B-6). Default: re-execute.
   */
  verify?(submission: Submission, opts?: { transcript?: boolean }): Verdict;
  // ── challenge ──
  /** The job's input tensors, by name (`in:<name>` in the plan). */
  inputs?(job: J): Record<string, Tensor>;
  /** The fixed segment plan; the node never chooses kinds, ops or wiring. */
  plan?(job: J): SegmentSpec[];
  /** The exact dtype and shape of the result (the last segment's output). */
  resultSig?(job: J): TensorSig;
  /** Segments opened per job. */
  samples?(job: J): number;
  /** The check of one segment op, with the job's own parameters. */
  kernel?(job: J, op: string): SegmentKernel;
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

export const matmul: WorkType & Pick<Required<WorkType>, "verify" | "plantedTask"> = {
  id: "matmul",
  mode: "inline",

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

  verify({ job, certificate, result }, { transcript = true } = {}) {
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
    if (!transcript) return { ok: true };
    // Re-execute over the job's own matrices, never the copies the node sent: the int32 hash encoding wraps, so a
    // certificate over A + 2³² would otherwise bind to A (docs/POUW_REVIEW.md §2, h).
    let transcriptOk = false;
    try {
      transcriptOk = cupowVerify({ ...certificate, matrixA: toFieldMatrix(job.matrixA, n).data, matrixB: toFieldMatrix(job.matrixB, n).data });
    } catch {
      transcriptOk = false;
    }
    if (!transcriptOk) return { ok: false, reason: "certificate transcript failed verification", stage: "transcript" };
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

/**
 * One quantized MLP block on the user's own weights (shared/work-int8-mlp.ts). Every job is challenged: 2 of its 4
 * segments are opened, so one wrong segment is caught with probability ≥ ½ per job.
 */
export const int8Mlp: WorkType<Int8MlpInput> = {
  id: "int8-mlp",
  mode: "challenge",
  minAgent: "1.7.0",
  requirements: () => ({ workType: "int8-mlp" }),
  validate: validateInt8Mlp,
  meter: meterInt8Mlp,
  inputs: int8MlpInputs,
  plan: int8MlpPlan,
  resultSig: int8MlpResultSig,
  samples: () => 2,
  kernel: int8MlpKernel,
};

/**
 * L chained int8-mlp blocks on the user's own weights (shared/work-int8-model.ts). 2 + ceil(L/4) of its 4·L segments
 * are opened per job, so one wrong segment is caught with probability (2 + ceil(L/4)) / 4L per job: ¾ at L = 1, 6/64
 * at L = 16. The draw grows with L but stays a handful of segment checks per answer; the claw of all held pay is what
 * keeps a wrong segment negative-EV at the lower rate.
 */
export const int8Model: WorkType<Int8ModelInput> = {
  id: "int8-model",
  mode: "challenge",
  minAgent: "1.8.0",
  requirements: () => ({ workType: "int8-model" }),
  validate: validateInt8Model,
  meter: meterInt8Model,
  inputs: int8ModelInputs,
  plan: int8ModelPlan,
  resultSig: int8ModelResultSig,
  samples: samplesInt8Model,
  kernel: int8ModelKernel,
};

const REGISTRY = new Map<string, WorkType<any>>([
  [matmul.id, matmul],
  [int8Mlp.id, int8Mlp],
  [int8Model.id, int8Model],
]);

export function getWorkType(id: string): WorkType<any> | undefined {
  return REGISTRY.get(id);
}

export function workTypeIds(): string[] {
  return [...REGISTRY.keys()];
}
