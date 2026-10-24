/**
 * Challenge-mode verification (ENGINEERING_BACKLOG B-26, Phase 0 step 5) on int8-mlp: commit, then challenge, then
 * answer. A commitment that does not bind is refused (no claw); a wrong, mismatched or late opening is caught: the
 * job fails, the owner's hold is released, all held pay of the node's payout wallet is clawed and the node suspended.
 */
import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import { privateKeyToAccount, generatePrivateKey, type PrivateKeyAccount } from "viem/accounts";
import { chainRoot, inputHash, makeCommitment, tensorHash, type Commitment, type SegmentOpening, type Tensor, type TensorRef } from "../../../shared/verification.js";
import { executeInt8Mlp, gemmBias, int8MlpInputs, int8MlpKernel, int8MlpPlan, randomInt8MlpInput, type Int8MlpInput } from "../../../shared/work-int8-mlp.js";
import { buildApp } from "../src/app.js";
import { getD1 } from "../src/lib/storage.js";
import { generateToken } from "../src/middleware/auth.js";
import { nodeSigningMessage } from "../src/middleware/node-auth.js";
import { creditUcld, getBalanceUcld } from "../src/services/balance.service.js";
import { announceNode, getNode, touchNode, unbindOwnNode } from "../src/services/nodes.service.js";
import {
  answerChallenge,
  enqueueWorkJob,
  getActiveAssignment,
  getWorkJob,
  runAssignment,
  segmentDraw,
  sha256,
  submitWork,
  sweepChallenges,
} from "../src/services/jobs.service.js";
import { epochOf } from "../src/services/ledger.service.js";
import { ENV, HOUR, entryStates, nextJob, setEnv, user } from "./helpers/sampled.js";

const SECRET = "segment-test-key-".padEnd(40, "s");
const PLAN = int8MlpPlan();

/** A node on agent 1.7.0 doing matmul and int8-mlp, bound to `payout`. */
async function int8Node(payout = "0x" + randomBytes(20).toString("hex")) {
  const node = "0x" + randomBytes(20).toString("hex");
  await announceNode(node, { cpuThreads: 8, ramGB: 16, gpus: [], os: "test" }, 100, ["matmul", "int8-mlp"], undefined, { agentVersion: "1.7.0" });
  await getD1().prepare("UPDATE nodes SET payout = ? WHERE address = ?").bind(payout, node).run();
  await touchNode(node);
  return { node, payout };
}

/** Enqueue an int8-mlp job and let `node` draw it as the only node online with nothing else queued. */
async function nextInt8Job(node: string, input: Int8MlpInput = randomInt8MlpInput(Math.floor(Math.random() * 1e9))) {
  await getD1().prepare("UPDATE work_jobs SET status = 'failed' WHERE status = 'queued'").run();
  await getD1().prepare("UPDATE nodes SET last_seen = 0 WHERE address <> ?").bind(node).run();
  await touchNode(node);
  const q = await enqueueWorkJob({ owner: user, workType: "int8-mlp", input });
  if (!q.ok) throw new Error(q.message);
  await runAssignment();
  const a = await getActiveAssignment(node);
  expect(a?.jobId).toBe(q.jobId);
  return { jobId: q.jobId, sigma: a!.sigma, input: a!.input as Int8MlpInput, priceUcld: q.priceUcld };
}

function openings(outputs: Tensor[], segments: number[]): SegmentOpening[] {
  return segments.map((idx) => {
    const tensors: Partial<Record<TensorRef, Tensor>> = { [`seg:${idx}`]: outputs[idx] };
    for (const r of PLAN[idx].inputs) if (r.startsWith("seg:")) tensors[r] = outputs[Number(r.slice(4))];
    return { idx, tensors };
  });
}

/** Run the plan, but make segment `bad` wrong (one entry off) and compute everything after it from the wrong value. */
function plantWrong(x: Int8MlpInput, bad: number, delta: number): Tensor[] {
  const ins = int8MlpInputs(x);
  const outs: Tensor[] = [];
  for (const spec of PLAN) {
    const k = int8MlpKernel(x, spec.op);
    const args = spec.inputs.map((r) => (r.startsWith("in:") ? ins[r.slice(3)] : outs[Number(r.slice(4))]));
    let t: Tensor;
    if (k.gemm) {
      const g = k.gemm(args);
      t = { ...k.sig.out, data: gemmBias(g.A, g.B, g.bias!, g.m, g.k, g.n) };
    } else t = k.elementwise!(args);
    if (spec.idx === bad) {
      const data = t.data.slice();
      // Stay in range: an elementwise output is i8.
      data[0] = t.dtype === "i8" ? (data[0] + delta > 127 ? data[0] - delta : data[0] + delta) : data[0] + delta;
      t = { ...t, data };
    }
    outs.push(t);
  }
  return outs;
}

