import { useReadContract } from "wagmi";
import { WORKLOAD_REGISTRY_ADDRESS, CHAIN_ID } from "@/lib/contracts";
import { WorkloadRegistryAbi } from "@shared/contracts";

export interface WorkloadRequirements {
  cpu: bigint;
  memoryBytes: bigint;
  storageBytes: bigint;
  requiresGPU: boolean;
  gpuCount: bigint;
  gpuAttributes: string[];
  storageClasses: string[];
  requiresEdge: boolean;
  regions: string[];
  maxLatency: bigint;
}

export interface WorkloadDetails {
  id: bigint;
  owner: `0x${string}`;
  manifestHash: `0x${string}`;
  requirements: WorkloadRequirements;
  status: number;
  createdAt: bigint;
  updatedAt: bigint;
  replicas: bigint;
  instances: Array<{
    id: bigint;
    provider: `0x${string}`;
    status: number;
    placedAt: bigint;
  }>;
}

export function useWorkloadDetails(workloadId?: bigint) {
  return useReadContract({
    address: WORKLOAD_REGISTRY_ADDRESS,
    abi: WorkloadRegistryAbi,
    functionName: "getWorkload",
    args: workloadId ? [workloadId] : undefined,
    chainId: CHAIN_ID,
    query: {
      enabled: !!workloadId,
      refetchInterval: 10000, // Refetch every 10 seconds
      staleTime: 5000, // Data considered fresh for 5 seconds
    },
  }) as { data: WorkloadDetails | undefined; isLoading: boolean; error: Error | null };
}
