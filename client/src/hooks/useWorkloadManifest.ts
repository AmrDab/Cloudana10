import { useQuery } from "@tanstack/react-query";
import { getWorkloadCID, fetchWorkloadManifestFromIPFS, type WorkloadManifestFromIPFS } from "@/lib/api";

/**
 * Fetches workload manifest from IPFS using the CID persisted at creation time.
 * Returns { data, isLoading, error }. data is the manifest (name, description, manifest YAML/JSON, requirements).
 */
export function useWorkloadManifest(workloadId: bigint | number | undefined) {
  const id = workloadId === undefined ? undefined : Number(workloadId);
  return useQuery<WorkloadManifestFromIPFS | null>({
    queryKey: ["workload-manifest", id],
    queryFn: async (): Promise<WorkloadManifestFromIPFS | null> => {
      if (id === undefined) return null;
      const cid = getWorkloadCID(id);
      if (!cid) return null;
      return fetchWorkloadManifestFromIPFS(cid);
    },
    enabled: id !== undefined,
    staleTime: 60_000, // 1 minute
  });
}
