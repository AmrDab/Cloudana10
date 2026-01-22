/**
 * Provider list/detail hooks with mock fallback when contracts are not deployed.
 */

import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { getAllProviders, getMyProviders } from "@/lib/api";
import { mapApiProviderToClient, mapApiProviderToDetail, type ApiProvider } from "@/lib/map-provider";
import type { ClientProviderList, ClientProviderDetail } from "@/lib/provider-types";

const MOCK_PROVIDERS: ApiProvider[] = [
  {
    owner: "0x1111111111111111111111111111111111111111",
    ownerAddress: "0x1111111111111111111111111111111111111111",
    providerkey: "0x1111111111111111111111111111111111111111",
    name: "Cloudana Demo East",
    region: "us-east-1",
    country: "USA",
    city: "Virginia",
    cpuModel: "AMD EPYC",
    cpuCores: 32,
    gpuModel: "NVIDIA A100",
    gpuCount: 4,
    gpuMemory: "80GB",
    ramTotal: "256 GB",
    storageTotal: "2 TB NVMe",
    capacity: 1,
    hardwareTier: 2,
    status: 1,
    ipLat: "37.5",
    ipLon: "-77.5",
  },
  {
    owner: "0x2222222222222222222222222222222222222222",
    ownerAddress: "0x2222222222222222222222222222222222222222",
    providerkey: "0x2222222222222222222222222222222222222222",
    name: "Cloudana Demo West",
    region: "us-west-2",
    country: "USA",
    city: "Oregon",
    cpuModel: "Intel Xeon",
    cpuCores: 64,
    gpuModel: "NVIDIA H100",
    gpuCount: 8,
    gpuMemory: "80GB",
    ramTotal: "512 GB",
    storageTotal: "4 TB NVMe",
    capacity: 2,
    hardwareTier: 2,
    status: 1,
    ipLat: "45.5",
    ipLon: "-122.6",
  },
  {
    owner: "0x3333333333333333333333333333333333333333",
    ownerAddress: "0x3333333333333333333333333333333333333333",
    providerkey: "0x3333333333333333333333333333333333333333",
    name: "Cloudana Demo EU",
    region: "eu-west-1",
    country: "Germany",
    city: "Frankfurt",
    cpuModel: "AMD EPYC",
    cpuCores: 48,
    gpuModel: "NVIDIA L40S",
    gpuCount: 4,
    gpuMemory: "48GB",
    ramTotal: "384 GB",
    storageTotal: "3 TB NVMe",
    capacity: 1,
    hardwareTier: 1,
    status: 1,
    ipLat: "50.1",
    ipLon: "8.68",
  },
];

async function fetchAllProviders(): Promise<ClientProviderList[]> {
  const raw = await getAllProviders();
  if (raw.length > 0) {
    return raw.map((p: ApiProvider, i: number) => mapApiProviderToClient(p, i));
  }
  return MOCK_PROVIDERS.map((p, i) => mapApiProviderToClient(p, i));
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
  });
}

export function useMyProviders() {
  const { address, isConnected } = useAccount();
  return useQuery({
    queryKey: ["myProviders", address],
    queryFn: () => (address ? fetchMyProviders(address) : Promise.resolve([])),
    enabled: !!address && isConnected,
    staleTime: 2_000,
  });
}

export function useProviderDetail(owner: string) {
  return useQuery({
    queryKey: ["providerDetail", owner],
    queryFn: async (): Promise<ClientProviderDetail | null> => {
      const raw = await getAllProviders();
      const list = raw.length > 0 ? raw : (MOCK_PROVIDERS as unknown as ApiProvider[]);
      const i = (list as ApiProvider[]).findIndex((p) => (p.owner ?? p.ownerAddress) === owner);
      if (i < 0) return null;
      return mapApiProviderToDetail(list[i] as ApiProvider, i);
    },
    enabled: !!owner,
    staleTime: 2_000,
  });
}
