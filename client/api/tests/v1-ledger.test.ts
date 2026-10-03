import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll } from "vitest";
import { epochOf, priceUcld, recordJobRewards, splitFee, closeEpochs, ledgerSummary } from "../src/services/ledger.service.js";

const TREASURY = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";

describe("price", () => {
  it("is max(1, ceil(n³ × price / 1e6)) µCLD", () => {
    expect(priceUcld(8 ** 3, 1000)).toBe(1); // 0.512 → 1
    expect(priceUcld(16 ** 3, 1000)).toBe(5); // 4.096 → 5
    expect(priceUcld(64 ** 3, 1000)).toBe(263); // 262.144 → 263
    expect(priceUcld(100 ** 3, 1000)).toBe(1000); // exact
    expect(priceUcld(256 ** 3, 1000)).toBe(16778);
  });
});

describe("lane split", () => {
  it("pays 0.975F / 0.005F / ρF with floor rounding", () => {
    expect(splitFee(1000, { rho: 0.25, clusterOk: true, budgetRemaining: 1e9 })).toEqual({ laneA: 975, treasury: 5, subsidy: 250 });
    expect(splitFee(263, { rho: 0.25, clusterOk: true, budgetRemaining: 1e9 })).toEqual({ laneA: 256, treasury: 1, subsidy: 65 });
    expect(splitFee(5, { rho: 0.25, clusterOk: true, budgetRemaining: 1e9 })).toEqual({ laneA: 4, treasury: 0, subsidy: 1 });
  });

  it("gives no subsidy when the cluster test failed", () => {
    expect(splitFee(1000, { rho: 0.25, clusterOk: false, budgetRemaining: 1e9 }).subsidy).toBe(0);
  });

  it("caps the subsidy at the remaining epoch budget", () => {
    expect(splitFee(1000, { rho: 0.25, clusterOk: true, budgetRemaining: 100 }).subsidy).toBe(100);
    expect(splitFee(1000, { rho: 0.25, clusterOk: true, budgetRemaining: 0 }).subsidy).toBe(0);
  });
});

describe("ledger entries + epoch close (SQLite)", () => {
  beforeAll(() =>
    setupV1Db({
      TREASURY_ADDRESS: TREASURY,
      EPOCH_SECONDS: "120",
      VEST_B_SECONDS: "120",
      SUBSIDY_RHO: "0.25",
      EPOCH_SUBSIDY_BUDGET_UCLD: "300",
    }),
  );

  it("writes lanes, enforces the epoch budget, and closes into per-address leaves", async () => {
    const t0 = 1_000 * 120_000; // start of epoch 1000
    const provider = "0x00000000000000000000000000000000000000aa";
    const r1 = await recordJobRewards({ jobId: "j1", workType: "matmul", provider, feeUcld: 1000, clusterOk: true, now: t0 });
    expect(r1).toMatchObject({ laneAUcld: 975, laneBUcld: 250, treasuryUcld: 5, epoch: 1000, vestsAt: t0 + 120_000 });
    const r2 = await recordJobRewards({ jobId: "j2", workType: "matmul", provider, feeUcld: 1000, clusterOk: true, now: t0 + 1 });
    expect(r2.laneBUcld).toBe(50); // budget 300 − 250 already used

    const summary = await ledgerSummary(provider, t0 + 2);
    expect(summary.pending).toEqual({ A: 1950, B: 300, treasury: 0 });
    expect(summary.vesting.B).toBe(300);

    // Epoch is over but lane B has not vested yet → not closed.
    expect(await closeEpochs(t0 + 120_000)).toEqual([]);
    const closed = await closeEpochs(t0 + 240_001);
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({ id: 1000, mintAUcld: 1960, mintBUcld: 300 });
    expect(closed[0].leaves).toEqual([
      { address: provider, amountUcld: 2250 },
      { address: TREASURY, amountUcld: 10 },
    ]);
    expect(await closeEpochs(t0 + 240_001)).toEqual([]); // posted once
    expect(epochOf(t0)).toBe(1000);
  });
});

describe("lane-B subsidy budget under concurrency", () => {
  it("never grants more than the epoch budget, even when submits race", async () => {
    const { setupV1Db } = await import("./helpers/v1-db.js");
    await setupV1Db({ EPOCH_SUBSIDY_BUDGET_UCLD: "100", SUBSIDY_RHO: "0.25", TREASURY_ADDRESS: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" });
    const { recordJobRewards } = await import("../src/services/ledger.service.js");
    const now = 1_700_000_000_000;
    // 10 jobs of fee 160 each want 40 µCLD of subsidy; budget is 100.
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        recordJobRewards({ jobId: `race-${i}`, workType: "matmul", provider: "0x" + "ab".repeat(20), feeUcld: 160, clusterOk: true, now }),
      ),
    );
    const granted = results.reduce((s, r) => s + r.laneBUcld, 0);
    expect(granted).toBe(100);
    expect(results.every((r) => r.laneAUcld === 156)).toBe(true);
  });
});
