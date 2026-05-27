/**
 * Provider list/detail hooks backed by on-chain reads.
 */

import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import {
  getAllProviders,
  getMyProviders,
  getProviderByDeviceId,
} from "@/lib/api";
import { mapApiProviderToClient, mapApiProviderToDetail, type ApiProvider } from "@/lib/map-provider";
import type { ClientProviderList, ClientProviderDetail } from "@/lib/provider-types";

async function fetchAllProviders(): Promise<ClientProviderList[]> {
  const raw = await getAllProviders();
  return raw.map((p: ApiProvider, i: number) => mapApiProviderToClient(p, i));
}

async function fetchMyProviders(owner: string): Promise<ClientProviderList[]> {
  const raw = await getMyProviders(owner as `0x${string}`);
  return raw.map((p: ApiProvider, i: number) => mapApiProviderToClient(p, i));
}

export function useProviderList() {
  return useQuery({
    queryKey: ["providers"],
    queryFn: fetchAllProviders,
    staleTime: 2_000,
    refetchOnMount: "always", // Always refetch when component mounts (ensures fresh data after registration)
  });
}

export function useMyProviders() {
  const { address, isConnected } = useAccount();
  return useQuery({
    queryKey: ["myProviders", address],
    queryFn: () => (address ? fetchMyProviders(address) : Promise.resolve([])),
    enabled: !!address && isConnected,
    staleTime: 2_000,
    refetchOnMount: "always", // Always refetch when component mounts (ensures fresh data after registration)
  });
}

/** Provider detail by deviceId (unique key). Uses chain + IPFS metadata. */
export function useProviderDetail(deviceId: string) {
  return useQuery({
    queryKey: ["providerDetail", deviceId],
    queryFn: async (): Promise<ClientProviderDetail | null> => {
      const p = await getProviderByDeviceId(deviceId);
      if (!p) return null;
      return mapApiProviderToDetail(p as ApiProvider, 0);
    },
    enabled: !!deviceId,
    staleTime: 2_000,
  });
}
