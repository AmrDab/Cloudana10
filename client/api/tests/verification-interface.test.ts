/**
 * The general verification interface (shared/verification.ts, B-26 Phase 0 step 2): rectangular Freivalds, the
 * commitment chain and the kind-generic opening check.
 */
import { describe, it, expect } from "vitest";
import { freivaldsRect } from "../../../pouw/src/index.js";
import {
  P,
  chainRoot,
  checkCommitment,
  checkInputs,
  checkOpening,
  inputHash,
  makeCommitment,
  tensorHash,
  type SegmentKernel,
  type SegmentOpening,
  type SegmentSpec,
  type Tensor,
} from "../../../shared/verification.js";

let seed = 7;
const rnd = (lo: number, hi: number) => lo + ((seed = (seed * 1103515245 + 12345) % 2147483648) % (hi - lo + 1));
const ints = (len: number, lo: number, hi: number) => Array.from({ length: len }, () => rnd(lo, hi));

function gemm(A: number[], B: number[], bias: number[] | null, m: number, k: number, n: number): number[] {
  const C = new Array<number>(m * n).fill(0);
  for (let i = 0; i < m; i++) for (let t = 0; t < k; t++) for (let j = 0; j < n; j++) C[i * n + j] += A[i * k + t] * B[t * n + j];
  if (bias) for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) C[i * n + j] += bias[j];
  return C;
}

describe("freivaldsRect", () => {
  const [m, k, n] = [5, 9, 7];
  const A = ints(m * k, -128, 127);
  const B = ints(k * n, -128, 127);
  const C = gemm(A, B, null, m, k, n);

  it("accepts A·B for a rectangular shape", () => {
    expect(freivaldsRect(A, B, C, m, k, n)).toBe(true);
  });

  it("rejects any single flipped entry", () => {
    for (let i = 0; i < C.length; i++) {
      const bad = C.slice();
      bad[i] += 1;
      expect(freivaldsRect(A, B, bad, m, k, n), `entry ${i}`).toBe(false);
    }
  });

  it("rejects mismatched shapes", () => {
    expect(freivaldsRect(A, B, C.slice(1), m, k, n)).toBe(false);
    expect(freivaldsRect(A, B, C, n, k, m)).toBe(false);
  });
});

describe("tensorHash / inputHash", () => {
  const t: Tensor = { dtype: "i8", shape: [2, 3], data: [1, -2, 3, -128, 127, 0] };
  it("depends on dtype, shape and data", () => {
    const h = tensorHash(t);
    expect(tensorHash({ ...t, shape: [3, 2] })).not.toBe(h);
    expect(tensorHash({ ...t, dtype: "i32" })).not.toBe(h);
    expect(tensorHash({ ...t, data: [1, -2, 3, -128, 127, 1] })).not.toBe(h);
  });
  it("refuses a malformed tensor instead of wrapping it (i8 300 would encode like 44)", () => {
    expect(() => tensorHash({ ...t, data: [300, -2, 3, -128, 127, 0] })).toThrow(/malformed/);
    expect(() => tensorHash({ ...t, data: [1.5, -2, 3, -128, 127, 0] })).toThrow(/malformed/);
    expect(() => tensorHash({ ...t, data: [1] })).toThrow(/malformed/);
  });
  it("inputHash is independent of key order", () => {
    const u: Tensor = { dtype: "i32", shape: [1], data: [5] };
    expect(inputHash({ a: t, b: u })).toBe(inputHash({ b: u, a: t }));
    expect(inputHash({ a: t, b: u })).not.toBe(inputHash({ a: u, b: t }));
  });
});

describe("chainRoot binds σ, the inputs, the plan and every output", () => {
  const plan: SegmentSpec[] = [
    { idx: 0, kind: "gemm", op: "xw", inputs: ["in:X", "in:W"] },
    { idx: 1, kind: "elementwise", op: "relu", inputs: ["seg:0"] },
  ];
  const outs = ["a".repeat(64), "b".repeat(64)];
  const base = chainRoot("s".repeat(64), "i".repeat(64), plan, outs);

  it("changes with σ and the input hash", () => {
    expect(chainRoot("t".repeat(64), "i".repeat(64), plan, outs)).not.toBe(base);
    expect(chainRoot("s".repeat(64), "j".repeat(64), plan, outs)).not.toBe(base);
  });
  it("changes with any out-hash, and with swapped out-hashes", () => {
    expect(chainRoot("s".repeat(64), "i".repeat(64), plan, ["c".repeat(64), outs[1]])).not.toBe(base);
    expect(chainRoot("s".repeat(64), "i".repeat(64), plan, [outs[0], "c".repeat(64)])).not.toBe(base);
    expect(chainRoot("s".repeat(64), "i".repeat(64), plan, [outs[1], outs[0]])).not.toBe(base);
  });
  it("changes with an op, a kind or the input wiring", () => {
    const alt = (f: (p: SegmentSpec[]) => void) => {
      const p = structuredClone(plan);
      f(p);
      return chainRoot("s".repeat(64), "i".repeat(64), p, outs);
    };
    expect(alt((p) => (p[1].op = "gelu"))).not.toBe(base);
    expect(alt((p) => (p[1].kind = "opaque"))).not.toBe(base);
    expect(alt((p) => (p[0].inputs = ["in:W", "in:X"]))).not.toBe(base);
    expect(alt((p) => (p[1].inputs = ["in:X"]))).not.toBe(base);
  });
});