/** An earlier honest int8-mlp job of `node`: its pay is held (pending in a later epoch). Returns its id. */
async function heldJob(node: string): Promise<string> {
  const j = await nextInt8Job(node);
  const { outputs, result } = executeInt8Mlp(j.input);
  const s = await submitWork(node, { jobId: j.jobId, commitment: makeCommitment(j.sigma, int8MlpInputs(j.input), PLAN, outputs), result });
  if (!s.ok || !("challenge" in s)) throw new Error(JSON.stringify(s));
  const r = await answerChallenge(node, { jobId: j.jobId, openings: openings(outputs, s.challenge.segments) });
  expect(r).toMatchObject({ ok: true });
  return j.jobId;
}

async function expectCaught(node: string, payout: string, jobId: string, held: string, before: { balanceUcld: number; heldUcld: number }) {
  const job = (await getWorkJob(jobId))!;
  expect(job).toMatchObject({ status: "failed", sample_check: "failed", result_json: null, challenge_expires_at: null, expires_at: null });
  expect(await getNode(node)).toMatchObject({ state: "suspended", state_reason: `sampled segment check failed on job ${jobId}` });
  // Wallet-wide: the earlier job's held pay is clawed; the caught job booked nothing.
  expect((await entryStates([held, jobId]))).toEqual({ [held]: ["A:clawed", "B:clawed", "treasury:pending"], [jobId]: [] });
  const claws = await getD1().prepare("SELECT COUNT(*) AS c FROM reward_claws WHERE job_id = ?").bind(jobId).first<{ c: number }>();
  expect(claws!.c).toBe(2);
  // The owner is not charged: the job's hold went back to spendable.
  expect(await getBalanceUcld(user)).toEqual({ balanceUcld: before.balanceUcld + job.price_ucld, heldUcld: before.heldUcld - job.price_ucld });
  void payout;
}

describe("segmentDraw: a keyed draw over the commitment", () => {
  beforeAll(() => setupV1Db({ ...ENV, JWT_SECRET: SECRET }));

  it("draws s distinct sorted indices, uniform over the 6 pairs of 4 (100,000 draws, ± 0.5 %)", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 100_000; i++) {
      const d = segmentDraw(`job-${i}`, sha256(`sigma:${i}`), sha256(`root:${i}`), 4, 2);
      expect(d.length).toBe(2);
      expect(d[0]).toBeLessThan(d[1]);
      counts.set(d.join(","), (counts.get(d.join(",")) ?? 0) + 1);
    }
    expect(counts.size).toBe(6);
    for (const c of counts.values()) expect(Math.abs(c / 100_000 - 1 / 6)).toBeLessThanOrEqual(0.005);
  }, 60_000);

  it("opens a given index at ½ ± 2 % over 10,000 draws (one wrong segment is caught with p = ½ per job)", () => {
    for (let idx = 0; idx < 4; idx++) {
      let hits = 0;
      for (let i = 0; i < 10_000; i++) if (segmentDraw(`j${i}`, sha256(`s${i}`), sha256(`r${idx}:${i}`), 4, 2).includes(idx)) hits++;
      expect(Math.abs(hits / 10_000 - 0.5), `index ${idx}`).toBeLessThanOrEqual(0.02);
    }
  });

  it("changes with the chain root, σ and the key; refuses impossible draws", () => {
    const base = Array.from({ length: 200 }, (_, i) => segmentDraw("j", "s", sha256(`r${i}`), 4, 2).join());
    expect(new Set(base).size).toBe(6);
    const bySigma = Array.from({ length: 200 }, (_, i) => segmentDraw("j", sha256(`s${i}`), "r", 4, 2).join());
    expect(new Set(bySigma).size).toBe(6);
    const one = segmentDraw("job", "sigma", "root", 4, 2);
    const changed = ["a", "b", "c", "d", "e", "f", "g", "h"].some((k) => {
      setEnv({ JWT_SECRET: `other-${k}`.padEnd(40, "o") });
      return segmentDraw("job", "sigma", "root", 4, 2).join() !== one.join();
    });
    setEnv({ JWT_SECRET: SECRET });
    expect(changed).toBe(true);
    expect(() => segmentDraw("j", "s", "r", 4, 5)).toThrow();
    expect(segmentDraw("j", "s", "r", 4, 4)).toEqual([0, 1, 2, 3]);
  });
});

