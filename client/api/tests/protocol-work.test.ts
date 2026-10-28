/**
 * Protocol work (owner decision D1, 2026-10-28): with no user job queued, the orchestrator issues one matmul job per
 * idle node, with no fee; it is verified like any job, and what is left of the epoch's lane-B budget after paid jobs'
 * subsidies is minted to protocol jobs pro rata by verified units, no wallet above CLUSTER_S_CAP of it.
 */
import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll } from "vitest";
import { solveAssignedJob } from "../../../pouw/src/index.js";
import { getD1 } from "../src/lib/storage.js";
import { creditUcld } from "../src/services/balance.service.js";
import { touchNode } from "../src/services/nodes.service.js";
import { enqueueWorkJob, getActiveAssignment, getWorkJob, issueProtocolWork, runAssignment, submitWork } from "../src/services/jobs.service.js";
import { PROTOCOL_ACCOUNT, closeEpochs, epochOf } from "../src/services/ledger.service.js";
import { A, B, HOUR, freshNode, n, setEnv, user } from "./helpers/sampled.js";

const BUDGET = 1_000_000;
const UNITS = 64 * 64 * 64;
const T = Date.now() - 14 * 24 * HOUR; // the jobs' own epochs, well before now

async function solveAndSubmit(node: string, t: number) {
  const a = (await getActiveAssignment(node))!;
  expect(a).toBeTruthy();
  const { certificate, result } = solveAssignedJob(a.sigma, a.matrixA, a.matrixB, a.n, node, "dev");
  const r = await submitWork(node, { jobId: a.jobId, certificate, result }, t);
  expect(r).toMatchObject({ ok: true, earned: { laneAUcld: 0, laneBUcld: 0 } });
  return a.jobId;
}

const queuedProtocol = async () =>
  (await getD1().prepare("SELECT COUNT(*) AS c FROM work_jobs WHERE protocol = 1 AND status = 'queued'").first<{ c: number }>())!.c;

describe("protocol work", () => {
  beforeAll(async () => {
    await setupV1Db({ PROTOCOL_WORK: "on", CLUSTER_N_MIN: "2", CLUSTER_S_CAP: "0.5", EPOCH_SUBSIDY_BUDGET_UCLD: String(BUDGET), VERIFY_WARMUP_JOBS: "0", PAY_HOLD_SECONDS: "86400", EPOCH_SECONDS: "3600" });
    await creditUcld(user, 1_000_000);
  });

  it("issues one job per idle node when the queue is empty, none when off or when a user job waits", async () => {
    const w1 = await freshNode();
    const w1b = await freshNode(w1.payout);
    const w2 = await freshNode();
    setEnv({ PROTOCOL_WORK: "off" });
    expect(await issueProtocolWork()).toBe(0);
    setEnv({ PROTOCOL_WORK: "on" });

    expect(await issueProtocolWork()).toBe(3);
    expect(await issueProtocolWork()).toBe(0); // already queued for every idle node
    expect(await runAssignment()).toBe(3);
    for (const { node } of [w1, w1b, w2]) {
      const a = (await getActiveAssignment(node))!;
      expect(a.n).toBe(64);
      const job = (await getWorkJob(a.jobId))!;
      expect(job).toMatchObject({ owner: PROTOCOL_ACCOUNT, price_ucld: 0, protocol: 1, status: "assigned" });
    }
    expect(await issueProtocolWork()).toBe(0); // nobody idle

    // Two rounds: four protocol jobs on wallet 1 (two nodes), two on wallet 2; every one booked at T.
    const ids: string[] = [];
    for (let round = 0; round < 2; round++) {
      if (round) {
        expect(await issueProtocolWork()).toBe(3);
        expect(await runAssignment()).toBe(3);
      }
      for (const { node } of [w1, w1b, w2]) ids.push(await solveAndSubmit(node, T));
    }
    const entries = await getD1()
      .prepare(`SELECT lane, amount_ucld, units, status FROM reward_entries WHERE job_id IN (${ids.map(() => "?").join(",")})`)
      .bind(...ids)
      .all<{ lane: string; amount_ucld: number; units: number; status: string }>();
    expect(entries.results).toHaveLength(6); // lane B only: no fee, no lane A, no treasury
    for (const e of entries.results!) expect(e).toEqual({ lane: "B", amount_ucld: 0, units: UNITS, status: "pending" });

    // A user job queued: no protocol work is issued while it waits.
    await getD1().prepare("UPDATE nodes SET last_seen = 0").run();
    const q = await enqueueWorkJob({ owner: user, workType: "matmul", n, matrixA: A, matrixB: B });
    if (!q.ok) throw new Error(q.message);
    await touchNode(w2.node);
    expect(await issueProtocolWork()).toBe(0);
    await runAssignment();
    expect((await getWorkJob(q.jobId))!.status).toBe("assigned");
    const a = (await getActiveAssignment(w2.node))!;
    const { certificate, result } = solveAssignedJob(a.sigma, A, B, n, w2.node, "dev");
    expect(await submitWork(w2.node, { jobId: a.jobId, certificate, result }, T)).toMatchObject({ ok: true, earned: { laneAUcld: 949, laneBUcld: 40 } });

    // At close: the paid job's subsidy first (40), the rest of the budget to protocol work pro rata by units, wallet 1
    // (4 of 6 jobs) capped at half of it, wallet 2 gets its third (split evenly over its two jobs).
    const epoch = epochOf(T + 86_400_000) + 1;
    const closed = (await closeEpochs(Date.now())).find((e) => e.epoch === epoch)!;
    const left = BUDGET - 40;
    const byWallet = Object.fromEntries(closed.leaves.map((l) => [l.account, l]));
    expect(byWallet[w1.payout.toLowerCase()].laneBUcld).toBe(Math.floor(Math.floor(left * 0.5) / 4) * 4);
    expect(byWallet[w2.payout.toLowerCase()].laneBUcld).toBe(Math.floor(Math.floor(left / 3) / 2) * 2 + 40);
    expect(closed.totalLaneBUcld).toBeLessThanOrEqual(BUDGET);
    expect(closed.feesBurnedUcld).toBe(1001);
    expect(closed.totalLaneAUcld).toBe(949);

    // An epoch whose protocol work came from one wallet only (fewer than CLUSTER_N_MIN): nothing minted for it.
    const T2 = T + 5 * 24 * HOUR;
    await getD1().prepare("UPDATE nodes SET last_seen = 0").run();
    await touchNode(w2.node);
    expect(await issueProtocolWork()).toBe(1);
    expect(await runAssignment()).toBe(1);
    await solveAndSubmit(w2.node, T2);
    const alone = (await closeEpochs(Date.now())).find((e) => e.epoch === epochOf(T2 + 86_400_000) + 1)!;
    expect(alone.totalLaneBUcld).toBe(0);
    expect(alone.totalLaneAUcld).toBe(0);
  });

  it("drops a protocol job nobody took in 10 minutes", async () => {
    await getD1().prepare("UPDATE nodes SET last_seen = 0").run();
    await getD1().prepare("DELETE FROM work_jobs WHERE status = 'queued'").run();
    const { node } = await freshNode();
    expect(await issueProtocolWork()).toBe(1);
    await getD1().prepare("UPDATE nodes SET last_seen = 0 WHERE address = ?").bind(node).run();
    expect(await queuedProtocol()).toBe(1);
    expect(await issueProtocolWork(Date.now() + 601_000)).toBe(0);
    expect(await queuedProtocol()).toBe(0);
  });
});
