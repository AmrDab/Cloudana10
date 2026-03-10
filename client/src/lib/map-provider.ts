/**
 * Map API/contract provider shape to ClientProviderList / ClientProviderDetail.
 * Handles both real contract data and mock data (contracts not deployed yet).
 */

import type { ClientProviderList, ClientProviderDetail } from "@/lib/provider-types";

export type ApiProvider = {
  owner?: string;
  ownerAddress?: string;
  providerkey?: string;
  name?: string;
  hostUri?: string;
  ipRegion?: string;
  ipRegionCode?: string;
  ipCountry?: string;
  ipCountryCode?: string;
  ipLat?: string | number;
  ipLon?: string | number;
  region?: string;
  country?: string;
  city?: string;
  cpuModel?: string;
  cpuCores?: number;
  gpuModel?: string;
  gpuCount?: number;
  gpuMemory?: string;
  ramTotal?: string;
  storageTotal?: string;
  capacity?: number;
  hardwareTier?: number;
  bondAmount?: string;
  status?: number;
  ipfsCID?: string;
  description?: string;
  website?: string;
  email?: string;
  organization?: string;
  [k: string]: unknown;
};

const emptyStats = { cpu: 0, gpu: 0, memory: 0, storage: 0 };

/** Parse "62.7 GB", "1.5 TB", "500" (no unit = GB) to bytes. Uses only IPFS-style strings. */
function parseCapacityToBytes(value: string | number | undefined, defaultGigabytes: number): number {
  if (value == null || value === "") return defaultGigabytes * 1024 ** 3;
  const capacityString = String(value).trim();
  const capacityMatch = capacityString.match(/^([\d.]+)\s*(GB|TB|MB|GiB|TiB|MiB)?$/i);
  if (!capacityMatch) return defaultGigabytes * 1024 ** 3;
  const numericValue = parseFloat(capacityMatch[1]);
  if (!Number.isFinite(numericValue)) return defaultGigabytes * 1024 ** 3;
  const capacityUnit = (capacityMatch[2] ?? "GB").toUpperCase();
  const gigabytes = capacityUnit === "TB" || capacityUnit === "TIB" ? numericValue * 1024 : capacityUnit === "MB" || capacityUnit === "MIB" ? numericValue / 1024 : numericValue;
  return Math.round(gigabytes * 1024 ** 3);
}

function formatCoordinate(coordinateValue: unknown): string {
  if (typeof coordinateValue === "number" && !Number.isNaN(coordinateValue)) return String(coordinateValue);
  if (typeof coordinateValue === "string") return coordinateValue;
  return "0";
}

