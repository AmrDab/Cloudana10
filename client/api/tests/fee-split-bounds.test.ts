import { describe, expect, it } from "vitest";
import { splitFee } from "../src/services/ledger.service.js";

// CloudanaSettlementV2.postEpoch: treasury·1e4 ≥ fees·300 and (laneA + treasury)·1e4 ≤ fees·9800, on wei
// (= µCLD × 1e12). Per-job splits must satisfy both so any epoch sum does too.
describe("splitFee honours the settlement contract's bounds", () => {
  it("for every fee 2..20000 µCLD (1 µCLD cannot satisfy both bounds; no billing path charges it)", () => {
    for (let fee = 2; fee <= 20_000; fee++) {
      const { laneA, treasury } = splitFee(fee, { rho: 0, clusterOk: false, budgetRemaining: 0 });
      const wei = (u: number) => BigInt(u) * 10n ** 12n;
      expect(wei(treasury) * 10_000n >= wei(fee) * 300n, `treasury fee=${fee}`).toBe(true);
      expect((wei(laneA) + wei(treasury)) * 10_000n <= wei(fee) * 9_800n, `cap fee=${fee}`).toBe(true);
      expect(laneA).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps the provider at 95% when the fee divides evenly", () => {
    expect(splitFee(1000, { rho: 0, clusterOk: false, budgetRemaining: 0 })).toMatchObject({ laneA: 950, treasury: 30 });
  });

  it("sums over an epoch still satisfy the bounds", () => {
    const fees = [1000, 1001, 50, 51, 999_999, 1234];
    let A = 0n, T = 0n, F = 0n;
    for (const f of fees) {
      const s = splitFee(f, { rho: 0, clusterOk: false, budgetRemaining: 0 });
      A += BigInt(s.laneA); T += BigInt(s.treasury); F += BigInt(f);
    }
    expect(T * 10_000n >= F * 300n).toBe(true);
    expect((A + T) * 10_000n <= F * 9_800n).toBe(true);
  });
});
