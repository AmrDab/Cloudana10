/**
 * Service to fetch real-time stats from provider nodes (provider-node-server GET /device-info).
 */

export interface ProviderNodeDeviceInfo {
  deviceId: string;
  hostname: string;
  spec: {
    cpuModel: string;
    cpuCores: number;
    memoryTotalBytes: number;
    memoryFreeBytes: number;
    diskTotalBytes?: number;
    diskFreeBytes?: number;
  };
}

export interface ProviderRealTimeStats {
  deviceId: string;
  isOnline: boolean;
  // CPU in millicores (1000 = 1 core)
  cpuTotal: number;
  cpuUsed: number;
  cpuAvailable: number;
  // Memory in bytes
  memoryTotal: number;
  memoryUsed: number;
  memoryAvailable: number;
  // Storage in bytes
  storageTotal: number;
  storageUsed: number;
  storageAvailable: number;
  // GPU (from IPFS metadata, not real-time)
  gpuTotal: number;
  gpuUsed: number;
  gpuAvailable: number;
  lastChecked: number; // timestamp
}

/**
 * Fetch device info from a provider node endpoint
 */
export async function fetchProviderNodeStats(
  endpoint: string,
  timeoutMs = 5000
): Promise<ProviderNodeDeviceInfo | null> {
  try {
    const baseUrl = endpoint.trim().replace(/\/$/, "");
    const url = `${baseUrl}/device-info`;
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "Accept": "application/json",
      },
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      console.warn(`[ProviderStats] Failed to fetch from ${url}: ${response.status}`);
      return null;
    }
    
    const data = await response.json() as ProviderNodeDeviceInfo;
    return data;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.warn(`[ProviderStats] Timeout fetching stats from ${endpoint}`);
    } else {
      console.warn(`[ProviderStats] Error fetching stats from ${endpoint}:`, error);
    }
    return null;
  }
}

/**
 * Convert provider node device info to stats format
 */
export function convertDeviceInfoToStats(
  deviceInfo: ProviderNodeDeviceInfo,
  ipfsMetadata?: {
    cpuCores?: number;
    gpuCount?: number;
  }
): ProviderRealTimeStats {
  const { deviceId, spec } = deviceInfo;
  
  // CPU: use IPFS metadata if available, otherwise use spec
  const cpuCores = ipfsMetadata?.cpuCores ?? spec.cpuCores;
  const cpuTotal = cpuCores * 1000; // millicores
  
  // Memory: calculate used from total - free
  const memoryTotal = spec.memoryTotalBytes;
  const memoryUsed = spec.memoryTotalBytes - spec.memoryFreeBytes;
  const memoryAvailable = spec.memoryFreeBytes;
  
  // Storage: calculate used from total - free
  const storageTotal = spec.diskTotalBytes ?? 0;
  const storageUsed = spec.diskTotalBytes && spec.diskFreeBytes
    ? spec.diskTotalBytes - spec.diskFreeBytes
    : 0;
  const storageAvailable = spec.diskFreeBytes ?? 0;
  
  // GPU: not available in real-time, use IPFS metadata
  const gpuTotal = ipfsMetadata?.gpuCount ?? 0;
  const gpuUsed = 0; // TODO: get from workload assignments
  const gpuAvailable = gpuTotal;
  
  return {
    deviceId,
    isOnline: true,
    cpuTotal,
    cpuUsed: 0, // TODO: calculate from running workloads
    cpuAvailable: cpuTotal,
    memoryTotal,
    memoryUsed,
    memoryAvailable,
    storageTotal,
    storageUsed,
    storageAvailable,
    gpuTotal,
    gpuUsed,
    gpuAvailable,
    lastChecked: Date.now(),
  };
}

/**
 * Fetch stats for multiple providers in parallel
 */
export async function fetchMultipleProviderStats(
  providers: Array<{
    deviceId: string;
    endpoint?: string;
    cpuCores?: number;
    gpuCount?: number;
  }>
): Promise<Map<string, ProviderRealTimeStats>> {
  const statsMap = new Map<string, ProviderRealTimeStats>();
  
  const results = await Promise.allSettled(
    providers.map(async (provider) => {
      if (!provider.endpoint) return null;
      
      const deviceInfo = await fetchProviderNodeStats(provider.endpoint);
      if (!deviceInfo) return null;
      
      const stats = convertDeviceInfoToStats(deviceInfo, {
        cpuCores: provider.cpuCores,
        gpuCount: provider.gpuCount,
      });
      
      return { deviceId: provider.deviceId, stats };
    })
  );
  
  for (const result of results) {
    if (result.status === "fulfilled" && result.value) {
      statsMap.set(result.value.deviceId, result.value.stats);
    }
  }
  
  return statsMap;
}
