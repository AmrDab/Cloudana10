// Contract interaction utilities and hooks for DePIN system
import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseEther, formatEther, type Address } from "viem";
import { CONTRACT_ADDRESSES, CLDTokenAbi, ProviderRegistryAbi, JobEscrowAbi } from "@shared/contracts";
import { baseSepolia } from "@reown/appkit/networks";

export const CHAIN_ID = CONTRACT_ADDRESSES.chainId;
export const NETWORK = baseSepolia;

// Contract addresses
export const CLD_TOKEN_ADDRESS = CONTRACT_ADDRESSES.contracts.CLDToken as Address;
export const PROVIDER_REGISTRY_ADDRESS = CONTRACT_ADDRESSES.contracts.ProviderRegistry as Address;
export const JOB_ESCROW_ADDRESS = CONTRACT_ADDRESSES.contracts.JobEscrow as Address;

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

// ============== Provider Registry Hooks ==============

export function useProviderRegistryBondInfo() {
  return useReadContract({
    address: PROVIDER_REGISTRY_ADDRESS,
    abi: ProviderRegistryAbi,
    functionName: "getBondInfo",
    chainId: CHAIN_ID,
    query: {
      refetchInterval: 10000, // Refetch every 10 seconds
      staleTime: 5000, // Data considered fresh for 5 seconds
    },
  });
}

export function useMyProviders(owner?: Address) {
  return useReadContract({
    address: PROVIDER_REGISTRY_ADDRESS,
    abi: ProviderRegistryAbi,
    functionName: "getMyProviders",
    args: owner ? [owner] : undefined,
    chainId: CHAIN_ID,
    query: {
      enabled: !!owner,
      refetchInterval: 5000, // Refetch every 5 seconds
      staleTime: 3000, // Data considered fresh for 3 seconds
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
      enabled: !!pubKeyHash,
      refetchInterval: 5000, // Refetch every 5 seconds
      staleTime: 3000, // Data considered fresh for 3 seconds
    },
  });
}

export function useRegisterProvider() {
  const { writeContract, data: hash, isPending: isWritePending, error: writeError, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, error: confirmError } = useWaitForTransactionReceipt({ 
    hash,
    query: {
      enabled: !!hash,
    },
  });

  const register = (pubKeyHash: string, ipfsCID: string) => {
    // Reset any previous errors before new transaction
    reset();
    console.log('[useRegisterProvider] Initiating registration...');
    writeContract({
      address: PROVIDER_REGISTRY_ADDRESS,
      abi: ProviderRegistryAbi,
      functionName: "registerProvider",
      args: [hexToBytes32(pubKeyHash), ipfsCID],
    });
  };

  // Comprehensive loading state: active from submission through confirmation
  // - isWritePending: true while submitting transaction to wallet/network
  // - !!hash && !isSuccess && !confirmError: true when transaction submitted but not yet confirmed
  // - isConfirming: true while actively waiting for block confirmation
  const isPending = isWritePending || isConfirming || (!!hash && !isSuccess && !confirmError);

  // Debug logging
  if (hash || isWritePending) {
    console.log('[useRegisterProvider] State:', {
      hash: hash ? hash.slice(0, 10) + '...' : 'none',
      isWritePending,
      isConfirming,
      isSuccess,
      confirmError: !!confirmError,
      isPending,
    });
  }

  return {
    register,
    hash,
    isPending,
    isSuccess,
    error: writeError || confirmError,
    reset,
  };
}

export function useUpdateProviderStatus() {
  const { writeContract, data: hash, isPending: isWritePending, error: writeError, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, error: confirmError } = useWaitForTransactionReceipt({ 
    hash,
    query: {
      enabled: !!hash,
    },
  });

  const updateStatus = (pubKeyHash: string, status: 0 | 1 | 2) => {
    reset();
    writeContract({
      address: PROVIDER_REGISTRY_ADDRESS,
      abi: ProviderRegistryAbi,
      functionName: "updateProviderStatus",
      args: [hexToBytes32(pubKeyHash), status],
    });
  };

  // Comprehensive loading state: active from submission through confirmation
  const isPending = isWritePending || isConfirming || (!!hash && !isSuccess && !confirmError);

  return {
    updateStatus,
    hash,
    isPending,
    isSuccess,
    error: writeError || confirmError,
    reset,
  };
}

// ============== Job Escrow Hooks ==============

export function useJobInfo(jobId?: bigint) {
  return useReadContract({
    address: JOB_ESCROW_ADDRESS,
    abi: JobEscrowAbi,
    functionName: "jobs",
    args: jobId !== undefined ? [jobId] : undefined,
    chainId: CHAIN_ID,
    query: {
      enabled: jobId !== undefined,
      refetchInterval: 5000, // Refetch every 5 seconds
      staleTime: 3000, // Data considered fresh for 3 seconds
    },
  });
}