describe("checkCommitment and checkOpening", () => {
  // Toy two-segment job: acc = X·W + bias (gemm), Y = relu(acc) as i32 (elementwise).
  const [m, k, n] = [3, 4, 5];
  const X: Tensor = { dtype: "i8", shape: [m, k], data: ints(m * k, -128, 127) };
  const W: Tensor = { dtype: "i8", shape: [k, n], data: ints(k * n, -128, 127) };
  // Column 0 is negative everywhere, so relu changes acc and the two outputs hash differently.
  const bias: Tensor = { dtype: "i32", shape: [n], data: [-200_000, ...ints(n - 1, -1000, 1000)] };
  const inputs = { X, W, bias };
  const plan: SegmentSpec[] = [
    { idx: 0, kind: "gemm", op: "xw", inputs: ["in:X", "in:W", "in:bias"] },
    { idx: 1, kind: "elementwise", op: "relu", inputs: ["seg:0"] },
  ];
  const relu = (t: Tensor): Tensor => ({ dtype: "i32", shape: t.shape, data: t.data.map((v) => Math.max(v, 0)) });
  const ACC = { dtype: "i32" as const, shape: [m, n] };
  // The kernels take their dimensions from the job (m, k, n), never from the tensors' own shapes.
  const kernels: Record<string, SegmentKernel> = {
    xw: {
      sig: { ins: [{ dtype: "i8", shape: [m, k] }, { dtype: "i8", shape: [k, n] }, { dtype: "i32", shape: [n] }], out: ACC },
      gemm: ([x, w, b]) => ({ A: x.data, B: w.data, bias: b.data, m, k, n }),
    },
    relu: { sig: { ins: [ACC], out: ACC }, elementwise: ([a]) => relu(a) },
  };
  const open = (spec: SegmentSpec, tensors: SegmentOpening["tensors"], cm = c, ins: Record<string, Tensor> = inputs) =>
    checkOpening(spec, { idx: spec.idx, tensors }, cm, ins, kernels[spec.op]);
  const acc: Tensor = { ...ACC, data: gemm(X.data, W.data, bias.data, m, k, n) };
  const Y = relu(acc);
  const sigma = "ab".repeat(32);
  const c = makeCommitment(sigma, inputs, plan, [acc, Y]);

  it("an honest commitment binds; σ, inputs, wiring and result are each checked", () => {
    expect(checkCommitment(sigma, inputs, plan, c, Y, ACC)).toEqual({ ok: true });
    expect(checkCommitment("cd".repeat(32), inputs, plan, c, Y, ACC)).toMatchObject({ ok: false });
    expect(checkCommitment(sigma, { ...inputs, X: { ...X, data: X.data.map((v) => (v === 127 ? v : v + 1)) } }, plan, c, Y, ACC)).toMatchObject({ ok: false });
    expect(checkCommitment(sigma, inputs, [plan[0], { ...plan[1], inputs: ["in:X"] }], c, Y, ACC)).toMatchObject({ ok: false });
    expect(checkCommitment(sigma, inputs, plan, c, { ...Y, data: Y.data.map((v) => v + 1) }, ACC)).toMatchObject({ ok: false });
    const swapped = { ...c, segments: [c.segments[0], { idx: 1, outHash: c.segments[0].outHash }] };
    expect(checkCommitment(sigma, inputs, plan, swapped, Y, ACC)).toMatchObject({ ok: false });
    // A refusal, never a catch: no stage.
    expect((checkCommitment(sigma, inputs, plan, swapped, Y, ACC) as { stage?: string }).stage).toBeUndefined();
  });

  it("an honest opening passes for each kind", () => {
    expect(open(plan[0], { "seg:0": acc })).toEqual({ ok: true });
    expect(open(plan[1], { "seg:0": acc, "seg:1": Y })).toEqual({ ok: true });
  });

  it("a wrong gemm output committed is caught by Freivalds; a +p shift is caught by the range bound", () => {
    for (const shift of [1, P]) {
      const bad = { ...acc, data: acc.data.slice() };
      bad.data[4] += shift;
      const cBad = makeCommitment(sigma, inputs, plan, [bad, relu(bad)]);
      expect(open(plan[0], { "seg:0": bad }, cBad), `shift ${shift}`).toMatchObject({ ok: false, stage: "segment" });
    }
  });

  it("a wrong elementwise output is caught", () => {
    const badY = { ...Y, data: Y.data.map((v, i) => (i === 2 ? v + 1 : v)) };
    const cBad = makeCommitment(sigma, inputs, plan, [acc, badY]);
    expect(open(plan[1], { "seg:0": acc, "seg:1": badY }, cBad)).toMatchObject({
      ok: false,
      stage: "segment",
      reason: expect.stringMatching(/recomputed output differs/),
    });
  });

  it("served tensors must hash to the commitment, and job inputs never come from the node", () => {
    const other = { ...acc, data: acc.data.map((v) => v + 1) };
    expect(open(plan[1], { "seg:0": other, "seg:1": Y })).toMatchObject({
      ok: false,
      stage: "segment",
      reason: expect.stringMatching(/does not match the commitment/),
    });
    expect(open(plan[1], { "seg:1": Y })).toMatchObject({ ok: false, stage: "segment" });
    // A node-served `in:X` is ignored: the job's X is used, so the honest opening still passes and a forged X changes nothing.
    const forgedX = { ...X, data: X.data.map(() => 0) };
    expect(open(plan[0], { "seg:0": acc, "in:X": forgedX })).toEqual({ ok: true });
  });

  describe("exact shapes: a tensor whose data is right but whose shape lies is refused", () => {
    // The node commits to the lying tensor consistently (its hash is in the commitment), so only the shape rule stops it.
    const lying = (shape: number[]) => {
      const t: Tensor = { ...acc, shape };
      return { t, cm: makeCommitment(sigma, inputs, plan, [t, relu(t)]) };
    };

    it("a transposed gemm output [n, m] is caught", () => {
      const { t, cm } = lying([n, m]);
      expect(open(plan[0], { "seg:0": t }, cm)).toMatchObject({ ok: false, stage: "segment" });
    });

    it("a flattened gemm output [1, m·n] is caught", () => {
      const { t, cm } = lying([1, m * n]);
      expect(open(plan[0], { "seg:0": t }, cm)).toMatchObject({ ok: false, stage: "segment" });
    });

    it("a transposed or flattened tensor served to an elementwise segment, or as its output, is caught", () => {
      for (const shape of [[n, m], [1, m * n], [m * n]]) {
        const { t, cm } = lying(shape);
        expect(open(plan[1], { "seg:0": t, "seg:1": relu(t) }, cm), `input ${shape}`).toMatchObject({ ok: false, stage: "segment" });
        const outLie = { ...Y, shape };
        const cm2 = makeCommitment(sigma, inputs, plan, [acc, outLie]);
        expect(open(plan[1], { "seg:0": acc, "seg:1": outLie }, cm2), `output ${shape}`).toMatchObject({ ok: false, stage: "segment" });
      }
    });

    it("a bias of the wrong length is refused (the job's own data: no catch)", () => {
      for (const data of [bias.data.slice(1), [...bias.data, 0]]) {
        const ins = { ...inputs, bias: { dtype: "i32" as const, shape: [data.length], data } };
        const v = open(plan[0], { "seg:0": acc }, c, ins);
        expect(v).toMatchObject({ ok: false });
        expect((v as { stage?: string }).stage).toBeUndefined();
      }
      // And a kernel that builds a bias of the wrong length from a right-shaped input is refused too.
      const badKernel: SegmentKernel = { ...kernels.xw, gemm: ([x, w, b]) => ({ A: x.data, B: w.data, bias: b.data.slice(1), m, k, n }) };
      expect(checkOpening(plan[0], { idx: 0, tensors: { "seg:0": acc } }, c, inputs, badKernel)).toMatchObject({
        ok: false,
        reason: expect.stringMatching(/dimensions/),
      });
    });

    it("operands of the wrong shape (A transposed) are refused", () => {
      const ins = { ...inputs, X: { ...X, shape: [k, m] } };
      expect(open(plan[0], { "seg:0": acc }, c, ins)).toMatchObject({ ok: false });
    });

    it("the committed result must have the exact result shape", () => {
      for (const shape of [[n, m], [1, m * n]]) {
        const lie = { ...Y, shape };
        const cm = makeCommitment(sigma, inputs, plan, [acc, lie]);
        expect(checkCommitment(sigma, inputs, plan, cm, lie, ACC), `${shape}`).toMatchObject({ ok: false, reason: expect.stringMatching(/i32\[3×5\]/) });
      }
    });

    it("job inputs are checked against their signature", () => {
      const sigs = { X: { dtype: "i8" as const, shape: [m, k] }, W: { dtype: "i8" as const, shape: [k, n] }, bias: { dtype: "i32" as const, shape: [n] } };
      expect(checkInputs(inputs, sigs)).toBeNull();
      expect(checkInputs({ ...inputs, X: { ...X, shape: [k, m] } }, sigs)).toMatch(/input X/);
      expect(checkInputs({ ...inputs, W: { ...W, shape: [1, k * n] } }, sigs)).toMatch(/input W/);
      expect(checkInputs({ X, W }, sigs)).toMatch(/signature/);
    });
  });
});
