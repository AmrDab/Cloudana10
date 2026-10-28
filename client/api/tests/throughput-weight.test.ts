/**
 * The draw weight is compute time, not heartbeat luck: a node's throughput sample runs from the heartbeat that handed
 * it the job (work_jobs.delivered_at) to the submit, so two equal nodes get equal weights however long each waited
 * for its next heartbeat (docs/POUW_SIMULATION_REPORT.md, phase 1 and phase 4 findings).
 */
import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll } from "vitest";
import { solveAssignedJob } from "../../../pouw/src/index.js";
import { getD1 } from "../src/lib/storage.js";
import { creditUcld } from "../src/services/balance.service.js";
import { getNode, nextThroughput, THROUGHPUT_SAMPLE_MAX_MMAC_S, touchNode } from "../src/services/nodes.service.js";
import { enqueueWorkJob, getActiveAssignment, getWorkJob, runAssignment, submitWork } from "../src/services/jobs.service.js";
import { A, B, ENV, freshNode, n, user } from "./helpers/sampled.js";

const UNITS = n * n * n;

/** Enqueue (assigned at once), deliver by a heartbeat `wait` ms later, submit `compute` ms after that. */
async function job(node: string, wait: number, compute: number) {
  await getD1().prepare("UPDATE nodes SET last_seen = 0 WHERE address <> ?").bind(node).run();
  await touchNode(node);
  const q = await enqueueWorkJob({ owner: user, workType: "matmul", n, matrixA: A, matrixB: B });
  if (!q.ok) throw new Error(q.message);
  await runAssignment();
  const assignedAt = (await getWorkJob(q.jobId))!.assigned_at!;
  const a = (await getActiveAssignment(node, assignedAt + wait))!;
  expect(a.jobId).toBe(q.jobId);
  expect((await getWorkJob(q.jobId))!.delivered_at).toBe(assignedAt + wait);
  const { certificate, result } = solveAssignedJob(a.sigma, A, B, n, node, "dev");
  const before = (await getNode(node))!.throughput_mmac_s;
  expect(await submitWork(node, { jobId: q.jobId, certificate, result }, assignedAt + wait + compute)).toMatchObject({ ok: true });
  return { before, after: (await getNode(node))!.throughput_mmac_s };
}

describe("throughput from delivery to submit", () => {
  beforeAll(async () => {
    await setupV1Db(ENV);
    await creditUcld(user, 1_000_000);
  });

  it("a job delivered 14 s late weighs the same as one delivered at once", async () => {
    const quick = await freshNode();
    const late = await freshNode();
    const q = await job(quick.node, 0, 20);
    const l = await job(late.node, 14_000, 20);
    expect(q.after).toBeCloseTo(nextThroughput(q.before, UNITS, 0.02), 12);
    expect(l.after).toBeCloseTo(nextThroughput(l.before, UNITS, 0.02), 12);
    expect(l.after).toBeCloseTo(q.after, 12);
  });

  it("an instant submit (the operator knew the answer) is worth at most a top machine's weight", () => {
    const instant = nextThroughput(1, 256 ** 3, 0.001);
    expect(instant).toBeLessThanOrEqual(0.8 + 0.2 * THROUGHPUT_SAMPLE_MAX_MMAC_S);
    expect(nextThroughput(1, 256 ** 3, 1)).toBeCloseTo(0.8 + 0.2 * (256 ** 3 / 1e6), 9);
  });

  it("a second heartbeat does not move delivered_at; a re-assignment clears it", async () => {
    const { node } = await freshNode();
    await getD1().prepare("UPDATE nodes SET last_seen = 0 WHERE address <> ?").bind(node).run();
    await touchNode(node);
    const q = await enqueueWorkJob({ owner: user, workType: "matmul", n, matrixA: A, matrixB: B });
    if (!q.ok) throw new Error(q.message);
    await runAssignment();
    const t = (await getWorkJob(q.jobId))!.assigned_at!;
    await getActiveAssignment(node, t + 1000);
    await getActiveAssignment(node, t + 16_000);
    expect((await getWorkJob(q.jobId))!.delivered_at).toBe(t + 1000);
    await runAssignment(t + 120_000); // expired: back to the queue
    expect((await getWorkJob(q.jobId))!).toMatchObject({ status: "queued", delivered_at: null });
  });
});