export function useProviderCredit(provider?: Address) {
  return useReadContract({
    address: JOB_ESCROW_ADDRESS,
    abi: JobEscrowAbi,
    functionName: "providerCredit",
    args: provider ? [provider] : undefined,
    chainId: CHAIN_ID,
    query: {
      enabled: !!provider,
      refetchInterval: 5000, // Refetch every 5 seconds
      staleTime: 3000, // Data considered fresh for 3 seconds
    },
  });
}

export function useUserRefundCredit(user?: Address) {
  return useReadContract({
    address: JOB_ESCROW_ADDRESS,
    abi: JobEscrowAbi,
    functionName: "userRefundCredit",
    args: user ? [user] : undefined,
    chainId: CHAIN_ID,
    query: {
      enabled: !!user,
      refetchInterval: 5000, // Refetch every 5 seconds
      staleTime: 3000, // Data considered fresh for 3 seconds
    },
  });
}

export function useCreateJob() {
  const { writeContract, data: hash, isPending: isWritePending, error: writeError, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, error: confirmError } = useWaitForTransactionReceipt({ 
    hash,
    query: {
      enabled: !!hash,
    },
  });

  const create = (pubKeyHash: string, budgetAmount: string) => {
    reset();
    writeContract({
      address: JOB_ESCROW_ADDRESS,
      abi: JobEscrowAbi,
      functionName: "createJob",
      args: [hexToBytes32(pubKeyHash), parseEther(budgetAmount)],
    });
  };

  // Comprehensive loading state: active from submission through confirmation
  const isPending = isWritePending || isConfirming || (!!hash && !isSuccess && !confirmError);

  return {
    create,
    hash,
    isPending,
    isSuccess,
    error: writeError || confirmError,
    reset,
  };
}

export function useDepositToJob() {
  const { writeContract, data: hash, isPending: isWritePending, error: writeError, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, error: confirmError } = useWaitForTransactionReceipt({ 
    hash,
    query: {
      enabled: !!hash,
    },
  });

  const deposit = (jobId: bigint, amount: string) => {
    reset();
    writeContract({
      address: JOB_ESCROW_ADDRESS,
      abi: JobEscrowAbi,
      functionName: "deposit",
      args: [jobId, parseEther(amount)],
    });
  };

  // Comprehensive loading state: active from submission through confirmation
  const isPending = isWritePending || isConfirming || (!!hash && !isSuccess && !confirmError);

  return {
    deposit,
    hash,
    isPending,
    isSuccess,
    error: writeError || confirmError,
    reset,
  };
}

export function useCloseJob() {
  const { writeContract, data: hash, isPending: isWritePending, error: writeError, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, error: confirmError } = useWaitForTransactionReceipt({ 
    hash,
    query: {
      enabled: !!hash,
    },
  });

  const close = (jobId: bigint) => {
    reset();
    writeContract({
      address: JOB_ESCROW_ADDRESS,
      abi: JobEscrowAbi,
      functionName: "closeJob",
      args: [jobId],
    });
  };

  // Comprehensive loading state: active from submission through confirmation
  const isPending = isWritePending || isConfirming || (!!hash && !isSuccess && !confirmError);

  return {
    close,
    hash,
    isPending,
    isSuccess,
    error: writeError || confirmError,
    reset,
  };
}

export function useWithdrawProvider() {
  const { writeContract, data: hash, isPending: isWritePending, error: writeError, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, error: confirmError } = useWaitForTransactionReceipt({ 
    hash,
    query: {
      enabled: !!hash,
    },
  });

  const withdraw = () => {
    reset();
    writeContract({
      address: JOB_ESCROW_ADDRESS,
      abi: JobEscrowAbi,
      functionName: "withdrawProvider",
      args: [],
    });
  };

  // Comprehensive loading state: active from submission through confirmation
  const isPending = isWritePending || isConfirming || (!!hash && !isSuccess && !confirmError);

  return {
    withdraw,
    hash,
    isPending,
    isSuccess,
    error: writeError || confirmError,
    reset,
  };
}

export function useWithdrawUserRefund() {
  const { writeContract, data: hash, isPending: isWritePending, error: writeError, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, error: confirmError } = useWaitForTransactionReceipt({ 
    hash,
    query: {
      enabled: !!hash,
    },
  });

  const withdraw = () => {
    reset();
    writeContract({
      address: JOB_ESCROW_ADDRESS,
      abi: JobEscrowAbi,
      functionName: "withdrawUserRefund",
      args: [],
    });
  };

  // Comprehensive loading state: active from submission through confirmation
  const isPending = isWritePending || isConfirming || (!!hash && !isSuccess && !confirmError);

  return {
    withdraw,
    hash,
    isPending,
    isSuccess,
    error: writeError || confirmError,
    reset,
  };
}
