/**
 * int8-model (B-26 follow-up): L int8-mlp blocks chained through the general verifier. One block equals int8-mlp; an
 * honest L = 4 job settles; a planted wrong segment in a middle block is caught when drawn, at the rate the draw says;
 * a chain tamper is refused; the type is drawn only among agents ≥ 1.9.0; the largest jobs (L·d·h = 2¹⁷) are accepted
 * and their worst answer still checks within the 50 ms budget.
 */
import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import { chainRoot, checkOpening, makeCommitment, tensorHash, type SegmentOpening, type SegmentSpec, type Tensor, type TensorRef } from "../../../shared/verification.js";
import { INT8_MLP, executeInt8Mlp, gemmBias, randomInt8MlpInput } from "../../../shared/work-int8-mlp.js";
import { INT8_MODEL, executeInt8Model, int8ModelInputs, int8ModelKernel, int8ModelPlan, randomInt8ModelInput, validateInt8Model, type Int8ModelInput } from "../../../shared/work-int8-model.js";
import { buildApp } from "../src/app.js";
import { ANSWER_MAX_BYTES } from "../src/routes/v1/work.js";
import { createHash } from "node:crypto";
import { getD1 } from "../src/lib/storage.js";
import { generateToken } from "../src/middleware/auth.js";
import { creditUcld, getBalanceUcld } from "../src/services/balance.service.js";
import { announceNode, getNode, touchNode } from "../src/services/nodes.service.js";
import { answerChallenge, enqueueWorkJob, getActiveAssignment, getWorkJob, runAssignment, segmentDraw, sha256, submitWork } from "../src/services/jobs.service.js";
import { getWorkType, int8Model } from "../src/services/work-types.js";
import { ENV, user } from "./helpers/sampled.js";

async function modelNode(agentVersion: string | null = "1.9.0", workTypes = ["matmul", "int8-mlp", "int8-model"]) {
  const node = "0x" + randomBytes(20).toString("hex");
  await announceNode(node, { cpuThreads: 8, ramGB: 16, gpus: [], os: "test" }, 100, workTypes, undefined, agentVersion ? { agentVersion } : {});
  await getD1().prepare("UPDATE nodes SET payout = ? WHERE address = ?").bind("0x" + randomBytes(20).toString("hex"), node).run();
  return node;
}

/** Only `nodes` online, nothing else queued; enqueue and draw. */
async function nextJob(nodes: string[], input: Int8ModelInput = randomInt8ModelInput(Math.floor(Math.random() * 1e9))) {
  await getD1().prepare("UPDATE work_jobs SET status = 'failed' WHERE status IN ('queued','assigned')").run();
  await getD1().prepare("UPDATE nodes SET last_seen = 0").run();
  for (const n of nodes) await touchNode(n);
  const q = await enqueueWorkJob({ owner: user, workType: "int8-model", input });
  if (!q.ok) throw new Error(q.message);
  await runAssignment();
  return { jobId: q.jobId, priceUcld: q.priceUcld, job: (await getWorkJob(q.jobId))!, input };
}

/** [d = h, L] at L·d·h = LDH_MAX. */
const CORNERS = [128, 256].map((M) => [M, Math.floor(INT8_MODEL.LDH_MAX / (M * M))]);

function openings(plan: SegmentSpec[], outputs: Tensor[], segments: number[]): SegmentOpening[] {
  return segments.map((idx) => {
    const tensors: Partial<Record<TensorRef, Tensor>> = { [`seg:${idx}`]: outputs[idx] };
    for (const r of plan[idx].inputs) if (r.startsWith("seg:")) tensors[r] = outputs[Number(r.slice(4))];
    return { idx, tensors };
  });
}

