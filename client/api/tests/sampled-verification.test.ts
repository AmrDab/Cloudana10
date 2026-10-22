/**
 * Sampled verification (ENGINEERING_BACKLOG B-6, owner decision 2026-10-21): Freivalds on every job, the transcript
 * re-executed on a random 1 in VERIFY_SAMPLE_K, every job's provider pay held PAY_HOLD_SECONDS, and a failed sampled
 * check claws that pay together with all held pay of the node's payout wallet and suspends the node.
 */
import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import { solveAssignedJob } from "../../../pouw/src/index.js";
import type { POUWCertificate } from "../../../pouw/src/types.js";
import { buildApp } from "../src/app.js";
import { getEnv, resetEnv } from "../src/config/env.js";
import { getD1 } from "../src/lib/storage.js";
import { creditUcld, getBalanceUcld } from "../src/services/balance.service.js";
import { announceNode, getNode, touchNode } from "../src/services/nodes.service.js";
import { enqueueWorkJob, getActiveAssignment, getWorkJob, runAssignment, sampledForCheck, sha256, submitWork } from "../src/services/jobs.service.js";
import { closeEpochs, epochJobs, epochOf, ledgerSummary, releasesAt } from "../src/services/ledger.service.js";
import { ZERO_ROOT } from "../src/services/epoch-merkle.js";

const HOUR = 3_600_000;
const n = 8;
const A = Array.from({ length: n * n }, (_, i) => ((i * 7919) % 41) - 20);
const B = Array.from({ length: n * n }, (_, i) => ((i * 104_729) % 37) - 18);
const user = "0x" + "5e".repeat(20);
const ENV = { CLUSTER_N_MIN: "1", EPOCH_SECONDS: "3600", PAY_HOLD_SECONDS: "86400", VERIFY_SAMPLE_K: "10" };

function setEnv(vars: Record<string, string>): void {
  Object.assign(process.env, vars);
  resetEnv();
}

/** A node bound to `payout` (default: a wallet of its own). */
async function freshNode(payout = "0x" + randomBytes(20).toString("hex")): Promise<{ node: string; payout: string }> {
  const node = "0x" + randomBytes(20).toString("hex");
  await announceNode(node, { cpuThreads: 8, ramGB: 16, gpus: [], os: "test" }, 100, ["matmul"]);
  await getD1().prepare("UPDATE nodes SET payout = ? WHERE address = ?").bind(payout, node).run();
  await touchNode(node);
  return { node, payout };
}

/** The right answer with a transcript hash that is not the one the work produces. */
const forged = (c: POUWCertificate): POUWCertificate => ({
  ...c,
  transcriptHash: (c.transcriptHash[0] === "0" ? "1" : "0") + c.transcriptHash.slice(1),
});

/**
 * Enqueue a job, let `node` draw it as the only node online (the file shares one in-memory database), and solve it;
 * `forge` submits a wrong transcript.
 */
async function nextJob(node: string, forge = false) {
  await getD1().prepare("UPDATE nodes SET last_seen = 0 WHERE address <> ?").bind(node).run();
  await touchNode(node);
  const q = await enqueueWorkJob({ owner: user, workType: "matmul", n, matrixA: A, matrixB: B });
  if (!q.ok) throw new Error(q.message);
  await runAssignment();
  const a = await getActiveAssignment(node);
  expect(a?.jobId).toBe(q.jobId);
  const { certificate, result } = solveAssignedJob(a!.sigma, A, B, n, node, "dev");
  return { jobId: q.jobId, sigma: a!.sigma, certificate: forge ? forged(certificate) : certificate, result };
}

/** lane:status of every reward entry of each job. */
async function entryStates(jobIds: string[]): Promise<Record<string, string[]>> {
  const rows = await getD1()
    .prepare(`SELECT job_id, lane, status FROM reward_entries WHERE job_id IN (${jobIds.map(() => "?").join(",")}) ORDER BY lane`)
    .bind(...jobIds)
    .all<{ job_id: string; lane: string; status: string }>();
  const out: Record<string, string[]> = Object.fromEntries(jobIds.map((id) => [id, []]));
  for (const r of rows.results ?? []) out[r.job_id].push(`${r.lane}:${r.status}`);
  return out;
}

