// Contract interaction utilities and hooks for DePIN system
import React from "react";
import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseEther, formatEther, type Address } from "viem";
import {
  CONTRACT_ADDRESSES,
  CLDTokenAbi,
  WorkloadRegistryAbi,
  ProviderRegistryAbi,
  RewardContractAbi,
  POUWVerifierAbi,
  StakingManagerAbi,
  ChallengeManagerAbi,
} from "@shared/contracts";
import { devLoggers } from "@/lib/logger";
import { baseSepolia } from "@reown/appkit/networks";

export const CHAIN_ID = CONTRACT_ADDRESSES.chainId;
export const NETWORK = baseSepolia;

// Contract addresses
export const CLD_TOKEN_ADDRESS = CONTRACT_ADDRESSES.contracts.CLDToken as Address;
export const WORKLOAD_REGISTRY_ADDRESS = CONTRACT_ADDRESSES.contracts.WorkloadRegistry as Address;
export const PROVIDER_REGISTRY_ADDRESS = CONTRACT_ADDRESSES.contracts.ProviderRegistry as Address;
export const REWARD_CONTRACT_ADDRESS = CONTRACT_ADDRESSES.contracts.RewardContract as Address;
export const POUW_VERIFIER_ADDRESS = CONTRACT_ADDRESSES.contracts.POUWVerifier as Address;
export const STAKING_MANAGER_ADDRESS = CONTRACT_ADDRESSES.contracts.StakingManager as Address;
export const CHALLENGE_MANAGER_ADDRESS = CONTRACT_ADDRESSES.contracts.ChallengeManager as Address;

// Re-export new ABIs
export { POUWVerifierAbi, StakingManagerAbi, ChallengeManagerAbi };

// Helper to convert string to bytes32
export function stringToBytes32(str: string): `0x${string}` {
  const hash = str.startsWith("0x") ? str.slice(2) : str;
  // Pad or truncate to 64 hex characters (32 bytes)
  const padded = hash.padEnd(64, "0").slice(0, 64);
  return `0x${padded}` as `0x${string}`;
}

// Helper to convert hex string to bytes32
export function hexToBytes32(hex: string): `0x${string}` {
  if (hex.startsWith("0x")) {
    hex = hex.slice(2);
  }
  // Pad or truncate to 64 hex characters (32 bytes)
  const padded = hex.padEnd(64, "0").slice(0, 64);
  return `0x${padded}` as `0x${string}`;
}