/** Run the plan with segment `bad` one entry off, and everything after it computed from the wrong value. */
function plantWrong(x: Int8ModelInput, bad: number, delta: number): Tensor[] {
  const plan = int8ModelPlan(x);
  const ins = int8ModelInputs(x);
  const outs: Tensor[] = [];
  for (const spec of plan) {
    const k = int8ModelKernel(x, spec.op);
    const args = spec.inputs.map((r) => (r.startsWith("in:") ? ins[r.slice(3)] : outs[Number(r.slice(4))]));
    let t: Tensor;
    if (k.gemm) {
      const g = k.gemm(args);
      t = { ...k.sig.out, data: gemmBias(g.A, g.B, g.bias!, g.m, g.k, g.n) };
    } else t = k.elementwise!(args);
    if (spec.idx === bad) {
      const data = t.data.slice();
      data[0] = t.dtype === "i8" ? (data[0] + delta > 127 ? data[0] - delta : data[0] + delta) : data[0] + delta;
      t = { ...t, data };
    }
    outs.push(t);
  }
  return outs;
}

describe("int8-model executor and intake", () => {
  it("one block equals int8-mlp (the same result and the same segment outputs)", () => {
    const mlp = randomInt8MlpInput(42, 2, 8, 8);
    const { X, b, d, h, ...block } = mlp;
    const one = executeInt8Model({ b, d, h, X, blocks: [block] });
    const ref = executeInt8Mlp(mlp);
    expect(one.result).toEqual(ref.result);
    expect(one.outputs.map(tensorHash)).toEqual(ref.outputs.map(tensorHash));
  });

  it("chains: block ℓ+1 reads block ℓ's Y; the plan has 4·L segments wired that way", () => {
    const x = randomInt8ModelInput(3, 3);
    const plan = int8ModelPlan(x);
    expect(plan).toHaveLength(12);
    expect(plan[4].inputs).toEqual(["seg:3", "in:W1_1", "in:b1_1"]);
    expect(plan[7].inputs).toEqual(["seg:6", "seg:3"]);
    const { outputs } = executeInt8Model(x);
    const second = executeInt8Mlp({ b: x.b, d: x.d, h: x.h, X: outputs[3].data, ...x.blocks[1] });
    expect(outputs[7]).toEqual(second.result);
  });

  it("registered as a challenge type gated on 1.9.0; meter 2·b·d·h·L; samples max(3, L)", () => {
    const x = randomInt8ModelInput(1, 5);
    expect(getWorkType("int8-model")).toBe(int8Model);
    expect(int8Model).toMatchObject({ mode: "challenge", minAgent: "1.9.0" });
    expect(int8Model.meter(x)).toBe(2 * 4 * 16 * 32 * 5);
    expect([1, 4, 5, 8, 16].map((L) => int8Model.samples!(randomInt8ModelInput(1, L)))).toEqual([3, 4, 5, 8, 16]);
  });

  it("refuses 0 or 17 blocks, d or h above 256, L·d·h above 2¹⁷, and a bad block (named)", () => {
    const x = randomInt8ModelInput(1, 2);
    expect(validateInt8Model(x)).toBeNull();
    expect(validateInt8Model({ ...x, blocks: [] })).toMatch(/blocks must have/);
    expect(validateInt8Model({ ...x, blocks: new Array(17).fill(x.blocks[0]) })).toMatch(/blocks must have/);
    expect(validateInt8Model(randomInt8ModelInput(1, 1, 2, 72, 8))).toBeNull(); // above the old 64
    expect(validateInt8Model(randomInt8ModelInput(1, 1, 2, 264, 8))).toMatch(/d and h/);
    expect(validateInt8Model({ ...x, d: 256, h: 256, blocks: new Array(3).fill({}) })).toMatch(/L·d·h must be at most 131072/);
    expect(validateInt8Model({ ...x, d: 128, h: 136, blocks: new Array(8).fill({}) })).toMatch(/L·d·h/);
    expect(validateInt8Model({ ...x, blocks: [x.blocks[0], { ...x.blocks[1], m2: 0 }] })).toMatch(/^blocks\[1\]: m2/);
  });

  // The corners of L·d·h = LDH_MAX: the deepest at d = h = 128 and the widest at d = h = 256.
  it.each(CORNERS)("the largest job (d = h = %i, L = %i, b = 64, extreme values) is accepted", (M, L) => {
    const worst = (n: number) => new Array(n).fill(-128);
    const block = { W1: worst(M * M), b1: new Array(M).fill(-(2 ** 20)), W2: worst(M * M), b2: new Array(M).fill(-(2 ** 20)), m1: 32767, s1: 31, m2: 32767, s2: 31, lut: worst(256) };
    const x: Int8ModelInput = { b: INT8_MLP.B_MAX, d: M, h: M, X: worst(INT8_MLP.B_MAX * M), blocks: new Array(L).fill(block) };
    expect(validateInt8Model(x)).toBeNull();
    const bytes = JSON.stringify(x).length;
    console.log(`[B-26] largest int8-model input (d = h = ${M}, L = ${L}): ${(bytes / 1e6).toFixed(2)} MB of JSON`);
    expect(bytes).toBeLessThan(1_500_000);
  });
});