describe("sampledForCheck: a keyed draw the node cannot predict", () => {
  // A fixed key and counter-derived inputs: HMAC outputs are pseudo-random, and the test is deterministic.
  beforeAll(() => setupV1Db({ ...ENV, JWT_SECRET: "sampler-test-key-".padEnd(40, "k") }));
  const pair = (i: number) => [sha256(`job:${i}`).slice(0, 36), sha256(`sigma:${i}`)] as const;

  it("samples 1 in K: 100,000 (jobId, σ) pairs hit at 1/10 ± 0.3 %", () => {
    let hits = 0;
    for (let i = 0; i < 100_000; i++) if (sampledForCheck(...pair(i), 10)) hits++;
    expect(Math.abs(hits / 100_000 - 0.1)).toBeLessThanOrEqual(0.003);
  });

  it("K = 1 samples every job; the env knob is the default", () => {
    for (let i = 0; i < 1000; i++) expect(sampledForCheck(...pair(i), 1)).toBe(true);
    let hits = 0;
    for (let i = 0; i < 10_000; i++) if (sampledForCheck(...pair(i))) hits++;
    expect(hits).toBeGreaterThan(800);
    expect(hits).toBeLessThan(1200);
  });

  it("changes with σ (a re-queued job is drawn afresh) and with the key", () => {
    const jobId = pair(0)[0];
    const bySigma = Array.from({ length: 2000 }, (_, i) => sampledForCheck(jobId, sha256(`nonce:${i}`), 10));
    const hits = bySigma.filter(Boolean).length;
    expect(hits).toBeGreaterThan(140);
    expect(hits).toBeLessThan(260);
    const drawn = (secret: string) => {
      setEnv({ JWT_SECRET: secret });
      return Array.from({ length: 2000 }, (_, i) => sampledForCheck(...pair(i), 10));
    };
    const one = drawn("first-key-".padEnd(40, "1"));
    const two = drawn("second-key-".padEnd(40, "2"));
    const both = one.filter((s, i) => s && two[i]).length;
    // Independent draws overlap on ~1 % of pairs; the same draw would overlap on ~10 %.
    expect(both).toBeLessThan(one.filter(Boolean).length / 3);
  });
});

describe("a planted wrong transcript (acceptance: always caught, after K jobs on average)", () => {
  beforeAll(async () => {
    await setupV1Db(ENV);
    await creditUcld(user, 1_000_000_000);
  });

  /**
   * A cheating node submits right answers with a wrong transcript until it is caught. Each submit is checked against
   * the draw the test re-derives; on detection, the job and the node are checked. Returns the jobs it took.
   */
  async function runCheater(): Promise<number> {
    const { node, payout } = await freshNode();
    const ids: string[] = [];
    for (let jobs = 1; jobs <= 500; jobs++) {
      const s = await nextJob(node, true);
      ids.push(s.jobId);
      const r = await submitWork(node, s);
      if (!sampledForCheck(s.jobId, s.sigma)) {
        expect(r).toMatchObject({ ok: true });
        continue;
      }
      expect(r).toMatchObject({ ok: false, code: "unprocessable", message: expect.stringMatching(/sampled transcript check failed/) });
      const job = (await getWorkJob(s.jobId))!;
      expect(job).toMatchObject({ status: "done", sample_check: "failed" });
      expect(JSON.parse(job.result_json!)).toEqual(s.result); // the verified answer is kept
      expect(await getNode(node)).toMatchObject({ state: "suspended", state_reason: `sampled transcript check failed on job ${s.jobId}` });
      // Every A/B entry of the node is clawed; every treasury entry stays pending (the fees are still burned).
      for (const [id, states] of Object.entries(await entryStates(ids))) {
        expect(states.filter((x) => !x.startsWith("treasury")).every((x) => x.endsWith(":clawed")), id).toBe(true);
        expect(states.filter((x) => x.startsWith("treasury")), id).toEqual(["treasury:pending"]);
      }
      const summary = await ledgerSummary(payout);
      expect(summary.pending.A + summary.pending.B).toBe(0);
      expect(summary.clawed.A).toBe(ids.length * 949);
      // The jobs that went through were not sampled (a sampled one would have been caught).
      const checked = await getD1().prepare("SELECT COUNT(*) AS c FROM work_jobs WHERE node = ? AND sample_check IS NOT NULL").bind(node).first<{ c: number }>();
      expect(checked!.c).toBe(1);
      return jobs;
    }
    throw new Error("a wrong transcript went uncaught for 500 jobs");
  }

  it("is caught every time; mean jobs to detection in [8, 12] at K = 10, and ≥ 96 % within 44", async () => {
    const runs = 400;
    const counts: number[] = [];
    for (let i = 0; i < runs; i++) counts.push(await runCheater());
    const mean = counts.reduce((s, c) => s + c, 0) / runs;
    const within44 = counts.filter((c) => c <= 44).length / runs;
    console.log(`[B-6] planted wrong transcript, K=10, ${runs} runs: mean ${mean.toFixed(2)} jobs to detection, max ${Math.max(...counts)}, ${(within44 * 100).toFixed(1)} % within 44`);
    expect(mean).toBeGreaterThanOrEqual(8);
    expect(mean).toBeLessThanOrEqual(12);
    expect(within44).toBeGreaterThanOrEqual(0.96);
  }, 300_000);

  it("with K = 1 every job is re-executed: caught on the first", async () => {
    setEnv({ VERIFY_SAMPLE_K: "1" });
    try {
      expect(await runCheater()).toBe(1);
    } finally {
      setEnv({ VERIFY_SAMPLE_K: "10" });
    }
  });
});

