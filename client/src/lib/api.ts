// IPFS, DePIN utilities, and orchestrator API helpers for direct contract interaction
// Orchestrator deploy routes: POST /v1/deploy, GET /v1/deployments/:id
import { devLoggers } from "@/lib/logger";

import { getPublicClient } from "@wagmi/core";
import { wagmiConfig } from "@/lib/wagmi-config";
import { ProviderRegistryAbi, CONTRACT_ADDRESSES } from "@shared/contracts";
import type { Address } from "viem";

/** Real device spec from node (GET /device-info or prepare-registration). */
export interface RealDeviceSpec {
  cpuModel: string;
  cpuCores: number;
  memoryTotalBytes: number;
  memoryFreeBytes?: number;
  diskTotalBytes?: number | null;
  diskFreeBytes?: number | null;
}

/** Response from prepare-registration: device_id + real spec to cap offered spec in UI. */
export interface PrepareRegistrationResponse {
  device_id: string;
  real_spec: RealDeviceSpec | null;
}

/**
 * Fetch device_id and real device spec from backend (for registration confirm modal).
 * Cap offered spec in UI to real_spec; register the user-agreed partial spec to IPFS/on-chain.
 */
export async function getPrepareRegistration(deviceId: string): Promise<PrepareRegistrationResponse | null> {
  const base = import.meta.env.VITE_API_URL || "http://localhost:7002/v1";
  const url = `${base}/build-provider/prepare-registration/${encodeURIComponent(deviceId)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as PrepareRegistrationResponse;
  return data;
}

/** True if the string looks like an HTTP(S) URL we can fetch for metadata */
export function isMetadataUrl(url: string | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  const t = url.trim().toLowerCase();
  return t.startsWith("http://") || t.startsWith("https://");
}

const METADATA_FETCH_TIMEOUT_MS = 8_000;

/**
 * Fetch provider metadata JSON from the given URL (IPFS gateway or any HTTP URL).
 * Used to enrich chain provider data with name, description, specs from IPFS.
 */
export async function fetchProviderMetadataFromUrl(url: string): Promise<ProviderMetadata | null> {
  try {
    devLoggers.ipfs.info(`📥 Fetching provider metadata from IPFS...`);
    devLoggers.ipfs.debug(`  URL: ${url.slice(0, 100)}${url.length > 100 ? '...' : ''}`);
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), METADATA_FETCH_TIMEOUT_MS);
    const startTime = Date.now();
    
    const res = await fetch(url, { signal: controller.signal, mode: "cors" });
    clearTimeout(timeout);
    const fetchDuration = Date.now() - startTime;
    
    if (!res.ok) {
      devLoggers.ipfs.warn(`⚠️  Fetch failed: HTTP ${res.status} ${res.statusText} (${fetchDuration}ms)`);
      return null;
    }
    
    const data = (await res.json()) as unknown;
    if (!data || typeof data !== "object") {
      devLoggers.ipfs.error(`❌ Invalid metadata format (${fetchDuration}ms)`);
      return null;
    }
    
    const metadata = data as ProviderMetadata;
    const dataSize = JSON.stringify(data).length;
    
    devLoggers.ipfs.success(`✅ Metadata fetched successfully (${fetchDuration}ms, ${dataSize} bytes)`);
    devLoggers.ipfs.log(`  📋 Available fields: ${Object.keys(data).join(', ')}`);
    devLoggers.ipfs.log(`  Name: ${metadata.name || '(unnamed)'}`);
    devLoggers.ipfs.log(`  CPU: ${metadata.cpuCores || 0} cores${metadata.cpuModel ? ` (${metadata.cpuModel})` : ''}`);
    devLoggers.ipfs.log(`  RAM: ${metadata.ramTotal || '(not set)'}`);
    devLoggers.ipfs.log(`  Storage: ${metadata.storageTotal || '(not set)'}`);
    devLoggers.ipfs.log(`  GPU: ${metadata.gpuCount || 0}${metadata.gpuModel ? ` x ${metadata.gpuModel}` : ''}`);
    devLoggers.ipfs.log(`  Region: ${metadata.region || 'unknown'}`);
    devLoggers.ipfs.log(`  Endpoint: ${metadata.endpoint || '(not set)'}`);
    
    return metadata;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      devLoggers.ipfs.error(`❌ Fetch timed out after ${METADATA_FETCH_TIMEOUT_MS}ms`);
    } else {
      devLoggers.ipfs.error(`💥 Fetch error:`, error.message);
    }
    return null;
  }
}

/**
 * Map IPFS ProviderMetadata to fields that can be merged into ApiProvider / ClientProviderDetail.
 * Handles field name variations and ensures all relevant fields are mapped.
 */
export function metadataToApiProviderFields(meta: ProviderMetadata): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (meta.name != null) out.name = meta.name;
  if (meta.description != null) out.description = meta.description;
  
  // CPU fields
  if (meta.cpuModel != null) out.cpuModel = meta.cpuModel;
  if (meta.cpuCores != null) out.cpuCores = meta.cpuCores;
  if (meta.cpuThreads != null) out.cpuThreads = meta.cpuThreads;
  if (meta.cpuClockSpeed != null) out.cpuClockSpeed = meta.cpuClockSpeed;
  
  // GPU fields
  if (meta.gpuModel != null) out.gpuModel = meta.gpuModel;
  if (meta.gpuCount != null) out.gpuCount = meta.gpuCount;
  if (meta.gpuMemory != null) out.gpuMemory = meta.gpuMemory;
  if (meta.gpuCudaCores != null) out.gpuCudaCores = meta.gpuCudaCores;
  
  // Memory fields - handle variations
  if (meta.ramTotal != null) out.ramTotal = meta.ramTotal;
  if (meta.ramType != null) out.ramType = meta.ramType;
  
  // Storage fields - handle variations
  if (meta.storageTotal != null) out.storageTotal = meta.storageTotal;
  if (meta.storageType != null) out.storageType = meta.storageType;
  if (meta.storageSpeed != null) out.storageSpeed = meta.storageSpeed;
  
  // Network fields
  if (meta.bandwidth != null) out.bandwidth = meta.bandwidth;
  if (meta.networkType != null) out.networkType = meta.networkType;
  
  // Location fields
  if (meta.website != null) out.website = meta.website;
  if (meta.email != null) out.email = meta.email;
  if (meta.organization != null) out.organization = meta.organization;
  if (meta.region != null) out.region = meta.region;
  if (meta.country != null) out.country = meta.country;
  if (meta.city != null) out.city = meta.city;
  if (meta.location != null) out.location = meta.location;
  
  // Tier and capacity
  if (meta.hardwareTier != null) out.hardwareTier = meta.hardwareTier;
  if (meta.capacity != null) out.capacity = meta.capacity;
  if (meta.tier != null) out.tier = meta.tier;
  
  // Endpoint for provider node
  if (meta.endpoint != null) out.endpoint = meta.endpoint;
  
  return out;
}

export interface ProviderMetadata {
  name?: string;
  description?: string;
  // CPU Info
  cpuModel?: string;
  cpuCores?: number;
  cpuThreads?: number;
  cpuClockSpeed?: string;
  // GPU Info
  gpuModel?: string;
  gpuCount?: number;
  gpuMemory?: string;
  gpuCudaCores?: string;
  // Memory (handle variations)
  ramTotal?: string;
  ramType?: string;
  // Storage (handle variations)
  storageTotal?: string;
  storageType?: string;
  storageSpeed?: string;
  // Network
  bandwidth?: string;
  networkType?: string;
  // Location
  location?: string;
  country?: string;
  city?: string;
  region?: string;
  hardwareTier?: number;
  capacity?: number;
  website?: string;
  email?: string;
  organization?: string;
  tier?: string;
  // Provider Node Endpoint
  endpoint?: string; // Provider node base URL for orchestrator to deploy workloads
  // Timestamps
  createdAt?: string;
  // Allow additional fields for flexibility
  [key: string]: unknown;
}

// IPFS Configuration
const PINATA_JWT = import.meta.env.VITE_PINATA_JWT;
const PINATA_GATEWAY = import.meta.env.VITE_PINATA_GATEWAY || 'gateway.pinata.cloud';

// Pinata API endpoints
const PINATA_API_URL = 'https://api.pinata.cloud';
const PINATA_UPLOAD_URL = `${PINATA_API_URL}/pinning/pinJSONToIPFS`;

/**
 * Upload arbitrary JSON as workload manifest to IPFS (Pinata). Use for create/update workload with on-chain manifestCID.
 * @returns IPFS CID
 */
export async function uploadWorkloadManifestToIPFS(content: unknown): Promise<string> {
  if (!PINATA_JWT) {
    throw new Error('VITE_PINATA_JWT is not set. Please configure it in .env.');
  }
  const response = await fetch(PINATA_UPLOAD_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${PINATA_JWT}`,
    },
    body: JSON.stringify({
      pinataContent: content,
      pinataMetadata: {
        name: `workload-manifest-${Date.now()}`,
        keyvalues: { type: 'workload-manifest', network: 'cloudana' },
      },
      pinataOptions: { cidVersion: 1 },
    }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Pinata upload failed: ${err}`);
  }
  const result = await response.json();
  return result.IpfsHash;
}

/**
 * Upload provider metadata to IPFS using Pinata
 * 
 * This uploads JSON metadata to IPFS via Pinata's API and returns the CID.
 * The data is permanently stored on IPFS and accessible via any IPFS gateway.
 * 
 * @param metadata - Provider metadata to upload
 * @returns IPFS CID (Content Identifier)
 * @throws Error if upload fails
 */
export async function uploadToIPFS(metadata: ProviderMetadata): Promise<string> {
  try {
    devLoggers.ipfs.info('═══════════════════════════════════════════════════');
    devLoggers.ipfs.info('📤 Uploading Provider Metadata to IPFS (Pinata)');
    devLoggers.ipfs.info('═══════════════════════════════════════════════════');
    
    // Validate JWT token
    if (!PINATA_JWT) {
      throw new Error('PINATA_JWT environment variable is not set. Please configure it in .env file.');
    }

    // Add timestamp if not present
    if (!metadata.createdAt) {
      metadata.createdAt = new Date().toISOString();
    }

    devLoggers.ipfs.log('📦 Metadata Summary:');
    devLoggers.ipfs.log(`  Name: ${metadata.name || '(unnamed)'}`);
    devLoggers.ipfs.log(`  Description: ${metadata.description || '(none)'}`);
    devLoggers.ipfs.log(`  CPU: ${metadata.cpuCores || 0} cores (${metadata.cpuModel || 'unknown'})`);
    devLoggers.ipfs.log(`  RAM: ${metadata.ramTotal || '(not set)'}`);
    devLoggers.ipfs.log(`  Storage: ${metadata.storageTotal || '(not set)'}`);
    devLoggers.ipfs.log(`  GPU: ${metadata.gpuCount || 0}x ${metadata.gpuModel || 'N/A'}`);
    devLoggers.ipfs.log(`  Region: ${metadata.region || 'unknown'}, ${metadata.country || 'unknown'}`);
    if (metadata.endpoint) {
      devLoggers.ipfs.success(`  Endpoint: ${metadata.endpoint}`);
    } else {
      devLoggers.ipfs.warn(`  ⚠️  Endpoint: (not set - won't be eligible for workload placement!)`);
    }
    
    const metadataSize = JSON.stringify(metadata).length;
    devLoggers.ipfs.log(`  Size: ${metadataSize} bytes`);
    devLoggers.ipfs.debug('Full metadata object:', metadata);

    devLoggers.ipfs.info('\n🚀 Sending to Pinata...');
    devLoggers.ipfs.debug(`  URL: ${PINATA_UPLOAD_URL}`);
    
    const startTime = Date.now();
    // Upload to Pinata
    const response = await fetch(PINATA_UPLOAD_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${PINATA_JWT}`,
      },
      body: JSON.stringify({
        pinataContent: metadata,
        pinataMetadata: {
          name: `provider-${metadata.name || 'node'}-${Date.now()}`,
          keyvalues: {
            type: 'provider-metadata',
            network: 'cloudana',
            timestamp: new Date().toISOString(),
          }
        },
        pinataOptions: {
          cidVersion: 1,
        }
      }),
    });
    const uploadDuration = Date.now() - startTime;

    if (!response.ok) {
      const errorData = await response.text();
      devLoggers.ipfs.error(`❌ Pinata API error: HTTP ${response.status} (${uploadDuration}ms)`);
      devLoggers.ipfs.error(`   Response: ${errorData.slice(0, 200)}`);
      throw new Error(`Pinata API error (${response.status}): ${errorData}`);
    }

    const result = await response.json();
    const cid = result.IpfsHash;
    const gatewayUrl = `https://${PINATA_GATEWAY}/ipfs/${cid}`;

    devLoggers.ipfs.success(`\n✅ Successfully uploaded to IPFS! (${uploadDuration}ms)`);
    devLoggers.ipfs.success(`  CID: ${cid}`);
    devLoggers.ipfs.success(`  Gateway URL: ${gatewayUrl}`);
    devLoggers.ipfs.log(`  Pin size: ${result.PinSize || 'unknown'} bytes`);
    devLoggers.ipfs.log('═══════════════════════════════════════════════════\n');

    return cid;
  } catch (error) {
    devLoggers.ipfs.error('💥 Upload failed:', error);
    devLoggers.ipfs.log('═══════════════════════════════════════════════════\n');
    throw new Error(`Failed to upload to IPFS: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Fetch provider metadata from IPFS using Pinata gateway
 * 
 * This retrieves JSON metadata from IPFS using the CID.
 * Data is fetched from Pinata's optimized gateway for best performance.
 * 
 * @param cid - IPFS Content Identifier
 * @returns Provider metadata or null if not found
 */
export async function fetchFromIPFS(cid: string): Promise<ProviderMetadata | null> {
  try {
    devLoggers.ipfs.log('Fetching from IPFS...');
    devLoggers.ipfs.log('CID:', cid);

    // Construct gateway URL
    const gatewayUrl = `https://ipfs.io/ipfs/${cid}`;
    devLoggers.ipfs.debug('Gateway URL:', gatewayUrl);

    // Fetch from IPFS gateway
    const response = await fetch(gatewayUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        devLoggers.ipfs.warn('CID not found on IPFS');
        return null;
      }
      throw new Error(`Gateway error (${response.status}): ${response.statusText}`);
    }

    const metadata = await response.json() as ProviderMetadata;
    devLoggers.ipfs.success('Successfully fetched metadata:', metadata);

    return metadata;
  } catch (error) {
    devLoggers.ipfs.error('Fetch failed:', error);
    return null;
  }
}

