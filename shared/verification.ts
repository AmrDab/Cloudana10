/**
 * The general verification interface (ENGINEERING_BACKLOG B-26, Phase 0), shared by the API and the agent.
 *
 * A job is a fixed plan of segments (from the WorkType, never from the node). The node runs it and commits to the hash
 * of every segment's output, folded with σ, the job's input hash and the plan into one chain root. After the
 * commitment is stored the API draws segments to open; the node serves the tensors each drawn segment reads and
 * writes, and `checkOpening` checks them against the commitment and the segment's kind:
 *   gemm        Out = A·B + 1·biasᵀ, by rectangular Freivalds (O(m·k + k·n + m·n), not O(m·k·n))
 *   elementwise a deterministic recompute, compared by hash
 *   opaque      the WorkType's re-execution
 * Job inputs (`in:*`) always come from the job, never from the node (docs/POUW_REVIEW.md §2h).
 */
import { createHash } from "node:crypto";
import { freivaldsRect } from "../pouw/src/freivalds.js";

export type SegmentKind = "gemm" | "elementwise" | "opaque";
/** A job input, or an earlier segment's output. */
export type TensorRef = `in:${string}` | `seg:${number}`;
export type Dtype = "i8" | "i32";
export interface Tensor {
  dtype: Dtype;
  shape: number[];
  data: number[];
}
/** From WorkType.plan(job): the node never chooses kinds, ops or wiring. */
export interface SegmentSpec {
  idx: number;
  kind: SegmentKind;
  op: string;
  inputs: TensorRef[];
}
/** What a node submits. Only the out-hashes are the node's own claims. */
export interface Commitment {
  /** Must equal the server's hash of the job's own inputs. */
  inputHash: string;
  /** = tensorHash(result) = segments[m-1].outHash */
  outputHash: string;
  /** The fold below; binds σ. */
  chainRoot: string;
  segments: { idx: number; outHash: string }[];
}
/** A challenged segment opened by the node: every `seg:j` input it reads, plus its own output `seg:idx`. */
export interface SegmentOpening {
  idx: number;
  tensors: Partial<Record<TensorRef, Tensor>>;
}
/**
 * stage set ⇒ a sampled check failed (the node is caught): "transcript" (matmul's cuPOW re-execution), "segment" (an
 * opened segment is wrong or does not match the commitment), "timeout" (the challenge was not answered in time).
 */
export type Verdict = { ok: true } | { ok: false; reason: string; stage?: "transcript" | "segment" | "timeout" };
export const isCaught = (v: Verdict): boolean => !v.ok && v.stage !== undefined;

/** The Freivalds prime; a gemm output entry must be within ±HALF_P so the mod-p check is exact over the integers. */
export const P = 1_000_000_007;
const HALF_P = (P - 1) / 2;

const RANGE: Record<Dtype, [number, number]> = { i8: [-128, 127], i32: [-(2 ** 31), 2 ** 31 - 1] };

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

/** Well-formed: a known dtype, a shape of positive integers, data of that size and every entry an integer in range. */
export function validTensor(t: unknown): t is Tensor {
  if (!t || typeof t !== "object") return false;
  const { dtype, shape, data } = t as Tensor;
  if (dtype !== "i8" && dtype !== "i32") return false;
  if (!Array.isArray(shape) || shape.length === 0 || shape.length > 4 || !shape.every((s) => Number.isInteger(s) && s > 0)) return false;
  if (!Array.isArray(data) || data.length !== shape.reduce((a, b) => a * b, 1)) return false;
  const [lo, hi] = RANGE[dtype];
  for (const v of data) if (!Number.isInteger(v) || v < lo || v > hi) return false;
  return true;
}

/**
 * sha256("cldt1|" + dtype + "|" + shape.join("x") + "|" ‖ little-endian two's-complement bytes). Throws on a tensor
 * that is not well-formed: a wrapped encoding would let two different tensors share a hash.
 */
export function tensorHash(t: Tensor): string {
  if (!validTensor(t)) throw new Error("tensorHash: malformed tensor");
  const width = t.dtype === "i8" ? 1 : 4;
  const head = new TextEncoder().encode(`cldt1|${t.dtype}|${t.shape.join("x")}|`);
  const bytes = new Uint8Array(head.length + t.data.length * width);
  bytes.set(head);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < t.data.length; i++) {
    if (width === 1) view.setInt8(head.length + i, t.data[i]);
    else view.setInt32(head.length + i * 4, t.data[i], true);
  }
  return sha256(bytes);
}

