/**
 * Provider types for Cloudana.
 * Maps from API/contract + IPFS metadata shape.
 * Smart contracts not deployed yet – UI supports mock/empty data.
 */

export interface ProviderStats {
  cpu: number;
  gpu: number;
  memory: number;
  storage: number;
}

export interface ClientProviderList {
  owner: string;
  ownerAddress?: string;
  providerkey?: string;
  name: string | null;
  hostUri: string;
  ipRegion: string;
  ipRegionCode: string;
  ipCountry: string;
  ipCountryCode: string;
  ipLat: string;
  ipLon: string;
  isOnline: boolean;
  isAudited: boolean;
  uptime7d: number;
  leaseCount: number;
  userLeases?: number;
  userActiveLeases?: number;
  gpuModels: { vendor: string; model: string; ram: string }[];
  activeStats: ProviderStats;
  pendingStats: ProviderStats;
  availableStats: ProviderStats;
  /** From IPFS metadata */
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
  /** bytes32 device id (for Option A: one wallet, many devices). */
  deviceId?: string;
}

export interface ClientProviderDetail extends ClientProviderList {
  uptime?: Array<{ id: string; isOnline: boolean; checkDate: string }>;
  /** General info from IPFS */
  description?: string;
  website?: string;
  email?: string;
  organization?: string;
  tier?: string;
  hardwareCpu?: string;
  hardwareCpuArch?: string;
  hardwareGpuVendor?: string;
  hardwareMemory?: string;
  hardwareDisk?: string;
  featPersistentStorage?: boolean;
  featPersistentStorageType?: string;
  networkProvider?: string;
  networkSpeedDown?: number;
  networkSpeedUp?: number;
  bandwidth?: string;
  networkType?: string;
  deploymentCount?: number;
  orderCount?: number;
  error?: string;
  attributes?: Array<{ key: string; value: string }>;
}