describe("int8-model worst-case answer at L·d·h = 2¹⁷ (b = 64)", () => {
  it.each(CORNERS)("d = h = %i, L = %i: the largest answer fits the answer cap, and checking it stays under 50 ms", (M, L) => {
    const x = randomInt8ModelInput(21, L, INT8_MLP.B_MAX, M, M);
    const s = int8Model.samples!(x);
    expect(s).toBe(Math.max(3, L));
    const plan = int8ModelPlan(x);
    const { outputs } = executeInt8Model(x);
    const c = makeCommitment("ab".repeat(32), int8ModelInputs(x), plan, outputs);
    // Size: the heaviest openings are rq2_res (an i32 and two i8 tensors), then the gemms; entries at their widest JSON form.
    const widest = (t: Tensor): Tensor => ({ ...t, data: t.data.map(() => (t.dtype === "i8" ? -128 : -(2 ** 23 - 1))) });
    const byWeight = [...plan.filter((q) => q.op.startsWith("rq2_res")), ...plan.filter((q) => q.kind === "gemm")].map((q) => q.idx).slice(0, s);
    const bytes = JSON.stringify({ jobId: "x".repeat(36), openings: openings(plan, outputs.map(widest), byWeight) }).length;
    console.log(`[B-26] largest int8-model answer (d = h = ${M}, L = ${L}): ${(bytes / 1e6).toFixed(2)} MB`);
    expect(bytes).toBeLessThan(ANSWER_MAX_BYTES);
    // Time: the s openings with the most gemms, best of 25 (the minimum excludes preemption under a loaded suite). Logged
    // too: with what answerChallenge does around them (the stored input's hash check and parse, its tensors and plan) —
    // ~18–25 ms run alone, but a loaded suite doubles wall and CPU time alike, so only the check is asserted, as before.
    const drawn = plan.filter((q) => q.kind === "gemm").map((q) => q.idx).slice(0, s);
    const os = openings(plan, outputs, drawn);
    const stored = JSON.stringify(x);
    const inputs = int8ModelInputs(x);
    const check = (y: Int8ModelInput, ins: Record<string, Tensor>) => {
      for (const o of os) expect(checkOpening(plan[o.idx], o, c, ins, int8ModelKernel(y, plan[o.idx].op))).toEqual({ ok: true });
    };
    const withLoad = () => {
      createHash("sha256").update(stored).digest("hex");
      const y = JSON.parse(stored) as Int8ModelInput;
      check(y, int8ModelInputs(y));
    };
    const best = (f: () => void) => {
      f();
      return Math.min(
        ...Array.from({ length: 25 }, () => {
          const t0 = performance.now();
          f();
          return performance.now() - t0;
        }),
      );
    };
    const ms = best(() => check(x, inputs));
    const loaded = best(withLoad);
    console.log(`[B-26] int8-model worst answer (${s} gemm openings, b=64 d=h=${M} L=${L}; best of 25): check ${ms.toFixed(1)} ms, with loading the input ${loaded.toFixed(1)} ms`);
    expect(ms).toBeLessThan(50);
  }, 120_000);
});