describe("the 24 h hold", () => {
  let node = "";
  let payout = "";
  beforeAll(async () => {
    await setupV1Db(ENV);
    await creditUcld(user, 1_000_000);
    ({ node, payout } = await freshNode());
  });

  it("refuses a hold shorter than one epoch", () => {
    setEnv({ PAY_HOLD_SECONDS: "1800" });
    expect(() => getEnv()).toThrow(/PAY_HOLD_SECONDS/);
    setEnv({ PAY_HOLD_SECONDS: "86400" });
    expect(getEnv().PAY_HOLD_SECONDS).toBe(86_400);
  });

  it("books the job into epochOf(t + 24 h): closeEpochs at t + 1 h closes nothing, at t + 25 h it closes with the fee", async () => {
    const s = await nextJob(node);
    const t = Date.now() - 14 * 24 * HOUR; // its own epochs: the describes share one database
    const e = epochOf(t + 24 * HOUR);
    const r = await submitWork(node, s, t);
    expect(r).toMatchObject({ ok: true, earned: { laneAUcld: 949, laneBUcld: 40 }, heldUntil: releasesAt(e), vestsAt: releasesAt(e) + HOUR });
    expect((await getWorkJob(s.jobId))!.sample_check).toBe(sampledForCheck(s.jobId, s.sigma) ? "passed" : null);
    const rows = await getD1().prepare("SELECT epoch, lane, status FROM reward_entries WHERE job_id = ?").bind(s.jobId).all<{ epoch: number; status: string }>();
    expect(rows.results?.map((x) => [x.epoch, x.status])).toEqual([[e, "pending"], [e, "pending"], [e, "pending"]]);

    // The provider sees it as held, not as vesting or in settlement.
    const held = await ledgerSummary(payout, t);
    expect(held).toMatchObject({ pending: { A: 949, B: 40 }, held: { A: 949, B: 40 }, vesting: { B: 0 }, clawed: { A: 0, B: 0 } });
    expect(held.entries.map((x) => x.releasesAt)).toEqual([releasesAt(e), releasesAt(e)]);

    expect(await closeEpochs(t + HOUR)).toEqual([]);
    const closed = await closeEpochs(t + 25 * HOUR);
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({
      epoch: e,
      feesBurnedUcld: 1001, // the fee burns in the rewards' epoch
      totalLaneAUcld: 949,
      totalLaneBUcld: 40,
      treasuryUcld: 31,
      leaves: [{ account: payout, laneAUcld: 949, laneBUcld: 40 }],
    });
    const after = await ledgerSummary(payout, t + 25 * HOUR);
    expect(after.held).toEqual({ A: 0, B: 0 });
    expect(after.entries.map((x) => x.releasesAt)).toEqual([null, null]);
  });
});

