/**
 * B-6 acceptance: orchestrator CPU per submit at n = 256 (process.cpuUsage, user + system) for (a) the full verdict
 * with the transcript re-executed (every job before B-6; a sampled job now), (b) the verdict without it (an unsampled
 * job: Freivalds and the binding checks) and (c) a whole unsampled submitWork. Logs the numbers; the submit path must be
 * ≥ 10× cheaper. The amortised gain, (a) / ((b) + (a)/K), can never exceed K.
 */
import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect } from "vitest";
import { solveAssignedJob } from "../../../pouw/src/index.js";
import { creditUcld } from "../src/services/balance.service.js";
import { announceNode, touchNode } from "../src/services/nodes.service.js";
import { enqueueWorkJob, getActiveAssignment, submitWork } from "../src/services/jobs.service.js";
import { matmul } from "../src/services/work-types.js";
import { getD1 } from "../src/lib/storage.js";

const n = 256;
const K = 10;

/** CPU milliseconds per call, averaged over `reps`. */
function cpuMs(reps: number, f: () => void): number {
  const start = process.cpuUsage();
  for (let i = 0; i < reps; i++) f();
  const d = process.cpuUsage(start);
  return (d.user + d.system) / 1000 / reps;
}

describe("verification CPU at n = 256", () => {
  it("an unsampled submit costs ≥ 10× less CPU than re-executing the transcript", async () => {
    // A never-sampled draw for (c); the verdicts in (a) and (b) choose the transcript explicitly.
    await setupV1Db({ CLUSTER_N_MIN: "1", VERIFY_SAMPLE_K: String(2 ** 40) });
    const user = "0x" + "c0".repeat(20);
    const node = "0x" + "c1".repeat(20);
    await creditUcld(user, 1_000_000);
    await announceNode(node, { cpuThreads: 8, ramGB: 16, gpus: [], os: "test" }, 100, ["matmul"]);
    await getD1().prepare("UPDATE nodes SET payout = ? WHERE address = ?").bind("0x" + "c2".repeat(20), node).run();
    await touchNode(node);
    const rnd = (k: number) => Array.from({ length: n * n }, (_, i) => ((i * k) % 201) - 100);
    const matrixA = rnd(7919);
    const matrixB = rnd(104_729);
    const q = await enqueueWorkJob({ owner: user, workType: "matmul", n, matrixA, matrixB });
    if (!q.ok) throw new Error(q.message);
    const a = (await getActiveAssignment(node))!;
    const { certificate, result } = solveAssignedJob(a.sigma, matrixA, matrixB, n, node, "bench"); // honest, built once
    const sub = { job: { n, matrixA, matrixB, sigma: a.sigma }, certificate, result };

    const full = cpuMs(2, () => expect(matmul.verify(sub, { transcript: true })).toEqual({ ok: true }));
    const cheap = cpuMs(20, () => expect(matmul.verify(sub, { transcript: false })).toEqual({ ok: true }));
    const startSubmit = process.cpuUsage();
    const r = await submitWork(node, { jobId: q.jobId, certificate, result });
    const d = process.cpuUsage(startSubmit);
    const submit = (d.user + d.system) / 1000;
    expect(r.ok).toBe(true);

    const amortised = full / (cheap + full / K);
    console.log(
      `[B-6] n=${n} CPU per submit: (a) with transcript ${full.toFixed(1)} ms, (b) without ${cheap.toFixed(1)} ms, ` +
        `(c) unsampled submitWork ${submit.toFixed(1)} ms; submit path ${(full / cheap).toFixed(1)}×, ` +
        `vs (c) ${(full / submit).toFixed(1)}×; amortised at K=${K} ${amortised.toFixed(1)}×`,
    );
    expect(full / cheap).toBeGreaterThanOrEqual(10);
  }, 120_000);
});