describe("int8-mlp: commit, challenge, answer", () => {
  beforeAll(async () => {
    await setupV1Db({ ...ENV, JWT_SECRET: SECRET, CHALLENGE_TTL_SECONDS: "30" });
    await creditUcld(user, 1_000_000_000);
  });

  it("honest: the draw only after the commitment is stored; then done, paid, held 24 h, sample_check 'passed'", async () => {
    const { node, payout } = await int8Node();
    const j = await nextInt8Job(node);
    // The assignment carries the input and nothing about the draw; the row has no draw yet.
    const a = (await getActiveAssignment(node))!;
    expect(Object.keys(a).sort()).toEqual(["expiresAt", "input", "jobId", "matrixA", "matrixB", "n", "sigma", "workType"]);
    expect(a).toMatchObject({ workType: "int8-mlp", n: j.input.d, matrixA: [], matrixB: [] });
    expect((await getWorkJob(j.jobId))!).toMatchObject({ commitment_json: null, challenge_json: null, challenge_expires_at: null });

    const { outputs, result } = executeInt8Mlp(j.input);
    const commitment = makeCommitment(j.sigma, int8MlpInputs(j.input), PLAN, outputs);
    const t = Date.now();
    const s = await submitWork(node, { jobId: j.jobId, commitment, result }, t);
    if (!s.ok || !("challenge" in s)) throw new Error(JSON.stringify(s));
    const { segments, deadline } = s.challenge;
    expect(segments).toEqual(segmentDraw(j.jobId, j.sigma, commitment.chainRoot, 4, 2));
    expect(deadline).toBe(t + 30_000);
    const row = (await getWorkJob(j.jobId))!;
    expect(row).toMatchObject({ status: "assigned", cert_z: commitment.chainRoot, challenge_expires_at: deadline, expires_at: deadline });
    expect(JSON.parse(row.challenge_json!)).toEqual(segments);
    expect(JSON.parse(row.commitment_json!)).toEqual(commitment);
    // An open challenge is not handed out again, nor re-queued by the assignment sweep.
    expect(await getActiveAssignment(node)).toBeNull();
    await runAssignment(deadline + 1);
    expect((await getWorkJob(j.jobId))!.status).toBe("assigned");

    const before = await getBalanceUcld(user);
    const r = await answerChallenge(node, { jobId: j.jobId, openings: openings(outputs, segments) }, t + 1000);
    expect(r).toMatchObject({ ok: true, units: 2 * j.input.b * j.input.d * j.input.h });
    if (!r.ok) throw new Error();
    expect(r.heldUntil).toBeGreaterThanOrEqual(t + 1000 + 24 * HOUR);
    expect((await getWorkJob(j.jobId))!).toMatchObject({ status: "done", sample_check: "passed", fee_captured_at: t + 1000 });
    expect(JSON.parse((await getWorkJob(j.jobId))!.result_json!)).toEqual(result);
    expect(await entryStates([j.jobId])).toEqual({ [j.jobId]: ["A:pending", "B:pending", "treasury:pending"] });
    const entries = await getD1().prepare("SELECT DISTINCT epoch, work_type FROM reward_entries WHERE job_id = ?").bind(j.jobId).all<{ epoch: number; work_type: string }>();
    expect(entries.results).toEqual([{ epoch: epochOf(t + 1000 + 24 * HOUR) + 1, work_type: "int8-mlp" }]);
    expect(await getBalanceUcld(user)).toEqual({ balanceUcld: before.balanceUcld, heldUcld: before.heldUcld - j.priceUcld });
    expect(await getNode(node)).toMatchObject({ state: "active", jobs_done: 1, jobs_failed: 0 });
    void payout;
  });

  it("a second submit for the same assignment is 409 (one commitment per assignment)", async () => {
    const { node } = await int8Node();
    const j = await nextInt8Job(node);
    const { outputs, result } = executeInt8Mlp(j.input);
    const c = makeCommitment(j.sigma, int8MlpInputs(j.input), PLAN, outputs);
    const s = await submitWork(node, { jobId: j.jobId, commitment: c, result });
    expect(s).toMatchObject({ ok: true, challenge: expect.anything() });
    const stored = (await getWorkJob(j.jobId))!.challenge_json;
    // Re-submitting (any commitment: honest again, or ground for a better draw) changes nothing.
    const other = { ...c, segments: c.segments.map((x, i) => (i === 0 ? { idx: 0, outHash: "0".repeat(64) } : x)) };
    for (const again of [c, other]) {
      expect(await submitWork(node, { jobId: j.jobId, commitment: again, result })).toEqual({
        ok: false,
        code: "conflict",
        message: "a commitment was already submitted for this assignment",
      });
    }
    expect((await getWorkJob(j.jobId))!.challenge_json).toBe(stored);
    // The stored challenge is still answerable.
    const segments = JSON.parse(stored!) as number[];
    expect(await answerChallenge(node, { jobId: j.jobId, openings: openings(outputs, segments) })).toMatchObject({ ok: true });
  });

  describe("chain-link tamper → 422 refused, re-queued, no claw, no draw", () => {
    const cases: [string, (j: Awaited<ReturnType<typeof nextInt8Job>>, outs: Tensor[], c: Commitment) => Commitment][] = [
      ["wrong chain root", (_j, _o, c) => ({ ...c, chainRoot: "ab".repeat(32) })],
      [
        "swapped out-hashes",
        (_j, _o, c) => ({ ...c, segments: [c.segments[0], { idx: 1, outHash: c.segments[2].outHash }, { idx: 2, outHash: c.segments[1].outHash }, c.segments[3]] }),
      ],
      [
        "a rewired plan",
        (j, o, c) => {
          const plan = int8MlpPlan();
          plan[3].inputs = ["seg:2", "in:W2"];
          return { ...c, chainRoot: chainRoot(j.sigma, c.inputHash, plan, o.map(tensorHash)) };
        },
      ],
      [
        "an input hash of the node's own X",
        (j, o) => makeCommitment(j.sigma, { ...int8MlpInputs(j.input), X: { dtype: "i8", shape: [j.input.b, j.input.d], data: j.input.X.map(() => 1) } }, PLAN, o),
      ],
      ["another σ", (j, o) => makeCommitment("ee".repeat(32), int8MlpInputs(j.input), PLAN, o)],
      ["a result that is not the last segment", (j, o) => makeCommitment(j.sigma, int8MlpInputs(j.input), PLAN, [...o.slice(0, 3), { ...o[3], data: o[3].data.map((v) => (v === 127 ? 126 : v + 1)) }])],
    ];
    for (const [name, tamper] of cases) {
      it(name, async () => {
        const { node } = await int8Node();
        const j = await nextInt8Job(node);
        const { outputs, result } = executeInt8Mlp(j.input);
        const c = tamper(j, outputs, makeCommitment(j.sigma, int8MlpInputs(j.input), PLAN, outputs));
        const r = await submitWork(node, { jobId: j.jobId, commitment: c, result });
        expect(r).toMatchObject({ ok: false, code: "unprocessable" });
        expect("challenge" in r).toBe(false);
        expect((await getWorkJob(j.jobId))!).toMatchObject({ status: "queued", attempts: 1, commitment_json: null, challenge_json: null, sample_check: null });
        expect(await getNode(node)).toMatchObject({ state: "active", jobs_failed: 1 });
        const claws = await getD1().prepare("SELECT COUNT(*) AS c FROM reward_claws WHERE job_id = ?").bind(j.jobId).first<{ c: number }>();
        expect(claws!.c).toBe(0);
      });
    }

    it("the commitment's input hash must be the job's own (not one the node chose)", () => {
      const x = randomInt8MlpInput(1);
      expect(inputHash(int8MlpInputs(x))).not.toBe(inputHash({ ...int8MlpInputs(x), X: { dtype: "i8", shape: [x.b, x.d], data: x.X.map(() => 0) } }));
    });
  });

  describe("a planted wrong segment is caught when drawn: claw wallet-wide, suspend, job failed, hold released", () => {
    for (const bad of [0, 1, 2, 3]) {
      it(`segment ${bad} (${PLAN[bad].op})`, async () => {
        const { node, payout } = await int8Node();
        const held = await heldJob(node);
        const j = await nextInt8Job(node);
        // The test knows the key: pick a wrong value whose commitment draws `bad` (a node cannot: it has no key).
        let outs: Tensor[] = [];
        let c: Commitment | null = null;
        for (let delta = 1; delta < 100 && !c; delta++) {
          outs = plantWrong(j.input, bad, delta);
          const cand = makeCommitment(j.sigma, int8MlpInputs(j.input), PLAN, outs);
          if (segmentDraw(j.jobId, j.sigma, cand.chainRoot, 4, 2).includes(bad)) c = cand;
        }
        expect(c).not.toBeNull();
        const before = await getBalanceUcld(user);
        const s = await submitWork(node, { jobId: j.jobId, commitment: c!, result: outs[3] });
        if (!s.ok || !("challenge" in s)) throw new Error(JSON.stringify(s));
        expect(s.challenge.segments).toContain(bad);
        const r = await answerChallenge(node, { jobId: j.jobId, openings: openings(outs, s.challenge.segments) });
        expect(r).toMatchObject({ ok: false, code: "unprocessable", message: expect.stringMatching(/^sampled segment check failed \(segment \d/) });
        await expectCaught(node, payout, j.jobId, held, before);
      });
    }

    it("a planted wrong segment that is not drawn passes (detection is ½ per job, the claw makes it negative-EV)", async () => {
      const { node } = await int8Node();
      const j = await nextInt8Job(node);
      let outs: Tensor[] = [];
      let c: Commitment | null = null;
      for (let delta = 1; delta < 100 && !c; delta++) {
        outs = plantWrong(j.input, 1, delta);
        const cand = makeCommitment(j.sigma, int8MlpInputs(j.input), PLAN, outs);
        if (!segmentDraw(j.jobId, j.sigma, cand.chainRoot, 4, 2).includes(1)) c = cand;
      }
      const s = await submitWork(node, { jobId: j.jobId, commitment: c!, result: outs[3] });
      if (!s.ok || !("challenge" in s)) throw new Error(JSON.stringify(s));
      // Every other segment is consistent with the wrong a1 (segment 2 is Freivalds-checked against the committed a1),
      // so only a draw that includes segment 1 catches it.
      expect(s.challenge.segments).not.toContain(1);
      expect(await answerChallenge(node, { jobId: j.jobId, openings: openings(outs, s.challenge.segments) })).toMatchObject({ ok: true });
    });
  });

  describe("opening mismatch → caught", () => {
    it("a served tensor that does not hash to the commitment", async () => {
      const { node, payout } = await int8Node();
      const held = await heldJob(node);
      const j = await nextInt8Job(node);
      const { outputs, result } = executeInt8Mlp(j.input);
      const s = await submitWork(node, { jobId: j.jobId, commitment: makeCommitment(j.sigma, int8MlpInputs(j.input), PLAN, outputs), result });
      if (!s.ok || !("challenge" in s)) throw new Error();
      const ops = openings(outputs, s.challenge.segments);
      const idx = s.challenge.segments[0];
      const t = ops[0].tensors[`seg:${idx}`]!;
      ops[0].tensors[`seg:${idx}`] = { ...t, data: t.data.map((v, i) => (i === 0 ? (v === 0 ? 1 : 0) : v)) };
      const before = await getBalanceUcld(user);
      expect(await answerChallenge(node, { jobId: j.jobId, openings: ops })).toMatchObject({
        ok: false,
        message: expect.stringMatching(/does not match the commitment/),
      });
      await expectCaught(node, payout, j.jobId, held, before);
    });

    it("opening other segments than the challenged ones", async () => {
      const { node, payout } = await int8Node();
      const held = await heldJob(node);
      const j = await nextInt8Job(node);
      const { outputs, result } = executeInt8Mlp(j.input);
      const s = await submitWork(node, { jobId: j.jobId, commitment: makeCommitment(j.sigma, int8MlpInputs(j.input), PLAN, outputs), result });
      if (!s.ok || !("challenge" in s)) throw new Error();
      const others = [0, 1, 2, 3].filter((i) => !s.challenge.segments.includes(i));
      const before = await getBalanceUcld(user);
      expect(await answerChallenge(node, { jobId: j.jobId, openings: openings(outputs, others) })).toMatchObject({
        ok: false,
        message: expect.stringMatching(/exactly the challenged segments/),
      });
      await expectCaught(node, payout, j.jobId, held, before);
    });
  });

  describe("challenge timeout → caught + claw", () => {
    it("an answer after the deadline", async () => {
      const { node, payout } = await int8Node();
      const held = await heldJob(node);
      const j = await nextInt8Job(node);
      const { outputs, result } = executeInt8Mlp(j.input);
      const t = Date.now();
      const s = await submitWork(node, { jobId: j.jobId, commitment: makeCommitment(j.sigma, int8MlpInputs(j.input), PLAN, outputs), result }, t);
      if (!s.ok || !("challenge" in s)) throw new Error();
      const before = await getBalanceUcld(user);
      const r = await answerChallenge(node, { jobId: j.jobId, openings: openings(outputs, s.challenge.segments) }, s.challenge.deadline + 1);
      expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/after the deadline/) });
      await expectCaught(node, payout, j.jobId, held, before);
    });

    it("no answer: sweepChallenges catches it after the deadline, not before", async () => {
      const { node, payout } = await int8Node();
      const held = await heldJob(node);
      const j = await nextInt8Job(node);
      const { outputs, result } = executeInt8Mlp(j.input);
      const t = Date.now();
      const s = await submitWork(node, { jobId: j.jobId, commitment: makeCommitment(j.sigma, int8MlpInputs(j.input), PLAN, outputs), result }, t);
      if (!s.ok || !("challenge" in s)) throw new Error();
      expect(await sweepChallenges(s.challenge.deadline - 1)).toBe(0);
      expect((await getWorkJob(j.jobId))!.status).toBe("assigned");
      const before = await getBalanceUcld(user);
      expect(await sweepChallenges(s.challenge.deadline + 1)).toBe(1);
      await expectCaught(node, payout, j.jobId, held, before);
      // A late answer then finds no open challenge.
      expect(await answerChallenge(node, { jobId: j.jobId, openings: openings(outputs, s.challenge.segments) })).toMatchObject({ ok: false, code: "conflict" });
    });
  });

  describe("unbinding mid-challenge evades nothing", () => {
    /** A node with held pay, and an open challenge on a second job. */
    async function openChallenge() {
      const { node, payout } = await int8Node();
      const held = await heldJob(node);
      const j = await nextInt8Job(node);
      const { outputs, result } = executeInt8Mlp(j.input);
      const s = await submitWork(node, { jobId: j.jobId, commitment: makeCommitment(j.sigma, int8MlpInputs(j.input), PLAN, outputs), result });
      if (!s.ok || !("challenge" in s)) throw new Error();
      expect((await getWorkJob(j.jobId))!.commit_payout).toBe(payout);
      return { node, payout, held, j, outputs, segments: s.challenge.segments, deadline: s.challenge.deadline };
    }

    it("the owner cannot unbind a node with an open challenge (409), and can once it is settled", async () => {
      const o = await openChallenge();
      expect(await unbindOwnNode(o.payout, o.node)).toEqual({ ok: false, code: "conflict", message: "finish or forfeit the open challenge first" });
      const res = await buildApp({ runtime: "node" }).request(`/v1/nodes/mine/${o.node}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${await generateToken(o.payout)}`, "cf-connecting-ip": "10.72.0.1" },
      });
      expect(res.status).toBe(409);
      expect((await getNode(o.node))!.payout).toBe(o.payout);
      expect(await answerChallenge(o.node, { jobId: o.j.jobId, openings: openings(o.outputs, o.segments) })).toMatchObject({ ok: true });
      expect(await unbindOwnNode(o.payout, o.node)).toMatchObject({ ok: true });
    });

    it("a payout cleared by another route, then no answer: the snapshot wallet is clawed and the node suspended", async () => {
      const o = await openChallenge();
      await getD1().prepare("UPDATE nodes SET payout = NULL, fleet_id = NULL, bound_at = NULL WHERE address = ?").bind(o.node).run();
      const before = await getBalanceUcld(user);
      expect(await sweepChallenges(o.deadline + 1)).toBe(1);
      await expectCaught(o.node, o.payout, o.j.jobId, o.held, before);
    });

    it("a payout cleared by another route, then a late answer: the same", async () => {
      const o = await openChallenge();
      await getD1().prepare("UPDATE nodes SET payout = NULL WHERE address = ?").bind(o.node).run();
      const before = await getBalanceUcld(user);
      expect(await answerChallenge(o.node, { jobId: o.j.jobId, openings: openings(o.outputs, o.segments) }, o.deadline + 1)).toMatchObject({ ok: false });
      await expectCaught(o.node, o.payout, o.j.jobId, o.held, before);
    });

    it("a payout moved to another wallet, then a wrong answer: the snapshot wallet is clawed, not the new one", async () => {
      const o = await openChallenge();
      const other = "0x" + randomBytes(20).toString("hex");
      await getD1().prepare("UPDATE nodes SET payout = ? WHERE address = ?").bind(other, o.node).run();
      const ops = openings(o.outputs, o.segments);
      const t = ops[0].tensors[`seg:${o.segments[0]}`]!;
      ops[0].tensors[`seg:${o.segments[0]}`] = { ...t, data: t.data.map((v, i) => (i === 0 ? (v === 0 ? 1 : 0) : v)) };
      const before = await getBalanceUcld(user);
      expect(await answerChallenge(o.node, { jobId: o.j.jobId, openings: ops })).toMatchObject({ ok: false });
      await expectCaught(o.node, o.payout, o.j.jobId, o.held, before);
    });

    it("an honest answer after the payout moved is paid to the wallet that committed", async () => {
      const o = await openChallenge();
      await getD1().prepare("UPDATE nodes SET payout = NULL WHERE address = ?").bind(o.node).run();
      expect(await answerChallenge(o.node, { jobId: o.j.jobId, openings: openings(o.outputs, o.segments) })).toMatchObject({ ok: true });
      const rows = await getD1().prepare("SELECT DISTINCT address FROM reward_entries WHERE job_id = ? AND lane = 'A'").bind(o.j.jobId).all<{ address: string }>();
      expect(rows.results).toEqual([{ address: o.payout }]);
    });
  });

  it("matmul jobs are untouched: same node, same submit, same answer as before", async () => {
    const { node } = await int8Node();
    const s = await nextJob(node);
    expect(await submitWork(node, s)).toMatchObject({ ok: true, units: 512 });
    expect((await getWorkJob(s.jobId))!).toMatchObject({ commitment_json: null, challenge_json: null, challenge_expires_at: null, input_json: null });
  });
});