describe("int8-model: commit, challenge, answer", () => {
  let app: ReturnType<typeof buildApp>;
  beforeAll(async () => {
    await setupV1Db({ ...ENV, JWT_SECRET: "int8-model-test-key-".padEnd(40, "m"), CHALLENGE_TTL_SECONDS: "30" });
    app = buildApp({ runtime: "node" });
    await creditUcld(user, 1_000_000_000);
  });

  /** An honest L = 4 job of `node`, settled: 4 of 16 segments drawn and answered. */
  async function honest(node: string) {
    const { jobId, input } = await nextJob([node], randomInt8ModelInput(11, 4));
    const a = (await getActiveAssignment(node))!;
    expect(a).toMatchObject({ jobId, workType: "int8-model", n: 16 });
    const plan = int8ModelPlan(input);
    const { outputs, result } = executeInt8Model(input);
    const commitment = makeCommitment(a.sigma, int8ModelInputs(input), plan, outputs);
    const s = await submitWork(node, { jobId, commitment, result });
    if (!s.ok || !("challenge" in s)) throw new Error(JSON.stringify(s));
    expect(s.challenge.segments).toEqual(segmentDraw(jobId, a.sigma, commitment.chainRoot, 16, 4));
    const r = await answerChallenge(node, { jobId, openings: openings(plan, outputs, s.challenge.segments) });
    expect(r).toMatchObject({ ok: true, units: 2 * 4 * 16 * 32 * 4 });
    return { jobId, result };
  }

  it("honest L = 4: 4 of 16 segments drawn, then done, paid, sample_check 'passed'", async () => {
    const { jobId, result } = await honest(await modelNode());
    expect((await getWorkJob(jobId))!).toMatchObject({ status: "done", sample_check: "passed" });
    expect(JSON.parse((await getWorkJob(jobId))!.result_json!)).toEqual(result);
  });

  it("a planted wrong segment in a middle block is caught when drawn: claw, suspend, job failed, hold released", async () => {
    const node = await modelNode();
    const held = await honest(node);
    const { jobId, input } = await nextJob([node], randomInt8ModelInput(12, 4));
    const a = (await getActiveAssignment(node))!;
    const plan = int8ModelPlan(input);
    const bad = 6; // block 1's aw2 gemm
    let outs: Tensor[] = [];
    let c = null;
    for (let delta = 1; delta < 400 && !c; delta++) {
      outs = plantWrong(input, bad, delta);
      const cand = makeCommitment(a.sigma, int8ModelInputs(input), plan, outs);
      if (segmentDraw(jobId, a.sigma, cand.chainRoot, 16, 4).includes(bad)) c = cand;
    }
    expect(c).not.toBeNull();
    const before = await getBalanceUcld(user);
    const s = await submitWork(node, { jobId, commitment: c!, result: outs[15] });
    if (!s.ok || !("challenge" in s)) throw new Error(JSON.stringify(s));
    const r = await answerChallenge(node, { jobId, openings: openings(plan, outs, s.challenge.segments) });
    expect(r).toMatchObject({ ok: false, code: "unprocessable", message: expect.stringMatching(/sampled segment check failed \(segment 6/) });
    const job = (await getWorkJob(jobId))!;
    expect(job).toMatchObject({ status: "failed", sample_check: "failed" });
    expect(await getNode(node)).toMatchObject({ state: "suspended" });
    // The earlier honest job's held pay (lanes A and B) is clawed.
    const claws = await getD1().prepare("SELECT COUNT(*) AS c FROM reward_claws WHERE job_id = ?").bind(jobId).first<{ c: number }>();
    expect(claws!.c).toBe(2);
    const clawed = await getD1().prepare("SELECT COUNT(*) AS c FROM reward_entries WHERE job_id = ? AND status = 'clawed'").bind(held.jobId).first<{ c: number }>();
    expect(clawed!.c).toBe(2);
    expect(await getBalanceUcld(user)).toEqual({ balanceUcld: before.balanceUcld + job.price_ucld, heldUcld: before.heldUcld - job.price_ucld });
  });

  it("a given middle segment is drawn at s / 4L over 10,000 draws (L = 4: 4/16; L = 16: 16/64); up to 16 drawn, ± 1.5 %", () => {
    for (const [L, s] of [[4, 4], [16, 16]]) {
      let hits = 0;
      for (let i = 0; i < 10_000; i++) if (segmentDraw(`j${i}`, sha256(`s${i}`), sha256(`r${L}:${i}`), 4 * L, s).includes(6)) hits++;
      expect(Math.abs(hits / 10_000 - s / (4 * L)), `L=${L}`).toBeLessThanOrEqual(0.015);
    }
    // Up to 16 distinct sorted indices; 17 is refused.
    const d = segmentDraw("j", "s", "r", 64, 16);
    expect(new Set(d).size).toBe(16);
    expect([...d].sort((a, b) => a - b)).toEqual(d);
    expect(() => segmentDraw("j", "s", "r", 64, 17)).toThrow();
  }, 60_000);

  it("chain tamper is refused (422, re-queued, no claw): a block's wiring rewired to skip the previous block", async () => {
    const node = await modelNode();
    const { jobId, input } = await nextJob([node], randomInt8ModelInput(13, 2));
    const a = (await getActiveAssignment(node))!;
    const { outputs, result } = executeInt8Model(input);
    const plan = int8ModelPlan(input);
    plan[4].inputs = ["in:X", "in:W1_1", "in:b1_1"];
    const honest = makeCommitment(a.sigma, int8ModelInputs(input), int8ModelPlan(input), outputs);
    const c = { ...honest, chainRoot: chainRoot(a.sigma, honest.inputHash, plan, outputs.map(tensorHash)) };
    const r = await submitWork(node, { jobId, commitment: c, result });
    expect(r).toMatchObject({ ok: false, code: "unprocessable" });
    expect((await getWorkJob(jobId))!).toMatchObject({ status: "queued", commitment_json: null });
    const claws = await getD1().prepare("SELECT COUNT(*) AS c FROM reward_claws WHERE job_id = ?").bind(jobId).first<{ c: number }>();
    expect(claws!.c).toBe(0);
  });

  it("is drawn only among agents ≥ 1.9.0 advertising it; 1.8.0 (inline inputs) and unversioned nodes are not", async () => {
    const old = await modelNode("1.8.0");
    const unknown = await modelNode(null);
    for (let i = 0; i < 10; i++) expect((await nextJob([old, unknown])).job).toMatchObject({ status: "queued", node: null });
    const notAdvertising = await modelNode("1.9.0", ["matmul", "int8-mlp"]);
    expect((await nextJob([notAdvertising])).job).toMatchObject({ status: "queued", node: null });
    const fresh = await modelNode("1.9.0");
    for (let i = 0; i < 10; i++) expect((await nextJob([old, unknown, fresh])).job).toMatchObject({ status: "assigned", node: fresh });
  });

  it("POST /v1/jobs takes an int8-model body; a 17-block one is 400", async () => {
    const jwt = await generateToken(user);
    const post = (input: unknown) =>
      app.request("/v1/jobs", {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json", "cf-connecting-ip": "10.72.0.1" },
        body: JSON.stringify({ workType: "int8-model", input }),
      });
    expect((await post(randomInt8ModelInput(1, 2))).status).toBe(200);
    const x = randomInt8ModelInput(1, 1);
    expect((await post({ ...x, blocks: new Array(17).fill(x.blocks[0]) })).status).toBe(400);
  });
});
