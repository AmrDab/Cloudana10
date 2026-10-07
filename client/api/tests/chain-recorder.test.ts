process.env.JWT_SECRET = "x".repeat(40);

import { describe, it, expect } from "vitest";
import { recordOnChain } from "../src/services/pouw-chain-recorder.service.js";

describe("recordOnChain (legacy POUWVerifier recording retired)", () => {
  it("returns not_configured without calling the chain, even with a verifier address and key set", async () => {
    process.env.POUW_VERIFIER_CONTRACT_ADDRESS = "0x" + "1".repeat(40);
    process.env.ORCHESTRATOR_PRIVATE_KEY = "a".repeat(64);
    const cert = {
      providerAddress: "0x" + "1".repeat(40),
      deviceId: "0x" + "2".repeat(64),
      n: 64,
      difficulty: 8,
      transcriptHash: "0x" + "3".repeat(64),
      z: "0x" + "4".repeat(64),
      timestamp: Date.now(),
    } as any;

    const outcome = await recordOnChain(cert);
    expect(outcome.status).toBe("not_configured");
    expect(outcome.tx).toBeNull();
    expect(outcome.reason).toMatch(/retired/i);
  });
});
