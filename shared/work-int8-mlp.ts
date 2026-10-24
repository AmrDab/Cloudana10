/**
 * WorkType "int8-mlp" (ENGINEERING_BACKLOG B-26, Phase 0): one quantized MLP block with a residual, on the user's own
 * weights, scales and activation table — Cloudana picks no model. Shared by the API (plan, kernels, checks) and the
 * agent (execute). Pure integer arithmetic, so every node computes the same bytes.
 *
 *   idx  kind         op       inputs                  output
 *   0    gemm         xw1      in:X, in:W1, in:b1      acc1 i32[b×h] = X·W1 + 1·b1ᵀ
 *   1    elementwise  rq1_lut  seg:0                   a1   i8[b×h]  = lut[requant(acc1, m1, s1) + 128]
 *   2    gemm         aw2      seg:1, in:W2, in:b2     acc2 i32[b×d] = a1·W2 + 1·b2ᵀ
 *   3    elementwise  rq2_res  seg:2, in:X             Y    i8[b×d]  = clamp(requant(acc2, m2, s2) + X, −128, 127)
 *
 * requant(v, m, s) = clamp(floor((v·m + 2^(s−1)) / 2^s), −128, 127). Bounds: |acc| ≤ 256·128² + 2²⁰ < 2²³, so
 * |acc·m| < 2³⁸ (exact in doubles) and |acc| < p/2 (the mod-p Freivalds check is exact over ℤ).
 */
import type { SegmentKernel, SegmentSpec, Tensor, TensorSig } from "./verification.js";

export interface Int8MlpInput {
  b: number;
  d: number;
  h: number;
  X: number[];
  W1: number[];
  b1: number[];
  W2: number[];
  b2: number[];
  m1: number;
  s1: number;
  m2: number;
  s2: number;
  /** 256 entries, index v + 128 for v in [−128, 127]. Default: ReLU (lut[v + 128] = max(v, 0)). */
  lut?: number[];
}

export const INT8_MLP = { B_MAX: 64, DIM_MIN: 8, DIM_MAX: 256, BIAS_MAX: 2 ** 20, M_MAX: 2 ** 15 - 1, S_MAX: 31 } as const;

const isInt = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;

/** Input check at intake: an error message, or null. */
export function validateInt8Mlp(x: Int8MlpInput): string | null {
  if (!x || typeof x !== "object") return "input is required";
  const { b, d, h } = x;
  if (!isInt(b, 1, INT8_MLP.B_MAX)) return `b must be an integer in [1, ${INT8_MLP.B_MAX}]`;
  if (!isInt(d, INT8_MLP.DIM_MIN, INT8_MLP.DIM_MAX) || !isInt(h, INT8_MLP.DIM_MIN, INT8_MLP.DIM_MAX)) {
    return `d and h must be integers in [${INT8_MLP.DIM_MIN}, ${INT8_MLP.DIM_MAX}]`;
  }
  const arrays: [string, unknown, number, number, number][] = [
    ["X", x.X, b * d, -128, 127],
    ["W1", x.W1, d * h, -128, 127],
    ["b1", x.b1, h, -INT8_MLP.BIAS_MAX, INT8_MLP.BIAS_MAX],
    ["W2", x.W2, h * d, -128, 127],
    ["b2", x.b2, d, -INT8_MLP.BIAS_MAX, INT8_MLP.BIAS_MAX],
  ];
  if (x.lut !== undefined) arrays.push(["lut", x.lut, 256, -128, 127]);
  for (const [name, arr, len, lo, hi] of arrays) {
    if (!Array.isArray(arr) || arr.length !== len) return `${name} must have ${len} entries`;
    for (let i = 0; i < len; i++) if (!isInt(arr[i], lo, hi)) return `${name}[${i}] must be an integer in [${lo}, ${hi}]`;
  }
  for (const k of ["m1", "m2"] as const) if (!isInt(x[k], 1, INT8_MLP.M_MAX)) return `${k} must be an integer in [1, ${INT8_MLP.M_MAX}]`;
  for (const k of ["s1", "s2"] as const) if (!isInt(x[k], 1, INT8_MLP.S_MAX)) return `${k} must be an integer in [1, ${INT8_MLP.S_MAX}]`;
  return null;
}

/** MAC-equivalents (the fee meter): two GEMMs of b·d·h. */
export const meterInt8Mlp = (x: Pick<Int8MlpInput, "b" | "d" | "h">): number => 2 * x.b * x.d * x.h;

const i8 = (shape: number[]): TensorSig => ({ dtype: "i8", shape });
const i32 = (shape: number[]): TensorSig => ({ dtype: "i32", shape });

/** The exact signature of each job input. */
export function int8MlpInputSigs({ b, d, h }: Int8MlpInput): Record<string, TensorSig> {
  return { X: i8([b, d]), W1: i8([d, h]), b1: i32([h]), W2: i8([h, d]), b2: i32([d]) };
}

/** The job's input tensors (`in:<name>`). Scales and the table are parameters the kernels take from the job. */
export function int8MlpInputs(x: Int8MlpInput): Record<string, Tensor> {
  const sigs = int8MlpInputSigs(x);
  return Object.fromEntries(Object.entries(sigs).map(([name, s]) => [name, { ...s, data: x[name as "X" | "W1" | "b1" | "W2" | "b2"] }]));
}

