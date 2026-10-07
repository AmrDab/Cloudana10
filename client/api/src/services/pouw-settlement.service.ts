/**
 * PoUW settlement — what happens after a certificate verifies.
 *
 * Verification is synchronous and authoritative. The legacy chain writes
 * (paying the provider from RewardContract, recording on POUWVerifier) are
 * retired — the API holds no chain key — so settlement now only persists the
 * explicit "disabled / not configured" outcomes next to the certificate.
 */
import type { POUWCertificate } from "../../../../pouw/src/types.js";
import { log } from "../lib/logger.js";
import { recordSettlement, type CertificateSettlement } from "./certificate-store.service.js";
import { distributeMiningReward } from "./mining-reward.service.js";
import { recordOnChain } from "./pouw-chain-recorder.service.js";

const L = log.pouw;

/**
 * Persist the settlement outcome for a verified certificate and return it for
 * the submit response.
 */
export async function settleCertificate(
  certificateId: string,
  cert: POUWCertificate,
  backedByWorkload: boolean,
  workloadId: string | null,
): Promise<CertificateSettlement> {
  const [reward, chain] = await Promise.all([distributeMiningReward(), recordOnChain(cert)]);

  const settlement: CertificateSettlement = {
    backedByWorkload,
    workloadId,
    reward,
    chain: { ...chain, attempts: 1 },
  };

  try {
    await recordSettlement(certificateId, settlement);
  } catch (err) {
    // The certificate itself is safe; only the settlement bookkeeping failed.
    L.error(`[POUW:settle] could not persist settlement for ${certificateId}:`, err instanceof Error ? err.message : err);
  }
  return settlement;
}

/** Legacy retry sweep for unrecorded certificates. Nothing to retry without a chain key; always 0. */
export async function retryUnrecordedCertificates(_limit = 3): Promise<number> {
  return 0;
}
