/**
 * Contract addresses and chain config for orchestrator backend.
 *
 * Supports two modes:
 *   1. Inlined data (Cloudflare Workers) — imports from lib/addresses-data.ts
 *   2. Filesystem fallback (Node.js) — reads shared/addresses.{network}.json
 */
import { addresses as inlinedAddresses } from "../lib/addresses-data.js";
import { log } from "../lib/logger.js";
import { getEnv } from "./env.js";

const L = log.config;

function loadAddresses(): Record<string, string> {
  // Use inlined addresses (works in Workers and Node.js)
  const data = inlinedAddresses;
  if (!data.contracts) {
    throw new Error("Invalid inlined addresses data — missing contracts field.");
  }
  L.success("Loaded inlined contract addresses", data);
  return data.contracts as unknown as Record<string, string>;
}

// Doesn't touch process.env, so this stays eager.
export const contractAddresses = loadAddresses();

// Everything below is sourced from getEnv(), which must not run at import
// time (the Worker bridges env into process.env per request) — so these are
// functions, not top-level consts, and callers invoke them per use.
export function getChainId(): number {
  return getEnv().CHAIN_ID ?? 84532;
}

export function getRpcUrl(): string {
  return getEnv().ORCHESTRATOR_CHAIN_RPC_URL ?? getEnv().RPC_URL ?? "https://sepolia.base.org";
}

// RPC Transport Configuration
export type RpcTransportMode = 'http' | 'websocket' | 'hybrid';
export function getRpcTransportMode(): RpcTransportMode {
  return getEnv().ORCHESTRATOR_RPC_TRANSPORT as RpcTransportMode;
}

export function getWssUrl(): string {
  return getEnv().ORCHESTRATOR_CHAIN_WSS_URL ?? "";
}

export function getWebsocketRetryCount(): number {
  return getEnv().ORCHESTRATOR_WEBSOCKET_RETRY_COUNT;
}

export function getWebsocketRetryDelay(): number {
  return getEnv().ORCHESTRATOR_WEBSOCKET_RETRY_DELAY;
}