describe("claw path: a failed sampled check claws the provider's held pay", () => {
  const t0 = Date.now() - 7 * 24 * HOUR; // its own epochs: the describes share one database
  let node = "";
  let payout = "";
  const ids: Record<string, string> = {};
  let price = 0;
  let app: ReturnType<typeof buildApp>;
  const network = async () => (await app.request("/v1/network", { headers: { "cf-connecting-ip": "10.66.0.1" } })).json();
  let before: { burnedUcld: number; mintedUcld: number };

  beforeAll(async () => {
    await setupV1Db(ENV);
    await creditUcld(user, 1_000_000);
    ({ node, payout } = await freshNode());
    // released: booked into an epoch that ended before t0 (closed below); current: booked into the epoch open at t0 —
    // out of the claw's reach though not closed yet; held1–3: booked after the open epoch.
    const plan: [string, number][] = [
      ["released", t0 - 26 * HOUR],
      ["current", t0 - 24 * HOUR],
      ["held1", t0 - HOUR],
      ["held2", t0 - HOUR / 2],
      ["held3", t0 - 60_000],
    ];
    for (const [name, at] of plan) {
      const s = await nextJob(node);
      expect(await submitWork(node, s, at)).toMatchObject({ ok: true });
      ids[name] = s.jobId;
    }
    price = (await getWorkJob(ids.held1))!.price_ucld;
    expect((await closeEpochs(t0)).map((p) => p.epoch)).toEqual([epochOf(t0 - 2 * HOUR)]);
    app = buildApp({ runtime: "node" });
    before = await network();
  });

  it("422: the result is kept and its fee captured; this job's and the 3 held jobs' A/B clawed; released and current untouched", async () => {
    setEnv({ VERIFY_SAMPLE_K: "1" });
    const s = await nextJob(node, true);
    ids.failed = s.jobId;
    const before = await getBalanceUcld(user);
    let r;
    try {
      r = await submitWork(node, s, t0);
    } finally {
      setEnv({ VERIFY_SAMPLE_K: "10" });
    }
    expect(r).toMatchObject({ ok: false, code: "unprocessable", message: expect.stringMatching(/result is kept.*clawed.*suspended/) });
    const job = (await getWorkJob(s.jobId))!;
    expect(job).toMatchObject({ status: "done", sample_check: "failed", fee_captured_at: t0 });
    expect(JSON.parse(job.result_json!)).toEqual(s.result);
    expect(before.heldUcld - (await getBalanceUcld(user)).heldUcld).toBe(price);

    const clawed = ["A:clawed", "B:clawed", "treasury:pending"];
    expect(await entryStates(Object.values(ids))).toEqual({
      [ids.released]: ["A:posted", "B:posted", "treasury:posted"],
      [ids.current]: ["A:pending", "B:pending", "treasury:pending"], // epoch = current: never clawed (race-free with closeEpochs)
      [ids.held1]: clawed,
      [ids.held2]: clawed,
      [ids.held3]: clawed,
      [ids.failed]: clawed,
    });
    expect(await getNode(node)).toMatchObject({
      state: "suspended",
      state_reason: `sampled transcript check failed on job ${s.jobId}`,
      jobs_done: 5, // no credit, no throughput sample for the failed job
      jobs_failed: 1,
    });
    const summary = await ledgerSummary(payout, t0);
    expect(summary).toMatchObject({ clawed: { A: 4 * 949, B: 4 * 40 }, pending: { A: 2 * 949, B: 2 * 40 }, held: { A: 949, B: 40 } });
    expect(summary.entries.filter((x) => x.status === "clawed")).toHaveLength(8);
  });

  it("every epoch payload stays within the contract's bounds and matches its job list; all-clawed epochs close with the zero root", async () => {
    const closed = await closeEpochs(t0 + 26 * HOUR);
    expect(closed.map((p) => p.epoch)).toEqual([...new Set([t0, t0 + 23 * HOUR, t0 + 23.5 * HOUR, t0 + 24 * HOUR - 60_000, t0 + 24 * HOUR].map((x) => epochOf(x)))]);
    for (const p of closed) {
      expect(p.treasuryUcld * 10_000).toBeGreaterThanOrEqual(p.feesBurnedUcld * 300);
      expect((p.totalLaneAUcld + p.treasuryUcld) * 10_000).toBeLessThanOrEqual(p.feesBurnedUcld * 9_800);
      expect(p.totalLaneBUcld).toBeLessThanOrEqual(getEnv().EPOCH_SUBSIDY_BUDGET_UCLD);
      // Anyone can recompute the payload from the epoch's public job list: clawed jobs are listed with A = B = 0.
      const { jobs } = await epochJobs(p.epoch, { limit: 500 });
      const sum = (k: "feeUcld" | "laneAUcld" | "laneBUcld" | "treasuryUcld") => jobs.reduce((s, j) => s + (j[k] ?? 0), 0);
      expect([sum("feeUcld"), sum("laneAUcld"), sum("laneBUcld"), sum("treasuryUcld")]).toEqual([
        p.feesBurnedUcld, p.totalLaneAUcld, p.totalLaneBUcld, p.treasuryUcld,
      ]);
    }
    const [current, ...held] = closed;
    expect(current).toMatchObject({ epoch: epochOf(t0), feesBurnedUcld: price, leaves: [{ account: payout, laneAUcld: 949, laneBUcld: 40 }] });
    for (const p of held) {
      expect(p).toMatchObject({ leaves: [], root: ZERO_ROOT, totalLaneAUcld: 0, totalLaneBUcld: 0 });
      expect(p.feesBurnedUcld).toBeGreaterThan(0);
      expect(p.treasuryUcld).toBeGreaterThan(0);
    }
    expect(held.reduce((s, p) => s + p.feesBurnedUcld, 0)).toBe(4 * price);
  });

  it("/v1/network counts the failed job's fee as burned and stops counting the clawed A/B as minted", async () => {
    const after = await network();
    expect(after.burnedUcld - before.burnedUcld).toBe(price);
    expect(after.mintedUcld - before.mintedUcld).toBe(31 - 3 * (949 + 40)); // + the failed job's treasury − 3 held jobs' A/B
  });
});

