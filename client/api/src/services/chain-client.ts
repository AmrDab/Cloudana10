/**
 * Chain client for orchestrator backend: read registries, write placement/status/rewards.
 * Supports both WebSocket and HTTP polling transports based on configuration.
 */
import { createPublicClient, createWalletClient, http, webSocket, fallback, type Abi, type Address, type Transport } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { 
  contractAddresses, 
  chainId, 
  rpcUrl, 
  orchestratorPrivateKey,
  rpcTransportMode,
  wssUrl,
  websocketRetryCount,
  websocketRetryDelay
} from "../config/contracts.js";
import { log } from "../lib/logger.js";

const L = log.config;
const BlockchainLog = log.blockchain;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sharedAbiPath = process.env.SHARED_PATH
  ? path.join(process.env.SHARED_PATH, "abi")
  : path.join(__dirname, "..", "..", "..", "..", "shared", "abi");

function loadAbi(name: string): unknown[] {
  const file = path.join(sharedAbiPath, `${name}.json`);
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * Create RPC transport based on configuration.
 * Supports: http, websocket, hybrid (websocket + http fallback)
 */
function createRpcTransport(): Transport {
  L.info(`[RPC Transport] Mode: ${rpcTransportMode}`);
  
  switch (rpcTransportMode) {
    case 'websocket': {
      if (!wssUrl) {
        L.warn("[RPC Transport] WebSocket mode selected but ORCHESTRATOR_CHAIN_WSS_URL not set. Falling back to HTTP.");
        return http(rpcUrl);
      }
      L.success(`[RPC Transport] Using WebSocket: ${wssUrl.slice(0, 40)}...`);
      return webSocket(wssUrl, {
        reconnect: true,
        retryCount: websocketRetryCount,
        retryDelay: websocketRetryDelay,
      });
    }
    
    case 'hybrid': {
      if (!wssUrl) {
        L.warn("[RPC Transport] Hybrid mode selected but ORCHESTRATOR_CHAIN_WSS_URL not set. Using HTTP only.");
        return http(rpcUrl);
      }
      L.success(`[RPC Transport] Using Hybrid (WebSocket + HTTP fallback)`);
      L.log(`  - Primary: ${wssUrl.slice(0, 40)}...`);
      L.log(`  - Fallback: ${rpcUrl.slice(0, 40)}...`);
      return fallback([
        webSocket(wssUrl, {
          reconnect: true,
          retryCount: websocketRetryCount,
          retryDelay: websocketRetryDelay,
        }),
        http(rpcUrl),
      ]);
    }
    
    case 'http':
    default: {
      L.success(`[RPC Transport] Using HTTP: ${rpcUrl.slice(0, 40)}...`);
      return http(rpcUrl);
    }
  }
}

const transport = createRpcTransport();
const chain = chainId === 84532 ? baseSepolia : { id: chainId, name: "unknown", nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" }, rpcUrls: { default: { http: [rpcUrl] } } };

export const publicClient = createPublicClient({ chain, transport });

const account = orchestratorPrivateKey
  ? privateKeyToAccount(("0x" + orchestratorPrivateKey.replace(/^0x/, "")) as `0x${string}`)
  : null;
export const walletClient = account
  ? createWalletClient({ account, chain, transport })
  : null;

const WorkloadRegistryAbi = loadAbi("WorkloadRegistry") as Abi;
const ProviderRegistryAbi = loadAbi("ProviderRegistry") as Abi;
const RewardContractAbi = loadAbi("RewardContract") as Abi;

export function getWorkloadRegistryAddress(): Address {
  const a = contractAddresses.WorkloadRegistry;
  if (!a || a === "0x0000000000000000000000000000000000000000") throw new Error("WorkloadRegistry address not set");
  return a as Address;
}

export function getProviderRegistryAddress(): Address {
  const a = contractAddresses.ProviderRegistry;
  if (!a || a === "0x0000000000000000000000000000000000000000") return "0x0000000000000000000000000000000000000000" as Address;
  return a as Address;
}

export function getRewardContractAddress(): Address {
  const a = contractAddresses.RewardContract;
  if (!a || a === "0x0000000000000000000000000000000000000000") throw new Error("RewardContract address not set");
  return a as Address;
}

// --- Read WorkloadRegistry ---
export async function readWorkload(workloadId: bigint) {
  return publicClient.readContract({
    address: getWorkloadRegistryAddress(),
    abi: WorkloadRegistryAbi,
    functionName: "getWorkload",
    args: [workloadId],
  });
}

/** Requirements shape used by placement (numeric only). */
export type WorkloadRequirementsReq = {
  cpu: bigint;
  memoryBytes: bigint;
  storageBytes: bigint;
  gpuCount: bigint;
};

/** Workload from chain (metadataUri-focused, like Provider). */
export type ChainWorkload = {
  id: bigint;
  owner: string;
  metadataUri: string;
  status: number; // 0=Inactive, 1=Active
  registeredAt: bigint;
  updatedAt: bigint;
  placementProvider: string;
  placementInstanceId: bigint;
};

export async function getActiveWorkloadIds(): Promise<bigint[]> {
  const address = getWorkloadRegistryAddress();
  BlockchainLog.info(`📖 Reading from blockchain: getActiveWorkloadIds()`);
  BlockchainLog.dim(`  Contract: WorkloadRegistry @ ${address}`);
  
  const startTime = Date.now();
  const list = await publicClient.readContract({
    address,
    abi: WorkloadRegistryAbi,
    functionName: "getActiveWorkloadIds",
  }) as bigint[];
  const duration = Date.now() - startTime;
  
  const result = list ?? [];
  BlockchainLog.success(`✅ Retrieved ${result.length} active workload ID(s) (${duration}ms)`);
  if (result.length > 0 && result.length <= 5) {
    BlockchainLog.log(`  IDs: ${result.map(id => id.toString()).join(', ')}`);
  } else if (result.length > 5) {
    BlockchainLog.log(`  First 5 IDs: ${result.slice(0, 5).map(id => id.toString()).join(', ')}... (+${result.length - 5} more)`);
  }
  
  return result;
}

export async function getWorkloadsBatch(workloadIds: bigint[]): Promise<ChainWorkload[]> {
  if (workloadIds.length === 0) {
    BlockchainLog.dim(`  getWorkloadsBatch: Empty input, returning []`);
    return [];
  }
  
  const address = getWorkloadRegistryAddress();
  BlockchainLog.info(`📖 Reading from blockchain: getWorkloadsBatch(${workloadIds.length} IDs)`);
  BlockchainLog.dim(`  Contract: WorkloadRegistry @ ${address}`);
  
  const startTime = Date.now();
  const batch = await publicClient.readContract({
    address,
    abi: WorkloadRegistryAbi,
    functionName: "getWorkloadsBatch",
    args: [workloadIds],
  }) as ChainWorkload[];
  const duration = Date.now() - startTime;
  
  const result = Array.isArray(batch) ? batch : [];
  BlockchainLog.success(`✅ Retrieved ${result.length} workload(s) (${duration}ms)`);
  
  return result;
}

/** Batch-read pending workload IDs. Kept for backward compatibility. */
export async function readPendingWorkloadIds(): Promise<bigint[]> {
  const pending = await readPendingWorkloadsWithRequirements();
  return pending.map((p) => p.workloadId);
}

/**
 * Active workloads that are not yet placed (placementProvider == 0). Requirements loaded from IPFS (metadataUri).
 */
export async function readPendingWorkloadsWithRequirements(): Promise<
  { workloadId: bigint; ownerAddress: Address; requirements: WorkloadRequirementsReq }[]
> {
  const { fetchWorkloadRequirementsFromUri } = await import("./ipfs.service.js");
  const activeIds = await getActiveWorkloadIds();
  if (activeIds.length === 0) return [];
  const workloads = await getWorkloadsBatch(activeIds);
  const out: { workloadId: bigint; ownerAddress: Address; requirements: WorkloadRequirementsReq }[] = [];
  const zeroAddr = "0x0000000000000000000000000000000000000000";
  for (let i = 0; i < workloads.length; i++) {
    const w = workloads[i];
    if (!w || w.status !== 1) continue;
    if (w.placementProvider !== zeroAddr && w.placementProvider !== "") continue;
    const metadataUri = w.metadataUri ?? "";
    if (!metadataUri) continue;
    const requirements = await fetchWorkloadRequirementsFromUri(metadataUri);
    if (!requirements) continue;
    out.push({ workloadId: activeIds[i], ownerAddress: w.owner as Address, requirements });
  }
  return out;
}

// --- Read ProviderRegistry (Option A: keyed by deviceId; one wallet can have many devices) ---
export type DeviceId = `0x${string}`;

export async function getActiveProviders(): Promise<DeviceId[]> {
  const addr = getProviderRegistryAddress();
  if (addr === "0x0000000000000000000000000000000000000000") {
    BlockchainLog.warn(`⚠️  ProviderRegistry address not set, returning empty array`);
    return [];
  }
  
  BlockchainLog.info(`📖 Reading from blockchain: getActiveProviders()`);
  BlockchainLog.dim(`  Contract: ProviderRegistry @ ${addr}`);
  
  const startTime = Date.now();
  const list = await publicClient.readContract({
    address: addr,
    abi: ProviderRegistryAbi,
    functionName: "getActiveProviders",
  }) as DeviceId[];
  const duration = Date.now() - startTime;
  
  const result = list ?? [];
  BlockchainLog.success(`✅ Retrieved ${result.length} active provider device(s) (${duration}ms)`);
  if (result.length > 0 && result.length <= 3) {
    result.forEach((deviceId, idx) => {
      BlockchainLog.log(`  ${idx + 1}. ${deviceId.slice(0, 10)}...${deviceId.slice(-8)}`);
    });
  } else if (result.length > 3) {
    BlockchainLog.log(`  First 3: ${result.slice(0, 3).map(id => id.slice(0, 10) + '...').join(', ')}... (+${result.length - 3} more)`);
  }
  
  return result;
}

/** Raw provider struct returned by ProviderRegistry.getProviderByDevice */
export type ChainProvider = {
  providerAddr: Address;
  deviceId: `0x${string}`;
  metadataUri: string;
  status: number;
  registeredAt: bigint;
  updatedAt: bigint;
};

export async function getProviderByDevice(deviceId: DeviceId): Promise<ChainProvider | null> {
  const addr = getProviderRegistryAddress();
  if (addr === "0x0000000000000000000000000000000000000000") return null;
  const result = await publicClient.readContract({
    address: addr,
    abi: ProviderRegistryAbi,
    functionName: "getProviderByDevice",
    args: [deviceId],
  });
  return result as ChainProvider | null;
}

/** Returns the owner address for a device ID. */
export async function getDeviceOwner(deviceId: DeviceId): Promise<Address | null> {
  const addr = getProviderRegistryAddress();
  if (addr === "0x0000000000000000000000000000000000000000") return null;
  return publicClient.readContract({
    address: addr,
    abi: ProviderRegistryAbi,
    functionName: "getDeviceOwner",
    args: [deviceId],
  }) as Promise<Address | null>;
}

/**
 * Get provider by address (alias for getProviderByDevice where address is the device ID).
 * In the current registry model, providers are keyed by deviceId, which is their address.
 */
export async function getProviderByAddress(providerAddress: Address): Promise<ChainProvider | null> {
  return getProviderByDevice(providerAddress as DeviceId);
}

// --- Write (orchestrator) ---
async function ensureWallet() {
  if (!walletClient || !account) throw new Error("Orchestrator private key not set (ORCHESTRATOR_PRIVATE_KEY)");
  return { walletClient, account };
}

export async function recordPlacement(workloadId: bigint, provider: Address, instanceId: bigint) {
  const { walletClient: w, account: a } = await ensureWallet();
  const contractAddress = getWorkloadRegistryAddress();
  
  BlockchainLog.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  BlockchainLog.info(`📝 RECORDING PLACEMENT ON BLOCKCHAIN`);
  BlockchainLog.info(`   Function: WorkloadRegistry.recordPlacement()`);
  BlockchainLog.info(`   Contract: ${contractAddress}`);
  BlockchainLog.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  BlockchainLog.info(`   Parameters:`);
  BlockchainLog.info(`     workloadId: ${workloadId}`);
  BlockchainLog.info(`     provider: ${provider}`);
  BlockchainLog.info(`     instanceId: ${instanceId}`);
  BlockchainLog.info(`   Transaction from: ${a.address}`);
  BlockchainLog.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  
  const startTime = Date.now();
  BlockchainLog.info(`🔄 Step 1/3: Sending transaction to blockchain...`);
  
  const hash = await w.writeContract({
    address: contractAddress,
    abi: WorkloadRegistryAbi,
    functionName: "recordPlacement",
    args: [workloadId, provider, instanceId],
    account: a,
  });
  const sendDuration = Date.now() - startTime;
  
  BlockchainLog.success(`✅ Step 2/3: Transaction sent to mempool (${sendDuration}ms)`);
  BlockchainLog.info(`   TX Hash: ${hash}`);
  BlockchainLog.info(`   View on explorer: https://sepolia.basescan.org/tx/${hash}`);
  BlockchainLog.info(`⏳ Step 3/3: Waiting for block confirmation...`);
  
  const confirmStartTime = Date.now();
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const confirmDuration = Date.now() - confirmStartTime;
  const totalDuration = Date.now() - startTime;
  
  BlockchainLog.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  if (receipt.status === 'success') {
    BlockchainLog.success(`🎉 TRANSACTION CONFIRMED!`);
    BlockchainLog.success(`   Status: SUCCESS ✅`);
    BlockchainLog.info(`   Block Number: ${receipt.blockNumber}`);
    BlockchainLog.info(`   Gas Used: ${receipt.gasUsed.toString()}`);
    BlockchainLog.info(`   Confirmation Time: ${confirmDuration}ms`);
    BlockchainLog.info(`   Total Time: ${totalDuration}ms`);
    BlockchainLog.info(`   TX Hash: ${hash}`);
    BlockchainLog.success(`   🔗 Workload ${workloadId} is now officially placed on-chain!`);
  } else {
    BlockchainLog.error(`❌ TRANSACTION REVERTED!`);
    BlockchainLog.error(`   Status: FAILED ❌`);
    BlockchainLog.error(`   Block Number: ${receipt.blockNumber}`);
    BlockchainLog.error(`   Total Time: ${totalDuration}ms`);
    BlockchainLog.error(`   The placement was NOT recorded on blockchain`);
  }
  BlockchainLog.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  
  return receipt;
}

export async function rewardProvider(provider: Address, workloadId: bigint, amount: bigint) {
  const { walletClient: w, account: a } = await ensureWallet();
  const hash = await w.writeContract({
    address: getRewardContractAddress(),
    abi: RewardContractAbi,
    functionName: "rewardProvider",
    args: [provider, workloadId, amount],
    account: a,
  });
  return publicClient.waitForTransactionReceipt({ hash });
}

// --- Event subscriptions (event-driven orchestrator) ---
export type WorkloadRegistryEventCallbacks = {
  onWorkloadRegistered: (workloadId: bigint) => void;
  onWorkloadDeregistered: (workloadId: bigint) => void;
  /** Called when workload is permanently deleted from the contract. */
  onWorkloadDeleted?: (workloadId: bigint) => void;
  /** Called when workload is activated or deregistered (capacity freed). */
  onCapacityFreed: () => void;
};

/**
 * Subscribe to WorkloadRegistry events. Returns an unsubscribe function.
 * Uses public client (http transport polls for new logs).
 */
export function watchWorkloadRegistryEvents(
  callbacks: WorkloadRegistryEventCallbacks
): () => void {
  const address = getWorkloadRegistryAddress();
  type LogArgs = { args?: { workloadId?: bigint } };

  const unsubRegistered = publicClient.watchContractEvent({
    address,
    abi: WorkloadRegistryAbi,
    eventName: "WorkloadRegistered",
    onLogs: (logs) => {
      for (const log of logs) {
        const args = (log as unknown as LogArgs).args;
        const workloadId = args?.workloadId;
        if (workloadId !== undefined) callbacks.onWorkloadRegistered(workloadId);
      }
    },
  });

  const unsubDeregistered = publicClient.watchContractEvent({
    address,
    abi: WorkloadRegistryAbi,
    eventName: "WorkloadDeregistered",
    onLogs: (logs) => {
      for (const log of logs) {
        const args = (log as unknown as LogArgs).args;
        const workloadId = args?.workloadId;
        if (workloadId !== undefined) callbacks.onWorkloadDeregistered(workloadId);
      }
      callbacks.onCapacityFreed();
    },
  });

  const unsubActivated = publicClient.watchContractEvent({
    address,
    abi: WorkloadRegistryAbi,
    eventName: "WorkloadActivated",
    onLogs: (logs) => {
      for (const log of logs) {
        const args = (log as unknown as LogArgs).args;
        const workloadId = args?.workloadId;
        if (workloadId !== undefined) callbacks.onWorkloadRegistered(workloadId);
      }
    },
  });

  const unsubDeleted = publicClient.watchContractEvent({
    address,
    abi: WorkloadRegistryAbi,
    eventName: "WorkloadDeleted",
    onLogs: (logs) => {
      for (const log of logs) {
        const args = (log as unknown as LogArgs).args;
        const workloadId = args?.workloadId;
        if (workloadId !== undefined && callbacks.onWorkloadDeleted) {
          callbacks.onWorkloadDeleted(workloadId);
        }
      }
    },
  });

  return () => {
    unsubRegistered();
    unsubDeregistered();
    unsubActivated();
    unsubDeleted();
  };
}

// --- Provider Registry Event Subscriptions ---
export type ProviderRegistryEventCallbacks = {
  onProviderRegistered: (deviceId: DeviceId, owner: string) => void;
  onProviderActivated: (deviceId: DeviceId, owner: string) => void;
  onProviderDeregistered: (deviceId: DeviceId, owner: string) => void;
  /** Called when new provider capacity becomes available. */
  onNewCapacityAvailable: () => void;
};

/**
 * Subscribe to ProviderRegistry events. Returns an unsubscribe function.
 * Uses public client (http transport polls for new logs).
 */
export function watchProviderRegistryEvents(
  callbacks: ProviderRegistryEventCallbacks
): () => void {
  const address = getProviderRegistryAddress();
  if (address === "0x0000000000000000000000000000000000000000") {
    return () => {}; // No-op if provider registry not set
  }
  
  type ProviderLogArgs = { args?: { deviceId?: DeviceId; owner?: string } };

  const unsubRegistered = publicClient.watchContractEvent({
    address,
    abi: ProviderRegistryAbi,
    eventName: "ProviderRegistered",
    onLogs: (logs) => {
      for (const log of logs) {
        const args = (log as unknown as ProviderLogArgs).args;
        const deviceId = args?.deviceId;
        const owner = args?.owner;
        if (deviceId && owner) {
          callbacks.onProviderRegistered(deviceId, owner);
        }
      }
      callbacks.onNewCapacityAvailable();
    },
  });

  const unsubActivated = publicClient.watchContractEvent({
    address,
    abi: ProviderRegistryAbi,
    eventName: "ProviderActivated",
    onLogs: (logs) => {
      for (const log of logs) {
        const args = (log as unknown as ProviderLogArgs).args;
        const deviceId = args?.deviceId;
        const owner = args?.owner;
        if (deviceId && owner) {
          callbacks.onProviderActivated(deviceId, owner);
        }
      }
      callbacks.onNewCapacityAvailable();
    },
  });

  const unsubDeregistered = publicClient.watchContractEvent({
    address,
    abi: ProviderRegistryAbi,
    eventName: "ProviderDeregistered",
    onLogs: (logs) => {
      for (const log of logs) {
        const args = (log as unknown as ProviderLogArgs).args;
        const deviceId = args?.deviceId;
        const owner = args?.owner;
        if (deviceId && owner) {
          callbacks.onProviderDeregistered(deviceId, owner);
        }
      }
    },
  });

  return () => {
    unsubRegistered();
    unsubActivated();
    unsubDeregistered();
  };
}
