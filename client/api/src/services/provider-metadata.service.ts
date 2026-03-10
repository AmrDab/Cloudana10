/**
 * Fetch provider metadata from IPFS (metadata URI: gateway URL or raw CID) and derive capacity for placement.
 * On-chain we store only metadata URI; full device spec is on IPFS.
 */
import { log } from "../lib/logger.js";

const L = log.ipfs;
const FETCH_TIMEOUT_MS = 18_000;
const FETCH_RETRY_ATTEMPTS = 2;
const IPFS_GATEWAY = process.env.IPFS_GATEWAY ?? "https://gateway.pinata.cloud";

export interface ProviderCapacityFromIPFS {
  cpu: bigint;
  memoryBytes: bigint;
  storageBytes: bigint;
  gpuCount: bigint;
}

/** Capacity + optional deploy endpoint (provider node base URL for POST /deploy). */
export interface ProviderCapacityAndEndpoint extends ProviderCapacityFromIPFS {
  /** Base URL of the provider node (e.g. https://host:4040). Required for orchestrator to deploy before recording placement. */
  endpoint?: string;
}

interface ProviderMetadataFromIPFS {
  cpuCores?: number;
  ramTotal?: string;
  storageTotal?: string;
  gpuCount?: number;
  /** Optional: base URL for provider node (POST /deploy). Must be set for workload placement to succeed. */
  endpoint?: string;
  // Alternative field names (from device spec)
  memoryTotalBytes?: number;
  diskTotalBytes?: number;
  ram?: string;
  memory?: string;
  storage?: string;
  disk?: string;
  [key: string]: unknown;
}

function isMetadataUrl(url: string | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  const t = url.trim().toLowerCase();
  return t.startsWith("http://") || t.startsWith("https://");
}

function isIpfsCid(uri: string): boolean {
  const s = uri.trim();
  return /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(s) || /^[a-z2-7]{59}$/.test(s);
}

/** Resolve metadata URI (URL or raw CID) to a fetchable URL. */
export function resolveMetadataUriToFetchUrl(uri: string | undefined): string | null {
  if (!uri || typeof uri !== "string") return null;
  const s = uri.trim();
  if (isMetadataUrl(s)) return s;
  if (isIpfsCid(s)) return `${IPFS_GATEWAY}/ipfs/${s}`;
  return null;
}

/** Parse "62.7 GB", "1.5 TB" etc. to bytes. */
function parseCapacityToBytes(value: string | undefined, defaultGb: number): bigint {
  L.dim(`    [parseCapacityToBytes] Input: "${value}", default: ${defaultGb} GB`);
  
  if (value == null || value === "") {
    const result = BigInt(Math.round(defaultGb * 1024 ** 3));
    L.dim(`    [parseCapacityToBytes] Empty value → using default: ${result} bytes`);
    return result;
  }
  
  const s = String(value).trim();
  const match = s.match(/^([\d.]+)\s*(GB|TB|MB|GiB|TiB|MiB)?$/i);
  
  if (!match) {
    L.warn(`    [parseCapacityToBytes] ❌ No match for regex! Input: "${s}"`);
    L.warn(`    [parseCapacityToBytes] Expected format: "32 GB", "1.5 TB", etc.`);
    return BigInt(Math.round(defaultGb * 1024 ** 3));
  }
  
  const num = parseFloat(match[1]);
  const unit = (match[2] ?? "GB").toUpperCase();
  
  L.dim(`    [parseCapacityToBytes] Matched: number=${num}, unit=${unit}`);
  
  if (!Number.isFinite(num)) {
    L.warn(`    [parseCapacityToBytes] ❌ Invalid number: ${num}`);
    return BigInt(Math.round(defaultGb * 1024 ** 3));
  }
  
  const gb = unit === "TB" || unit === "TIB" ? num * 1024 : unit === "MB" || unit === "MIB" ? num / 1024 : num;
  const bytes = BigInt(Math.round(gb * 1024 ** 3));
  
  L.dim(`    [parseCapacityToBytes] Conversion: ${num} ${unit} → ${gb} GB → ${bytes} bytes`);
  
  return bytes;
}

