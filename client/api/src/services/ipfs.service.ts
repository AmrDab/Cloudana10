/**
 * Fetch workload manifest metadata from IPFS by CID.
 * Used by API and orchestrator to match/select providers and expose manifest to frontend.
 */
import { readWorkload } from "./chain-client.js";
import { bytesToCidString } from "../lib/cid.js";
import { log } from "../lib/logger.js";

/** Default: Pinata gateway (reliable for pinned content). Override with IPFS_GATEWAY (e.g. https://cloudflare-ipfs.com). */
const IPFS_GATEWAY = process.env.IPFS_GATEWAY ?? "https://gateway.pinata.cloud";
const L = log.ipfs;

export interface WorkloadManifestFromIPFS {
  name?: string;
  description?: string;
  summary?: string;
  manifest?: string;
  requirements?: Record<string, unknown>;
  createdAt?: string;
  /** Raw deploy JSON (services, profiles) when stored as deploy config */
  services?: unknown;
  profiles?: unknown;
  [key: string]: unknown;
}

const FETCH_TIMEOUT_MS = 18_000;
const FETCH_RETRY_ATTEMPTS = 2;

function resolveWorkloadMetadataUriToFetchUrl(uri: string | undefined): string | null {
  if (!uri || typeof uri !== "string") return null;
  const s = uri.trim();
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  if (/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(s) || /^[a-z2-7]{59}$/.test(s)) return `${IPFS_GATEWAY}/ipfs/${s}`;
  return `${IPFS_GATEWAY}/ipfs/${s}`;
}

/**
 * Fetch workload manifest from IPFS by CID.
 * Returns normalized object; handles both wrapped shape { name, manifest, ... } and raw deploy JSON.
 */
export async function fetchWorkloadManifestFromIPFS(cid: string): Promise<WorkloadManifestFromIPFS | null> {
  try {
    const url = `${IPFS_GATEWAY}/ipfs/${cid}`;
    L.info(`📥 Fetching workload manifest from IPFS...`);
    L.log(`  CID: ${cid}`);
    L.dim(`  URL: ${url}`);
    
    const startTime = Date.now();
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    const fetchDuration = Date.now() - startTime;
    
    if (!res.ok) {
      L.error(`❌ IPFS fetch failed: HTTP ${res.status} ${res.statusText} (${fetchDuration}ms)`);
      return null;
    }
    
    const data = (await res.json()) as WorkloadManifestFromIPFS;
    const dataSize = JSON.stringify(data).length;
    
    L.success(`✅ Manifest fetched successfully (${fetchDuration}ms, ${dataSize} bytes)`);
    L.log(`  Name: ${data.name || '(unnamed)'}`);
    L.log(`  Description: ${data.description || data.summary || '(no description)'}`);
    if (data.requirements) {
      L.log(`  Requirements:`, data.requirements);
    }
    
    return data;
  } catch (e) {
    L.error("💥 Failed to fetch workload manifest from IPFS:", cid, e);
    return null;
  }
}

/** Requirements shape for placement (from workload metadata on IPFS). */
export interface WorkloadRequirementsFromIPFS {
  cpu: bigint;
  memoryBytes: bigint;
  storageBytes: bigint;
  gpuCount: bigint;
}

/**
 * Fetch workload metadata from URI (IPFS CID or gateway URL) and return requirements for placement.
 * Supports: SDL templates (sdl/manifest field), requirements object, or legacy fields.
 */
export async function fetchWorkloadRequirementsFromUri(metadataUri: string): Promise<WorkloadRequirementsFromIPFS | null> {
  const url = resolveWorkloadMetadataUriToFetchUrl(metadataUri);
  if (!url) {
    L.warn(`❌ Invalid metadata URI: ${metadataUri}`);
    return null;
  }

  L.info(`📥 Fetching workload requirements from IPFS...`);
  L.dim(`  URI: ${metadataUri}`);
  L.dim(`  Resolved URL: ${url}`);

  let lastError: unknown;
  for (let attempt = 1; attempt <= FETCH_RETRY_ATTEMPTS; attempt++) {
    try {
      if (attempt > 1) L.log(`  Retry attempt ${attempt}/${FETCH_RETRY_ATTEMPTS}...`);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const startTime = Date.now();

      const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
      clearTimeout(timeout);
      const fetchDuration = Date.now() - startTime;

      if (!res.ok) {
        L.error(`❌ IPFS fetch failed: HTTP ${res.status} (${fetchDuration}ms)`);
        if (attempt < FETCH_RETRY_ATTEMPTS) continue;
        return null;
      }

      const data = (await res.json()) as Record<string, unknown>;
      if (!data || typeof data !== "object") {
        L.error(`❌ Invalid data format from IPFS (${fetchDuration}ms)`);
        return null;
      }

      // Try SDL parsing first (awesome-akash templates)
      const { parseSDLFromMetadata, extractResources } = await import("./sdl-parser.service.js");
      const parsed = parseSDLFromMetadata(data);
      if (parsed) {
        const requirements = extractResources(parsed);
        L.success(`✅ Requirements from SDL (${fetchDuration}ms)`);
        L.log(`  CPU: ${requirements.cpu}`);
        L.log(`  Memory: ${requirements.memoryBytes} bytes`);
        L.log(`  Storage: ${requirements.storageBytes} bytes`);
        L.log(`  GPU: ${requirements.gpuCount}`);
        return requirements;
      }

      // Fallback: requirements object or legacy fields
      const req = (data.requirements as Record<string, unknown>) ?? data;
      const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? BigInt(Math.max(0, v)) : BigInt(0));
      const strNum = (v: unknown) => (typeof v === "string" ? BigInt(Math.max(0, parseInt(v, 10) || 0)) : num(v));

      const requirements = {
        cpu: BigInt(Math.max(0, Number(req.cpu ?? 1000))),
        memoryBytes: strNum(req.memoryBytes ?? req.memory ?? 512 * 1024 * 1024),
        storageBytes: strNum(req.storageBytes ?? req.storage ?? 10 * 1024 * 1024 * 1024),
        gpuCount: num(req.gpuCount ?? req.gpu ?? 0),
      };

      L.success(`✅ Requirements fetched (${fetchDuration}ms)`);
      L.log(`  CPU: ${requirements.cpu}`);
      L.log(`  Memory: ${requirements.memoryBytes} bytes`);
      L.log(`  Storage: ${requirements.storageBytes} bytes`);
      L.log(`  GPU: ${requirements.gpuCount}`);

      return requirements;
    } catch (error: unknown) {
      lastError = error;
      if (error instanceof Error && error.name === "AbortError") {
        L.warn(`⏱️ IPFS fetch timed out after ${FETCH_TIMEOUT_MS}ms${attempt < FETCH_RETRY_ATTEMPTS ? ", retrying..." : ""}`);
      } else {
        L.warn(`💥 Fetch error: ${error instanceof Error ? error.message : error}${attempt < FETCH_RETRY_ATTEMPTS ? ", retrying..." : ""}`);
      }
    }
  }

  if (lastError instanceof Error && lastError.name === "AbortError") {
    L.error(`❌ IPFS fetch timed out after ${FETCH_TIMEOUT_MS}ms (${FETCH_RETRY_ATTEMPTS} attempts)`);
  } else {
    L.error(`💥 Failed to fetch requirements after ${FETCH_RETRY_ATTEMPTS} attempts:`, lastError instanceof Error ? lastError.message : lastError);
  }
  return null;
}

