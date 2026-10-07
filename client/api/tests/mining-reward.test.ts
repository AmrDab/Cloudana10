process.env.JWT_SECRET = "x".repeat(40);

import { describe, it, expect } from "vitest";
import { distributeMiningReward } from "../src/services/mining-reward.service.js";

describe("distributeMiningReward (legacy on-chain rewards retired)", () => {
  it("always reports disabled and never pays, even when a key would be configured", async () => {
    process.env.MINING_REWARDS_ENABLED = "true";
    process.env.ORCHESTRATOR_PRIVATE_KEY = "a".repeat(64);
    const outcome = await distributeMiningReward();
    expect(outcome.status).toBe("disabled");
    expect(outcome.tx).toBeNull();
    expect(outcome.wei).toBeNull();
    expect(outcome.reason).toMatch(/retired/i);
  });
});
