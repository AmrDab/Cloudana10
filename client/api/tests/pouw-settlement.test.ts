process.env.JWT_SECRET = "x".repeat(40);

import { describe, it, expect, vi, beforeEach } from "vitest";
import { resetEnv } from "../src/config/env.js";

vi.mock("../src/services/certificate-store.service.js", () => ({
  recordSettlement: vi.fn(),
}));

import { settleCertificate, retryUnrecordedCertificates } from "../src/services/pouw-settlement.service.js";
import { recordSettlement } from "../src/services/certificate-store.service.js";

const cert = { n: 64 } as any;

beforeEach(() => {
  resetEnv();
  vi.clearAllMocks();
});

describe("settleCertificate", () => {
  it("persists the retired reward/chain outcomes with chain.attempts=1 and passes workloadId through", async () => {
    (recordSettlement as any).mockResolvedValue(undefined);

    const result = await settleCertificate("cert-1", cert, true, "wl-1");

    expect(result.reward.status).toBe("disabled");
    expect(result.chain.status).toBe("not_configured");
    expect(result.chain.attempts).toBe(1);
    expect(result.workloadId).toBe("wl-1");
    expect(result.backedByWorkload).toBe(true);
    expect(recordSettlement).toHaveBeenCalledWith("cert-1", result);
  });

  it("does not reject when recordSettlement throws", async () => {
    (recordSettlement as any).mockRejectedValue(new Error("db down"));

    await expect(settleCertificate("cert-2", cert, false, null)).resolves.toBeDefined();
  });
});

describe("retryUnrecordedCertificates", () => {
  it("always returns 0 (no chain writes without a chain key)", async () => {
    process.env.POUW_VERIFIER_CONTRACT_ADDRESS = "0x" + "1".repeat(40);
    process.env.ORCHESTRATOR_PRIVATE_KEY = "a".repeat(64);
    resetEnv();
    expect(await retryUnrecordedCertificates()).toBe(0);
  });
});