/**
 * Generate a public key hash for the node
 * In production, this would be derived from the node's actual public key
 */
export function generatePubKeyHash(): string {
  const randomBytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(randomBytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * Validate IPFS CID format
 */
export function isValidIPFSCID(cid: string): boolean {
  // Basic CID validation (v0 and v1)
  return /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(cid) || // CIDv0
         /^[a-z2-7]{59}$/.test(cid); // CIDv1 base32
}

/**
 * Generate Pinata gateway URL for viewing IPFS content
 * @param cid IPFS CID
 * @returns Full Pinata gateway URL
 */
export function getPinataGatewayUrl(cid: string): string {
  // Use public gateway for viewing (no authentication required)
  // Your dedicated gateway requires authentication which isn't suitable for public links
  const PUBLIC_GATEWAY = "gateway.pinata.cloud";
  return `https://${PUBLIC_GATEWAY}/ipfs/${cid}`;
}

/** Workload manifest metadata stored on IPFS (uploaded at workload registration) */
export interface WorkloadManifestFromIPFS {
  name: string;
  description?: string;
  manifest: string; // YAML/JSON workload definition
  requirements?: {
    cpu: string;
    memory: string;
    storage: string;
    storageClasses: string[];
    requiresGPU: boolean;
    gpuCount: string;
    gpuAttributes: string[];
    requiresEdge: boolean;
    regions: string[];
    maxLatency: string;
  };
  createdAt?: string;
}

/**
 * Fetch workload manifest from IPFS by CID.
 * Returns the JSON object (name, description, manifest YAML/JSON, requirements, createdAt).
 * Handles both wrapped shape { name, manifest, ... } and raw deploy JSON (services, profiles).
 */
export async function fetchWorkloadManifestFromIPFS(cid: string): Promise<WorkloadManifestFromIPFS | null> {
  try {
    const url = `https://ipfs.io/ipfs/${cid}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    if (!data || typeof data !== "object") return null;
    // Already in expected shape (has .manifest string)
    if (typeof (data as WorkloadManifestFromIPFS).manifest === "string") {
      return data as WorkloadManifestFromIPFS;
    }
    // Raw deploy JSON (services, profiles): normalize for display
    if (data.services != null || data.profiles != null) {
      return {
        name: typeof data.name === "string" ? data.name : typeof data.summary === "string" ? data.summary : undefined,
        description: typeof data.description === "string" ? data.description : undefined,
        summary: typeof data.summary === "string" ? data.summary : undefined,
        manifest: JSON.stringify(data, null, 2),
        createdAt: typeof data.createdAt === "string" ? data.createdAt : undefined,
      };
    }
    // Minimal metadata-only payload (name, summary, createdAt from dashboard)
    return {
      name: typeof data.name === "string" ? data.name : undefined,
      description: typeof data.description === "string" ? data.description : undefined,
      summary: typeof data.summary === "string" ? data.summary : undefined,
      manifest: JSON.stringify(data, null, 2),
      createdAt: typeof data.createdAt === "string" ? data.createdAt : undefined,
    };
  } catch (e) {
    devLoggers.ipfs.warn("Failed to fetch workload manifest", cid, e);
    return null;
  }
}
// Export types for use in components
export interface ProviderNode {
  pubKeyHash: string;
  ipfsCID: string;
  bondAmount: string;
  registeredAt: number;
  status: number; // ProviderStatus: 0=Unregistered, 1=Active, 2=Inactive, 3=Suspended
  owner: string;
  metadata?: ProviderMetadata; // Fetched from IPFS
}

const PROVIDER_REGISTRY_ADDRESS = CONTRACT_ADDRESSES.contracts.ProviderRegistry as Address;
const CHAIN_ID = CONTRACT_ADDRESSES.chainId;

/** On-chain provider: only metadataUri + protocol state. Full device spec is on IPFS. */
export type ContractProviderRaw = {
  providerAddr?: Address;
  deviceId?: string;
  metadataUri?: string;
  status?: number;
  registeredAt?: bigint;
  updatedAt?: bigint;
  /** @deprecated Legacy ABI used endpoint; prefer metadataUri */
  endpoint?: string;
};

/** Map contract getProviderByDevice() result to ApiProvider shape. Chain stores only metadata URI; spec from IPFS. */
export function mapContractProviderToApi(
  addr: Address,
  raw: ContractProviderRaw,
  deviceId?: string
): Record<string, unknown> {
  const owner = (raw.providerAddr ?? addr) as string;
  const status = Number(raw.status ?? 0); // 0 Unregistered, 1 Active, 2 Inactive, 3 Suspended
  const metadataUri = raw.metadataUri ?? raw.endpoint ?? "";
  const out: Record<string, unknown> = {
    owner,
    ownerAddress: owner,
    providerkey: owner,
    hostUri: metadataUri,
    status,
    registeredAt: Number(raw.registeredAt ?? 0),
    updatedAt: Number(raw.updatedAt ?? 0),
  };
  out.deviceId = (deviceId != null && deviceId !== "" ? deviceId : (typeof raw.deviceId === "string" ? raw.deviceId : undefined)) ?? undefined;
  return out;
}

/** 
 * Resolve provider metadata URL: use hostUri if it's HTTP(S), else if it looks like IPFS CID use gateway URL.
 * Follows the same pattern as workload metadata resolution for consistency.
 */
function getProviderMetadataUrl(p: { hostUri?: string }): string | null {
  const uri = p.hostUri;
  if (!uri || typeof uri !== "string") return null;
  const trimmed = uri.trim();
  // If already a full URL, use it as-is
  if (isMetadataUrl(trimmed)) return trimmed;
  // If it's a CID, convert to IPFS gateway URL (same gateway as workload)
  if (isValidIPFSCID(trimmed)) return `https://ipfs.io/ipfs/${trimmed}`;
  // Assume it's a CID even if validation failed (handles edge cases)
  return `https://ipfs.io/ipfs/${trimmed}`;
}

/**
 * Enrich a single API provider with IPFS metadata. On-chain we only store metadata URI;
 * full device spec (capacity, capabilities, location, etc.) comes from IPFS.
 */
async function enrichProviderWithIpfsMetadata(p: Record<string, unknown>): Promise<void> {
  const metadataUrl = getProviderMetadataUrl(p as { hostUri?: string });
  if (!metadataUrl) {
    devLoggers.ipfs.warn(`⚠️  No metadata URL for provider ${p.owner as string ?? 'unknown'}`);
    return;
  }
  if (isValidIPFSCID(String((p.hostUri as string) ?? ""))) {
    p.ipfsCID = p.hostUri;
  }
  
  devLoggers.ipfs.log(`🔍 Fetching IPFS metadata for provider ${p.owner as string ?? 'unknown'}...`);
  devLoggers.ipfs.debug(`  URL: ${metadataUrl}`);
  
  const meta = await fetchProviderMetadataFromUrl(metadataUrl);
  if (meta) {
    const fields = metadataToApiProviderFields(meta);
    Object.assign(p, fields);
    devLoggers.ipfs.success(`✅ Enriched provider with IPFS metadata (${Object.keys(fields).length} fields)`);
    devLoggers.ipfs.debug(`  Fields: ${Object.keys(fields).join(', ')}`);
  } else {
    devLoggers.ipfs.error(`❌ Failed to fetch IPFS metadata for provider ${p.owner as string ?? 'unknown'}`);
    devLoggers.ipfs.warn(`  Provider will show incomplete data (using defaults)`);
  }
}

/**
 * Fetch real-time stats from provider nodes via backend API
 */
export async function getProviderStats(): Promise<Record<string, any>> {
  try {
    const base = import.meta.env.VITE_API_URL || "http://localhost:7002/v1";
    const url = `${base}/orchestration/provider-stats`;
    const res = await fetch(url);
    if (!res.ok) {
      devLoggers.api.warn(`Failed to fetch provider stats: ${res.status}`);
      return {};
    }
    const data = await res.json();
    return data.stats || {};
  } catch (error) {
    devLoggers.api.error("Error fetching provider stats:", error);
    return {};
  }
}

/**
 * Get all active providers from the ProviderRegistry contract (by deviceId).
 * Enriches each provider with IPFS metadata and real-time stats from provider nodes.
 */
export async function getAllProviders(): Promise<any[]> {
  try {
    const client = getPublicClient(wagmiConfig, { chainId: CHAIN_ID });
    if (!client) {
      devLoggers.api.warn("No public client for chain", CHAIN_ID);
      return [];
    }
    const deviceIds = await client.readContract({
      address: PROVIDER_REGISTRY_ADDRESS,
      abi: ProviderRegistryAbi,
      functionName: "getActiveProviders",
    }) as `0x${string}`[];
    if (!deviceIds?.length) {
      devLoggers.api.log("No providers on chain");
      return [];
    }
    
    // Fetch providers with IPFS metadata
    const providers = await Promise.all(
      deviceIds.map(async (deviceId) => {
        const raw = await client.readContract({
          address: PROVIDER_REGISTRY_ADDRESS,
          abi: ProviderRegistryAbi,
          functionName: "getProviderByDevice",
          args: [deviceId],
        }) as ContractProviderRaw;
        if (Number(raw?.status) === 0) return null;
        const owner = (raw?.providerAddr ?? "") as string;
        const deviceIdString = (typeof deviceId === "string" ? deviceId : (deviceId as unknown as { toString: () => string })?.toString?.()) ?? "";
        const provider = mapContractProviderToApi(owner, raw, deviceIdString);
        await enrichProviderWithIpfsMetadata(provider);
        return provider;
      })
    );
    const filtered = providers.filter((provider): provider is NonNullable<typeof provider> => provider != null);
    
    // Fetch real-time stats from provider nodes
    const stats = await getProviderStats();
    
    // Merge stats with provider data
    filtered.forEach((provider) => {
      const deviceId = provider.deviceId as string;
      if (deviceId && stats[deviceId]) {
        provider.realTimeStats = stats[deviceId];
      }
    });
    
    devLoggers.api.log(`Loaded ${filtered.length} providers from chain (with real-time stats)`);
    return filtered;
  } catch (error) {
    devLoggers.api.error("Error fetching providers from chain:", error);
    return [];
  }
}

/**
 * Get providers registered by the given owner (from chain; one wallet can have many devices).
 * Enriches each provider with IPFS metadata and real-time stats from provider nodes.
 */
export async function getMyProviders(ownerAddress: Address): Promise<any[]> {
  try {
    const client = getPublicClient(wagmiConfig, { chainId: CHAIN_ID });
    if (!client) return [];
    const deviceIds = await client.readContract({
      address: PROVIDER_REGISTRY_ADDRESS,
      abi: ProviderRegistryAbi,
      functionName: "getProvidersByOwner",
      args: [ownerAddress],
    }) as `0x${string}`[];
    if (!deviceIds?.length) return [];
    
    const providers = await Promise.all(
      deviceIds.map(async (deviceId) => {
        const raw = await client.readContract({
          address: PROVIDER_REGISTRY_ADDRESS,
          abi: ProviderRegistryAbi,
          functionName: "getProviderByDevice",
          args: [deviceId],
        }) as ContractProviderRaw;
        if (Number(raw?.status) === 0) return null;
        const owner = (raw?.providerAddr ?? ownerAddress) as string;
        const deviceIdString = (typeof deviceId === "string" ? deviceId : (deviceId as unknown as { toString: () => string })?.toString?.()) ?? "";
        const provider = mapContractProviderToApi(owner, raw, deviceIdString);
        await enrichProviderWithIpfsMetadata(provider);
        return provider;
      })
    );
    const filtered = providers.filter((provider): provider is NonNullable<typeof provider> => provider != null);
    
    // Fetch real-time stats from provider nodes
    const stats = await getProviderStats();
    
    // Merge stats with provider data
    filtered.forEach((provider) => {
      const deviceId = provider.deviceId as string;
      if (deviceId && stats[deviceId]) {
        provider.realTimeStats = stats[deviceId];
      }
    });
    
    return filtered;
  } catch (error) {
    devLoggers.api.error("Error fetching my providers:", error);
    return [];
  }
}

/**
 * Get one provider by deviceId (unique key). Fetches from chain and enriches with IPFS metadata
 * (when endpoint is a gateway URL or IPFS CID).
 */
export async function getProviderByDeviceId(deviceId: string): Promise<any | null> {
  try {
    const client = getPublicClient(wagmiConfig, { chainId: CHAIN_ID });
    if (!client || !deviceId || typeof deviceId !== "string") return null;
    const raw = await client.readContract({
      address: PROVIDER_REGISTRY_ADDRESS,
      abi: ProviderRegistryAbi,
      functionName: "getProviderByDevice",
      args: [deviceId as `0x${string}`],
    }) as ContractProviderRaw;
    if (!raw || Number(raw?.status) === 0) return null;
    const owner = (raw?.providerAddr ?? "") as string;
    const provider = mapContractProviderToApi(owner, raw, deviceId);
    await enrichProviderWithIpfsMetadata(provider);
    return provider;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator Deploy API
// ─────────────────────────────────────────────────────────────────────────────

/** Base URL for the orchestrator (same as VITE_API_URL). */
function getOrchestratorBase(): string {
  const override = import.meta.env.VITE_ORCHESTRATOR_URL;
  if (override) return override.replace(/\/+$/, "");
  const api = import.meta.env.VITE_API_URL;
  if (api) return api.replace(/\/+$/, "");
  return "http://localhost:7002/v1";
}

/**
 * Options for deploying a workload.
 *
 * - `provider = "akash"` (or omitted) → deploy to Akash network
 * - `providerEndpoint = "https://my-node:4040"` → deploy directly to a Cloudana provider
 */
export interface DeployWorkloadOptions {
  /** SDL YAML string or JSON object representing the workload manifest. */
  manifest: string | Record<string, unknown>;
  /**
   * Target provider.
   * - `"akash"` or `undefined` → Akash network (requires AKASH_MNEMONIC on orchestrator)
   * - Any other string → treated as a named provider (currently routed via providerEndpoint)
   */
  provider?: "akash" | string;
  /** Direct HTTP endpoint of a Cloudana provider node (e.g. `https://provider.example.com:4040`). */
  providerEndpoint?: string;
  /** Optional human-readable name for this deployment. */
  name?: string;
}

export interface DeployWorkloadResult {
  status: "success" | "error";
  /** "akash" or "cloudana" */
  provider?: string;
  /** Akash deployment ID (poll with getDeploymentStatus). */
  deploymentId?: string;
  /** Akash deployment sequence number. */
  dseq?: string;
  /** Akash wallet address that owns the deployment. */
  owner?: string;
  /** Akash network (mainnet/testnet). */
  network?: string;
  /** Cloudana workload/instance IDs. */
  workloadId?: string;
  instanceId?: string;
  /** Provider endpoint used. */
  providerEndpoint?: string;
  /** Human-readable message from the orchestrator. */
  message?: string;
  /** Error description if status = "error". */
  error?: string;
  /** Raw result from provider node (Cloudana). */
  result?: unknown;
}

/**
 * Deploy a workload via the orchestrator.
 *
 * Routes to Akash or a Cloudana provider node based on `options.provider`
 * and `options.providerEndpoint`.
 *
 * @example
 * // Deploy to Akash
 * const result = await deployWorkload({ manifest: mySDLYaml });
 *
 * @example
 * // Deploy to a specific Cloudana provider
 * const result = await deployWorkload({
 *   manifest: mySDLYaml,
 *   providerEndpoint: "https://provider.example.com:4040",
 * });
 */
export async function deployWorkload(options: DeployWorkloadOptions): Promise<DeployWorkloadResult> {
  const base = getOrchestratorBase();
  const url = `${base}/deploy`;

  devLoggers.api.info(`🚀 Deploying workload to ${options.providerEndpoint ? `Cloudana (${options.providerEndpoint})` : "Akash"}...`);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        manifest: options.manifest,
        provider: options.provider,
        providerEndpoint: options.providerEndpoint,
        name: options.name,
      }),
    });

    const data = (await res.json()) as DeployWorkloadResult;

    if (!res.ok) {
      devLoggers.api.error(`❌ Deploy failed (HTTP ${res.status}): ${data.error ?? "unknown error"}`);
    } else {
      devLoggers.api.success(`✅ Deploy initiated: ${data.deploymentId ?? data.workloadId ?? "ok"}`);
    }

    return data;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    devLoggers.api.error(`💥 Deploy request failed: ${msg}`);
    return { status: "error", error: msg };
  }
}

