// Contract interaction utilities and hooks
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

// Helper to convert string to bytes32 (for metadata hash)
export function stringToBytes32(str: string): `0x${string}` {
  const hash = str.startsWith("0x") ? str.slice(2) : str;
  // Pad or truncate to 64 hex characters (32 bytes)
  const padded = hash.padEnd(64, "0").slice(0, 64);
  return `0x${padded}` as `0x${string}`;
}

// ============== CLD Token Hooks ==============

export function useCLDTokenBalance(address?: Address) {
  return useReadContract({
    address: CLD_TOKEN_ADDRESS,
    abi: CLDTokenAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
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

export function useProviderInfo(address?: Address) {
  return useReadContract({
    address: PROVIDER_REGISTRY_ADDRESS,
    abi: ProviderRegistryAbi,
    functionName: "getProvider",
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
    },
  });
}

export function useRegisterProvider() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading, isSuccess } = useWaitForTransactionReceipt({ hash });

  const register = (metaHash: string, burnAmount?: string) => {
    const hashBytes32 = stringToBytes32(metaHash);
    if (burnAmount && parseFloat(burnAmount) > 0) {
      writeContract({
        address: PROVIDER_REGISTRY_ADDRESS,
        abi: ProviderRegistryAbi,
        functionName: "registerProviderWithBurn",
        args: [hashBytes32, parseEther(burnAmount)],
      });
    } else {
      writeContract({
        address: PROVIDER_REGISTRY_ADDRESS,
        abi: ProviderRegistryAbi,
        functionName: "registerProvider",
        args: [hashBytes32],
      });
    }
  };

  return {
    register,
    hash,
    isPending: isPending || isLoading,
    isSuccess,
    error,
  };
}

export function useSetProviderActive() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading, isSuccess } = useWaitForTransactionReceipt({ hash });

  const setActive = (active: boolean) => {
    writeContract({
      address: PROVIDER_REGISTRY_ADDRESS,
      abi: ProviderRegistryAbi,
      functionName: "setProviderActive",
      args: [active],
    });
  };

  return {
    setActive,
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
    query: {
      enabled: !!user,
    },
  });
}

export function useCreateJob() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading, isSuccess } = useWaitForTransactionReceipt({ hash });

  const create = (provider: Address, budgetAmount: string) => {
    writeContract({
      address: JOB_ESCROW_ADDRESS,
      abi: JobEscrowAbi,
      functionName: "createJob",
      args: [provider, parseEther(budgetAmount)],
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

export function useSubmitUsageReport() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading, isSuccess } = useWaitForTransactionReceipt({ hash });

  const submit = (
    report: {
      jobId: bigint;
      user: Address;
      provider: Address;
      grossCost: string;
      providerEarn: string;
      nonce: bigint;
      deadline: bigint;
    },
    signature: `0x${string}`
  ) => {
    writeContract({
      address: JOB_ESCROW_ADDRESS,
      abi: JobEscrowAbi,
      functionName: "submitUsageReport",
      args: [
        {
          jobId: report.jobId,
          user: report.user,
          provider: report.provider,
          grossCost: parseEther(report.grossCost),
          providerEarn: parseEther(report.providerEarn),
          nonce: report.nonce,
          deadline: report.deadline,
        },
        signature,
      ],
    });
  };

  return {
    submit,
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

