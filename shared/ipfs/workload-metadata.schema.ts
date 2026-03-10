/**
 * Workload metadata schema for IPFS.
 * On-chain we store only the metadata URI (CID or gateway URL); this is the full document.
 * Supports SDL v2.0 templates (awesome-akash format) and legacy requirements format.
 */

export const WORKLOAD_METADATA_SCHEMA_VERSION = "1.0";

export interface WorkloadMetadata {
  /** Schema version for evolution */
  schemaVersion?: string;

  /** Display name */
  name?: string;

  /** Description or summary */
  description?: string;
  summary?: string;

  /** SDL v2.0 YAML template (awesome-akash format). When present, orchestrator parses and builds K8s manifest. */
  sdl?: string;

  /** Alternative: raw manifest string (SDL YAML). Same as sdl. */
  manifest?: string;

  /** Optional template ID (e.g., "elizaos", "akash-network-awesome-akash-Elizaos-ai_Agents") */
  template?: string;

  /** Legacy: explicit requirements for placement. If sdl/manifest present, requirements are derived from SDL. */
  requirements?: {
    cpu?: number | string;
    memory?: number | string;
    memoryBytes?: number | string;
    storage?: number | string;
    storageBytes?: number | string;
    gpuCount?: number | string;
    gpu?: number | string;
  };

  /** Creation timestamp (ISO 8601) */
  createdAt?: string;

  /** Raw deploy config (services, profiles) when stored as parsed JSON */
  services?: unknown;
  profiles?: unknown;

  /** Allow additional fields for forward compatibility */
  [key: string]: unknown;
}
