// IPFS and DePIN utilities for direct contract interaction
// No backend needed - all data stored on-chain or IPFS

import { readContract, getPublicClient } from "@wagmi/core";
import { wagmiConfig } from "@/lib/wagmi-config";
import { ProviderRegistryAbi, CONTRACT_ADDRESSES } from "@shared/contracts";
import type { Address } from "viem";

export interface ProviderMetadata {
  name: string;
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
  // Memory
  ramTotal?: string;
  ramType?: string;
  // Storage
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
  // Timestamps
  createdAt?: string;
}

// IPFS Configuration
const PINATA_JWT = import.meta.env.VITE_PINATA_JWT;
const PINATA_GATEWAY = import.meta.env.VITE_PINATA_GATEWAY || 'gateway.pinata.cloud';

// Pinata API endpoints
const PINATA_API_URL = 'https://api.pinata.cloud';
const PINATA_UPLOAD_URL = `${PINATA_API_URL}/pinning/pinJSONToIPFS`;

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
    // Validate JWT token
    if (!PINATA_JWT) {
      throw new Error('PINATA_JWT environment variable is not set. Please configure it in .env file.');
    }

    // Add timestamp if not present
    if (!metadata.createdAt) {
      metadata.createdAt = new Date().toISOString();
    }

    console.log('[IPFS] Uploading to Pinata...');
    console.log('[IPFS] Metadata:', metadata);

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

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`Pinata API error (${response.status}): ${errorData}`);
    }

    const result = await response.json();
    const cid = result.IpfsHash;

    console.log('[IPFS] ✓ Successfully uploaded to IPFS');
    console.log('[IPFS] CID:', cid);
    console.log('[IPFS] Gateway URL:', `https://${PINATA_GATEWAY}/ipfs/${cid}`);

    return cid;
  } catch (error) {
    console.error('[IPFS] ✗ Upload failed:', error);
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
    console.log('[IPFS] Fetching from IPFS...');
    console.log('[IPFS] CID:', cid);

    // Construct gateway URL
    const gatewayUrl = `https://ipfs.io/ipfs/${cid}`;
    console.log('[IPFS] Gateway URL:', gatewayUrl);

    // Fetch from IPFS gateway
    const response = await fetch(gatewayUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.warn('[IPFS] ✗ CID not found on IPFS');
        return null;
      }
      throw new Error(`Gateway error (${response.status}): ${response.statusText}`);
    }

    const metadata = await response.json() as ProviderMetadata;
    console.log('[IPFS] ✓ Successfully fetched metadata:', metadata);

    return metadata;
  } catch (error) {
    console.error('[IPFS] ✗ Fetch failed:', error);
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
    .map((b) => b.toString(16).padStart(2, "0"))
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

const WORKLOAD_CID_STORAGE_KEY = "cloudana_workload_cid";

/** Persist IPFS CID for a workload so we can fetch manifest later (on-chain we only store hash of CID) */
export function setWorkloadCID(workloadId: number | bigint, cid: string): void {
  try {
    const key = `${WORKLOAD_CID_STORAGE_KEY}_${String(workloadId)}`;
    localStorage.setItem(key, cid);
  } catch (e) {
    console.warn("[IPFS] Failed to store workload CID", e);
  }
}

/** Get persisted IPFS CID for a workload, if any */
export function getWorkloadCID(workloadId: number | bigint): string | null {
  try {
    const key = `${WORKLOAD_CID_STORAGE_KEY}_${String(workloadId)}`;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Fetch workload manifest from IPFS by CID.
 * Returns the JSON object (name, description, manifest YAML/JSON, requirements, createdAt).
 */
export async function fetchWorkloadManifestFromIPFS(cid: string): Promise<WorkloadManifestFromIPFS | null> {
  try {
    const url = `https://ipfs.io/ipfs/${cid}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const data = (await res.json()) as WorkloadManifestFromIPFS;
    return data;
  } catch (e) {
    console.warn("[IPFS] Failed to fetch workload manifest", cid, e);
    return null;
  }
}
// Export types for use in components
export interface ProviderNode {
  pubKeyHash: string;
  ipfsCID: string;
  bondAmount: string;
  registeredAt: number;
  status: number; // 0=Registered, 1=Active, 2=Inactive
  owner: string;
  metadata?: ProviderMetadata; // Fetched from IPFS
}

/**
 * Get all registered providers
 * 
 * Reads provider registrations directly from ProviderRegistry events on-chain.
 */
export async function getAllProviders(): Promise<any[]> {
  try {
    const PROVIDER_REGISTRY_ADDRESS = (CONTRACT_ADDRESSES.contracts.ProviderRegistry || "0xc3D4f33d7b686A3c6edf1d69869D29AB6F7b5CFF") as Address;
    const CHAIN_ID = CONTRACT_ADDRESSES.chainId;

    const logs = await getPublicClient(wagmiConfig, { chainId: CHAIN_ID }).getContractEvents({
      address: PROVIDER_REGISTRY_ADDRESS,
      abi: ProviderRegistryAbi,
      eventName: "ProviderRegistered",
      fromBlock: "earliest",
      toBlock: "latest",
    });

    const providers = await Promise.all(
      logs.map(async (log: any, index: number) => {
        const pubKeyHash = log.args.pubKeyHash as `0x${string}`;
        const owner = log.args.owner as Address;
        const ipfsCID = (log.args.ipfsCID as string) || "";

        let metadata = null;
        if (ipfsCID) {
          metadata = await fetchFromIPFS(ipfsCID);
        }

        return {
          id: `provider-${index}-${pubKeyHash}`,
          pubKeyHash,
          providerkey: pubKeyHash,
          ipfsCID,
          bondAmount: (log.args.bondAmount ?? 0n).toString(),
          registeredAt: 0,
          status: 1,
          owner,
          ownerAddress: owner,
          ...metadata,
        };
      })
    );

    return providers.reverse();
  } catch (error) {
    console.error('[API] Error fetching providers:', error);
    return [];
  }
}

/**
 * Get providers registered by the current user
 * 
 * Reads providers registered by the given owner directly from ProviderRegistry.
 */
export async function getMyProviders(ownerAddress: Address): Promise<any[]> {
  try {
    const PROVIDER_REGISTRY_ADDRESS = (CONTRACT_ADDRESSES.contracts.ProviderRegistry || "0xc3D4f33d7b686A3c6edf1d69869D29AB6F7b5CFF") as Address;
    const CHAIN_ID = CONTRACT_ADDRESSES.chainId;

    const pubKeyHashes = await readContract(wagmiConfig, {
      address: PROVIDER_REGISTRY_ADDRESS,
      abi: ProviderRegistryAbi,
      functionName: "getMyProviders",
      args: [ownerAddress],
      chainId: CHAIN_ID,
    }) as `0x${string}`[];

    const providers = await Promise.all(
      pubKeyHashes.map(async (pubKeyHash) => {
        const providerDetails = await readContract(wagmiConfig, {
          address: PROVIDER_REGISTRY_ADDRESS,
          abi: ProviderRegistryAbi,
          functionName: "getProvider",
          args: [pubKeyHash],
          chainId: CHAIN_ID,
        }) as any;

        const ipfsCID = providerDetails.ipfsCID || providerDetails[2] || "";
        let metadata = null;
        if (ipfsCID) {
          metadata = await fetchFromIPFS(ipfsCID as string);
        }

        return {
          pubKeyHash,
          providerkey: pubKeyHash,
          ipfsCID,
          bondAmount: (providerDetails.bondAmount || providerDetails[3] || 0n).toString(),
          registeredAt: Number(providerDetails.registeredAt || providerDetails[4] || 0),
          status: Number(providerDetails.status || providerDetails[5] || 0),
          owner: providerDetails.owner || providerDetails[0],
          ownerAddress: providerDetails.owner || providerDetails[0],
          ...metadata,
        };
      })
    );

    return providers;
  } catch (error) {
    console.error('[API] Error fetching my providers:', error);
    return [];
  }
}

