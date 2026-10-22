import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll } from "vitest";
import { epochOf, epochJobs, getEpochPayload, recordJobRewards, splitFee, closeEpochs, ledgerSummary, TREASURY_ACCOUNT } from "../src/services/ledger.service.js";
import { epochRoot } from "../src/services/epoch-merkle.js";
import { getD1 } from "../src/lib/storage.js";

describe("lane split", () => {
  it("pays 0.95F / 0.03F / ρF (treasury rounds up, A trimmed to the 98% cap)", () => {
    expect(splitFee(1000, { rho: 0.04, clusterOk: true, budgetRemaining: 1e9 })).toEqual({ laneA: 950, treasury: 30, subsidy: 40 });
    expect(splitFee(263, { rho: 0.04, clusterOk: true, budgetRemaining: 1e9 })).toEqual({ laneA: 249, treasury: 8, subsidy: 10 });
    expect(splitFee(1001, { rho: 0.04, clusterOk: true, budgetRemaining: 1e9 })).toEqual({ laneA: 949, treasury: 31, subsidy: 40 });
  });

  it("caps ρ at RHO_MAX so paying yourself never returns more than you paid", () => {
    expect(splitFee(1000, { rho: 0.25, clusterOk: true, budgetRemaining: 1e9 })).toEqual({ laneA: 950, treasury: 30, subsidy: 40 });
    for (const fee of [5, 263, 1000, 1001, 123_457]) {
      const s = splitFee(fee, { rho: 0.25, clusterOk: true, budgetRemaining: 1e9 });
      expect(s.laneA + s.subsidy).toBeLessThan(fee);
    }
  });

  it("gives no subsidy when the cluster gate withheld it", () => {
    expect(splitFee(1000, { rho: 0.04, clusterOk: false, budgetRemaining: 1e9 }).subsidy).toBe(0);
  });

  it("caps the subsidy at the remaining epoch budget", () => {
    expect(splitFee(1000, { rho: 0.04, clusterOk: true, budgetRemaining: 25 }).subsidy).toBe(25);
    expect(splitFee(1000, { rho: 0.04, clusterOk: true, budgetRemaining: 0 }).subsidy).toBe(0);
  });
});

describe("ledger entries + epoch close (SQLite)", () => {
  beforeAll(() =>
    setupV1Db({
      EPOCH_SECONDS: "120",
      VEST_B_SECONDS: "120",
      SUBSIDY_RHO: "0.25", // above RHO_MAX on purpose: the ledger must cap it at 0.04
      EPOCH_SUBSIDY_BUDGET_UCLD: "50",
      PAY_HOLD_SECONDS: "0", // booked into the open epoch: the 24 h hold has its own tests (sampled-verification.test.ts)
    }),
  );

  it("writes lanes, fits lane B to the epoch budget pro rata, and closes lane A as soon as the epoch ends", async () => {
    const t0 = 1_000 * 120_000; // start of epoch 1000
    const provider = "0x00000000000000000000000000000000000000aa";
    const r1 = await recordJobRewards({ jobId: "j1", workType: "matmul", provider, feeUcld: 1000, clusterOk: true, now: t0 });
    expect(r1).toMatchObject({ laneAUcld: 950, laneBUcld: 40, treasuryUcld: 30, epoch: 1000, vestsAt: t0 + 120_000 });
    const r2 = await recordJobRewards({ jobId: "j2", workType: "matmul", provider, feeUcld: 1000, clusterOk: true, now: t0 + 1 });
    expect(r2.laneBUcld).toBe(40); // the most it can be: the budget is applied when the epoch closes

    const summary = await ledgerSummary(provider, t0 + 2);
    expect(summary.pending).toEqual({ A: 1900, B: 80, treasury: 0 });
    expect(summary.vesting.B).toBe(80);
    expect((await ledgerSummary(TREASURY_ACCOUNT)).pending.treasury).toBe(60);

    // Not before the epoch has ended…
    expect(await closeEpochs(t0 + 119_999)).toEqual([]);
    // …but right when it has, even though j2's lane B (vests at t0 + 120 001) is still vesting.
    const closed = await closeEpochs(t0 + 120_000);
    const leaves = [{ account: provider, laneAUcld: 1900, laneBUcld: 50 }];
    expect(closed).toEqual([
      {
        epoch: 1000,
        root: epochRoot(1000, leaves),
        feesBurnedUcld: 0, // no work_jobs rows behind j1/j2 in this unit test
        totalLaneAUcld: 1900,
        totalLaneBUcld: 50,
        treasuryUcld: 60, // an amount, not a leaf
        leaves,
        status: "closed",
      },
    ]);
    expect(await closeEpochs(t0 + 240_001)).toEqual([]); // posted once
    expect(epochOf(t0)).toBe(1000);
    // 80 wanted, budget 50: both jobs got 25, not 40 then 10.
    const b = await getD1().prepare("SELECT job_id, amount_ucld FROM reward_entries WHERE lane = 'B' AND epoch = 1000 ORDER BY job_id").all<{ job_id: string; amount_ucld: number }>();
    expect(b.results).toEqual([{ job_id: "j1", amount_ucld: 25 }, { job_id: "j2", amount_ucld: 25 }]);

    // The public job list, page by page, as the close counted it (no work_jobs rows here: no fee).
    const job = (jobId: string) => ({ jobId, workType: "matmul", provider, feeUcld: null, laneAUcld: 950, laneBUcld: 25, treasuryUcld: 30 });
    const first = await epochJobs(1000, { limit: 1 });
    expect(first).toEqual({ epoch: closed[0], jobs: [job("j1")], next: "j1" });
    expect(await epochJobs(1000, { after: "j1", limit: 1 })).toEqual({ epoch: closed[0], jobs: [job("j2")], next: null });
    // A job that commits into the epoch after it closed is not in its root (it moves on at the next close): not listed.
    await recordJobRewards({ jobId: "j3", workType: "matmul", provider, feeUcld: 1000, clusterOk: true, now: t0 + 5 });
    expect((await epochJobs(1000)).jobs.map((j) => j.jobId)).toEqual(["j1", "j2"]);
    // A vetoed epoch publishes nothing (its root and fees were cleared; it closes again).
    expect(await getEpochPayload(1000)).toMatchObject({ epoch: 1000, status: "closed" });
    await getD1().prepare("UPDATE epochs SET status = 'vetoed' WHERE id = 1000").run();
    expect(await getEpochPayload(1000)).toBeNull();
    await getD1().prepare("UPDATE epochs SET status = 'closed' WHERE id = 1000").run();
  });
});

