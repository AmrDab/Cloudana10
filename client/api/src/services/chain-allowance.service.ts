/**
 * The lane-B budget an epoch may mint: EPOCH_SUBSIDY_BUDGET_UCLD, never above the settlement contract's `allowance(epoch)`
 * (the contract rejects an over-allowance post whole, lane A included; the keeper would skip the epoch every pass —
 * seen in the simulation's phase 4, docs/POUW_SIMULATION_REPORT.md). Read from the chain when SETTLEMENT_ADDRESS and
 * CHAIN_RPC_URL are set; a failed read keeps the env budget, with a warning.
 */
import { createPublicClient, http, parseAbi, type Address } from "viem";
import { getEnv } from "../config/env.js";
import { log } from "../lib/logger.js";

const ABI = parseAbi(["function allowance(uint256 epoch) view returns (uint256)"]);
const WEI_PER_UCLD = 10n ** 12n;

export type AllowanceSource = (epoch: number) => Promise<bigint>;
let source: AllowanceSource | null = null;
/** Tests: a stand-in for the chain read (wei). null = the chain. */
export function setAllowanceSource(s: AllowanceSource | null): void {
  source = s;
}

export async function laneBBudget(epoch: number): Promise<number> {
  const env = getEnv();
  const budget = env.EPOCH_SUBSIDY_BUDGET_UCLD;
  const settlement = env.SETTLEMENT_ADDRESS;
  const rpc = env.CHAIN_RPC_URL;
  if (!source && !(settlement && rpc)) return budget;
  try {
    const wei = source
      ? await source(epoch)
      : await createPublicClient({ transport: http(rpc) }).readContract({ address: settlement as Address, abi: ABI, functionName: "allowance", args: [BigInt(epoch)] });
    const allowance = Number(wei / WEI_PER_UCLD);
    if (allowance < budget) log.api.warn(`[ledger] epoch ${epoch}: EPOCH_SUBSIDY_BUDGET_UCLD ${budget} is above the chain allowance ${allowance} µCLD — lane B capped at the allowance`);
    return Math.min(budget, allowance);
  } catch (err) {
    log.api.warn(`[ledger] epoch ${epoch}: could not read the chain allowance, using the env budget ${budget}:`, err);
    return budget;
  }
}