// Generate random public key hash (for demo purposes)
export function generatePubKeyHash(): string {
  const randomBytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(randomBytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

// ============== CLD Token Hooks ==============

export function useCLDTokenBalance(address?: Address) {
  return useReadContract({
    address: CLD_TOKEN_ADDRESS,
    abi: CLDTokenAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: {
      enabled: !!address,
      refetchInterval: 5000, // Refetch every 5 seconds
      staleTime: 3000, // Data considered fresh for 3 seconds
    },
  });
}

export function useCLDTokenAllowance(owner?: Address, spender?: Address) {
  return useReadContract({
    address: CLD_TOKEN_ADDRESS,
    abi: CLDTokenAbi,
    functionName: "allowance",
    args: owner && spender ? [owner, spender] : undefined,
    chainId: CHAIN_ID,
    query: {
      enabled: !!owner && !!spender,
      refetchInterval: 5000, // Refetch every 5 seconds
      staleTime: 3000, // Data considered fresh for 3 seconds
    },
  });
}

export function useApproveCLDToken() {
  const { writeContract, data: hash, isPending: isWritePending, error: writeError, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, error: confirmError } = useWaitForTransactionReceipt({ 
    hash,
    query: {
      enabled: !!hash,
      retry: 3, // Retry failed RPC calls
      retryDelay: 1000, // Wait 1 second between retries
    },
  });

  const approve = (spender: Address, amount: string) => {
    // Reset any previous errors before new transaction
    reset();
    writeContract({
      address: CLD_TOKEN_ADDRESS,
      abi: CLDTokenAbi,
      functionName: "approve",
      args: [spender, parseEther(amount)],
    });
  };

  // Comprehensive loading state: active from submission through confirmation
  // - isWritePending: true while submitting transaction to wallet/network
  // - !!hash && !isSuccess && !confirmError: true when transaction submitted but not yet confirmed
  // - isConfirming: true while actively waiting for block confirmation
  const isPending = isWritePending || isConfirming || (!!hash && !isSuccess && !confirmError);

  if (hash) {
    devLoggers.contract.debug('[useApproveCLDToken] State:', {
      hash: hash?.slice(0, 10) + '...',
      isWritePending,
      isConfirming,
      isSuccess,
      confirmError: !!confirmError,
      isPending,
    });
  }

  return {
    approve,
    hash,
    isPending,
    isSuccess,
    error: writeError || confirmError,
    reset,
  };
}


// ============== Workload Registry Hooks ==============

export interface ResourceRequirements {
  cpu: bigint;
  memory: bigint;
  storage: bigint;
  storageClasses: string[];
  requiresGPU: boolean;
  gpuCount: bigint;
  gpuAttributes: string[];
  requiresEdge: boolean;
  regions: string[];
  maxLatency: bigint;
}

/** Workload from chain: metadataUri (IPFS/URL), status (0=Inactive, 1=Active), placementProvider, placementInstanceId. */
export function useWorkloadInfo(workloadId?: bigint) {
  return useReadContract({
    address: WORKLOAD_REGISTRY_ADDRESS,
    abi: WorkloadRegistryAbi,
    functionName: "getWorkload",
    args: workloadId !== undefined ? [workloadId] : undefined,
    chainId: CHAIN_ID,
    query: {
      enabled: workloadId !== undefined && WORKLOAD_REGISTRY_ADDRESS !== "0x0000000000000000000000000000000000000000",
      refetchInterval: 5000,
      staleTime: 3000,
    },
  });
}

export function useUserWorkloads(user?: Address) {
  return useReadContract({
    address: WORKLOAD_REGISTRY_ADDRESS,
    abi: WorkloadRegistryAbi,
    functionName: "getUserWorkloads",
    args: user ? [user] : undefined,
    chainId: CHAIN_ID,
    query: {
      enabled: !!user && WORKLOAD_REGISTRY_ADDRESS !== "0x0000000000000000000000000000000000000000",
      refetchInterval: 5000, // Refetch every 5 seconds
      staleTime: 3000, // Data considered fresh for 3 seconds
    },
  });
}

export function useWorkloadCount() {
  return useReadContract({
    address: WORKLOAD_REGISTRY_ADDRESS,
    abi: WorkloadRegistryAbi,
    functionName: "getWorkloadCount",
    chainId: CHAIN_ID,
    query: {
      enabled: WORKLOAD_REGISTRY_ADDRESS !== "0x0000000000000000000000000000000000000000",
      refetchInterval: 10000, // Refetch every 10 seconds
      staleTime: 5000, // Data considered fresh for 5 seconds
    },
  });
}

/** Register a new workload with metadataUri (IPFS CID or gateway URL). Full manifest/requirements live on IPFS. */
export function useRegisterWorkload() {
  const { writeContract, data: hash, isPending: isWritePending, error: writeError, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, error: confirmError } = useWaitForTransactionReceipt({
    hash,
    query: { enabled: !!hash, retry: 3, retryDelay: 1000 },
  });

  const register = (metadataUri: string) => {
    if (!metadataUri || typeof metadataUri !== "string" || metadataUri.trim() === "") return;
    reset();
    devLoggers.contract.log("[useRegisterWorkload] Registering workload with metadataUri...");
    writeContract({
      address: WORKLOAD_REGISTRY_ADDRESS,
      abi: WorkloadRegistryAbi,
      functionName: "registerWorkload",
      args: [metadataUri.trim()],
    });
  };

  const isPending = isWritePending || isConfirming || (!!hash && !isSuccess && !confirmError);
  return { register, hash, isPending, isSuccess, error: writeError || confirmError, reset };
}

/** @deprecated Use useRegisterWorkload. Kept for compatibility. */
export function useCreateWorkload() {
  const r = useRegisterWorkload();
  return { create: r.register, hash: r.hash, isPending: r.isPending, isSuccess: r.isSuccess, error: r.error, reset: r.reset };
}

/** Update workload metadata URI (owner only). */
export function useUpdateWorkload() {
  const { writeContract, data: hash, isPending: isWritePending, error: writeError, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, error: confirmError } = useWaitForTransactionReceipt({ hash, query: { enabled: !!hash } });

  const update = (workloadId: bigint, newMetadataUri: string) => {
    if (!newMetadataUri || typeof newMetadataUri !== "string" || newMetadataUri.trim() === "") return;
    reset();
    writeContract({
      address: WORKLOAD_REGISTRY_ADDRESS,
      abi: WorkloadRegistryAbi,
      functionName: "updateWorkload",
      args: [workloadId, newMetadataUri.trim()],
    });
  };

  const isPending = isWritePending || isConfirming || (!!hash && !isSuccess && !confirmError);
  return { update, hash, isPending, isSuccess, error: writeError || confirmError, reset };
}

/** Deregister workload (set inactive). Owner can activate again later. */
export function useDeregisterWorkload() {
  const { writeContract, data: hash, isPending: isWritePending, error: writeError, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, error: confirmError } = useWaitForTransactionReceipt({ hash, query: { enabled: !!hash } });

  const deregister = (workloadId: bigint) => {
    reset();
    writeContract({
      address: WORKLOAD_REGISTRY_ADDRESS,
      abi: WorkloadRegistryAbi,
      functionName: "deregisterWorkload",
      args: [workloadId],
    });
  };

  const isPending = isWritePending || isConfirming || (!!hash && !isSuccess && !confirmError);
  return { deregister, hash, isPending, isSuccess, error: writeError || confirmError, reset };
}

/** Reactivate a deregistered workload. */
export function useActivateWorkload() {
  const { writeContract, data: hash, isPending: isWritePending, error: writeError, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, error: confirmError } = useWaitForTransactionReceipt({ hash, query: { enabled: !!hash } });

  const activate = (workloadId: bigint) => {
    reset();
    writeContract({
      address: WORKLOAD_REGISTRY_ADDRESS,
      abi: WorkloadRegistryAbi,
      functionName: "activateWorkload",
      args: [workloadId],
    });
  };

  const isPending = isWritePending || isConfirming || (!!hash && !isSuccess && !confirmError);
  return { activate, hash, isPending, isSuccess, error: writeError || confirmError, reset };
}

/** Permanently delete workload (only inactive workloads can be deleted). */
export function useDeleteWorkload() {
  const { writeContract, data: hash, isPending: isWritePending, error: writeError, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, error: confirmError } = useWaitForTransactionReceipt({ hash, query: { enabled: !!hash } });

  const deleteWorkload = (workloadId: bigint) => {
    reset();
    writeContract({
      address: WORKLOAD_REGISTRY_ADDRESS,
      abi: WorkloadRegistryAbi,
      functionName: "deleteWorkload",
      args: [workloadId],
    });
  };

  const isPending = isWritePending || isConfirming || (!!hash && !isSuccess && !confirmError);
  return { deleteWorkload, hash, isPending, isSuccess, error: writeError || confirmError, reset };
}

// ============== Provider Registry Hooks ==============

export interface ProviderCapabilities {
  region: string;
  supportsEdge: boolean;
  storageClasses: string[];
  supportsGPU: boolean;
  maxGPUs: bigint;
  gpuModels: string[];
  runtime: string;
}

export interface ProviderCapacity {
  cpu: bigint;
  memoryBytes: bigint;
  storageBytes: bigint;
  gpuCount: bigint;
}

const PROVIDER_REGISTRY_ENABLED =
  PROVIDER_REGISTRY_ADDRESS !== "0x0000000000000000000000000000000000000000";

/** bytes32 device id (e.g. from GET /device-info or build-provider-status). */
export type ProviderDeviceId = `0x${string}`;

export function useRegisterProvider() {
  const { writeContract, data: hash, isPending: isWritePending, error: writeError, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, error: confirmError } = useWaitForTransactionReceipt({
    hash,
    query: { enabled: !!hash },
  });
  
  // Log transaction hash when received
  React.useEffect(() => {
    if (hash) {
      devLoggers.contract.success(`✅ Transaction sent!`);
      devLoggers.contract.log(`  TX Hash: ${hash}`);
      devLoggers.contract.info(`  ⏳ Waiting for confirmation...`);
    }
  }, [hash]);
  
  // Log confirmation status
  React.useEffect(() => {
    if (isSuccess && hash) {
      devLoggers.contract.success(`🎉 Transaction confirmed!`);
      devLoggers.contract.log(`  TX Hash: ${hash}`);
      devLoggers.contract.log("═══════════════════════════════════════════════════\n");
    }
  }, [isSuccess, hash]);
  
  // Log errors
  React.useEffect(() => {
    if (writeError) {
      devLoggers.contract.error(`❌ Transaction failed:`, writeError.message);
      devLoggers.contract.log("═══════════════════════════════════════════════════\n");
    }
    if (confirmError) {
      devLoggers.contract.error(`❌ Confirmation error:`, confirmError.message);
      devLoggers.contract.log("═══════════════════════════════════════════════════\n");
    }
  }, [writeError, confirmError]);

  /** Register provider: on-chain stores only metadataUri (IPFS CID or gateway URL). Full spec is on IPFS. */
  const register = (deviceId: ProviderDeviceId, metadataUri: string) => {
    devLoggers.contract.info("═══════════════════════════════════════════════════");
    devLoggers.contract.info("📝 Registering Provider On-Chain");
    devLoggers.contract.info("═══════════════════════════════════════════════════");
    
    if (!PROVIDER_REGISTRY_ENABLED) {
      devLoggers.contract.error("❌ ProviderRegistry address not set - cannot register");
      return;
    }
    if (!deviceId || typeof deviceId !== "string" || !deviceId.startsWith("0x")) {
      devLoggers.contract.error("❌ Invalid device ID format");
      return;
    }
    if (!metadataUri || typeof metadataUri !== "string" || metadataUri.trim() === "") {
      devLoggers.contract.error("❌ Invalid metadata URI");
      return;
    }
    
    devLoggers.contract.log("📦 Transaction Parameters:");
    devLoggers.contract.log(`  Contract: ProviderRegistry @ ${PROVIDER_REGISTRY_ADDRESS}`);
    devLoggers.contract.log(`  Function: registerProvider()`);
    devLoggers.contract.log(`  Device ID: ${deviceId}`);
    devLoggers.contract.log(`  Metadata URI: ${metadataUri.trim()}`);
    devLoggers.contract.info("🚀 Sending transaction (please confirm in wallet)...");
    
    reset();
    writeContract({
      address: PROVIDER_REGISTRY_ADDRESS,
      abi: ProviderRegistryAbi,
      functionName: "registerProvider",
      args: [deviceId, metadataUri.trim()],
    });
  };

  const isPending = isWritePending || isConfirming || (!!hash && !isSuccess && !confirmError);
  return {
    register,
    hash,
    isPending,
    isSuccess,
    error: writeError || confirmError,
    reset,
  };
}

/** Update provider metadata URI (re-upload to IPFS then call this with new CID). */
export function useUpdateProvider() {
  const { writeContract, data: hash, isPending: isWritePending, error: writeError, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, error: confirmError } = useWaitForTransactionReceipt({
    hash,
    query: { enabled: !!hash },
  });
  const update = (deviceId: ProviderDeviceId, newMetadataUri: string) => {
    if (!PROVIDER_REGISTRY_ENABLED) return;
    if (!deviceId || typeof deviceId !== "string" || !deviceId.startsWith("0x")) return;
    if (!newMetadataUri || typeof newMetadataUri !== "string" || newMetadataUri.trim() === "") return;
    reset();
    writeContract({
      address: PROVIDER_REGISTRY_ADDRESS,
      abi: ProviderRegistryAbi,
      functionName: "updateProvider",
      args: [deviceId, newMetadataUri.trim()],
    });
  };
  const isPending = isWritePending || isConfirming || (!!hash && !isSuccess && !confirmError);
  return {
    update,
    hash,
    isPending,
    isSuccess,
    error: writeError || confirmError,
    reset,
  };
}

export function useDeregisterProvider() {
  const { writeContract, data: hash, isPending: isWritePending, error: writeError, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, error: confirmError } = useWaitForTransactionReceipt({
    hash,
    query: { enabled: !!hash },
  });
  const deregister = (deviceId: ProviderDeviceId) => {
    if (!PROVIDER_REGISTRY_ENABLED) return;
    reset();
    writeContract({
      address: PROVIDER_REGISTRY_ADDRESS,
      abi: ProviderRegistryAbi,
      functionName: "deregisterProvider",
      args: [deviceId],
    });
  };
  const isPending = isWritePending || isConfirming || (!!hash && !isSuccess && !confirmError);
  return { deregister, hash, isPending, isSuccess, error: writeError || confirmError, reset };
}

export function useActivateProvider() {
  const { writeContract, data: hash, isPending: isWritePending, error: writeError, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, error: confirmError } = useWaitForTransactionReceipt({
    hash,
    query: { enabled: !!hash },
  });
  const activate = (deviceId: ProviderDeviceId) => {
    if (!PROVIDER_REGISTRY_ENABLED) return;
    reset();
    writeContract({
      address: PROVIDER_REGISTRY_ADDRESS,
      abi: ProviderRegistryAbi,
      functionName: "activateProvider",
      args: [deviceId],
    });
  };
  const isPending = isWritePending || isConfirming || (!!hash && !isSuccess && !confirmError);
  return { activate, hash, isPending, isSuccess, error: writeError || confirmError, reset };
}

export function useProviderRegistryBondInfo() {
  return {
    data: {
      minBond: BigInt(0),
      maxBond: BigInt(0),
    },
  };
}

/** List of deviceIds registered by the given owner (one wallet can have many devices). */
export function useMyProviders(user?: Address) {
  return useReadContract({
    address: PROVIDER_REGISTRY_ADDRESS,
    abi: ProviderRegistryAbi,
    functionName: "getProvidersByOwner",
    args: user ? [user] : undefined,
    chainId: CHAIN_ID,
    query: {
      enabled: PROVIDER_REGISTRY_ENABLED && !!user,
    },
  });
}

/** Provider info by device id (use after build or from useMyProviders device list). */
export function useProviderInfoByDevice(deviceId?: ProviderDeviceId) {
  return useReadContract({
    address: PROVIDER_REGISTRY_ADDRESS,
    abi: ProviderRegistryAbi,
    functionName: "getProviderByDevice",
    args: deviceId ? [deviceId] : undefined,
    chainId: CHAIN_ID,
    query: {
      enabled: PROVIDER_REGISTRY_ENABLED && !!deviceId,
    },
  });
}

/** @deprecated Use useProviderInfoByDevice(deviceId). Kept for compatibility where provider was address. */
export function useProviderInfo(providerAddressOrDeviceId?: Address | ProviderDeviceId) {
  return useProviderInfoByDevice(providerAddressOrDeviceId as ProviderDeviceId | undefined);
}

/** Active provider device ids (bytes32[]). */
export function useAllProviders() {
  return useReadContract({
    address: PROVIDER_REGISTRY_ADDRESS,
    abi: ProviderRegistryAbi,
    functionName: "getActiveProviders",
    chainId: CHAIN_ID,
    query: {
      enabled: PROVIDER_REGISTRY_ENABLED,
      refetchInterval: 10000,
    },
  });
}

// ============== Reward Contract Hooks ==============

const REWARD_CONTRACT_ENABLED =
  REWARD_CONTRACT_ADDRESS !== "0x0000000000000000000000000000000000000000";

export function useWorkloadDeposit(workloadId?: bigint) {
  return useReadContract({
    address: REWARD_CONTRACT_ADDRESS,
    abi: RewardContractAbi,
    functionName: "workloadDeposits",
    args: workloadId !== undefined ? [workloadId] : undefined,
    chainId: CHAIN_ID,
    query: {
      enabled: REWARD_CONTRACT_ENABLED && workloadId !== undefined,
      refetchInterval: 5000,
    },
  });
}

export function useProviderPendingRewards(provider?: Address) {
  return useReadContract({
    address: REWARD_CONTRACT_ADDRESS,
    abi: RewardContractAbi,
    functionName: "providerPendingRewards",
    args: provider ? [provider] : undefined,
    chainId: CHAIN_ID,
    query: {
      enabled: REWARD_CONTRACT_ENABLED && !!provider,
      refetchInterval: 5000,
    },
  });
}

export function useFundWorkload() {
  const { writeContract, data: hash, isPending: isWritePending, error: writeError, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, error: confirmError } = useWaitForTransactionReceipt({
    hash,
    query: { enabled: !!hash },
  });

  const fund = (workloadId: bigint, amount: string) => {
    if (!REWARD_CONTRACT_ENABLED) return;
    reset();
    writeContract({
      address: REWARD_CONTRACT_ADDRESS,
      abi: RewardContractAbi,
      functionName: "fundWorkload",
      args: [workloadId, parseEther(amount)],
    });
  };

  return {
    fund,
    hash,
    isPending: isWritePending || isConfirming || (!!hash && !isSuccess && !confirmError),
    isSuccess,
    error: writeError || confirmError,
    reset,
  };
}

export function useWithdrawEarnings() {
  const { writeContract, data: hash, isPending: isWritePending, error: writeError, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, error: confirmError } = useWaitForTransactionReceipt({
    hash,
    query: { enabled: !!hash },
  });

  const withdraw = () => {
    if (!REWARD_CONTRACT_ENABLED) return;
    reset();
    writeContract({
      address: REWARD_CONTRACT_ADDRESS,
      abi: RewardContractAbi,
      functionName: "withdrawEarnings",
    });
  };

  return {
    withdraw,
    hash,
    isPending: isWritePending || isConfirming || (!!hash && !isSuccess && !confirmError),
    isSuccess,
    error: writeError || confirmError,
    reset,
  };
}

// Aliases for provider-rewards-modal (same as Reward contract)
export function useProviderCredit(provider?: Address) {
  const result = useProviderPendingRewards(provider);
  return { data: result.data, refetch: result.refetch };
}

export function useWithdrawProvider() {
  return useWithdrawEarnings();
}
