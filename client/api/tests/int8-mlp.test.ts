/**
 * The int8-mlp executor and kernels (shared/work-int8-mlp.ts, B-26 Phase 0 step 4): determinism against a hard-coded
 * golden vector, the intake bounds, the kernels agreeing with the executor, and the per-segment check cost at the
 * largest shape (budget: 50 ms of Worker CPU per answer).
 */
import { describe, it, expect } from "vitest";
import { checkOpening, makeCommitment, tensorHash, type Tensor } from "../../../shared/verification.js";
import {
  INT8_MLP,
  executeInt8Mlp,
  int8MlpInputs,
  int8MlpKernel,
  int8MlpPlan,
  meterInt8Mlp,
  randomInt8MlpInput,
  requant,
  validateInt8Mlp,
  type Int8MlpInput,
} from "../../../shared/work-int8-mlp.js";
import { getWorkType, int8Mlp } from "../src/services/work-types.js";

/** randomInt8MlpInput(42, 2, 8, 8): computed once and pinned. node-agent/src/int8-mlp.selftest.ts pins the same. */
const GOLDEN = {
  result: [-22, 33, -102, -24, -11, -54, 81, 19, -76, 127, 78, 6, 127, 123, -51, 115],
  outHashes: [
    "b8a75b9de9e466c6c75026cf4df3a36cf8ecdf0186aa5520cf29a8c6313561bd",
    "5aff0b8851b5007e3dd4ae13670dca5c6fb99c40525e2e547825e4f7b3a08310",
    "b24fb5ee60d7e9e21825b90d8513701bde23d72cc74cbcd86488d9150e1cbcea",
    "495ad426e781ef12aadcad94e64ff90b6871649382cef443d4ee18d0b3be0650",
  ],
};

describe("int8-mlp executor", () => {
  it("matches the golden vector", () => {
    const { outputs, result } = executeInt8Mlp(randomInt8MlpInput(42, 2, 8, 8));
    expect(result).toEqual({ dtype: "i8", shape: [2, 8], data: GOLDEN.result });
    expect(outputs.map(tensorHash)).toEqual(GOLDEN.outHashes);
    expect(outputs.map((t) => `${t.dtype}[${t.shape}]`)).toEqual(["i32[2,8]", "i8[2,8]", "i32[2,8]", "i8[2,8]"]);
  });

  it("requant rounds half up, then clamps to int8", () => {
    expect(requant(3, 1, 1)).toBe(2); // 1.5 → 2
    expect(requant(-3, 1, 1)).toBe(-1); // −1.5 → −1
    expect(requant(10 ** 6, 3, 2)).toBe(127);
    expect(requant(-(10 ** 6), 3, 2)).toBe(-128);
    // The extreme bound: |acc| < 2²³ and m < 2¹⁵ stay exact in doubles.
    expect(requant(2 ** 23 - 1, 2 ** 15 - 1, 31)).toBe(127);
    expect(requant(-(2 ** 23 - 1), 1, 16)).toBe(-128);
    expect(requant(5_000_000, 3, 17)).toBe(114); // floor((15,000,000 + 65,536) / 131,072) = 114
  });

  it("uses the user's table when given (default ReLU)", () => {
    const x = randomInt8MlpInput(3);
    const identity = Array.from({ length: 256 }, (_, i) => i - 128);
    expect(executeInt8Mlp({ ...x, lut: identity }).result).not.toEqual(executeInt8Mlp(x).result);
    expect(executeInt8Mlp({ ...x, lut: Array.from({ length: 256 }, (_, i) => Math.max(i - 128, 0)) }).result).toEqual(executeInt8Mlp(x).result);
  });

  it("every kernel agrees with the executor: honest openings of all four segments pass", () => {
    const x = randomInt8MlpInput(9, 3, 16, 24);
    const { outputs } = executeInt8Mlp(x);
    const plan = int8MlpPlan();
    const c = makeCommitment("ab".repeat(32), int8MlpInputs(x), plan, outputs);
    for (const spec of plan) {
      const tensors: Record<string, Tensor> = { [`seg:${spec.idx}`]: outputs[spec.idx] };
      for (const r of spec.inputs) if (r.startsWith("seg:")) tensors[r] = outputs[Number(r.slice(4))];
      expect(checkOpening(spec, { idx: spec.idx, tensors }, c, int8MlpInputs(x), int8MlpKernel(x, spec.op)), spec.op).toEqual({ ok: true });
    }
  });
});

