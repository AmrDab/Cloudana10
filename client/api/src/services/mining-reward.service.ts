/**
 * Mining Reward Service — legacy PoUW certificate rewards.
 *
 * The on-chain path (orchestrator calling RewardContract.rewardProvider with a
 * hot key) is retired: the API Worker holds no chain key, and CLD is minted per
 * verified job through the v1 ledger and settled by the keeper. This module
 * keeps the outcome shape the certificate store persists, and always reports
 * the legacy reward as disabled.
 */

export type RewardStatus = "paid" | "skipped" | "failed" | "disabled" | "not_configured";

/** What happened to the reward — always explicit, so callers and providers can see it. */
export interface RewardOutcome {
  status: RewardStatus;
  /** Amount in CLD wei; set when paid (and when skipped for insufficient pool, for context). */
  wei: string | null;
  tx: string | null;
  reason: string | null;
}

/**
 * Legacy mining reward for a verified certificate. Never pays: on-chain mining
 * rewards were replaced by per-job minting in the v1 ledger.
 */
export async function distributeMiningReward(): Promise<RewardOutcome> {
  return {
    status: "disabled",
    wei: null,
    tx: null,
    reason: "legacy on-chain mining rewards are retired; CLD is minted per verified job via the ledger",
  };
}