/**
 * Fetch full workload manifest from metadata URI (IPFS or URL). Retries on timeout.
 */
export async function fetchWorkloadManifestFromUri(metadataUri: string): Promise<WorkloadManifestFromIPFS | null> {
  const url = resolveWorkloadMetadataUriToFetchUrl(metadataUri);
  if (!url) return null;
  let lastError: unknown;
  for (let attempt = 1; attempt <= FETCH_RETRY_ATTEMPTS; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
      clearTimeout(timeout);
      if (!res.ok) return null;
      const data = (await res.json()) as WorkloadManifestFromIPFS;
      return data;
    } catch (e) {
      lastError = e;
      if (attempt < FETCH_RETRY_ATTEMPTS) L.dim(`  Manifest fetch attempt ${attempt} failed, retrying...`);
    }
  }
  L.warn(`Failed to fetch workload manifest from URI after ${FETCH_RETRY_ATTEMPTS} attempts`);
  return null;
}

/**
 * Get workload manifest from chain (metadataUri) + IPFS. For orchestrator logging and matching.
 */
export async function getWorkloadManifestByWorkloadId(workloadId: bigint): Promise<{ cid: string; manifest: WorkloadManifestFromIPFS } | null> {
  try {
    const workload = await readWorkload(workloadId);
    if (!workload) return null;
    const metadataUri = (workload as { metadataUri?: string }).metadataUri;
    if (!metadataUri || typeof metadataUri !== "string") return null;
    const manifest = await fetchWorkloadManifestFromUri(metadataUri);
    if (!manifest) return null;
    return { cid: metadataUri, manifest };
  } catch {
    return null;
  }
}

/** Provider metadata shape from IPFS */
export interface ProviderMetadata {
  name?: string;
  description?: string;
  organization?: string;
  region?: string;
  country?: string;
  city?: string;
  endpoint?: string;
  cpuModel?: string;
  cpuCores?: number;
  cpuThreads?: number;
  cpuClockSpeed?: string;
  gpuModel?: string;
  gpuCount?: number;
  gpuMemory?: string;
  gpuCudaCores?: number;
  ramTotal?: string | number;
  ramType?: string;
  storageTotal?: string | number;
  storageType?: string;
  storageSpeed?: string;
  bandwidth?: string;
  networkType?: string;
  [key: string]: unknown;
}

/**
 * Check if a string looks like a valid IPFS CID
 */
export function isValidIPFSCID(cid: string): boolean {
  if (!cid || typeof cid !== "string") return false;
  const trimmed = cid.trim();
  // CIDv0 (Qm...) or CIDv1 (baf...)
  return /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(trimmed) || /^baf[a-z2-7]{56,}$/.test(trimmed);
}

/**
 * Fetch provider metadata from a URL (IPFS gateway or direct HTTP)
 */
export async function fetchProviderMetadataFromUrl(url: string): Promise<ProviderMetadata | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const startTime = Date.now();
    
    const res = await fetch(url, { 
      signal: controller.signal, 
      headers: { Accept: "application/json" } 
    });
    clearTimeout(timeout);
    const fetchDuration = Date.now() - startTime;
    
    if (!res.ok) {
      L.warn(`❌ Failed to fetch provider metadata: HTTP ${res.status} (${fetchDuration}ms)`);
      return null;
    }
    
    const data = (await res.json()) as ProviderMetadata;
    L.success(`✅ Provider metadata fetched (${fetchDuration}ms)`);
    return data;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      L.warn(`❌ Provider metadata fetch timed out after ${FETCH_TIMEOUT_MS}ms`);
    } else {
      L.warn(`💥 Failed to fetch provider metadata:`, error.message);
    }
    return null;
  }
}
