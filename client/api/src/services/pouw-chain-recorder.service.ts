/**
 * POUW Chain Recorder — legacy on-chain certificate records (POUWVerifier.sol).
 *
 * Retired: the API Worker holds no chain key, so certificates are no longer
 * written to Base from here. The outcome shape is kept because the certificate
 * store persists it and the submit response reports it.
 */
import type { POUWCertificate } from "../../../../pouw/src/types.js";

/** The fields POUWVerifier.recordCertificate needed — a full certificate or a stored row. */
export type ChainRecordInput = Pick<
  POUWCertificate,
  "providerAddress" | "deviceId" | "n" | "difficulty" | "transcriptHash" | "z" | "timestamp"
>;

export type ChainStatus = "recorded" | "pending" | "failed" | "not_configured";

export interface ChainOutcome {
  status: ChainStatus;
  tx: string | null;
  reason: string | null;
}

/** Never writes to the chain; always reports the legacy recorder as not configured. */
export async function recordOnChain(_cert: ChainRecordInput): Promise<ChainOutcome> {
  return { status: "not_configured", tx: null, reason: "on-chain certificate recording is retired (the API holds no chain key)" };
}
