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

function coords(val: unknown): string {
  if (typeof val === "number" && !Number.isNaN(val)) return String(val);
  if (typeof val === "string") return val;
  return "0";
}

export function mapApiProviderToClient(p: ApiProvider, index: number): ClientProviderList {
  const owner = p.owner ?? p.ownerAddress ?? "";
  const key = p.providerkey ?? owner;
  const isActive = p.status === 1;
  const cpu = (p.cpuCores ?? 8) * 1000;
  const gpu = p.gpuCount ?? 0;
  const mem = parseInt(String(p.ramTotal ?? "32").replace(/\D/g, ""), 10) || 32;
  const memBytes = mem * 1024 * 1024 * 1024;
  const disk = parseInt(String(p.storageTotal ?? "500").replace(/\D/g, ""), 10) || 500;
  const diskBytes = disk * 1024 * 1024 * 1024;
  const used = isActive ? 0.3 : 0;

  return {
    owner,
    ownerAddress: owner,
    providerkey: key,
    name: p.name ?? null,
    hostUri: p.hostUri ?? `provider-${index}.cloudana.network`,
    ipRegion: p.ipRegion ?? p.region ?? "Unknown",
    ipRegionCode: p.ipRegionCode ?? (p.region ?? "??").slice(0, 2).toUpperCase(),
    ipCountry: p.ipCountry ?? p.country ?? "Unknown",
    ipCountryCode: p.ipCountryCode ?? (p.country ?? "??").slice(0, 2).toUpperCase(),
    ipLat: coords(p.ipLat ?? 40.7),
    ipLon: coords(p.ipLon ?? -74),
    isOnline: isActive,
    isAudited: false,
    uptime7d: isActive ? 0.99 : 0,
    leaseCount: isActive ? 5 + (index % 10) : 0,
    userLeases: 0,
    userActiveLeases: 0,
    gpuModels: p.gpuModel ? [{ vendor: "NVIDIA", model: p.gpuModel, ram: p.gpuMemory ?? "" }] : [],
    activeStats: {
      cpu: Math.round(cpu * used),
      gpu: Math.round(gpu * used),
      memory: Math.round(memBytes * used),
      storage: Math.round(diskBytes * used),
    },
    pendingStats: emptyStats,
    availableStats: {
      cpu: Math.round(cpu * (1 - used)),
      gpu: Math.round(gpu * (1 - used)),
      memory: Math.round(memBytes * (1 - used)),
      storage: Math.round(diskBytes * (1 - used)),
    },
    region: p.region,
    country: p.country,
    city: p.city,
    cpuModel: p.cpuModel,
    cpuCores: p.cpuCores,
    gpuModel: p.gpuModel,
    gpuCount: p.gpuCount,
    gpuMemory: p.gpuMemory,
    ramTotal: p.ramTotal,
    storageTotal: p.storageTotal,
    capacity: p.capacity,
    hardwareTier: p.hardwareTier,
    bondAmount: p.bondAmount,
    status: p.status,
    ipfsCID: p.ipfsCID,
  };
}

export function mapApiProviderToDetail(p: ApiProvider, index: number): ClientProviderDetail {
  const list = mapApiProviderToClient(p, index);
  return {
    ...list,
    description: p.description,
    website: p.website,
    email: p.email,
    organization: p.organization,
    deploymentCount: list.leaseCount,
    orderCount: 0,
    uptime: [],
    attributes: [],
  };
}
