import { useQuery } from "@tanstack/react-query";
import { getPublicClient } from "@wagmi/core";
import { fetchWorkloadManifestFromIPFS, type WorkloadManifestFromIPFS } from "@/lib/api";
import { wagmiConfig } from "@/lib/wagmi-config";
import { WORKLOAD_REGISTRY_ADDRESS, CHAIN_ID } from "@/lib/contracts";
import { WorkloadRegistryAbi } from "@shared/contracts";

const IPFS_GATEWAY = "https://ipfs.io";

function resolveMetadataUriToUrl(uri: string | undefined): string | null {
  if (!uri || typeof uri !== "string") return null;
  const s = uri.trim();
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  return `${IPFS_GATEWAY}/ipfs/${s}`;
}

/**
 * Fetches workload manifest from IPFS using metadataUri from chain.
 * Returns { data, isLoading, error }. data is the manifest (name, description, manifest, requirements).
 */
export function useWorkloadManifest(workloadId: bigint | number | undefined) {
  const id = workloadId !== undefined && workloadId !== null ? Number(workloadId) : undefined;
  return useQuery<WorkloadManifestFromIPFS | null>({
    queryKey: ["workload-manifest", id],
    queryFn: async (): Promise<WorkloadManifestFromIPFS | null> => {
      if (id === undefined || id === null || typeof id !== 'number') return null;
      const client = getPublicClient(wagmiConfig, { chainId: CHAIN_ID });
      if (!client) return null;
      try {
        const workload = await client.readContract({
          address: WORKLOAD_REGISTRY_ADDRESS,
          abi: WorkloadRegistryAbi,
          functionName: "getWorkload",
          args: [BigInt(id)],
        }) as { metadataUri?: string };
        const metadataUri = workload?.metadataUri;
        if (!metadataUri) return null;
        const url = resolveMetadataUriToUrl(metadataUri);
        if (!url) return null;
        const res = await fetch(url, { headers: { Accept: "application/json" } });
        if (!res.ok) return null;
        const data = (await res.json()) as WorkloadManifestFromIPFS;
        return data;
      } catch {
        return null;
      }
    },
    enabled: id !== undefined && id !== null && typeof id === 'number',
    staleTime: 60_000,
  });
}