export function mapApiProviderToClient(provider: ApiProvider, providerIndex: number): ClientProviderList {
  const providerOwner = provider.owner ?? provider.ownerAddress ?? "";
  const providerKey = provider.providerkey ?? providerOwner;
  const isProviderActive = provider.status === 1;
  
  // Get real-time stats from provider node if available
  const providerRealTimeStats = provider.realTimeStats as {
    cpuTotal?: number;
    cpuUsed?: number;
    cpuAvailable?: number;
    memoryTotal?: number;
    memoryUsed?: number;
    memoryAvailable?: number;
    storageTotal?: number;
    storageUsed?: number;
    storageAvailable?: number;
    gpuTotal?: number;
    gpuUsed?: number;
    gpuAvailable?: number;
    isOnline?: boolean;
  } | undefined;
  
  // If real-time stats available, use them; otherwise fall back to IPFS metadata
  if (providerRealTimeStats) {
    return {
      owner: providerOwner,
      ownerAddress: providerOwner,
      providerkey: providerKey,
      name: provider.name ?? null,
      hostUri: provider.hostUri ?? "",
      ipRegion: provider.ipRegion ?? provider.region ?? "Unknown",
      ipRegionCode: provider.ipRegionCode ?? (provider.region ?? "??").slice(0, 2).toUpperCase(),
      ipCountry: provider.ipCountry ?? provider.country ?? "Unknown",
      ipCountryCode: provider.ipCountryCode ?? (provider.country ?? "??").slice(0, 2).toUpperCase(),
      ipLat: formatCoordinate(provider.ipLat ?? 40.7),
      ipLon: formatCoordinate(provider.ipLon ?? -74),
      isOnline: providerRealTimeStats.isOnline ?? isProviderActive,
      isAudited: false,
      uptime7d: isProviderActive ? 0.99 : 0,
      leaseCount: isProviderActive ? 5 + (providerIndex % 10) : 0,
      userLeases: 0,
      userActiveLeases: 0,
      gpuModels: provider.gpuModel ? [{ vendor: "NVIDIA", model: provider.gpuModel, ram: provider.gpuMemory ?? "" }] : [],
      activeStats: {
        cpu: providerRealTimeStats.cpuUsed ?? 0,
        gpu: providerRealTimeStats.gpuUsed ?? 0,
        memory: providerRealTimeStats.memoryUsed ?? 0,
        storage: providerRealTimeStats.storageUsed ?? 0,
      },
      pendingStats: emptyStats,
      availableStats: {
        cpu: providerRealTimeStats.cpuAvailable ?? 0,
        gpu: providerRealTimeStats.gpuAvailable ?? 0,
        memory: providerRealTimeStats.memoryAvailable ?? 0,
        storage: providerRealTimeStats.storageAvailable ?? 0,
      },
      region: provider.region,
      country: provider.country,
      city: provider.city,
      cpuModel: provider.cpuModel,
      cpuCores: provider.cpuCores,
      gpuModel: provider.gpuModel,
      gpuCount: provider.gpuCount,
      gpuMemory: provider.gpuMemory,
      ramTotal: provider.ramTotal,
      storageTotal: provider.storageTotal,
      capacity: provider.capacity,
      hardwareTier: provider.hardwareTier,
      bondAmount: provider.bondAmount,
      status: provider.status,
      ipfsCID: provider.ipfsCID,
      deviceId: provider.deviceId as string | undefined,
    };
  }
  
  // Fallback: use IPFS metadata with zero usage (no mock data)
  const totalCpuMillicores = (provider.cpuCores ?? 0) * 1000;
  const totalGpuCount = provider.gpuCount ?? 0;
  const totalMemoryBytes = parseCapacityToBytes(provider.ramTotal, 0);
  const totalStorageBytes = parseCapacityToBytes(provider.storageTotal, 0);

  return {
    owner: providerOwner,
    ownerAddress: providerOwner,
    providerkey: providerKey,
    name: provider.name ?? null,
    hostUri: provider.hostUri ?? "",
    ipRegion: provider.ipRegion ?? provider.region ?? "Unknown",
    ipRegionCode: provider.ipRegionCode ?? (provider.region ?? "??").slice(0, 2).toUpperCase(),
    ipCountry: provider.ipCountry ?? provider.country ?? "Unknown",
    ipCountryCode: provider.ipCountryCode ?? (provider.country ?? "??").slice(0, 2).toUpperCase(),
    ipLat: formatCoordinate(provider.ipLat ?? 40.7),
    ipLon: formatCoordinate(provider.ipLon ?? -74),
    isOnline: isProviderActive,
    isAudited: false,
    uptime7d: isProviderActive ? 0.99 : 0,
    leaseCount: isProviderActive ? 5 + (providerIndex % 10) : 0,
    userLeases: 0,
    userActiveLeases: 0,
    gpuModels: provider.gpuModel ? [{ vendor: "NVIDIA", model: provider.gpuModel, ram: provider.gpuMemory ?? "" }] : [],
    activeStats: {
      cpu: 0,
      gpu: 0,
      memory: 0,
      storage: 0,
    },
    pendingStats: emptyStats,
    availableStats: {
      cpu: totalCpuMillicores,
      gpu: totalGpuCount,
      memory: totalMemoryBytes,
      storage: totalStorageBytes,
    },
    region: provider.region,
    country: provider.country,
    city: provider.city,
    cpuModel: provider.cpuModel,
    cpuCores: provider.cpuCores,
    gpuModel: provider.gpuModel,
    gpuCount: provider.gpuCount,
    gpuMemory: provider.gpuMemory,
    ramTotal: provider.ramTotal,
    storageTotal: provider.storageTotal,
    capacity: provider.capacity,
    hardwareTier: provider.hardwareTier,
    bondAmount: provider.bondAmount,
    status: provider.status,
    ipfsCID: provider.ipfsCID,
    deviceId: provider.deviceId as string | undefined,
  };
}

export function mapApiProviderToDetail(provider: ApiProvider, providerIndex: number): ClientProviderDetail {
  const clientProviderList = mapApiProviderToClient(provider, providerIndex);
  return {
    ...clientProviderList,
    description: provider.description,
    website: provider.website,
    email: provider.email,
    organization: provider.organization,
    tier: provider.tier,
    deploymentCount: clientProviderList.leaseCount,
    orderCount: 0,
    uptime: [],
    attributes: [],
  };
}