/** The result's signature: Y i8[b×d]. */
export const int8MlpResultSig = ({ b, d }: Int8MlpInput): TensorSig => i8([b, d]);

const PLAN: SegmentSpec[] = [
  { idx: 0, kind: "gemm", op: "xw1", inputs: ["in:X", "in:W1", "in:b1"] },
  { idx: 1, kind: "elementwise", op: "rq1_lut", inputs: ["seg:0"] },
  { idx: 2, kind: "gemm", op: "aw2", inputs: ["seg:1", "in:W2", "in:b2"] },
  { idx: 3, kind: "elementwise", op: "rq2_res", inputs: ["seg:2", "in:X"] },
];
export const int8MlpPlan = (): SegmentSpec[] => PLAN.map((s) => ({ ...s, inputs: [...s.inputs] }));

const clamp8 = (v: number) => (v < -128 ? -128 : v > 127 ? 127 : v);
export const requant = (v: number, m: number, s: number): number => clamp8(Math.floor((v * m + 2 ** (s - 1)) / 2 ** s));
export const reluLut = (): number[] => Array.from({ length: 256 }, (_, i) => Math.max(i - 128, 0));

/** Out = A·B + 1·biasᵀ (A m×k, B k×n), exact in doubles within the bounds above. */
export function gemmBias(A: number[], B: number[], bias: number[], m: number, k: number, n: number): number[] {
  const C = new Array<number>(m * n);
  for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) C[i * n + j] = bias[j];
  for (let i = 0; i < m; i++) {
    for (let t = 0; t < k; t++) {
      const a = A[i * k + t];
      if (a === 0) continue;
      const row = t * n;
      for (let j = 0; j < n; j++) C[i * n + j] += a * B[row + j];
    }
  }
  return C;
}

/** The check of one segment op, with the job's own dimensions, scales and table. */
export function int8MlpKernel(x: Int8MlpInput, op: string): SegmentKernel {
  const { b, d, h } = x;
  const lut = x.lut ?? reluLut();
  switch (op) {
    case "xw1":
      return {
        sig: { ins: [i8([b, d]), i8([d, h]), i32([h])], out: i32([b, h]) },
        gemm: ([X, W1, b1]) => ({ A: X.data, B: W1.data, bias: b1.data, m: b, k: d, n: h }),
      };
    case "rq1_lut":
      return {
        sig: { ins: [i32([b, h])], out: i8([b, h]) },
        elementwise: ([acc]) => ({ dtype: "i8", shape: [b, h], data: acc.data.map((v) => lut[requant(v, x.m1, x.s1) + 128]) }),
      };
    case "aw2":
      return {
        sig: { ins: [i8([b, h]), i8([h, d]), i32([d])], out: i32([b, d]) },
        gemm: ([a1, W2, b2]) => ({ A: a1.data, B: W2.data, bias: b2.data, m: b, k: h, n: d }),
      };
    case "rq2_res":
      return {
        sig: { ins: [i32([b, d]), i8([b, d])], out: i8([b, d]) },
        elementwise: ([acc, X]) => ({ dtype: "i8", shape: [b, d], data: acc.data.map((v, i) => clamp8(requant(v, x.m2, x.s2) + X.data[i])) }),
      };
    default:
      throw new Error(`int8-mlp: unknown op ${op}`);
  }
}

/** Runs the plan: every segment's output, in order, and the result (the last one). What an honest node computes. */
export function executeInt8Mlp(x: Int8MlpInput): { outputs: Tensor[]; result: Tensor } {
  const ins = int8MlpInputs(x);
  const outputs: Tensor[] = [];
  for (const spec of PLAN) {
    const k = int8MlpKernel(x, spec.op);
    const args = spec.inputs.map((ref) => (ref.startsWith("in:") ? ins[ref.slice(3)] : outputs[Number(ref.slice(4))]));
    if (k.gemm) {
      const g = k.gemm(args);
      outputs.push({ ...k.sig.out, data: gemmBias(g.A, g.B, g.bias ?? new Array(g.n).fill(0), g.m, g.k, g.n) });
    } else {
      outputs.push(k.elementwise!(args));
    }
  }
  return { outputs, result: outputs[outputs.length - 1] };
}

/**
 * A deterministic input with random weights (a 31-bit LCG from `seed`) — for tests, selftests and examples only. It is
 * not a model: real jobs bring their own weights, scales and table.
 */
export function randomInt8MlpInput(seed: number, b = 4, d = 16, h = 32): Int8MlpInput {
  let s = seed >>> 0 || 1;
  const next = () => (s = (s * 1103515245 + 12345) % 2147483648);
  // The high bits: an LCG's low bits have short periods.
  const ints = (len: number, lo: number, hi: number) => Array.from({ length: len }, () => lo + (Math.floor(next() / 65536) % (hi - lo + 1)));
  return {
    b, d, h,
    X: ints(b * d, -128, 127),
    W1: ints(d * h, -128, 127),
    b1: ints(h, -4096, 4096),
    W2: ints(h * d, -128, 127),
    b2: ints(d, -4096, 4096),
    // Scales that keep the activations mostly inside int8 for uniform weights (|acc1| ~ 5,500·√d, |acc2| ~ 2,200·√h).
    m1: Math.round((2 ** 20 * 40) / (5500 * Math.sqrt(d))),
    s1: 20,
    m2: Math.round((2 ** 20 * 30) / (2200 * Math.sqrt(h))),
    s2: 20,
  };
}
