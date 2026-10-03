process.env.JWT_SECRET = "x".repeat(40);

import { describe, it, expect, vi, beforeEach } from "vitest";
import { resetEnv } from "../src/config/env.js";

vi.mock("../src/services/mining-reward.service.js", () => ({
  distributeMiningReward: vi.fn(),
}));
vi.mock("../src/services/pouw-chain-recorder.service.js", () => ({
  recordOnChain: vi.fn(),
}));
vi.mock("../src/services/certificate-store.service.js", () => ({
  recordSettlement: vi.fn(),
  recordChainOutcome: vi.fn(),
  listUnrecordedCertificates: vi.fn(),
}));

import { jobPriceCld, settleCertificate, retryUnrecordedCertificates } from "../src/services/pouw-settlement.service.js";
import { distributeMiningReward } from "../src/services/mining-reward.service.js";
import { recordOnChain } from "../src/services/pouw-chain-recorder.service.js";
import {
  recordSettlement,
  recordChainOutcome,
  listUnrecordedCertificates,
} from "../src/services/certificate-store.service.js";

const cert = { n: 64 } as any;

beforeEach(() => {
  delete process.env.POUW_JOB_PRICE_CLD;
  delete process.env.POUW_VERIFIER_CONTRACT_ADDRESS;
  delete process.env.ORCHESTRATOR_PRIVATE_KEY;
  resetEnv();
  vi.clearAllMocks();
});

describe("jobPriceCld", () => {
  it("n=64 -> 1 with default price", () => {
    expect(jobPriceCld(64)).toBe(1);
  });

  it("n=8 -> 0.04 (rounded to 2dp, floor 0.01)", () => {
    expect(jobPriceCld(8)).toBe(0.04);
  });

  it("n=256 -> 8", () => {
    expect(jobPriceCld(256)).toBe(8);
  });

  it("respects POUW_JOB_PRICE_CLD override", () => {
    process.env.POUW_JOB_PRICE_CLD = "2.5";
    resetEnv();
    expect(jobPriceCld(64)).toBe(2.5);
  });
});

describe("settleCertificate", () => {
  it("carries both outcomes and chain.attempts=1, passes workloadId through", async () => {
    const rewardOutcome = { status: "paid", wei: "123", tx: "0xreward", reason: null };
    const chainOutcome = { status: "recorded", tx: "0xchain", reason: null };
    (distributeMiningReward as any).mockResolvedValue(rewardOutcome);
    (recordOnChain as any).mockResolvedValue(chainOutcome);
    (recordSettlement as any).mockResolvedValue(undefined);

    const result = await settleCertificate("cert-1", cert, true, "wl-1");

    expect(result.reward).toEqual(rewardOutcome);
    expect(result.chain).toEqual({ ...chainOutcome, attempts: 1 });
    expect(result.workloadId).toBe("wl-1");
    expect(result.backedByWorkload).toBe(true);
    expect(recordSettlement).toHaveBeenCalledWith("cert-1", result);
  });

  it("does not reject when recordSettlement throws", async () => {
    (distributeMiningReward as any).mockResolvedValue({ status: "disabled", wei: null, tx: null, reason: null });
    (recordOnChain as any).mockResolvedValue({ status: "not_configured", tx: null, reason: null });
    (recordSettlement as any).mockRejectedValue(new Error("db down"));

    await expect(settleCertificate("cert-2", cert, false, null)).resolves.toBeDefined();
  });
});

describe("retryUnrecordedCertificates", () => {
  it("returns 0 without touching the store when unconfigured", async () => {
    const result = await retryUnrecordedCertificates();
    expect(result).toBe(0);
    expect(listUnrecordedCertificates).not.toHaveBeenCalled();
  });

  it("records outcomes for each pending certificate and returns the recorded count", async () => {
    process.env.POUW_VERIFIER_CONTRACT_ADDRESS = "0x" + "1".repeat(40);
    process.env.ORCHESTRATOR_PRIVATE_KEY = "a".repeat(64);
    resetEnv();

    const rows = [{ id: "c1" }, { id: "c2" }];
    (listUnrecordedCertificates as any).mockResolvedValue(rows);
    (recordOnChain as any)
      .mockResolvedValueOnce({ status: "recorded", tx: "0x1", reason: null })
      .mockResolvedValueOnce({ status: "failed", tx: null, reason: "boom" });

    const result = await retryUnrecordedCertificates();

    expect(recordChainOutcome).toHaveBeenCalledTimes(2);
    expect(result).toBe(1);
  });
});
