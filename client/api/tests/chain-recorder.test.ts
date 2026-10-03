process.env.JWT_SECRET = "x".repeat(40);

import { describe, it, expect, beforeEach } from "vitest";
import { resetEnv } from "../src/config/env.js";
import { recordOnChain } from "../src/services/pouw-chain-recorder.service.js";

beforeEach(() => {
  delete process.env.POUW_VERIFIER_CONTRACT_ADDRESS;
  delete process.env.ORCHESTRATOR_PRIVATE_KEY;
  resetEnv();
});

describe("recordOnChain", () => {
  it("returns not_configured when unconfigured, without calling the chain", async () => {
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
    expect(outcome).toEqual({ status: "not_configured", tx: null, reason: "verifier contract or orchestrator signer not provisioned" });
  });
});