describe("lane-B subsidy budget, pro rata", () => {
  it("never posts more than the epoch budget, however many submits race, and every job gets the same share", async () => {
    const { setupV1Db } = await import("./helpers/v1-db.js");
    await setupV1Db({ EPOCH_SUBSIDY_BUDGET_UCLD: "100", SUBSIDY_RHO: "0.25", EPOCH_SECONDS: "3600", PAY_HOLD_SECONDS: "0" });
    const { recordJobRewards, closeEpochs, epochOf } = await import("../src/services/ledger.service.js");
    const now = 1_700_000_000_000;
    // 10 jobs of fee 1000 each want 40 µCLD of subsidy (ρ capped at 0.04), 400 in all; the budget is 100.
    const providers = Array.from({ length: 10 }, (_, i) => "0x" + (i + 1).toString(16).padStart(40, "b"));
    const results = await Promise.all(
      providers.map((provider, i) => recordJobRewards({ jobId: `race-${i}`, workType: "matmul", provider, feeUcld: 1000, clusterOk: true, now })),
    );
    expect(results.every((r) => r.laneAUcld === 950 && r.laneBUcld === 40)).toBe(true);
    const [closed] = (await closeEpochs(now + 3_600_000)).filter((e) => e.epoch === epochOf(now));
    expect(closed.totalLaneBUcld).toBe(100);
    expect(closed.leaves.map((l) => l.laneBUcld)).toEqual(Array(10).fill(10));
  });

  it("leaves an epoch under its budget untouched", async () => {
    const { setupV1Db } = await import("./helpers/v1-db.js");
    await setupV1Db({ EPOCH_SUBSIDY_BUDGET_UCLD: "1000", SUBSIDY_RHO: "0.04", EPOCH_SECONDS: "3600", PAY_HOLD_SECONDS: "0" });
    const { recordJobRewards, fitLaneB, epochOf } = await import("../src/services/ledger.service.js");
    const now = 1_800_000_000_000;
    await recordJobRewards({ jobId: "under-1", workType: "matmul", provider: "0x" + "cd".repeat(20), feeUcld: 1000, clusterOk: true, now });
    expect(await fitLaneB(epochOf(now), 1000)).toBe(1);
    expect(await fitLaneB(epochOf(now), 20)).toBe(0.5);
    expect(await fitLaneB(epochOf(now), 20)).toBe(1); // idempotent once it fits
  });
});
