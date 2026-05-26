/**
 * Contract addresses and chain config for orchestrator backend.
 *
 * Supports two modes:
 *   1. Inlined data (Cloudflare Workers) — imports from lib/addresses-data.ts
 *   2. Filesystem fallback (Node.js) — reads shared/addresses.{network}.json
 */
import { addresses as inlinedAddresses } from "../lib/addresses-data.js";
import { log } from "../lib/logger.js";

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

export const contractAddresses = loadAddresses();
export const chainId = Number(process.env.CHAIN_ID ?? 84532);
export const rpcUrl = process.env.ORCHESTRATOR_CHAIN_RPC_URL ?? process.env.RPC_URL ?? "https://sepolia.base.org";
export const orchestratorPrivateKey = process.env.ORCHESTRATOR_PRIVATE_KEY ?? "";

// RPC Transport Configuration
export type RpcTransportMode = 'http' | 'websocket' | 'hybrid';
export const rpcTransportMode = (process.env.ORCHESTRATOR_RPC_TRANSPORT ?? 'http') as RpcTransportMode;
export const wssUrl = process.env.ORCHESTRATOR_CHAIN_WSS_URL ?? "";
export const websocketRetryCount = Number(process.env.ORCHESTRATOR_WEBSOCKET_RETRY_COUNT ?? 3);
export const websocketRetryDelay = Number(process.env.ORCHESTRATOR_WEBSOCKET_RETRY_DELAY ?? 3000);
