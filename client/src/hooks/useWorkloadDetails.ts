import { useMemo } from "react";
import { useReadContract } from "wagmi";
import { WORKLOAD_REGISTRY_ADDRESS, CHAIN_ID } from "@/lib/contracts";
import { WorkloadRegistryAbi } from "@shared/contracts";

/** Workload from chain: metadataUri-focused (like Provider). Requirements/manifest on IPFS. */
export interface WorkloadDetails {
  id: bigint;
  owner: `0x${string}`;
  metadataUri: string;
  status: number; // 0=Inactive, 1=Active
  registeredAt: bigint;
  updatedAt: bigint;
  placementProvider: `0x${string}`;
  placementInstanceId: bigint;
}

export function useWorkloadDetails(workloadId?: bigint) {
  const result = useReadContract({
    address: WORKLOAD_REGISTRY_ADDRESS,
    abi: WorkloadRegistryAbi,
    functionName: "getWorkload",
    args: workloadId !== undefined ? [workloadId] : undefined,
    chainId: CHAIN_ID,
    query: {
      enabled: workloadId !== undefined,
      refetchInterval: 10000,
      staleTime: 5000,
    },
  });
  const data = useMemo((): WorkloadDetails | undefined => {
    const raw = result.data as WorkloadDetails | unknown[] | undefined;
    if (!raw) return undefined;
    // Contract can return tuple as object (named) or array (indexed); normalize to WorkloadDetails
    const owner =
      Array.isArray(raw)
        ? (raw[1] as `0x${string}`)
        : (raw as WorkloadDetails).owner;
    const ZERO = "0x0000000000000000000000000000000000000000" as const;
    if (!owner || owner === ZERO) return undefined;
    if (Array.isArray(raw)) {
      return {
        id: raw[0] as bigint,
        owner: owner,
        metadataUri: String(raw[2] ?? ""),
        status: Number(raw[3] ?? 0),
        registeredAt: raw[4] as bigint,
        updatedAt: raw[5] as bigint,
        placementProvider: (raw[6] as `0x${string}`) ?? ZERO,
        placementInstanceId: (raw[7] as bigint) ?? BigInt(0),
      };
    }
    return raw as WorkloadDetails;
  }, [result.data]);
  return { ...result, data } as { data: WorkloadDetails | undefined; isLoading: boolean; error: Error | null };
}