/**
 * Fetch provider metadata from metadata URI (IPFS gateway URL or raw CID) and return capacity.
 * Used by placement to decide if provider has enough resources for a workload.
 */
export async function fetchProviderCapacityFromIpfsUrl(
  metadataUri: string
): Promise<ProviderCapacityFromIPFS | null> {
  const result = await fetchProviderCapacityAndEndpointFromIpfsUrl(metadataUri);
  return result;
}

/**
 * Fetch provider metadata and return capacity + optional endpoint (provider node base URL).
 * Placement uses this so the orchestrator can POST /deploy before recording on-chain; only providers with endpoint are placeable.
 */
export async function fetchProviderCapacityAndEndpointFromIpfsUrl(
  metadataUri: string
): Promise<ProviderCapacityAndEndpoint | null> {
  const url = resolveMetadataUriToFetchUrl(metadataUri);
  if (!url) {
    L.warn(`❌ Invalid provider metadata URI: ${metadataUri}`);
    return null;
  }

  L.info(`📥 Fetching provider capacity from IPFS...`);
  L.dim(`  URI: ${metadataUri.slice(0, 60)}${metadataUri.length > 60 ? '...' : ''}`);
  L.dim(`  URL: ${url.slice(0, 80)}${url.length > 80 ? '...' : ''}`);

  let lastError: any;
  for (let attempt = 1; attempt <= FETCH_RETRY_ATTEMPTS; attempt++) {
    try {
      if (attempt > 1) L.log(`  Retry attempt ${attempt}/${FETCH_RETRY_ATTEMPTS}...`);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const startTime = Date.now();

      const res = await fetch(url, { signal: controller.signal, mode: "cors", headers: { Accept: "application/json" } });
      clearTimeout(timeout);
      const fetchDuration = Date.now() - startTime;

      if (!res.ok) {
        L.error(`❌ IPFS fetch failed: HTTP ${res.status} ${res.statusText} (${fetchDuration}ms)`);
        if (attempt < FETCH_RETRY_ATTEMPTS) continue;
        return null;
      }

      const data = (await res.json()) as ProviderMetadataFromIPFS;
      const dataSize = JSON.stringify(data).length;

      if (!data || typeof data !== "object") {
        L.error(`❌ Invalid provider metadata format (${fetchDuration}ms)`);
        return null;
      }

      // Debug: Log ALL fields from metadata to see what we actually got
      L.log(`  📋 Raw metadata fields from IPFS:`);
      L.log(`     cpuCores: ${data.cpuCores} (type: ${typeof data.cpuCores})`);
      L.log(`     ramTotal: ${data.ramTotal} (type: ${typeof data.ramTotal})`);
      L.log(`     storageTotal: ${data.storageTotal} (type: ${typeof data.storageTotal})`);
      L.log(`     gpuCount: ${data.gpuCount} (type: ${typeof data.gpuCount})`);
      L.log(`     endpoint: ${data.endpoint} (type: ${typeof data.endpoint})`);

      // Check for alternative field names that might exist
      const altData = data as any;
      if (altData.ram) L.log(`     Alternative 'ram': ${altData.ram}`);
      if (altData.memory) L.log(`     Alternative 'memory': ${altData.memory}`);
      if (altData.storage) L.log(`     Alternative 'storage': ${altData.storage}`);
      if (altData.disk) L.log(`     Alternative 'disk': ${altData.disk}`);
      if (altData.memoryTotalBytes) L.log(`     Alternative 'memoryTotalBytes': ${altData.memoryTotalBytes}`);
      if (altData.diskTotalBytes) L.log(`     Alternative 'diskTotalBytes': ${altData.diskTotalBytes}`);

      const cpuCores = typeof data.cpuCores === "number" && Number.isFinite(data.cpuCores) ? data.cpuCores : 0;
      const gpuCount = typeof data.gpuCount === "number" && Number.isFinite(data.gpuCount) ? data.gpuCount : 0;

      // Memory: prioritize direct byte values, then parse string formats
      let memoryBytes: bigint;
      if (typeof data.memoryTotalBytes === "number" && data.memoryTotalBytes > 0) {
        memoryBytes = BigInt(Math.round(data.memoryTotalBytes));
        L.log(`     ✅ Using memoryTotalBytes directly: ${memoryBytes} bytes`);
      } else {
        // Try string formats: ramTotal, ram, memory
        const ramTotal = data.ramTotal || data.ram || data.memory;
        memoryBytes = parseCapacityToBytes(ramTotal, 0);
        if (ramTotal) {
          L.log(`     Parsed from string "${ramTotal}": ${memoryBytes} bytes`);
        }
      }

      // Storage: prioritize direct byte values, then parse string formats
      let storageBytes: bigint;
      if (typeof data.diskTotalBytes === "number" && data.diskTotalBytes > 0) {
        storageBytes = BigInt(Math.round(data.diskTotalBytes));
        L.log(`     ✅ Using diskTotalBytes directly: ${storageBytes} bytes`);
      } else {
        // Try string formats: storageTotal, storage, disk
        const storageTotal = data.storageTotal || data.storage || data.disk;
        storageBytes = parseCapacityToBytes(storageTotal, 0);
        if (storageTotal) {
          L.log(`     Parsed from string "${storageTotal}": ${storageBytes} bytes`);
        }
      }

      const capacity: ProviderCapacityAndEndpoint = {
        cpu: BigInt(Math.max(0, cpuCores) * 1000),
        memoryBytes,
        storageBytes,
        gpuCount: BigInt(Math.max(0, gpuCount)),
      };

      const endpoint = typeof data.endpoint === "string" && data.endpoint.trim() ? data.endpoint.trim() : undefined;
      if (endpoint) capacity.endpoint = endpoint;

      L.success(`✅ Provider capacity fetched (${fetchDuration}ms, ${dataSize} bytes)`);
      L.log(`  ✨ Final parsed values:`);
      L.log(`     CPU Cores: ${cpuCores} → millicores: ${capacity.cpu}`);

      const ramGB = (Number(capacity.memoryBytes) / (1024**3)).toFixed(2);
      const storageGB = (Number(capacity.storageBytes) / (1024**3)).toFixed(2);

      if (capacity.memoryBytes > 0) {
        L.success(`     RAM: ${capacity.memoryBytes} bytes (${ramGB} GB)`);
      } else {
        L.warn(`     RAM: ❌ 0 bytes - NO RAM CAPACITY DETECTED!`);
      }

      if (capacity.storageBytes > 0) {
        L.success(`     Storage: ${capacity.storageBytes} bytes (${storageGB} GB)`);
      } else {
        L.warn(`     Storage: ❌ 0 bytes - NO STORAGE CAPACITY DETECTED!`);
      }

      L.log(`     GPU Count: ${gpuCount}`);

      if (endpoint) {
        L.success(`  Endpoint: ${endpoint}`);
      } else {
        L.warn(`  ⚠️  Endpoint: (not set - provider won't be eligible for placement)`);
      }

      return capacity;
    } catch (error: any) {
      lastError = error;
      if (error?.name === "AbortError") {
        L.warn(`⏱️ IPFS fetch timed out after ${FETCH_TIMEOUT_MS}ms${attempt < FETCH_RETRY_ATTEMPTS ? ", retrying..." : ""}`);
      } else {
        L.warn(`💥 Fetch error: ${error?.message ?? error}${attempt < FETCH_RETRY_ATTEMPTS ? ", retrying..." : ""}`);
      }
    }
  }

  if (lastError?.name === "AbortError") {
    L.error(`❌ IPFS fetch timed out after ${FETCH_TIMEOUT_MS}ms for ${metadataUri.slice(0, 40)}... (${FETCH_RETRY_ATTEMPTS} attempts)`);
  } else {
    L.error(`💥 Failed to fetch provider capacity after ${FETCH_RETRY_ATTEMPTS} attempts:`, lastError?.message ?? lastError);
  }
  return null;
}
