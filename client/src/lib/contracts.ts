// Contract interaction utilities and hooks for DePIN system
import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseEther, formatEther, keccak256, toHex, type Address } from "viem";
import { CONTRACT_ADDRESSES, CLDTokenAbi, WorkloadRegistryAbi, ProviderRegistryAbi } from "@shared/contracts";
import { baseSepolia } from "@reown/appkit/networks";

export const CHAIN_ID = CONTRACT_ADDRESSES.chainId;
export const NETWORK = baseSepolia;

// Contract addresses
export const CLD_TOKEN_ADDRESS = CONTRACT_ADDRESSES.contracts.CLDToken as Address;
export const WORKLOAD_REGISTRY_ADDRESS = CONTRACT_ADDRESSES.contracts.WorkloadRegistry as Address;

export const PROVIDER_REGISTRY_ADDRESS = (
  CONTRACT_ADDRESSES.contracts.ProviderRegistry || "0xc3D4f33d7b686A3c6edf1d69869D29AB6F7b5CFF"
) as Address;

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

// Helper to convert IPFS CID string to bytes32
// IPFS CIDs are variable length, so we hash the CID string to get a deterministic bytes32 value
// This allows the contract to store a reference to the IPFS content
export function ipfsCIDToBytes32(cid: string): `0x${string}` {
  // Hash the CID string to get a deterministic bytes32 value
  return keccak256(toHex(cid)) as `0x${string}`;
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
    
    // Map TypeScript interface to ABI structure (ABI expects memoryBytes and storageBytes)
    const abiRequirements = {
      cpu: requirements.cpu,
      memoryBytes: requirements.memory, // Map memory to memoryBytes
      storageBytes: requirements.storage, // Map storage to storageBytes
      storageClasses: requirements.storageClasses,
      requiresGPU: requirements.requiresGPU,
      gpuCount: requirements.gpuCount,
      gpuAttributes: requirements.gpuAttributes,
      requiresEdge: requirements.requiresEdge,
      regions: requirements.regions,
      maxLatency: requirements.maxLatency,
    };
    
    // Validate all required fields are present and valid
    if (
      abiRequirements.cpu === undefined ||
      abiRequirements.memoryBytes === undefined ||
      abiRequirements.storageBytes === undefined ||
      abiRequirements.storageClasses === undefined ||
      abiRequirements.requiresGPU === undefined ||
      abiRequirements.gpuCount === undefined ||
      abiRequirements.gpuAttributes === undefined ||
      abiRequirements.requiresEdge === undefined ||
      abiRequirements.regions === undefined ||
      abiRequirements.maxLatency === undefined
    ) {
      console.error('[useCreateWorkload] Invalid requirements:', abiRequirements);
      throw new Error('Invalid resource requirements: missing required fields');
    }
    
    writeContract({
      address: WORKLOAD_REGISTRY_ADDRESS,
      abi: WorkloadRegistryAbi,
      functionName: "createWorkload",
      args: [manifestHashBytes32, abiRequirements],
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
    
    // Map TypeScript interface to ABI structure (ABI expects memoryBytes and storageBytes)
    const abiRequirements = {
      cpu: requirements.cpu,
      memoryBytes: requirements.memory, // Map memory to memoryBytes
      storageBytes: requirements.storage, // Map storage to storageBytes
      storageClasses: requirements.storageClasses,
      requiresGPU: requirements.requiresGPU,
      gpuCount: requirements.gpuCount,
      gpuAttributes: requirements.gpuAttributes,
      requiresEdge: requirements.requiresEdge,
      regions: requirements.regions,
      maxLatency: requirements.maxLatency,
    };
    
    writeContract({
      address: WORKLOAD_REGISTRY_ADDRESS,
      abi: WorkloadRegistryAbi,
      functionName: "updateWorkload",
      args: [workloadId, manifestHashBytes32, abiRequirements],
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

// ============== Provider Registry Hooks ==============

export function useRegisterProvider() {
  const { writeContract, data: hash, isPending: isWritePending, error: writeError, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, error: confirmError } = useWaitForTransactionReceipt({
    hash,
    query: {
      enabled: !!hash,
      retry: 3,
      retryDelay: 1000,
    },
  });

  const register = (pubKeyHash: string, ipfsCID: string) => {
    reset();
    writeContract({
      address: PROVIDER_REGISTRY_ADDRESS,
      abi: ProviderRegistryAbi,
      functionName: "registerProvider",
      args: [hexToBytes32(pubKeyHash), ipfsCID],
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

export function useProviderRegistryBondInfo() {
  return {
    data: BigInt(0),
  };
}

export function useMyProviders(user?: Address) {
  return useReadContract({
    address: PROVIDER_REGISTRY_ADDRESS,
    abi: ProviderRegistryAbi,
    functionName: "getMyProviders",
    args: user ? [user] : undefined,
    chainId: CHAIN_ID,
    query: {
      enabled: !!user && PROVIDER_REGISTRY_ADDRESS !== "0x0000000000000000000000000000000000000000",
      refetchInterval: 10000,
      staleTime: 5000,
    },
  });
}

export function useProviderInfo(pubKeyHash?: string) {
  return useReadContract({
    address: PROVIDER_REGISTRY_ADDRESS,
    abi: ProviderRegistryAbi,
    functionName: "getProvider",
    args: pubKeyHash ? [hexToBytes32(pubKeyHash)] : undefined,
    chainId: CHAIN_ID,
    query: {
      enabled: !!pubKeyHash && PROVIDER_REGISTRY_ADDRESS !== "0x0000000000000000000000000000000000000000",
      refetchInterval: 10000,
      staleTime: 5000,
    },
  });
}