describe("int8-mlp intake", () => {
  const ok = randomInt8MlpInput(1, 2, 8, 8);
  const bad = (patch: Partial<Int8MlpInput>) => validateInt8Mlp({ ...ok, ...patch });

  it("accepts a valid input and is registered as a challenge type gated on agent 1.7.0", () => {
    expect(validateInt8Mlp(ok)).toBeNull();
    expect(getWorkType("int8-mlp")).toBe(int8Mlp);
    expect(int8Mlp).toMatchObject({ mode: "challenge", minAgent: "1.7.0" });
    expect(int8Mlp.samples!(ok)).toBe(2);
    expect(meterInt8Mlp(ok)).toBe(2 * 2 * 8 * 8);
  });

  it("refuses out-of-bounds dimensions, entries, biases, scales and tables", () => {
    expect(bad({ b: 0 })).toMatch(/b must be/);
    expect(bad({ b: INT8_MLP.B_MAX + 1 })).toMatch(/b must be/);
    expect(bad({ d: 7 })).toMatch(/d and h/);
    expect(bad({ h: 257 })).toMatch(/d and h/);
    expect(bad({ X: ok.X.slice(1) })).toMatch(/X must have 16/);
    expect(bad({ W1: ok.W1.map((v, i) => (i === 3 ? 128 : v)) })).toMatch(/W1\[3\]/);
    expect(bad({ W2: ok.W2.map((v, i) => (i === 0 ? 0.5 : v)) })).toMatch(/W2\[0\]/);
    expect(bad({ b1: ok.b1.map((v, i) => (i === 0 ? 2 ** 20 + 1 : v)) })).toMatch(/b1\[0\]/);
    expect(bad({ b2: ok.b2.slice(1) })).toMatch(/b2 must have 8/);
    expect(bad({ m1: 0 })).toMatch(/m1/);
    expect(bad({ m2: 2 ** 15 })).toMatch(/m2/);
    expect(bad({ s1: 0 })).toMatch(/s1/);
    expect(bad({ s2: 32 })).toMatch(/s2/);
    expect(bad({ lut: new Array(255).fill(0) })).toMatch(/lut must have 256/);
    expect(bad({ lut: new Array(256).fill(-129) })).toMatch(/lut\[0\]/);
  });
});

describe("int8-mlp check cost at the largest shape (b = 64, d = h = 256)", () => {
  it("each segment check is under the 50 ms budget, and so are the two gemms together (the worst draw)", () => {
    const x = randomInt8MlpInput(7, INT8_MLP.B_MAX, INT8_MLP.DIM_MAX, INT8_MLP.DIM_MAX);
    const { outputs } = executeInt8Mlp(x);
    const plan = int8MlpPlan();
    const inputs = int8MlpInputs(x);
    const c = makeCommitment("ab".repeat(32), inputs, plan, outputs);
    const ms: number[] = [];
    for (const spec of plan) {
      const tensors: Record<string, Tensor> = { [`seg:${spec.idx}`]: outputs[spec.idx] };
      for (const r of spec.inputs) if (r.startsWith("seg:")) tensors[r] = outputs[Number(r.slice(4))];
      const check = () => expect(checkOpening(spec, { idx: spec.idx, tensors }, c, inputs, int8MlpKernel(x, spec.op))).toEqual({ ok: true });
      check(); // warm-up: a Worker isolate serves many answers
      // The fastest of 9 timed runs on this thread: the check's own cost. process.cpuUsage counts every thread (the
      // parallel test files, GC) and wall time under a loaded suite counts preemption; the minimum excludes both.
      const runs = Array.from({ length: 9 }, () => {
        const t0 = performance.now();
        check();
        return performance.now() - t0;
      });
      ms.push(Math.min(...runs));
    }
    console.log(
      `[B-26] int8-mlp b=64 d=h=256 time per segment check (Freivalds, hashes, shape checks; best of 9): ` +
        `${plan.map((s, i) => `${s.op} ${ms[i].toFixed(1)} ms`).join(", ")}; worst draw (both gemms) ${(ms[0] + ms[2]).toFixed(1)} ms`,
    );
    for (const m of ms) expect(m).toBeLessThan(50);
    expect(ms[0] + ms[2]).toBeLessThan(50);
  }, 60_000);
});
