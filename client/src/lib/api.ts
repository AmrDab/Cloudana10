// IPFS and DePIN utilities for direct contract interaction
// No backend needed - all data stored on-chain or IPFS

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

/**
 * Upload provider metadata to IPFS
 * In production, this would use a service like Pinata, Web3.Storage, or local IPFS node
 * For now, we'll create a mock implementation
 */
export async function uploadToIPFS(metadata: ProviderMetadata): Promise<string> {
  // TODO: Implement actual IPFS upload using Pinata or Web3.Storage
  // For now, return a mock CID based on the data hash
  
  const jsonString = JSON.stringify(metadata, null, 2);
  
  // Mock CID generation (in production, this would be the actual IPFS CID)
  // Using a simple hash-like string for demonstration
  const mockCID = `Qm${btoa(jsonString.substring(0, 32)).replace(/[^a-zA-Z0-9]/g, '').substring(0, 44)}`;
  
  console.log('[IPFS] Mock upload to IPFS:', mockCID);
  console.log('[IPFS] Metadata:', metadata);
  
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 500));
  
  return mockCID;
}

/**
 * Fetch provider metadata from IPFS
 * In production, this would fetch from IPFS gateway
 */
export async function fetchFromIPFS(cid: string): Promise<ProviderMetadata | null> {
  // TODO: Implement actual IPFS fetch using gateway
  // For now, return mock data
  
  console.log('[IPFS] Mock fetch from IPFS:', cid);
  
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 300));
  
  // Return mock metadata
  return {
    name: 'Provider Node',
    description: 'DePIN compute node',
    createdAt: new Date().toISOString(),
  };
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