/** sha256 of the "name:tensorHash" lines of the job's inputs, names sorted, joined by "\n". */
export function inputHash(inputs: Record<string, Tensor>): string {
  return sha256(
    Object.keys(inputs)
      .sort()
      .map((name) => `${name}:${tensorHash(inputs[name])}`)
      .join("\n"),
  );
}

/** L0 = sha256("cldc1|"+σ+"|"+inHash); L(i+1) = sha256(Li+"|"+idx+"|"+kind+"|"+op+"|"+inputs.join(",")+"|"+outHash_i). */
export function chainRoot(sigma: string, inHash: string, plan: SegmentSpec[], outHashes: string[]): string {
  let l = sha256(`cldc1|${sigma}|${inHash}`);
  plan.forEach((s, i) => {
    l = sha256(`${l}|${s.idx}|${s.kind}|${s.op}|${s.inputs.join(",")}|${outHashes[i]}`);
  });
  return l;
}

/** The commitment an honest node submits for `outputs` (one per plan segment, in order). */
export function makeCommitment(sigma: string, inputs: Record<string, Tensor>, plan: SegmentSpec[], outputs: Tensor[]): Commitment {
  const inHash = inputHash(inputs);
  const outHashes = outputs.map(tensorHash);
  return {
    inputHash: inHash,
    outputHash: outHashes[outHashes.length - 1],
    chainRoot: chainRoot(sigma, inHash, plan, outHashes),
    segments: plan.map((s, i) => ({ idx: s.idx, outHash: outHashes[i] })),
  };
}

const HEX64 = /^[0-9a-f]{64}$/;

/** A tensor's dtype and exact shape. */
export interface TensorSig {
  dtype: Dtype;
  shape: number[];
}
/** Same dtype and exactly the same shape — [n, m] is not [m, n], and [1, m·n] is not [m, n]. */
export const hasSig = (t: Tensor, s: TensorSig): boolean =>
  t.dtype === s.dtype && t.shape.length === s.shape.length && t.shape.every((d, i) => d === s.shape[i]);

/** Every job input well-formed and of the exact signature the job says (`expected` names the same inputs). */
export function checkInputs(inputs: Record<string, Tensor>, expected: Record<string, TensorSig>): string | null {
  const names = Object.keys(expected).sort();
  if (Object.keys(inputs).sort().join(",") !== names.join(",")) return "the job's inputs do not match its signature";
  for (const name of names) {
    if (!validTensor(inputs[name]) || !hasSig(inputs[name], expected[name])) return `input ${name} must be ${expected[name].dtype}[${expected[name].shape.join("×")}]`;
  }
  return null;
}

/**
 * The bind check (no sampling): the commitment is for this job's inputs, this plan and this σ, and `result` is the
 * last segment's output, of exactly the signature `resultSig`. A failure is a refusal, not a catch: nothing was opened
 * yet.
 */
export function checkCommitment(
  sigma: string,
  inputs: Record<string, Tensor>,
  plan: SegmentSpec[],
  c: Commitment,
  result: Tensor,
  resultSig: TensorSig,
): Verdict {
  if (!c || typeof c !== "object" || !Array.isArray(c.segments)) return { ok: false, reason: "commitment missing" };
  if (c.inputHash !== inputHash(inputs)) return { ok: false, reason: "commitment is not for this job's inputs (input hash mismatch)" };
  if (c.segments.length !== plan.length || c.segments.some((s, i) => s?.idx !== plan[i].idx || typeof s.outHash !== "string" || !HEX64.test(s.outHash))) {
    return { ok: false, reason: "commitment segments do not match the job's plan" };
  }
  const outHashes = c.segments.map((s) => s.outHash);
  if (c.chainRoot !== chainRoot(sigma, c.inputHash, plan, outHashes)) {
    return { ok: false, reason: "commitment chain root does not match the assignment (σ, inputs, plan or segment hashes)" };
  }
  if (!validTensor(result) || !hasSig(result, resultSig)) {
    return { ok: false, reason: `result must be a well-formed ${resultSig.dtype}[${resultSig.shape.join("×")}] tensor` };
  }
  if (c.outputHash !== tensorHash(result) || c.outputHash !== outHashes[outHashes.length - 1]) {
    return { ok: false, reason: "result does not match the commitment's output hash" };
  }
  return { ok: true };
}

export interface GemmOperands {
  A: number[];
  B: number[];
  bias: number[] | null;
  m: number;
  k: number;
  n: number;
}
export interface SegmentKernel {
  /**
   * The segment's exact signature, from the job's own parameters (never from the node): each input, in plan order,
   * and the output. checkOpening refuses any tensor that does not have it.
   */
  sig: { ins: TensorSig[]; out: TensorSig };
  /** gemm: Out = A·B + 1·biasᵀ, checked by Freivalds (A from the opening or job, B/bias always the job's own). */
  gemm?(ins: Tensor[]): GemmOperands;
  /** elementwise: deterministic recompute; compared by tensorHash. */
  elementwise?(ins: Tensor[]): Tensor;
  /** opaque: the WorkType's own re-execution of the segment. */
  opaque?(ins: Tensor[], out: Tensor): boolean;
}

