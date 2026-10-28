/**
 * Lane B never above the chain allowance: at close the budget is min(EPOCH_SUBSIDY_BUDGET_UCLD, allowance(epoch)), so
 * the keeper never meets a post the contract would reject whole (seen in the simulation's phase 4).
 */
import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resetEnv } from "../src/config/env.js";
import { creditUcld } from "../src/services/balance.service.js";
import { submitWork } from "../src/services/jobs.service.js";
import { closeEpochs, epochOf } from "../src/services/ledger.service.js";
import { laneBBudget, setAllowanceSource } from "../src/services/chain-allowance.service.js";
import { ENV, HOUR, freshNode, nextJob, setEnv, user } from "./helpers/sampled.js";

const WEI = 10n ** 12n; // per µCLD
const T = Date.now() - 20 * 24 * HOUR;

describe("lane-B budget vs the chain allowance", () => {
  beforeAll(async () => {
    await setupV1Db({ ...ENV, EPOCH_SUBSIDY_BUDGET_UCLD: "1000000", SETTLEMENT_ADDRESS: "0x" + "ab".repeat(20), CHAIN_RPC_URL: "http://127.0.0.1:1" });
    await creditUcld(user, 1_000_000);
  });
  afterAll(() => setAllowanceSource(null));

  it("takes the smaller of the two, and the env budget when the chain cannot be read", async () => {
    setAllowanceSource(async () => 100n * WEI);
    expect(await laneBBudget(1)).toBe(100);
    setAllowanceSource(async () => 5_000_000n * WEI);
    expect(await laneBBudget(1)).toBe(1_000_000);
    setAllowanceSource(async () => {
      throw new Error("rpc down");
    });
    expect(await laneBBudget(1)).toBe(1_000_000);
    setAllowanceSource(null);
    delete process.env.SETTLEMENT_ADDRESS;
    delete process.env.CHAIN_RPC_URL;
    resetEnv();
    expect(await laneBBudget(1)).toBe(1_000_000); // no chain configured: the env budget, no read
    setEnv({ SETTLEMENT_ADDRESS: "0x" + "ab".repeat(20), CHAIN_RPC_URL: "http://127.0.0.1:1" });
  });

  it("scales an epoch's lane B down to the allowance at close", async () => {
    const { node } = await freshNode();
    for (let i = 0; i < 3; i++) {
      const s = await nextJob(node);
      expect(await submitWork(node, s, T)).toMatchObject({ ok: true, earned: { laneAUcld: 949, laneBUcld: 40 } });
    }
    setAllowanceSource(async () => 100n * WEI); // 3 × 40 = 120 wanted, 100 allowed
    const epoch = epochOf(T + 86_400_000) + 1;
    const closed = (await closeEpochs(Date.now())).find((e) => e.epoch === epoch)!;
    expect(closed.totalLaneBUcld).toBeLessThanOrEqual(100);
    expect(closed.totalLaneBUcld).toBeGreaterThan(90);
    expect(closed.totalLaneAUcld).toBe(3 * 949);
  });
});
