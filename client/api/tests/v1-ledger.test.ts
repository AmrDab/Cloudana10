import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll } from "vitest";
import { epochOf, recordJobRewards, splitFee, closeEpochs, ledgerSummary, TREASURY_ACCOUNT } from "../src/services/ledger.service.js";
import { epochRoot } from "../src/services/epoch-merkle.js";

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
    }),
  );

  it("writes lanes, enforces the epoch budget, and closes lane A as soon as the epoch ends", async () => {
    const t0 = 1_000 * 120_000; // start of epoch 1000
    const provider = "0x00000000000000000000000000000000000000aa";
    const r1 = await recordJobRewards({ jobId: "j1", workType: "matmul", provider, feeUcld: 1000, clusterOk: true, now: t0 });
    expect(r1).toMatchObject({ laneAUcld: 950, laneBUcld: 40, treasuryUcld: 30, epoch: 1000, vestsAt: t0 + 120_000 });
    const r2 = await recordJobRewards({ jobId: "j2", workType: "matmul", provider, feeUcld: 1000, clusterOk: true, now: t0 + 1 });
    expect(r2.laneBUcld).toBe(10); // budget 50 − 40 already used

    const summary = await ledgerSummary(provider, t0 + 2);
    expect(summary.pending).toEqual({ A: 1900, B: 50, treasury: 0 });
    expect(summary.vesting.B).toBe(50);
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
  });
});

describe("lane-B subsidy budget under concurrency", () => {
  it("never grants more than the epoch budget, even when submits race", async () => {
    const { setupV1Db } = await import("./helpers/v1-db.js");
    await setupV1Db({ EPOCH_SUBSIDY_BUDGET_UCLD: "100", SUBSIDY_RHO: "0.25" });
    const { recordJobRewards } = await import("../src/services/ledger.service.js");
    const now = 1_700_000_000_000;
    // 10 jobs of fee 1000 each want 40 µCLD of subsidy (ρ capped at 0.04); budget is 100.
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        recordJobRewards({ jobId: `race-${i}`, workType: "matmul", provider: "0x" + "ab".repeat(20), feeUcld: 1000, clusterOk: true, now }),
      ),
    );
    const granted = results.reduce((s, r) => s + r.laneBUcld, 0);
    expect(granted).toBe(100);
    expect(results.every((r) => r.laneAUcld === 950)).toBe(true);
  });
});