// ─── Deployment status ─────────────────────────────────────────────────────

export type AkashDeploymentStatus =
  | "creating"
  | "waiting_for_bids"
  | "bid_accepted"
  | "manifest_sent"
  | "active"
  | "failed"
  | "closed";

export interface DeploymentStatusResult {
  id: string;
  dseq?: string;
  owner?: string;
  status: AkashDeploymentStatus | string;
  provider?: string;
  providerEndpoint?: string;
  gseq?: number;
  oseq?: number;
  sdl?: string;
  createdAt: number;
  updatedAt: number;
  error?: string;
  serviceUrl?: string;
}

/**
 * Get the status of a deployment by its ID (returned from deployWorkload).
 *
 * @param deploymentId - The deployment ID from deployWorkload().deploymentId
 */
export async function getDeploymentStatus(deploymentId: string): Promise<DeploymentStatusResult | null> {
  const base = getOrchestratorBase();
  const url = `${base}/deployments/${encodeURIComponent(deploymentId)}`;

  try {
    const res = await fetch(url);
    if (res.status === 404) return null;
    if (!res.ok) {
      devLoggers.api.warn(`⚠️  getDeploymentStatus HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { status: string; deployment: DeploymentStatusResult };
    return data.deployment ?? null;
  } catch (err: unknown) {
    devLoggers.api.error(`💥 getDeploymentStatus error: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/**
 * List all Akash deployments tracked by the orchestrator.
 */
export async function listDeployments(): Promise<DeploymentStatusResult[]> {
  const base = getOrchestratorBase();
  const url = `${base}/deployments`;

  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as { status: string; deployments: DeploymentStatusResult[] };
    return data.deployments ?? [];
  } catch {
    return [];
  }
}

/**
 * Close/terminate an active deployment.
 *
 * @param deploymentId - The deployment ID to close
 */
export async function closeDeployment(deploymentId: string): Promise<{ success: boolean; error?: string }> {
  const base = getOrchestratorBase();
  const url = `${base}/deployments/${encodeURIComponent(deploymentId)}`;

  try {
    const res = await fetch(url, { method: "DELETE" });
    const data = (await res.json()) as { status: string; error?: string };
    return { success: data.status === "success", error: data.error };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