describe("HTTP: POST /v1/jobs (int8-mlp), /v1/work/submit with a commitment, /v1/work/answer", () => {
  let app: ReturnType<typeof buildApp>;
  let ip = 0;
  const call = (path: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    headers.set("cf-connecting-ip", `10.71.0.${ip++ % 250}`);
    return app.request(path, { ...init, headers });
  };
  async function signed(acct: PrivateKeyAccount, path: string, payload: unknown) {
    const body = typeof payload === "string" ? payload : JSON.stringify(payload);
    const ts = String(Date.now());
    const nonce = randomBytes(16).toString("hex");
    const signature = await acct.signMessage({ message: nodeSigningMessage("POST", path, ts, body, nonce) });
    return call(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Node": acct.address, "X-Node-Timestamp": ts, "X-Nonce": nonce, "X-Node-Signature": signature },
      body,
    });
  }

  beforeAll(async () => {
    await setupV1Db({ ...ENV, JWT_SECRET: SECRET });
    app = buildApp({ runtime: "node" });
    await creditUcld(user, 1_000_000_000);
  });

  it("queues, assigns (input in the heartbeat assignment), challenges and settles", async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    const node = acct.address.toLowerCase();
    await announceNode(node, { cpuThreads: 8, ramGB: 16, gpus: [], os: "test" }, 100, ["matmul", "int8-mlp"], undefined, { agentVersion: "1.7.0" });
    await getD1().prepare("UPDATE nodes SET payout = ? WHERE address = ?").bind("0x" + "ab".repeat(20), node).run();
    await getD1().prepare("UPDATE nodes SET last_seen = 0 WHERE address <> ?").bind(node).run();
    await touchNode(node);

    const input = randomInt8MlpInput(77, 4, 16, 32);
    const jwt = await generateToken(user);
    const created = await call("/v1/jobs", {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ workType: "int8-mlp", input }),
    });
    const cb = (await created.json()) as { status: string; jobId: string; priceUcld: number };
    expect(created.status).toBe(200);
    expect(cb.status).toBe("success");

    const hb = await signed(acct, "/v1/nodes/heartbeat", { agentVersion: "1.7.0" });
    const assignment = ((await hb.json()) as { assignment: { jobId: string; sigma: string; input: Int8MlpInput; matrixA: number[] } }).assignment;
    expect(assignment).toMatchObject({ jobId: cb.jobId, workType: "int8-mlp", matrixA: [], matrixB: [], input });

    const { outputs, result } = executeInt8Mlp(assignment.input);
    const commitment = makeCommitment(assignment.sigma, int8MlpInputs(assignment.input), PLAN, outputs);
    const sub = await signed(acct, "/v1/work/submit", { jobId: cb.jobId, commitment, result });
    const sb = (await sub.json()) as { status: string; challenge: { segments: number[]; deadline: number } };
    expect(sub.status).toBe(200);
    expect(sb).toEqual({ status: "success", challenge: { segments: expect.any(Array), deadline: expect.any(Number) } });

    // A second commitment is 409; an oversized answer is 413 and changes nothing.
    expect((await signed(acct, "/v1/work/submit", { jobId: cb.jobId, commitment, result })).status).toBe(409);
    const huge = JSON.stringify({ jobId: cb.jobId, openings: [{ idx: 0, tensors: { "seg:0": { dtype: "i32", shape: [1], data: [0] } } }], pad: "x".repeat(1024 * 1024) });
    const tooBig = await signed(acct, "/v1/work/answer", huge);
    expect(tooBig.status).toBe(413);
    expect(((await tooBig.json()) as { error: { code: string } }).error.code).toBe("payload_too_large");
    expect((await getWorkJob(cb.jobId))!.status).toBe("assigned");
    // A tensor longer than the largest int8-mlp segment (64 × 256) is refused by the schema.
    const long = await signed(acct, "/v1/work/answer", { jobId: cb.jobId, openings: [{ idx: 0, tensors: { "seg:0": { dtype: "i32", shape: [1], data: new Array(64 * 256 + 1).fill(0) } } }] });
    expect(long.status).toBe(400);
    expect((await getWorkJob(cb.jobId))!.status).toBe("assigned");

    const ans = await signed(acct, "/v1/work/answer", { jobId: cb.jobId, openings: openings(outputs, sb.challenge.segments) });
    const ab = (await ans.json()) as Record<string, unknown>;
    expect(ans.status).toBe(200);
    expect(ab).toMatchObject({ status: "success", units: 2 * 4 * 16 * 32, earned: { laneAUcld: expect.any(Number), laneBUcld: expect.any(Number) } });

    const got = await call(`/v1/jobs/${cb.jobId}`, { headers: { Authorization: `Bearer ${jwt}` } });
    const gb = (await got.json()) as { job: { status: string; workType: string; n: number; result: number[]; certificate: { z: string } } };
    expect(gb.job).toMatchObject({ status: "done", workType: "int8-mlp", n: 16, result: result.data, certificate: { z: commitment.chainRoot } });
  });

  it("an oversized body is 413 before the signature check and before any parsing (submit and answer)", async () => {
    // Unsigned, not even JSON: a 413 here means neither requireNode (401) nor the JSON parser (400) ran.
    for (const [path, size] of [["/v1/work/answer", 1024 * 1024 + 1], ["/v1/work/submit", 8 * 1024 * 1024 + 1]] as const) {
      const declared = await call(path, { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": String(size) }, body: "{".repeat(size) });
      expect(declared.status, path).toBe(413);
      // Streamed without a Content-Length: counted while reading, stopped at the cap.
      const bytes = new TextEncoder().encode("{".repeat(size));
      const stream = new ReadableStream<Uint8Array>({
        start(ctl) {
          for (let i = 0; i < bytes.length; i += 65536) ctl.enqueue(bytes.subarray(i, i + 65536));
          ctl.close();
        },
      });
      const streamed = await call(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
      expect(streamed.status, `${path} streamed`).toBe(413);
    }
    // Under the cap the same garbage reaches the signature check.
    expect((await call("/v1/work/answer", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" })).status).toBe(401);
  });

  it("refuses an int8-mlp job outside the bounds (400), and a matmul body still validates as before", async () => {
    const jwt = await generateToken(user);
    const bad = await call("/v1/jobs", {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ workType: "int8-mlp", input: { ...randomInt8MlpInput(1), b: 65 } }),
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { message: string } }).error.message).toMatch(/b must be/);
    const acct = privateKeyToAccount(generatePrivateKey());
    await announceNode(acct.address.toLowerCase(), { cpuThreads: 8, ramGB: 16, gpus: [], os: "test" }, 100, ["matmul"]);
    const res = await signed(acct, "/v1/work/submit", { jobId: "x" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe("certificate: Required");
  });
});
