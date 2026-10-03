process.env.JWT_SECRET = "x".repeat(40);

import { describe, it, expect, beforeEach } from "vitest";
import { resetEnv } from "../src/config/env.js";
import { distributeMiningReward, calculateReward } from "../src/services/mining-reward.service.js";

const cert = (n: number, difficulty: number) =>
  ({ n, difficulty, providerAddress: "0x" + "1".repeat(40) } as any);

beforeEach(() => {
  delete process.env.MINING_REWARDS_ENABLED;
  delete process.env.ORCHESTRATOR_PRIVATE_KEY;
  delete process.env.POUW_MINING_POOL_WORKLOAD_ID;
  resetEnv();
});

describe("distributeMiningReward outcome mapping", () => {
  it("returns disabled when MINING_REWARDS_ENABLED=false", async () => {
    process.env.MINING_REWARDS_ENABLED = "false";
    resetEnv();
    const outcome = await distributeMiningReward(cert(64, 8), true);
    expect(outcome.status).toBe("disabled");
  });

  it("returns not_configured with a reason mentioning the signer when ORCHESTRATOR_PRIVATE_KEY is unset", async () => {
    const outcome = await distributeMiningReward(cert(64, 8), true);
    expect(outcome.status).toBe("not_configured");
    expect(outcome.reason).toMatch(/signer/i);
  });

  it("returns not_configured when the mining pool workload id is unset", async () => {
    process.env.ORCHESTRATOR_PRIVATE_KEY = "a".repeat(64);
    resetEnv();
    const outcome = await distributeMiningReward(cert(64, 8), true);
    expect(outcome.status).toBe("not_configured");
  });
});

describe("calculateReward scaling", () => {
  it("n=64,d=8 -> 10 CLD in wei", () => {
    expect(calculateReward(cert(64, 8))).toBe(10n * 10n ** 18n);
  });

  it("n=64,d=12 -> double", () => {
    expect(calculateReward(cert(64, 12))).toBe(2n * 10n * 10n ** 18n);
  });

  it("n=256,d=8 -> 8x", () => {
    expect(calculateReward(cert(256, 8))).toBe(8n * 10n * 10n ** 18n);
  });
});
