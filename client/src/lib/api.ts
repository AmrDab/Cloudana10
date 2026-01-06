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
 * Get all registered providers from the blockchain
 * Uses contract's getAllProviderKeys() function (no events needed)
 * Follows the same reliable pattern as getMyProviders()
 */
export async function getAllProviders(): Promise<any[]> {
  try {
    console.log('[API] Fetching all providers from blockchain...');
    
    const PROVIDER_REGISTRY_ADDRESS = CONTRACT_ADDRESSES.contracts.ProviderRegistry as Address;
    const CHAIN_ID = CONTRACT_ADDRESSES.chainId;
    
    // Call the contract's getAllProviderKeys function to get all pubKeyHashes
    const pubKeyHashes = await readContract(wagmiConfig, {
      address: PROVIDER_REGISTRY_ADDRESS,
      abi: ProviderRegistryAbi,
      functionName: "getAllProviderKeys",
      chainId: CHAIN_ID,
    }) as `0x${string}`[];
    
    console.log(`[API] Found ${pubKeyHashes.length} total providers`);
    
    // Fetch full details for each provider (same pattern as getMyProviders)
    const providers = await Promise.all(
      pubKeyHashes.map(async (pubKeyHash, index) => {
        try {
          // Get provider details from contract using public providers mapping
          const providerDetails = await readContract(wagmiConfig, {
            address: PROVIDER_REGISTRY_ADDRESS,
            abi: ProviderRegistryAbi,
            functionName: "providers",
            args: [pubKeyHash],
            chainId: CHAIN_ID,
          }) as any;
          
          // Skip if provider doesn't exist (owner is zero address)
          if (!providerDetails[0] || providerDetails[0] === '0x0000000000000000000000000000000000000000') {
            return null;
          }
          
          // Fetch IPFS metadata
          let metadata = null;
          if (providerDetails[2]) {
            try {
              metadata = await fetchFromIPFS(providerDetails[2] as string);
            } catch (ipfsErr) {
              console.warn(`[API] Failed to fetch IPFS metadata for ${pubKeyHash}:`, ipfsErr);
            }
          }
          
          // Return complete provider data
          return {
            id: `provider-${index}-${pubKeyHash}`,
            pubKeyHash,
            providerkey: pubKeyHash,
            ipfsCID: providerDetails[2],
            bondAmount: providerDetails[3]?.toString() || "0",
            registeredAt: Number(providerDetails[4] || 0),
            status: Number(providerDetails[5] || 0),
            owner: providerDetails[0],
            ownerAddress: providerDetails[0],
            // Spread IPFS metadata (name, description, hardware specs, etc.)
            ...metadata,
          };
        } catch (err) {
          console.warn(`[API] Failed to fetch details for provider ${pubKeyHash}:`, err);
          return null;
        }
      })
    );
    
    // Filter out null values (failed fetches) and sort by registration time (most recent first)
    const validProviders = providers
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .sort((a, b) => b.registeredAt - a.registeredAt);
    
    console.log(`[API] Successfully loaded ${validProviders.length} providers with metadata`);
    return validProviders;
  } catch (error) {
    console.error('[API] Error fetching all providers:', error);
    return [];
  }
}

/**
 * Get providers registered by the current user from the blockchain
 * Returns full provider details with IPFS metadata
 */
export async function getMyProviders(ownerAddress: Address): Promise<any[]> {
  try {
    console.log('[API] Fetching my providers for:', ownerAddress);
    
    const PROVIDER_REGISTRY_ADDRESS = CONTRACT_ADDRESSES.contracts.ProviderRegistry as Address;
    const CHAIN_ID = CONTRACT_ADDRESSES.chainId;
    
    // Call the contract's getMyProviders function to get pubKeyHashes
    const pubKeyHashes = await readContract(wagmiConfig, {
      address: PROVIDER_REGISTRY_ADDRESS,
      abi: ProviderRegistryAbi,
      functionName: "getMyProviders",
      args: [ownerAddress],
      chainId: CHAIN_ID,
    }) as `0x${string}`[];
    
    console.log(`[API] Found ${pubKeyHashes.length} provider keys`);
    
    // Fetch full details for each provider including IPFS metadata
    const providers = await Promise.all(
      pubKeyHashes.map(async (pubKeyHash) => {
        try {
          // Get provider details from contract using public providers mapping
          const providerDetails = await readContract(wagmiConfig, {
            address: PROVIDER_REGISTRY_ADDRESS,
            abi: ProviderRegistryAbi,
            functionName: "providers",
            args: [pubKeyHash],
            chainId: CHAIN_ID,
          }) as any;
          
          // Fetch IPFS metadata
          let metadata = null;
          console.log('providerDetails from Contract', providerDetails);
          if (providerDetails[2]) {
            metadata = await fetchFromIPFS(providerDetails[2] as string);
          }
          console.log('providerDetails from IPFS', metadata);
          return {
            pubKeyHash,
            providerkey: pubKeyHash,
            ipfsCID: providerDetails[2],
            bondAmount: providerDetails[3]?.toString() || "0",
            registeredAt: Number(providerDetails[4] || 0),
            status: Number(providerDetails[5] || 0),
            owner: providerDetails[0],
            ownerAddress: providerDetails[0],
            // Spread IPFS metadata
            ...metadata,
          };
        } catch (err) {
          console.warn(`[API] Failed to fetch details for provider ${pubKeyHash}:`, err);
          return null;
        }
      })
    );
    
    // Filter out null values (failed fetches)
    const validProviders = providers.filter((p) => p !== null);
    console.log(`[API] Successfully loaded ${validProviders.length} providers with metadata`);
    return validProviders;
  } catch (error) {
    console.error('[API] Error fetching my providers:', error);
    return [];
  }
}