describe("the claw is wallet-wide; the suspension is the failing node's", () => {
  const t = Date.now() - 3 * 24 * HOUR; // its own epochs: the describes share one database

  it("node 1 fails a sample: node 2 (same payout wallet) loses its held pay but keeps working; node 3 (another wallet) keeps both", async () => {
    await setupV1Db(ENV);
    await creditUcld(user, 1_000_000);
    const wallet = "0x" + randomBytes(20).toString("hex");
    const one = await freshNode(wallet);
    const two = await freshNode(wallet);
    const three = await freshNode();
    const held: Record<string, string> = {};
    for (const [name, { node }] of [["two", two], ["three", three]] as const) {
      const s = await nextJob(node);
      expect(await submitWork(node, s, t - HOUR)).toMatchObject({ ok: true });
      held[name] = s.jobId;
    }

    setEnv({ VERIFY_SAMPLE_K: "1" });
    const s = await nextJob(one.node, true);
    let r;
    try {
      r = await submitWork(one.node, s, t);
    } finally {
      setEnv({ VERIFY_SAMPLE_K: "10" });
    }
    expect(r).toMatchObject({ ok: false, code: "unprocessable", message: expect.stringMatching(/payout wallet's held pay is clawed/) });
    expect(await entryStates([held.two, held.three, s.jobId])).toEqual({
      [held.two]: ["A:clawed", "B:clawed", "treasury:pending"],
      [held.three]: ["A:pending", "B:pending", "treasury:pending"],
      [s.jobId]: ["A:clawed", "B:clawed", "treasury:pending"],
    });
    expect(await getNode(one.node)).toMatchObject({ state: "suspended", state_reason: `sampled transcript check failed on job ${s.jobId}` });
    expect(await getNode(two.node)).toMatchObject({ state: "active", jobs_failed: 0 });
    expect(await getNode(three.node)).toMatchObject({ state: "active", jobs_failed: 0 });
    expect((await ledgerSummary(wallet, t)).clawed).toEqual({ A: 2 * 949, B: 2 * 40 });
    expect((await ledgerSummary(three.payout, t)).held).toEqual({ A: 949, B: 40 });
  });
});
