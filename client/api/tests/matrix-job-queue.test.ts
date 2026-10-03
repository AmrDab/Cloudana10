process.env.JWT_SECRET = "x".repeat(40);

import { describe, it, expect } from "vitest";
import {
  enqueueJob,
  listJobsForOwner,
  countQueuedJobs,
  claimJob,
  completeJob,
  getJob,
} from "../src/services/matrix-job-queue.service.js";

function matrix(n: number, fill = 1) {
  return Array(n * n).fill(fill);
}

describe("matrix job queue (in-memory fallback)", () => {
  it("enqueues a job for an owner, lists it lowercased, and counts it as queued", async () => {
    const owner = "0xABCDEF0000000000000000000000000000000001";
    const job = await enqueueJob({ n: 2, matrixA: matrix(2), matrixB: matrix(2), difficulty: 8, owner, priceCld: 1 });

    const jobs = await listJobsForOwner(owner);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe(job.id);
    expect(jobs[0].owner).toBe(owner.toLowerCase());

    expect(await countQueuedJobs()).toBeGreaterThanOrEqual(1);

    // Drain it so it doesn't pollute the next test's claim ordering (shared in-memory store).
    const claimedOwnerJob = await claimJob("0xDrain");
    expect(claimedOwnerJob!.id).toBe(job.id);
    await completeJob(job.id, "0xDrain", matrix(2));
  });

  it("claims, completes, and rejects a wrong provider or wrong result length", async () => {
    const job = await enqueueJob({ n: 2, matrixA: matrix(2), matrixB: matrix(2), difficulty: 8 });

    const claimed = await claimJob("0xProvider1");
    expect(claimed).not.toBeNull();
    expect(claimed!.id).toBe(job.id);
    expect(claimed!.status).toBe("claimed");
    expect(claimed!.matrixA).toEqual(matrix(2));
    expect(claimed!.matrixB).toEqual(matrix(2));

    const wrongProvider = await completeJob(job.id, "0xSomeoneElse", matrix(2));
    expect(wrongProvider).toBe(false);

    const wrongLength = await completeJob(job.id, "0xProvider1", [1, 2, 3]);
    expect(wrongLength).toBe(false);

    const ok = await completeJob(job.id, "0xProvider1", matrix(2, 9));
    expect(ok).toBe(true);

    const stored = await getJob(job.id);
    expect(stored?.status).toBe("done");
    expect(stored?.resultHash).toBeTruthy();

    const reclaim = await claimJob("0xProvider1");
    expect(reclaim).toBeNull();
  });
});
