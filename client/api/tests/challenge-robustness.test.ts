/**
 * Challenge-mode robustness (PR #60 review): a lost response never gets an honest node clawed, the sweep is cheap,
 * isolated per job and has a grace window, a commitment cannot bind a replaced σ, a catch releases the owner's hold in
 * the same batch, a body of the wrong kind is a 400, and answers are rate limited per node.
 */
import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { privateKeyToAccount, generatePrivateKey, type PrivateKeyAccount } from "viem/accounts";

// release() throws when armed: a catch must not depend on a separate write after its batch.
const trap = vi.hoisted(() => ({ releaseThrows: false }));
vi.mock("../src/services/balance.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/balance.service.js")>();
  return {
    ...actual,
    release: async (address: string, ucld: number) => {
      if (trap.releaseThrows) throw new Error("D1 error after the batch");
      return actual.release(address, ucld);
    },
  };
});

import { makeCommitment, type Tensor } from "../../../shared/verification.js";
import { executeInt8Mlp, int8MlpInputs, int8MlpPlan, randomInt8MlpInput, type Int8MlpInput } from "../../../shared/work-int8-mlp.js";
import { runChallengeJob } from "../../../node-agent/src/work.ts";
import { solveAssignedJob } from "../../../pouw/src/index.js";
import { buildApp } from "../src/app.js";
import { getD1 } from "../src/lib/storage.js";
import { getSqlite } from "../src/lib/sqlite.js";
import { nodeSigningMessage } from "../src/middleware/node-auth.js";
import { creditUcld, getBalanceUcld } from "../src/services/balance.service.js";
import { announceNode, getNode, touchNode } from "../src/services/nodes.service.js";
import {
  SWEEP_GRACE_MS,
  answerChallenge,
  enqueueWorkJob,
  getActiveAssignment,
  getWorkJob,
  runAssignment,
  submitWork,
  sweepChallenges,
} from "../src/services/jobs.service.js";
import { ENV, user } from "./helpers/sampled.js";

const PLAN = int8MlpPlan();

async function int8Node(node = "0x" + randomBytes(20).toString("hex")) {
  const payout = "0x" + randomBytes(20).toString("hex");
  await announceNode(node, { cpuThreads: 8, ramGB: 16, gpus: [], os: "test" }, 100, ["matmul", "int8-mlp"], undefined, { agentVersion: "1.7.0" });
  await getD1().prepare("UPDATE nodes SET payout = ? WHERE address = ?").bind(payout, node).run();
  await touchNode(node);
  return { node, payout };
}

async function nextJob(node: string, workType: "int8-mlp" | "matmul" = "int8-mlp") {
  // Nothing else queued, and nothing an expiry could re-queue ahead of this job.
  await getD1().prepare("UPDATE work_jobs SET status = 'failed' WHERE status = 'queued' OR (status = 'assigned' AND challenge_expires_at IS NULL)").run();
  await getD1().prepare("UPDATE nodes SET last_seen = 0 WHERE address <> ?").bind(node).run();
  await touchNode(node);
  const q =
    workType === "int8-mlp"
      ? await enqueueWorkJob({ owner: user, workType, input: randomInt8MlpInput(Math.floor(Math.random() * 1e9)) })
      : await enqueueWorkJob({ owner: user, workType, n: 8, matrixA: new Array(64).fill(3), matrixB: new Array(64).fill(-2) });
  if (!q.ok) throw new Error(q.message);
  await runAssignment();
  const a = (await getActiveAssignment(node))!;
  expect(a.jobId).toBe(q.jobId);
  return { jobId: q.jobId, sigma: a.sigma, input: a.input as Int8MlpInput };
}

const lostResponse = () => Object.assign(new Error("socket hang up"), { lost: true });
const retryable = (e: unknown) => (e as { lost?: boolean }).lost === true;

beforeAll(async () => {
  await setupV1Db({ ...ENV, JWT_SECRET: "robustness-key-".padEnd(40, "r"), CHALLENGE_TTL_SECONDS: "30" });
  await creditUcld(user, 1_000_000_000);
});

