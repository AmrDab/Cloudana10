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
    },
  });
}

export function useApproveCLDToken() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading, isSuccess } = useWaitForTransactionReceipt({ hash });

  const approve = (spender: Address, amount: string) => {
    writeContract({
      address: CLD_TOKEN_ADDRESS,
      abi: CLDTokenAbi,
      functionName: "approve",
      args: [spender, parseEther(amount)],
    });
  };

  return {
    approve,
    hash,
    isPending: isPending || isLoading,
    isSuccess,
    error,
  };
}

// ============== Provider Registry Hooks ==============

export function useProviderRegistryBondInfo() {
  return useReadContract({
    address: PROVIDER_REGISTRY_ADDRESS,
    abi: ProviderRegistryAbi,
    functionName: "getBondInfo",
    chainId: CHAIN_ID,
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
    },
  });
}

export function useRegisterProvider() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading, isSuccess } = useWaitForTransactionReceipt({ hash });

  const register = (pubKeyHash: string, ipfsCID: string) => {
    writeContract({
      address: PROVIDER_REGISTRY_ADDRESS,
      abi: ProviderRegistryAbi,
      functionName: "registerProvider",
      args: [hexToBytes32(pubKeyHash), ipfsCID],
    });
  };

  return {
    register,
    hash,
    isPending: isPending || isLoading,
    isSuccess,
    error,
  };
}

export function useUpdateProviderStatus() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading, isSuccess } = useWaitForTransactionReceipt({ hash });

  const updateStatus = (pubKeyHash: string, status: 0 | 1 | 2) => {
    writeContract({
      address: PROVIDER_REGISTRY_ADDRESS,
      abi: ProviderRegistryAbi,
      functionName: "updateProviderStatus",
      args: [hexToBytes32(pubKeyHash), status],
    });
  };

  return {
    updateStatus,
    hash,
    isPending: isPending || isLoading,
    isSuccess,
    error,
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
    },
  });
}

export function useCreateJob() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading, isSuccess } = useWaitForTransactionReceipt({ hash });

  const create = (pubKeyHash: string, budgetAmount: string) => {
    writeContract({
      address: JOB_ESCROW_ADDRESS,
      abi: JobEscrowAbi,
      functionName: "createJob",
      args: [hexToBytes32(pubKeyHash), parseEther(budgetAmount)],
    });
  };

  return {
    create,
    hash,
    isPending: isPending || isLoading,
    isSuccess,
    error,
  };
}

export function useDepositToJob() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading, isSuccess } = useWaitForTransactionReceipt({ hash });

  const deposit = (jobId: bigint, amount: string) => {
    writeContract({
      address: JOB_ESCROW_ADDRESS,
      abi: JobEscrowAbi,
      functionName: "deposit",
      args: [jobId, parseEther(amount)],
    });
  };

  return {
    deposit,
    hash,
    isPending: isPending || isLoading,
    isSuccess,
    error,
  };
}

export function useCloseJob() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading, isSuccess } = useWaitForTransactionReceipt({ hash });

  const close = (jobId: bigint) => {
    writeContract({
      address: JOB_ESCROW_ADDRESS,
      abi: JobEscrowAbi,
      functionName: "closeJob",
      args: [jobId],
    });
  };

  return {
    close,
    hash,
    isPending: isPending || isLoading,
    isSuccess,
    error,
  };
}

export function useWithdrawProvider() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading, isSuccess } = useWaitForTransactionReceipt({ hash });

  const withdraw = () => {
    writeContract({
      address: JOB_ESCROW_ADDRESS,
      abi: JobEscrowAbi,
      functionName: "withdrawProvider",
      args: [],
    });
  };

  return {
    withdraw,
    hash,
    isPending: isPending || isLoading,
    isSuccess,
    error,
  };
}

export function useWithdrawUserRefund() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading, isSuccess } = useWaitForTransactionReceipt({ hash });

  const withdraw = () => {
    writeContract({
      address: JOB_ESCROW_ADDRESS,
      abi: JobEscrowAbi,
      functionName: "withdrawUserRefund",
      args: [],
    });
  };

  return {
    withdraw,
    hash,
    isPending: isPending || isLoading,
    isSuccess,
    error,
  };
}
