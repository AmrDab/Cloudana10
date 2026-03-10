/**
 * Contract addresses and chain config for orchestrator backend.
 * REQUIREMENT: Orchestrator MUST read contract addresses from shared/addresses.{network}.json.
 * No fallback to environment variables - ensures all components (orchestrator, provider, workload) 
 * use the same source of truth for contract addresses.
 * Path: client/api/src/config -> ../../../../shared (project root shared/).
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { log } from "../lib/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sharedPath = process.env.SHARED_PATH ?? path.join(__dirname, "..", "..", "..", "..", "shared");
const networkName = process.env.CHAIN_NETWORK ?? "baseSepolia";
const L = log.config;

function loadAddresses(): Record<string, string> {
  L.info("Loading addresses from", sharedPath);
  const file = path.join(sharedPath, `addresses.${networkName}.json`);
  L.log("File exists:", fs.existsSync(file));
  if (!fs.existsSync(file)) {
    throw new Error(
      `Contract addresses file not found at ${file}. ` +
      `Orchestrator MUST read contract addresses from shared directory, not from env file. ` +
      `Please deploy contracts first or ensure the shared/addresses.${networkName}.json file exists.`
    );
  }
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!data.contracts) {
    throw new Error(
      `Invalid contract addresses file at ${file}. ` +
      `Expected a "contracts" field with contract addresses.`
    );
  }
  L.success("Data loaded from", file, data);
  return data.contracts;
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