const segFail = (reason: string): Verdict => ({ ok: false, reason, stage: "segment" });

/**
 * Kind-generic opening check: every tensor has its exact signature and the served ones hash to the commitment, then
 * the kind's check. A failure with a stage is the node's (caught); one without is the job's own data or kernel being
 * inconsistent (refused, never a catch).
 */
export function checkOpening(spec: SegmentSpec, o: SegmentOpening, c: Commitment, jobInputs: Record<string, Tensor>, kernel: SegmentKernel): Verdict {
  if (!o || o.idx !== spec.idx || !o.tensors || typeof o.tensors !== "object") return segFail(`segment ${spec.idx}: opening missing`);
  if (kernel.sig.ins.length !== spec.inputs.length) return { ok: false, reason: `segment ${spec.idx} (${spec.op}): kernel signature does not match the plan` };
  const committed = (ref: `seg:${number}`) => c.segments[Number(ref.slice(4))]?.outHash;
  const served = (ref: `seg:${number}`, sig: TensorSig): Tensor | null => {
    const t = o.tensors[ref];
    return validTensor(t) && hasSig(t, sig) && tensorHash(t) === committed(ref) ? t : null;
  };
  const ins: Tensor[] = [];
  for (const [i, ref] of spec.inputs.entries()) {
    const sig = kernel.sig.ins[i];
    if (ref.startsWith("in:")) {
      const t = jobInputs[ref.slice(3)];
      if (!t || !validTensor(t) || !hasSig(t, sig)) return { ok: false, reason: `segment ${spec.idx} (${spec.op}): job input ${ref} does not have its signature` };
      ins.push(t);
    } else {
      const t = served(ref as `seg:${number}`, sig);
      if (!t) return segFail(`segment ${spec.idx}: opening does not match the commitment (${ref})`);
      ins.push(t);
    }
  }
  const out = served(`seg:${spec.idx}`, kernel.sig.out);
  if (!out) return segFail(`segment ${spec.idx}: opening does not match the commitment (output)`);

  if (spec.kind === "gemm") {
    if (!kernel.gemm) throw new Error(`checkOpening: no gemm kernel for ${spec.op}`);
    const g = kernel.gemm(ins);
    // The operands the kernel built must be the dimensions the signature says: A [m,k], B [k,n], bias [n], out [m,n].
    if (
      g.A.length !== g.m * g.k ||
      g.B.length !== g.k * g.n ||
      (g.bias !== null && g.bias.length !== g.n) ||
      out.dtype !== "i32" ||
      !hasSig(out, { dtype: "i32", shape: [g.m, g.n] })
    ) {
      return { ok: false, reason: `segment ${spec.idx} (${spec.op}): gemm operands do not have the plan's dimensions` };
    }
    // Exact over ℤ: the true entries are within ±HALF_P (the WorkType's bounds), so a claimed one must be too.
    const C = new Array<number>(out.data.length);
    for (let i = 0; i < g.m; i++) {
      for (let j = 0; j < g.n; j++) {
        const v = out.data[i * g.n + j];
        if (Math.abs(v) > HALF_P) return segFail(`segment ${spec.idx} (${spec.op}): output entry out of range`);
        C[i * g.n + j] = g.bias ? v - g.bias[j] : v;
      }
    }
    return freivaldsRect(g.A, g.B, C, g.m, g.k, g.n) ? { ok: true } : segFail(`segment ${spec.idx} (${spec.op}): output is not A·B + bias (Freivalds check failed)`);
  }
  if (spec.kind === "elementwise") {
    if (!kernel.elementwise) throw new Error(`checkOpening: no elementwise kernel for ${spec.op}`);
    const want = kernel.elementwise(ins);
    if (!hasSig(want, kernel.sig.out)) return { ok: false, reason: `segment ${spec.idx} (${spec.op}): kernel output does not have its signature` };
    return tensorHash(want) === committed(`seg:${spec.idx}`) ? { ok: true } : segFail(`segment ${spec.idx} (${spec.op}): recomputed output differs`);
  }
  if (!kernel.opaque) throw new Error(`checkOpening: no re-execution for ${spec.op}`);
  return kernel.opaque(ins, out) ? { ok: true } : segFail(`segment ${spec.idx} (${spec.op}): re-execution differs`);
}
