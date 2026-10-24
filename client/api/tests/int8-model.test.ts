/**
 * int8-model (B-26 follow-up): L int8-mlp blocks chained through the general verifier. One block equals int8-mlp; an
 * honest L = 4 job settles; a planted wrong segment in a middle block is caught when drawn, at the rate the draw says;
 * a chain tamper is refused; the type is drawn only among agents ≥ 1.8.0; the largest job fits one D1 row.
 */
import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import { chainRoot, makeCommitment, tensorHash, type SegmentOpening, type SegmentSpec, type Tensor, type TensorRef } from "../../../shared/verification.js";
import { INT8_MLP, executeInt8Mlp, gemmBias, randomInt8MlpInput } from "../../../shared/work-int8-mlp.js";
import { INT8_MODEL, executeInt8Model, int8ModelInputs, int8ModelKernel, int8ModelPlan, randomInt8ModelInput, validateInt8Model, type Int8ModelInput } from "../../../shared/work-int8-model.js";
import { buildApp } from "../src/app.js";
import { getD1 } from "../src/lib/storage.js";
import { generateToken } from "../src/middleware/auth.js";
import { creditUcld, getBalanceUcld } from "../src/services/balance.service.js";
import { announceNode, getNode, touchNode } from "../src/services/nodes.service.js";
import { answerChallenge, enqueueWorkJob, getActiveAssignment, getWorkJob, runAssignment, segmentDraw, sha256, submitWork } from "../src/services/jobs.service.js";
import { getWorkType, int8Model } from "../src/services/work-types.js";
import { ENV, user } from "./helpers/sampled.js";

async function modelNode(agentVersion: string | null = "1.8.0", workTypes = ["matmul", "int8-mlp", "int8-model"]) {
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

  it("registered as a challenge type gated on 1.8.0; meter 2·b·d·h·L; samples 2 + ceil(L/4)", () => {
    const x = randomInt8ModelInput(1, 5);
    expect(getWorkType("int8-model")).toBe(int8Model);
    expect(int8Model).toMatchObject({ mode: "challenge", minAgent: "1.8.0" });
    expect(int8Model.meter(x)).toBe(2 * 4 * 16 * 32 * 5);
    expect([1, 4, 5, 8, 16].map((L) => int8Model.samples!(randomInt8ModelInput(1, L)))).toEqual([3, 3, 4, 4, 6]);
  });

  it("refuses 0 or 17 blocks, d or h above 64, and a bad block (named)", () => {
    const x = randomInt8ModelInput(1, 2);
    expect(validateInt8Model(x)).toBeNull();
    expect(validateInt8Model({ ...x, blocks: [] })).toMatch(/blocks must have/);
    expect(validateInt8Model({ ...x, blocks: new Array(17).fill(x.blocks[0]) })).toMatch(/blocks must have/);
    expect(validateInt8Model(randomInt8ModelInput(1, 1, 2, 72, 8))).toMatch(/d and h/);
    expect(validateInt8Model({ ...x, blocks: [x.blocks[0], { ...x.blocks[1], m2: 0 }] })).toMatch(/^blocks\[1\]: m2/);
  });

  it("the largest job (L = 16, b = 64, d = h = 64, extreme values) fits a D1 row (2 MB) with room to spare", () => {
    const L = INT8_MODEL.L_MAX;
    const M = INT8_MODEL.DIM_MAX;
    const worst = (n: number) => new Array(n).fill(-128);
    const block = { W1: worst(M * M), b1: new Array(M).fill(-(2 ** 20)), W2: worst(M * M), b2: new Array(M).fill(-(2 ** 20)), m1: 32767, s1: 31, m2: 32767, s2: 31, lut: worst(256) };
    const x: Int8ModelInput = { b: INT8_MLP.B_MAX, d: M, h: M, X: worst(INT8_MLP.B_MAX * M), blocks: new Array(L).fill(block) };
    expect(validateInt8Model(x)).toBeNull();
    const bytes = JSON.stringify(x).length;
    console.log(`[B-26] largest int8-model input: ${(bytes / 1e6).toFixed(2)} MB of JSON`);
    expect(bytes).toBeLessThan(1_000_000);
  });
});

describe("int8-model: commit, challenge, answer", () => {
  let app: ReturnType<typeof buildApp>;
  beforeAll(async () => {
    await setupV1Db({ ...ENV, JWT_SECRET: "int8-model-test-key-".padEnd(40, "m"), CHALLENGE_TTL_SECONDS: "30" });
    app = buildApp({ runtime: "node" });
    await creditUcld(user, 1_000_000_000);
  });

  /** An honest L = 4 job of `node`, settled: 3 of 16 segments drawn and answered. */
  async function honest(node: string) {
    const { jobId, input } = await nextJob([node], randomInt8ModelInput(11, 4));
    const a = (await getActiveAssignment(node))!;
    expect(a).toMatchObject({ jobId, workType: "int8-model", n: 16 });
    const plan = int8ModelPlan(input);
    const { outputs, result } = executeInt8Model(input);
    const commitment = makeCommitment(a.sigma, int8ModelInputs(input), plan, outputs);
    const s = await submitWork(node, { jobId, commitment, result });
    if (!s.ok || !("challenge" in s)) throw new Error(JSON.stringify(s));
    expect(s.challenge.segments).toEqual(segmentDraw(jobId, a.sigma, commitment.chainRoot, 16, 3));
    const r = await answerChallenge(node, { jobId, openings: openings(plan, outputs, s.challenge.segments) });
    expect(r).toMatchObject({ ok: true, units: 2 * 4 * 16 * 32 * 4 });
    return { jobId, result };
  }

  it("honest L = 4: 3 of 16 segments drawn, then done, paid, sample_check 'passed'", async () => {
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
      if (segmentDraw(jobId, a.sigma, cand.chainRoot, 16, 3).includes(bad)) c = cand;
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

  it("a given middle segment is drawn at s / 4L over 10,000 draws (L = 4: 3/16; L = 16: 6/64), ± 1.5 %", () => {
    for (const [L, s] of [[4, 3], [16, 6]]) {
      let hits = 0;
      for (let i = 0; i < 10_000; i++) if (segmentDraw(`j${i}`, sha256(`s${i}`), sha256(`r${L}:${i}`), 4 * L, s).includes(6)) hits++;
      expect(Math.abs(hits / 10_000 - s / (4 * L)), `L=${L}`).toBeLessThanOrEqual(0.015);
    }
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

  it("is drawn only among agents ≥ 1.8.0 advertising it; 1.7.0 and unversioned nodes are not", async () => {
    const old = await modelNode("1.7.0");
    const unknown = await modelNode(null);
    for (let i = 0; i < 10; i++) expect((await nextJob([old, unknown])).job).toMatchObject({ status: "queued", node: null });
    const notAdvertising = await modelNode("1.8.0", ["matmul", "int8-mlp"]);
    expect((await nextJob([notAdvertising])).job).toMatchObject({ status: "queued", node: null });
    const fresh = await modelNode("1.8.0");
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