describe("a lost response never gets an honest node clawed", () => {
  it("submit performed but its response lost → the agent re-submits, gets the same challenge, and the answer pays", async () => {
    const { node } = await int8Node();
    const j = await nextJob(node);
    const challenges: unknown[] = [];
    let submits = 0;
    const post = async (path: string, body: any) => {
      if (path === "/v1/work/submit") {
        const r = await submitWork(node, body);
        challenges.push(r);
        if (++submits === 1) throw lostResponse(); // the API stored it; the node never heard back
        if (!r.ok) throw Object.assign(new Error((r as { message: string }).message), { status: 409 });
        return r;
      }
      const r = await answerChallenge(node, body);
      if (!r.ok) throw Object.assign(new Error(r.message), { status: 422 });
      return r;
    };
    const earned = await runChallengeJob({ jobId: j.jobId, workType: "int8-mlp", sigma: j.sigma, input: j.input }, post, { retryable, sleep: async () => {} });
    expect(earned.laneAUcld).toBeGreaterThan(0);
    expect(challenges[1]).toEqual(challenges[0]); // the stored draw and deadline, not a new draw
    expect((await getWorkJob(j.jobId))!).toMatchObject({ status: "done", sample_check: "passed" });
    expect(await getNode(node)).toMatchObject({ state: "active", jobs_failed: 0 });
  });

  it("answer POSTs that fail on the network or with a 5xx are retried before the deadline, and the answer pays", async () => {
    const { node } = await int8Node();
    const j = await nextJob(node);
    let answers = 0;
    const post = async (path: string, body: any) => {
      if (path === "/v1/work/submit") return submitWork(node, body);
      answers++;
      if (answers === 1) throw lostResponse();
      if (answers === 2) throw Object.assign(new Error("HTTP 503"), { status: 503 });
      const r = await answerChallenge(node, body);
      if (!r.ok) throw Object.assign(new Error(r.message), { status: 422 });
      return r;
    };
    const earned = await runChallengeJob({ jobId: j.jobId, workType: "int8-mlp", sigma: j.sigma, input: j.input }, post, {
      retryable: (e) => retryable(e) || ((e as { status?: number }).status ?? 0) >= 500,
      sleep: async () => {},
    });
    expect(answers).toBe(3);
    expect(earned.laneAUcld).toBeGreaterThan(0);
    expect((await getWorkJob(j.jobId))!).toMatchObject({ status: "done", sample_check: "passed" });
  });
});

describe("the sweep", () => {
  it("has a 10 s grace; the answer path keeps the strict deadline", async () => {
    const { node } = await int8Node();
    const j = await nextJob(node);
    const { outputs, result } = executeInt8Mlp(j.input);
    const s = await submitWork(node, { jobId: j.jobId, commitment: makeCommitment(j.sigma, int8MlpInputs(j.input), PLAN, outputs), result });
    if (!s.ok || !("challenge" in s)) throw new Error();
    const late = s.challenge.deadline + 5000;
    expect(SWEEP_GRACE_MS).toBe(10_000);
    expect(await sweepChallenges(late)).toBe(0);
    expect((await getWorkJob(j.jobId))!.status).toBe("assigned");
    const opened = s.challenge.segments.map((idx) => {
      const tensors: Record<string, Tensor> = { [`seg:${idx}`]: outputs[idx] };
      for (const r of PLAN[idx].inputs) if (r.startsWith("seg:")) tensors[r] = outputs[Number(r.slice(4))];
      return { idx, tensors };
    });
    expect(await answerChallenge(node, { jobId: j.jobId, openings: opened }, late)).toMatchObject({ ok: false, message: expect.stringMatching(/after the deadline/) });
  });

  it("reads only the columns a catch needs, and one job that throws does not stop the batch", async () => {
    const make = async () => {
      const { node } = await int8Node();
      const j = await nextJob(node);
      const { outputs, result } = executeInt8Mlp(j.input);
      const s = await submitWork(node, { jobId: j.jobId, commitment: makeCommitment(j.sigma, int8MlpInputs(j.input), PLAN, outputs), result });
      if (!s.ok || !("challenge" in s)) throw new Error();
      return { node, jobId: j.jobId, deadline: s.challenge.deadline };
    };
    const broken = await make();
    const fine = await make();
    // The broken one expires first and cannot be caught (its owner is gone: normalizeAddress throws).
    await getD1().prepare("UPDATE work_jobs SET owner = NULL, challenge_expires_at = ? WHERE id = ?").bind(fine.deadline - 1, broken.jobId).run();
    const sqls: string[] = [];
    const db = getD1();
    const prepare = db.prepare.bind(db);
    const spy = vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
      sqls.push(sql);
      return prepare(sql);
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let caught: number;
    try {
      caught = await sweepChallenges(fine.deadline + SWEEP_GRACE_MS + 1);
    } finally {
      spy.mockRestore();
      errors.mockRestore();
    }
    expect(caught).toBe(1);
    expect((await getWorkJob(fine.jobId))!).toMatchObject({ status: "failed", sample_check: "failed" });
    expect((await getWorkJob(broken.jobId))!.status).toBe("assigned");
    const select = sqls.find((s) => s.includes("challenge_expires_at <"))!;
    expect(select).not.toMatch(/SELECT \*/);
    expect(select).not.toMatch(/input_json|result_json|commitment_json/);
    await getD1().prepare("UPDATE work_jobs SET status = 'failed' WHERE id = ?").bind(broken.jobId).run();
  });
});

