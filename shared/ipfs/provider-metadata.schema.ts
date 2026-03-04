/**
 * Canonical provider metadata schema (device spec) for IPFS.
 * On-chain we store only the metadata URI (CID or gateway URL); this is the full document.
 * Versioned for future evolution; extra fields are allowed.
 */

export const PROVIDER_METADATA_SCHEMA_VERSION = "1.0";

export interface ProviderMetadataSchema {
  /** Schema version for evolution (e.g. "1.0") */
  schemaVersion?: string;

  /** Display name (required) */
  name: string;
  description?: string;
  createdAt?: string; // ISO 8601

  // --- Capacity (used by placement and UI) ---
  cpuModel?: string;
  cpuCores?: number;
  cpuThreads?: number;
  cpuClockSpeed?: string;
  ramTotal?: string;   // e.g. "256 GB", "1.5 TB"
  storageTotal?: string;
  gpuModel?: string;
  gpuCount?: number;   // 0 = CPU-only
  gpuMemory?: string;
  gpuCudaCores?: string;

  // --- Location / attributes ---
  region?: string;
  country?: string;
  city?: string;
  location?: string;

  // --- Deploy (required for workload placement) ---
  /** Base URL of the provider node for POST /deploy (e.g. https://host:4040). Orchestrator confirms workload execution here before recording placement on-chain. */
  endpoint?: string;

  // --- Contact / org ---
  website?: string;
  email?: string;
  organization?: string;

  // --- Optional tier/capacity hints ---
  hardwareTier?: number;
  capacity?: number;
  tier?: string;

  // --- Extensibility (e.g. Akash-style attributes for filtering) ---
  attributes?: Record<string, string | number | boolean>;

  // --- Allow additional fields for forward compatibility ---
  [key: string]: unknown;
}

/** Capacity shape derived from provider metadata for placement. */
export interface ProviderCapacityFromMetadata {
  cpu: bigint;        // millicores
  memoryBytes: bigint;
  storageBytes: bigint;
  gpuCount: bigint;
}
