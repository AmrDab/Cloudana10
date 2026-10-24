/**
 * WorkType "int8-model" (ENGINEERING_BACKLOG B-26 follow-up): L int8-mlp blocks chained — block ℓ's Y is block ℓ+1's
 * X — on the user's own weights; Cloudana picks no model. Each block is exactly the int8-mlp block
 * (shared/work-int8-mlp.ts: same kernels, same per-block bounds), so the plan is 4·L segments:
 *
 *   4ℓ+0  gemm         xw1@ℓ      Xℓ, in:W1_ℓ, in:b1_ℓ      Xℓ = in:X for ℓ = 0, else seg:4ℓ−1 (the previous Y)
 *   4ℓ+1  elementwise  rq1_lut@ℓ  seg:4ℓ
 *   4ℓ+2  gemm         aw2@ℓ      seg:4ℓ+1, in:W2_ℓ, in:b2_ℓ
 *   4ℓ+3  elementwise  rq2_res@ℓ  seg:4ℓ+2, Xℓ
 *
 * One d and one h for every block. Size: the input stays in one D1 row (≤ 2 MB). At L = 16 blocks of d = h = 256 the
 * weights alone are 16 · 2 · 65,536 = 2.1 M entries (~9 MB of JSON), so int8-model caps d and h at 64 instead:
 * 16 · 2 · 4,096 = 131 k weight entries, ~0.6 MB of JSON at most with X, biases and tables.
 */
import type { SegmentKernel, SegmentSpec, Tensor, TensorRef, TensorSig } from "./verification.js";
import { INT8_MLP, executeInt8Mlp, int8MlpInputs, int8MlpKernel, randomInt8MlpInput, validateInt8Mlp, type Int8MlpInput } from "./work-int8-mlp.js";

export type Int8Block = Pick<Int8MlpInput, "W1" | "b1" | "W2" | "b2" | "m1" | "s1" | "m2" | "s2" | "lut">;
export interface Int8ModelInput {
  b: number;
  d: number;
  h: number;
  X: number[];
  blocks: Int8Block[];
}

export const INT8_MODEL = { L_MAX: 16, DIM_MAX: 64 } as const;

/** Block ℓ as an int8-mlp input (its X only matters for ℓ = 0; the executor feeds the previous Y). */
const blockInput = (x: Int8ModelInput, l: number, X: number[] = x.X): Int8MlpInput => ({ b: x.b, d: x.d, h: x.h, X, ...x.blocks[l] });

export function validateInt8Model(x: Int8ModelInput): string | null {
  if (!x || typeof x !== "object") return "input is required";
  if (!Array.isArray(x.blocks) || x.blocks.length < 1 || x.blocks.length > INT8_MODEL.L_MAX) return `blocks must have 1 to ${INT8_MODEL.L_MAX} entries`;
  if (!Number.isInteger(x.d) || !Number.isInteger(x.h) || x.d > INT8_MODEL.DIM_MAX || x.h > INT8_MODEL.DIM_MAX) {
    return `d and h must be integers in [${INT8_MLP.DIM_MIN}, ${INT8_MODEL.DIM_MAX}]`;
  }
  for (let l = 0; l < x.blocks.length; l++) {
    if (!x.blocks[l] || typeof x.blocks[l] !== "object") return `blocks[${l}] must be an object`;
    const err = validateInt8Mlp(blockInput(x, l));
    if (err) return `blocks[${l}]: ${err}`;
  }
  return null;
}

/** MAC-equivalents: two GEMMs of b·d·h per block. */
export const meterInt8Model = (x: Int8ModelInput): number => 2 * x.b * x.d * x.h * x.blocks.length;

/** Segments opened: 2 + ceil(L/4) (3 at L = 1, 6 at L = 16), within segmentDraw's 8. */
export const samplesInt8Model = (x: Int8ModelInput): number => Math.min(8, 2 + Math.ceil(x.blocks.length / 4));

/** The job's input tensors: X, then per block ℓ its W1_ℓ, b1_ℓ, W2_ℓ, b2_ℓ, q_ℓ and lut_ℓ (as in int8-mlp). */
export function int8ModelInputs(x: Int8ModelInput): Record<string, Tensor> {
  const out: Record<string, Tensor> = {};
  x.blocks.forEach((_, l) => {
    for (const [name, t] of Object.entries(int8MlpInputs(blockInput(x, l)))) if (name !== "X") out[`${name}_${l}`] = t;
  });
  out.X = int8MlpInputs(blockInput(x, 0)).X;
  return out;
}

export function int8ModelPlan(x: Int8ModelInput): SegmentSpec[] {
  const plan: SegmentSpec[] = [];
  for (let l = 0; l < x.blocks.length; l++) {
    const i = 4 * l;
    const X: TensorRef = l === 0 ? "in:X" : `seg:${i - 1}`;
    plan.push(
      { idx: i, kind: "gemm", op: `xw1@${l}`, inputs: [X, `in:W1_${l}`, `in:b1_${l}`] },
      { idx: i + 1, kind: "elementwise", op: `rq1_lut@${l}`, inputs: [`seg:${i}`] },
      { idx: i + 2, kind: "gemm", op: `aw2@${l}`, inputs: [`seg:${i + 1}`, `in:W2_${l}`, `in:b2_${l}`] },
      { idx: i + 3, kind: "elementwise", op: `rq2_res@${l}`, inputs: [`seg:${i + 2}`, X] },
    );
  }
  return plan;
}

export const int8ModelResultSig = ({ b, d }: Int8ModelInput): TensorSig => ({ dtype: "i8", shape: [b, d] });

/** The int8-mlp kernel of block ℓ, for op "<op>@ℓ". */
export function int8ModelKernel(x: Int8ModelInput, op: string): SegmentKernel {
  const m = /^(xw1|rq1_lut|aw2|rq2_res)@(\d+)$/.exec(op);
  const l = m ? Number(m[2]) : -1;
  if (!m || l >= x.blocks.length) throw new Error(`int8-model: unknown op ${op}`);
  return int8MlpKernel(blockInput(x, l), m[1]);
}

/** Every segment's output, in plan order, and the result (the last block's Y). */
export function executeInt8Model(x: Int8ModelInput): { outputs: Tensor[]; result: Tensor } {
  const outputs: Tensor[] = [];
  let X = x.X;
  for (let l = 0; l < x.blocks.length; l++) {
    const r = executeInt8Mlp(blockInput(x, l, X));
    outputs.push(...r.outputs);
    X = r.result.data;
  }
  return { outputs, result: outputs[outputs.length - 1] };
}

/** Random weights for tests, selftests and examples only — not a model. */
export function randomInt8ModelInput(seed: number, L = 4, b = 4, d = 16, h = 32): Int8ModelInput {
  const blocks = Array.from({ length: L }, (_, l) => {
    const { X: _x, b: _b, d: _d, h: _h, ...w } = randomInt8MlpInput(seed + 7919 * l, b, d, h);
    return w;
  });
  return { b, d, h, X: randomInt8MlpInput(seed, b, d, h).X, blocks };
}
