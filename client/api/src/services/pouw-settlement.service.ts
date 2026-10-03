/**
 * PoUW settlement — what happens after a certificate verifies.
 *
 * Verification is synchronous and authoritative. Settlement (paying the
 * provider, recording on Base) touches the chain and can fail or be
 * unconfigured; this module makes every outcome explicit, persists it next to
 * the certificate, and retries unrecorded certificates opportunistically so no
 * scheduler is needed on the Worker.
 *
 * It also owns the price of a paid matrix job — the CLD a user spends to put
 * real work into the queue, which is what makes a certificate "backed".
 */
import type { POUWCertificate } from "../../../../pouw/src/types.js";
import { getEnv } from "../config/env.js";
import { log } from "../lib/logger.js";
import {
  listUnrecordedCertificates,
  recordChainOutcome,
  recordSettlement,
  type CertificateSettlement,
} from "./certificate-store.service.js";
import { distributeMiningReward } from "./mining-reward.service.js";
import { recordOnChain } from "./pouw-chain-recorder.service.js";

const L = log.pouw;

/** CLD credits for a job of size n — same (n/64)^1.5 curve the reward uses. */
export function jobPriceCld(n: number): number {
  const base = getEnv().POUW_JOB_PRICE_CLD;
  return Math.max(0.01, Math.round(base * Math.pow(n / 64, 1.5) * 100) / 100);
}

/**
 * Pay and record a verified certificate. Runs the two chain writes in
 * parallel, persists the outcome, and returns it for the submit response.
 */
export async function settleCertificate(
  certificateId: string,
  cert: POUWCertificate,
  backedByWorkload: boolean,
  workloadId: string | null,
): Promise<CertificateSettlement> {
  const [reward, chain] = await Promise.all([
    distributeMiningReward(cert, backedByWorkload),
    recordOnChain(cert),
  ]);

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

/**
 * Retry on-chain recording for certificates that failed earlier. Called after
 * each accepted submission (and available to a cron on Node). Bounded so a
 * backlog never delays the request that triggered it.
 */
export async function retryUnrecordedCertificates(limit = 3): Promise<number> {
  const env = getEnv();
  if (!env.POUW_VERIFIER_CONTRACT_ADDRESS || !env.ORCHESTRATOR_PRIVATE_KEY) return 0;

  let recorded = 0;
  try {
    const pending = await listUnrecordedCertificates(limit, env.POUW_CHAIN_RECORD_MAX_ATTEMPTS);
    for (const c of pending) {
      const outcome = await recordOnChain(c);
      await recordChainOutcome(c.id, outcome);
      if (outcome.status === "recorded") recorded++;
    }
  } catch (err) {
    L.warn("[POUW:settle] retry sweep failed:", err instanceof Error ? err.message : err);
  }
  return recorded;
}
