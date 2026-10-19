/**
 * Contract addresses and chain config.
 *
 * Addresses come inlined (lib/addresses-data.ts, generated from shared/addresses.*.json) so the Worker needs no
 * filesystem. Every address currently listed is a legacy contract under a compromised key and is read-only
 * (routes/v1/pouw.ts shows historical certificates); the v2 token and settlement are not deployed yet
 * (docs/OWNER_RUNBOOK.md step 4). The API Worker holds no chain key.
 */
import { addresses as inlinedAddresses } from "../lib/addresses-data.js";
import { log } from "../lib/logger.js";
import { getEnv } from "./env.js";

const L = log.config;

function loadAddresses(): Record<string, string> {
  const data = inlinedAddresses;
  if (!data.contracts) {
    throw new Error("Invalid inlined addresses data — missing contracts field.");
  }
  L.success("Loaded inlined contract addresses", data);
  return data.contracts as unknown as Record<string, string>;
}

// Doesn't touch process.env, so this stays eager.
export const contractAddresses = loadAddresses();

// Sourced from getEnv(), which must not run at import time (the Worker bridges env into process.env per request).
export function getChainId(): number {
  return getEnv().CHAIN_ID ?? 84532;
}

/** Read-only RPC: the assignment-seed / deposit-watcher URL first, then the generic one, then the public endpoint. */
export function getRpcUrl(): string {
  return getEnv().CHAIN_RPC_URL ?? getEnv().RPC_URL ?? "https://sepolia.base.org";
}
