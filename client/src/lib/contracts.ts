// Contract interaction utilities and hooks for DePIN system
import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseEther, formatEther, type Address } from "viem";
import { CONTRACT_ADDRESSES, CLDTokenAbi, WorkloadRegistryAbi } from "@shared/contracts";
import { baseSepolia } from "@reown/appkit/networks";

export const CHAIN_ID = CONTRACT_ADDRESSES.chainId;
export const NETWORK = baseSepolia;

// Contract addresses
export const CLD_TOKEN_ADDRESS = CONTRACT_ADDRESSES.contracts.CLDToken as Address;
export const WORKLOAD_REGISTRY_ADDRESS = CONTRACT_ADDRESSES.contracts.WorkloadRegistry as Address;

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
    .map((b) => b.toString(16).padStart(2, "0"))
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

  // Debug logging
  if (hash) {
    console.log('[useApproveCLDToken] State:', {
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
  memoryBytes: bigint;  // Changed from 'memory' (reserved keyword in Solidity)
  storageBytes: bigint; // Changed from 'storage' (reserved keyword in Solidity)
  storageClasses: string[];
  requiresGPU: boolean;
  gpuCount: bigint;
  gpuAttributes: string[];
  requiresEdge: boolean;
  regions: string[];
  maxLatency: bigint;
}

export function useWorkloadInfo(workloadId?: bigint) {
  return useReadContract({
    address: WORKLOAD_REGISTRY_ADDRESS,
    abi: WorkloadRegistryAbi,
    functionName: "workloads",
    args: workloadId !== undefined ? [workloadId] : undefined,
    chainId: CHAIN_ID,
    query: {
      enabled: workloadId !== undefined && WORKLOAD_REGISTRY_ADDRESS !== "0x0000000000000000000000000000000000000000",
      refetchInterval: 5000, // Refetch every 5 seconds
      staleTime: 3000, // Data considered fresh for 3 seconds
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

export function useCreateWorkload() {
  const { writeContract, data: hash, isPending: isWritePending, error: writeError, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, error: confirmError } = useWaitForTransactionReceipt({ 
    hash,
    query: {
      enabled: !!hash,
      retry: 3, // Retry failed RPC calls
      retryDelay: 1000, // Wait 1 second between retries
    },
  });

  const create = (manifestHash: string, requirements: ResourceRequirements) => {
    // Reset any previous errors before new transaction
    reset();
    console.log('[useCreateWorkload] Initiating workload creation...');
    
    // Convert manifestHash string to bytes32
    const manifestHashBytes32 = hexToBytes32(manifestHash);
    
    writeContract({
      address: WORKLOAD_REGISTRY_ADDRESS,
      abi: WorkloadRegistryAbi,
      functionName: "createWorkload",
      args: [manifestHashBytes32, requirements],
    });
  };

  // Comprehensive loading state: active from submission through confirmation
  const isPending = isWritePending || isConfirming || (!!hash && !isSuccess && !confirmError);

  // Debug logging
  if (hash || isWritePending) {
    console.log('[useCreateWorkload] State:', {
      hash: hash ? hash.slice(0, 10) + '...' : 'none',
      isWritePending,
      isConfirming,
      isSuccess,
      confirmError: !!confirmError,
      isPending,
    });
  }

  return {
    create,
    hash,
    isPending,
    isSuccess,
    error: writeError || confirmError,
    reset,
  };
}

export function useUpdateWorkload() {
  const { writeContract, data: hash, isPending: isWritePending, error: writeError, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, error: confirmError } = useWaitForTransactionReceipt({ 
    hash,
    query: {
      enabled: !!hash,
    },
  });

  const update = (workloadId: bigint, manifestHash: string, requirements: ResourceRequirements) => {
    reset();
    const manifestHashBytes32 = hexToBytes32(manifestHash);
    writeContract({
      address: WORKLOAD_REGISTRY_ADDRESS,
      abi: WorkloadRegistryAbi,
      functionName: "updateWorkload",
      args: [workloadId, manifestHashBytes32, requirements],
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

export function useScaleWorkload() {
  const { writeContract, data: hash, isPending: isWritePending, error: writeError, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, error: confirmError } = useWaitForTransactionReceipt({ 
    hash,
    query: {
      enabled: !!hash,
    },
  });

  const scale = (workloadId: bigint, newReplicas: bigint) => {
    reset();
    writeContract({
      address: WORKLOAD_REGISTRY_ADDRESS,
      abi: WorkloadRegistryAbi,
      functionName: "scaleWorkload",
      args: [workloadId, newReplicas],
    });
  };

  const isPending = isWritePending || isConfirming || (!!hash && !isSuccess && !confirmError);

  return {
    scale,
    hash,
    isPending,
    isSuccess,
    error: writeError || confirmError,
    reset,
  };
}

export function useTerminateWorkload() {
  const { writeContract, data: hash, isPending: isWritePending, error: writeError, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, error: confirmError } = useWaitForTransactionReceipt({ 
    hash,
    query: {
      enabled: !!hash,
    },
  });

  const terminate = (workloadId: bigint) => {
    reset();
    writeContract({
      address: WORKLOAD_REGISTRY_ADDRESS,
      abi: WorkloadRegistryAbi,
      functionName: "terminateWorkload",
      args: [workloadId],
    });
  };

  const isPending = isWritePending || isConfirming || (!!hash && !isSuccess && !confirmError);

  return {
    terminate,
    hash,
    isPending,
    isSuccess,
    error: writeError || confirmError,
    reset,
  };
}
