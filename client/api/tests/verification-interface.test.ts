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
  checkOpening,
  inputHash,
  makeCommitment,
  tensorHash,
  type SegmentKernel,
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
  const kernel: SegmentKernel = {
    gemm: ([x, w, b]) => ({ A: x.data, B: w.data, bias: b.data, m: x.shape[0], k: x.shape[1], n: w.shape[1] }),
    elementwise: ([acc]) => relu(acc),
  };
  const acc: Tensor = { dtype: "i32", shape: [m, n], data: gemm(X.data, W.data, bias.data, m, k, n) };
  const Y = relu(acc);
  const sigma = "ab".repeat(32);
  const c = makeCommitment(sigma, inputs, plan, [acc, Y]);

  it("an honest commitment binds; σ, inputs, wiring and result are each checked", () => {
    expect(checkCommitment(sigma, inputs, plan, c, Y)).toEqual({ ok: true });
    expect(checkCommitment("cd".repeat(32), inputs, plan, c, Y)).toMatchObject({ ok: false });
    expect(checkCommitment(sigma, { ...inputs, X: { ...X, data: X.data.map((v) => (v === 127 ? v : v + 1)) } }, plan, c, Y)).toMatchObject({ ok: false });
    expect(checkCommitment(sigma, inputs, [plan[0], { ...plan[1], inputs: ["in:X"] }], c, Y)).toMatchObject({ ok: false });
    expect(checkCommitment(sigma, inputs, plan, c, { ...Y, data: Y.data.map((v) => v + 1) })).toMatchObject({ ok: false });
    const swapped = { ...c, segments: [c.segments[0], { idx: 1, outHash: c.segments[0].outHash }] };
    expect(checkCommitment(sigma, inputs, plan, swapped, Y)).toMatchObject({ ok: false });
    // A refusal, never a catch: no stage.
    expect((checkCommitment(sigma, inputs, plan, swapped, Y) as { stage?: string }).stage).toBeUndefined();
  });

  it("an honest opening passes for each kind", () => {
    expect(checkOpening(plan[0], { idx: 0, tensors: { "seg:0": acc } }, c, inputs, kernel)).toEqual({ ok: true });
    expect(checkOpening(plan[1], { idx: 1, tensors: { "seg:0": acc, "seg:1": Y } }, c, inputs, kernel)).toEqual({ ok: true });
  });

  it("a wrong gemm output committed is caught by Freivalds; a +p shift is caught by the range bound", () => {
    for (const shift of [1, P]) {
      const bad = { ...acc, data: acc.data.slice() };
      bad.data[4] += shift;
      const cBad = makeCommitment(sigma, inputs, plan, [bad, relu(bad)]);
      const v = checkOpening(plan[0], { idx: 0, tensors: { "seg:0": bad } }, cBad, inputs, kernel);
      expect(v, `shift ${shift}`).toMatchObject({ ok: false, stage: "segment" });
    }
  });

  it("a wrong elementwise output is caught", () => {
    const badY = { ...Y, data: Y.data.map((v, i) => (i === 2 ? v + 1 : v)) };
    const cBad = makeCommitment(sigma, inputs, plan, [acc, badY]);
    expect(checkOpening(plan[1], { idx: 1, tensors: { "seg:0": acc, "seg:1": badY } }, cBad, inputs, kernel)).toMatchObject({
      ok: false,
      stage: "segment",
      reason: expect.stringMatching(/recomputed output differs/),
    });
  });

  it("served tensors must hash to the commitment, and job inputs never come from the node", () => {
    const other = { ...acc, data: acc.data.map((v) => v + 1) };
    expect(checkOpening(plan[1], { idx: 1, tensors: { "seg:0": other, "seg:1": Y } }, c, inputs, kernel)).toMatchObject({
      ok: false,
      stage: "segment",
      reason: expect.stringMatching(/does not match the commitment/),
    });
    expect(checkOpening(plan[1], { idx: 1, tensors: { "seg:1": Y } }, c, inputs, kernel)).toMatchObject({ ok: false, stage: "segment" });
    // A node-served `in:X` is ignored: the job's X is used, so the honest opening still passes and a forged X changes nothing.
    const forgedX = { ...X, data: X.data.map(() => 0) };
    expect(checkOpening(plan[0], { idx: 0, tensors: { "seg:0": acc, "in:X": forgedX } }, c, inputs, kernel)).toEqual({ ok: true });
  });
});
