// ProviderMinter contract hooks for claiming registration rewards
import React from "react";
import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { type Address } from "viem";
import { CONTRACT_ADDRESSES, ProviderMinterAbi } from "@shared/contracts";
import { devLoggers } from "@/lib/logger";
import { CHAIN_ID } from "@/lib/contracts";
import type { NodeTier } from "@/lib/node-tier";

export const PROVIDER_MINTER_ADDRESS = CONTRACT_ADDRESSES.contracts.ProviderMinter as Address;

const ENABLED =
  PROVIDER_MINTER_ADDRESS !== "0x0000000000000000000000000000000000000000";

// ── Read hooks ───────────────────────────────────────────────────────────────

/** Preview the current reward for a given tier (returns bigint in wei). */
export function usePreviewRegistrationReward(tier?: NodeTier) {
  return useReadContract({
    address: PROVIDER_MINTER_ADDRESS,
    abi: ProviderMinterAbi,
    functionName: "previewReward",
    args: tier !== undefined ? [tier] : undefined,
    chainId: CHAIN_ID,
    query: {
      enabled: ENABLED && tier !== undefined,
      staleTime: 30_000,
    },
  });
}

/** Check if a device has already claimed its registration reward. */
export function useHasClaimedReward(deviceId?: `0x${string}`) {
  return useReadContract({
    address: PROVIDER_MINTER_ADDRESS,
    abi: ProviderMinterAbi,
    functionName: "hasClaimed",
    args: deviceId ? [deviceId] : undefined,
    chainId: CHAIN_ID,
    query: {
      enabled: ENABLED && !!deviceId,
      staleTime: 10_000,
    },
  });
}

/** Total claims and current epoch for display. */
export function useProviderMinterStats() {
  const totalClaims = useReadContract({
    address: PROVIDER_MINTER_ADDRESS,
    abi: ProviderMinterAbi,
    functionName: "totalClaims",
    chainId: CHAIN_ID,
    query: { enabled: ENABLED, staleTime: 30_000 },
  });

  const currentEpoch = useReadContract({
    address: PROVIDER_MINTER_ADDRESS,
    abi: ProviderMinterAbi,
    functionName: "currentEpoch",
    chainId: CHAIN_ID,
    query: { enabled: ENABLED, staleTime: 30_000 },
  });

  return {
    totalClaims: totalClaims.data as bigint | undefined,
    currentEpoch: currentEpoch.data as bigint | undefined,
    isLoading: totalClaims.isLoading || currentEpoch.isLoading,
    refetch: () => {
      totalClaims.refetch();
      currentEpoch.refetch();
    },
  };
}

// ── Write hook ───────────────────────────────────────────────────────────────

/** Claim the one-time registration reward for a device. */
export function useClaimRegistrationReward() {
  const { writeContract, data: hash, isPending: isWritePending, error: writeError, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, error: confirmError } = useWaitForTransactionReceipt({
    hash,
    query: { enabled: !!hash, retry: 3, retryDelay: 1000 },
  });

  React.useEffect(() => {
    if (hash) {
      devLoggers.contract.success("Registration reward TX sent!");
      devLoggers.contract.log(`  TX Hash: ${hash}`);
    }
  }, [hash]);

  React.useEffect(() => {
    if (isSuccess && hash) {
      devLoggers.contract.success("Registration reward claimed!");
    }
  }, [isSuccess, hash]);

  const claim = (deviceId: `0x${string}`, tier: NodeTier) => {
    if (!ENABLED) {
      devLoggers.contract.error("ProviderMinter not deployed");
      return;
    }
    reset();
    writeContract({
      address: PROVIDER_MINTER_ADDRESS,
      abi: ProviderMinterAbi,
      functionName: "claimRegistrationReward",
      args: [deviceId, tier],
    });
  };

  const isPending = isWritePending || isConfirming || (!!hash && !isSuccess && !confirmError);

  return {
    claim,
    hash,
    isPending,
    isSuccess,
    error: writeError || confirmError,
    reset,
  };
}