describe("a commitment cannot bind a σ an expire-and-reassign replaced", () => {
  for (const [name, change] of [
    ["σ replaced between the check and the write", "UPDATE work_jobs SET sigma = 'replaced' WHERE id = ?"],
    ["assignment expired between the check and the write", "UPDATE work_jobs SET expires_at = 1 WHERE id = ?"],
  ] as const) {
    it(name, async () => {
      const { node } = await int8Node();
      const j = await nextJob(node);
      const { outputs, result } = executeInt8Mlp(j.input);
      const db = getD1();
      const prepare = db.prepare.bind(db);
      let raced = false;
      const spy = vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
        if (!raced && sql.startsWith("UPDATE work_jobs SET commitment_json")) {
          raced = true;
          getSqlite().prepare(change).run(j.jobId);
        }
        return prepare(sql);
      });
      let r;
      try {
        r = await submitWork(node, { jobId: j.jobId, commitment: makeCommitment(j.sigma, int8MlpInputs(j.input), PLAN, outputs), result });
      } finally {
        spy.mockRestore();
      }
      expect(raced).toBe(true);
      expect(r).toMatchObject({ ok: false, code: "conflict" });
      expect((await getWorkJob(j.jobId))!).toMatchObject({ commitment_json: null, challenge_json: null, challenge_expires_at: null });
    });
  }
});

describe("a catch releases the owner's hold in its own batch", () => {
  it("even when every write after the batch fails", async () => {
    const { node } = await int8Node();
    const j = await nextJob(node);
    const { outputs, result } = executeInt8Mlp(j.input);
    const s = await submitWork(node, { jobId: j.jobId, commitment: makeCommitment(j.sigma, int8MlpInputs(j.input), PLAN, outputs), result });
    if (!s.ok || !("challenge" in s)) throw new Error();
    const before = await getBalanceUcld(user);
    const price = (await getWorkJob(j.jobId))!.price_ucld;
    trap.releaseThrows = true;
    try {
      await answerChallenge(node, { jobId: j.jobId, openings: [] }).catch(() => undefined);
    } finally {
      trap.releaseThrows = false;
    }
    expect((await getWorkJob(j.jobId))!.status).toBe("failed");
    expect(await getBalanceUcld(user)).toEqual({ balanceUcld: before.balanceUcld + price, heldUcld: before.heldUcld - price });
    // A second catch of the same job releases nothing more.
    expect(await sweepChallenges(Date.now() + 10 * 60_000)).toBe(0);
    expect(await getBalanceUcld(user)).toEqual({ balanceUcld: before.balanceUcld + price, heldUcld: before.heldUcld - price });
  });
});

describe("a submit body of the wrong kind is a 400, not a failed check", () => {
  it("a certificate on an int8-mlp job, a commitment on a matmul job", async () => {
    const { node } = await int8Node();
    const j = await nextJob(node);
    const { certificate, result } = solveAssignedJob(j.sigma, new Array(64).fill(1), new Array(64).fill(1), 8, node, "dev");
    expect(await submitWork(node, { jobId: j.jobId, certificate, result })).toEqual({
      ok: false,
      code: "validation_failed",
      message: "this is a int8-mlp job: submit { jobId, commitment, result }",
    });
    expect((await getWorkJob(j.jobId))!).toMatchObject({ status: "assigned", attempts: 0 });

    const m = await nextJob(node, "matmul");
    const x = randomInt8MlpInput(1);
    const ex = executeInt8Mlp(x);
    expect(await submitWork(node, { jobId: m.jobId, commitment: makeCommitment(m.sigma, int8MlpInputs(x), PLAN, ex.outputs), result: ex.result })).toEqual({
      ok: false,
      code: "validation_failed",
      message: "this is a matmul job: submit { jobId, certificate, result }",
    });
    expect((await getWorkJob(m.jobId))!).toMatchObject({ status: "assigned", attempts: 0 });
    expect(await getNode(node)).toMatchObject({ jobs_failed: 0, state: "active" });
  });
});

describe("POST /v1/work/answer is rate limited per node", () => {
  it("the 31st answer in a minute is 429", async () => {
    const app = buildApp({ runtime: "node" });
    const acct: PrivateKeyAccount = privateKeyToAccount(generatePrivateKey());
    await int8Node(acct.address.toLowerCase());
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      const body = JSON.stringify({ jobId: "no-such-job", openings: [] });
      const ts = String(Date.now());
      const nonce = randomBytes(16).toString("hex");
      const signature = await acct.signMessage({ message: nodeSigningMessage("POST", "/v1/work/answer", ts, body, nonce) });
      const res = await app.request("/v1/work/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json", "cf-connecting-ip": `10.73.0.${i}`, "X-Node": acct.address, "X-Node-Timestamp": ts, "X-Nonce": nonce, "X-Node-Signature": signature },
        body,
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 30).every((s) => s === 404)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
});
