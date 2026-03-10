/**
 * Workload Status Poller Service
 * Polls provider nodes for workload execution status, logs, and endpoints.
 * Caches results in memory for fast user queries.
 * Provider-node-server: GET /workload/:workloadId/:instanceId/status, /logs, /endpoints, /urls.
 */
import { log } from "../lib/logger.js";
import type { DeviceId } from "./chain-client.js";

const L = log.orchestratorEvent;

const POLL_INTERVAL_MS = Number(process.env.WORKLOAD_STATUS_POLL_INTERVAL_MS ?? 15_000); // 15s
const CACHE_TTL_MS = Number(process.env.WORKLOAD_STATUS_CACHE_TTL_MS ?? 60_000); // 1 min

interface WorkloadStatusCache {
  workloadId: bigint;
  instanceId: bigint;
  providerAddress: string;
  providerEndpoint: string;
  status: {
    instanceStatus: string;
    namespace?: string;
    deployedAt?: number;
    k8sStatus?: {
      phase: string;
      ready: boolean;
      podCount: number;
      readyPods: number;
      details: string;
      services?: Array<{
        name: string;
        type: string;
        ports: Array<{ port: number; nodePort?: number; protocol: string }>;
        urls?: string[];
      }>;
    };
  };
  logs?: Record<string, string>;
  endpoints?: Array<{
    name: string;
    type: string;
    ports: Array<{ port: number; nodePort?: number; protocol: string }>;
  }>;
  urls?: string[]; // Extracted public URLs for easy access
  lastUpdated: number;
  error?: string;
}

// In-memory cache: workloadId -> WorkloadStatusCache
const statusCache = new Map<string, WorkloadStatusCache>();

// Track which workloads are actively deployed (from orchestrator placement)
const activeWorkloads = new Map<
  string,
  {
    workloadId: bigint;
    instanceId: bigint;
    providerAddress: string;
    providerEndpoint: string;
    deviceId: DeviceId;
    ownerAddress: string;
  }
>();

let pollingIntervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Register a workload for status polling after successful deployment.
 */
export function registerWorkloadForPolling(
  workloadId: bigint,
  instanceId: bigint,
  providerAddress: string,
  providerEndpoint: string,
  deviceId: DeviceId,
  ownerAddress: string
): void {
  const key = `${workloadId}-${instanceId}`;
  activeWorkloads.set(key, { workloadId, instanceId, providerAddress, providerEndpoint, deviceId, ownerAddress });
  L.success(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  L.success(`✅ WORKLOAD REGISTERED FOR STATUS POLLING`);
  L.info(`   Workload ID: ${workloadId}`);
  L.info(`   Instance ID: ${instanceId}`);
  L.info(`   Provider: ${providerAddress}`);
  L.info(`   Provider Endpoint: ${providerEndpoint}`);
  L.info(`   Device ID: ${deviceId.slice(0, 16)}...`);
  L.info(`   Owner: ${ownerAddress}`);
  L.info(`   Total active workloads: ${activeWorkloads.size}`);
  L.info(`   Status will be polled every ${POLL_INTERVAL_MS / 1000}s`);
  L.success(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
}

/**
 * Unregister a workload (e.g., when closed/terminated).
 */
export function unregisterWorkloadFromPolling(workloadId: bigint, instanceId: bigint): void {
  const key = `${workloadId}-${instanceId}`;
  activeWorkloads.delete(key);
  statusCache.delete(key);
  L.info(`Unregistered workload ${workloadId}/${instanceId} from status polling`);
}

/**
 * Get placement (provider + instanceId) for a workload by ID.
 * Used when handling WorkloadDeleted (contract no longer has the workload).
 */
export function getPlacementByWorkloadId(workloadId: bigint): {
  instanceId: bigint;
  providerAddress: string;
  deviceId: DeviceId;
  ownerAddress: string;
} | null {
  for (const w of activeWorkloads.values()) {
    if (w.workloadId === workloadId) {
      return {
        instanceId: w.instanceId,
        providerAddress: w.providerAddress,
        deviceId: w.deviceId,
        ownerAddress: w.ownerAddress,
      };
    }
  }
  return null;
}

/**
 * Fetch status, logs, and endpoints from provider node.
 */
async function pollWorkloadFromProvider(
  workloadId: bigint,
  instanceId: bigint,
  providerEndpoint: string
): Promise<Partial<WorkloadStatusCache>> {
  const baseUrl = providerEndpoint.replace(/\/+$/, "");
  const wid = workloadId.toString();
  const iid = instanceId.toString();

  try {
    // Fetch status, logs, endpoints, and URLs in parallel (provider-node-server)
    const [statusRes, logsRes, endpointsRes, urlsRes] = await Promise.allSettled([
      fetch(`${baseUrl}/workload/${wid}/${iid}/status`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      }),
      fetch(`${baseUrl}/workload/${wid}/${iid}/logs?tail=100`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      }),
      fetch(`${baseUrl}/workload/${wid}/${iid}/endpoints`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      }),
      fetch(`${baseUrl}/workload/${wid}/${iid}/urls`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      }),
    ]);

    const result: Partial<WorkloadStatusCache> = { lastUpdated: Date.now() };

    // Parse status
    if (statusRes.status === "fulfilled" && statusRes.value.ok) {
      const data = (await statusRes.value.json()) as {
        instanceStatus: string;
        namespace?: string;
        deployedAt?: number;
        k8sStatus?: WorkloadStatusCache["status"]["k8sStatus"];
      };
      result.status = {
        instanceStatus: data.instanceStatus,
        namespace: data.namespace,
        deployedAt: data.deployedAt,
        k8sStatus: data.k8sStatus,
      };
      
      // Extract URLs from services for easy access
      if (data.k8sStatus?.services) {
        const urls: string[] = [];
        for (const service of data.k8sStatus.services) {
          if (service.urls && Array.isArray(service.urls)) {
            urls.push(...service.urls);
          }
        }
        if (urls.length > 0) {
          result.urls = urls;
          L.success(`      🌐 Extracted ${urls.length} URL(s): ${urls.join(', ')}`);
        }
      }
    } else {
      result.error = `Status fetch failed: ${statusRes.status === "fulfilled" ? statusRes.value.status : "timeout"}`;
    }

    // Parse logs
    if (logsRes.status === "fulfilled" && logsRes.value.ok) {
      const data = (await logsRes.value.json()) as { logs?: Record<string, string> };
      result.logs = data.logs;
    }

    // Parse endpoints
    if (endpointsRes.status === "fulfilled" && endpointsRes.value.ok) {
      const data = (await endpointsRes.value.json()) as {
        endpoints?: WorkloadStatusCache["endpoints"];
      };
      result.endpoints = data.endpoints;
    }

    // Parse URLs from dedicated endpoint (takes precedence over status extraction)
    if (urlsRes.status === "fulfilled" && urlsRes.value.ok) {
      const data = (await urlsRes.value.json()) as { urls?: string[]; services?: Array<{ name: string; urls: string[] }> };
      if (data.urls && data.urls.length > 0) {
        result.urls = data.urls;
        L.success(`      🌐 Fetched ${data.urls.length} URL(s) from dedicated endpoint: ${data.urls.join(', ')}`);
      }
    }

    return result;
  } catch (e) {
    L.error(
      `Failed to poll workload ${workloadId}/${instanceId} from ${providerEndpoint}:`,
      e instanceof Error ? e.message : e
    );
    return {
      lastUpdated: Date.now(),
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Poll all active workloads.
 */
async function pollAllWorkloads(): Promise<void> {
  if (activeWorkloads.size === 0) {
    return;
  }

  L.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  L.info(`📊 STATUS POLLING: Checking ${activeWorkloads.size} active workload(s)...`);

  const pollPromises: Promise<void>[] = [];
  let successCount = 0;
  let errorCount = 0;

  for (const [key, workload] of activeWorkloads.entries()) {
    pollPromises.push(
      (async () => {
        try {
          L.info(`   🔍 Polling workload ${workload.workloadId}/${workload.instanceId}...`);
          
          // Use cached provider endpoint to avoid RPC calls
          const endpoint = workload.providerEndpoint;
          if (!endpoint) {
            L.warn(
              `      ⚠️  Provider ${workload.providerAddress.slice(0, 10)}... missing cached endpoint`
            );
            errorCount++;
            return;
          }

          L.info(`      📡 Fetching from: ${endpoint}`);
          const pollStart = Date.now();
          
          const result = await pollWorkloadFromProvider(
            workload.workloadId,
            workload.instanceId,
            endpoint
          );
          
          const pollDuration = Date.now() - pollStart;

          // Update cache
          const cached = statusCache.get(key) || {
            workloadId: workload.workloadId,
            instanceId: workload.instanceId,
            providerAddress: workload.providerAddress,
            providerEndpoint: endpoint,
            status: { instanceStatus: "pending" },
            lastUpdated: 0,
          };

          const updatedCache = {
            ...cached,
            ...result,
            lastUpdated: result.lastUpdated || Date.now(),
          };
          
          statusCache.set(key, updatedCache);
          
          if (result.error) {
            L.warn(`      ⚠️  Status: ERROR - ${result.error} (${pollDuration}ms)`);
            errorCount++;
          } else {
            const status = result.status?.instanceStatus || "unknown";
            const k8sPhase = result.status?.k8sStatus?.phase || "-";
            const pods = result.status?.k8sStatus ? 
              `${result.status.k8sStatus.readyPods}/${result.status.k8sStatus.podCount}` : "-";
            
            L.success(
              `      ✅ Status: ${status} | K8s: ${k8sPhase} | Pods: ${pods} (${pollDuration}ms)`
            );
            successCount++;
          }
        } catch (e) {
          L.error(
            `      ❌ Error polling workload ${workload.workloadId}/${workload.instanceId}: ${
              e instanceof Error ? e.message : e
            }`
          );
          errorCount++;
        }
      })()
    );
  }

  await Promise.allSettled(pollPromises);
  
  L.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  L.info(`✅ Polling complete: ${successCount} success, ${errorCount} errors`);
  L.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
}

/**
 * Get cached status for a workload.
 */
export function getWorkloadStatus(
  workloadId: bigint,
  instanceId: bigint
): WorkloadStatusCache | null {
  console.log(`⚠️ getWorkloadStatus: statusCache: ${statusCache.size}`);
  console.log(`⚠️ getWorkloadStatus: statusCache: ${Array.from(statusCache.entries())}`);
  console.log(`⚠️ getWorkloadStatus: activeWorkloads: ${Array.from(activeWorkloads.entries())}`);
  const key = `${workloadId}-${instanceId}`;
  const cached = statusCache.get(key);

  if (!cached) {
    return null;
  }

  // Check if cache is stale
  if (Date.now() - cached.lastUpdated > CACHE_TTL_MS) {
    L.info(`      ⚠️ Cache stale for workload ${workloadId}/${instanceId}`);
  }

  return cached;
}

/**
 * Force refresh a specific workload status (on-demand).
 */
export async function refreshWorkloadStatus(
  workloadId: bigint,
  instanceId: bigint
): Promise<WorkloadStatusCache | null> {
  console.log(`✅ refreshWorkloadStatus: activeWorkloads: ${activeWorkloads.size}`);
  console.log(`✅ refreshWorkloadStatus: activeWorkloads: ${Array.from(activeWorkloads.entries())}`);
  const key = `${workloadId}-${instanceId}`;
  const workload = activeWorkloads.get(key);

  if (!workload) {
    L.warn(`Workload ${workloadId}/${instanceId} not registered for polling`);
    return null;
  }

  try {
    // Use cached provider endpoint to avoid RPC calls
    const endpoint = workload.providerEndpoint;
    if (!endpoint) {
      L.warn(
        `Provider ${workload.providerAddress} missing cached endpoint for workload ${workloadId}`
      );
      return null;
    }

    const result = await pollWorkloadFromProvider(
      workloadId,
      instanceId,
      endpoint
    );

    const cached = statusCache.get(key) || {
      workloadId,
      instanceId,
      providerAddress: workload.providerAddress,
      providerEndpoint: endpoint,
      status: { instanceStatus: "pending" },
      lastUpdated: 0,
    };

    const updated = {
      ...cached,
      ...result,
      lastUpdated: result.lastUpdated || Date.now(),
    };

    statusCache.set(key, updated);
    return updated;
  } catch (e) {
    L.error(
      `Failed to refresh workload ${workloadId}/${instanceId}:`,
      e instanceof Error ? e.message : e
    );
    return null;
  }
}

/**
 * Start the status polling loop.
 */
export function startWorkloadStatusPolling(): void {
  if (pollingIntervalId !== null) {
    L.warn("Workload status polling already started");
    return;
  }

  L.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  L.success(`✅ WORKLOAD STATUS POLLING STARTED`);
  L.info(`   Poll interval: ${POLL_INTERVAL_MS}ms (${POLL_INTERVAL_MS / 1000}s)`);
  L.info(`   Cache TTL: ${CACHE_TTL_MS}ms (${CACHE_TTL_MS / 1000}s)`);
  L.info(`   This service tracks workload execution status from providers`);
  L.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  // Run first poll immediately
  void pollAllWorkloads();

  // Then poll on interval
  pollingIntervalId = setInterval(() => {
    void pollAllWorkloads();
  }, POLL_INTERVAL_MS);
}

/**
 * Stop the status polling loop.
 */
export function stopWorkloadStatusPolling(): void {
  if (pollingIntervalId !== null) {
    clearInterval(pollingIntervalId);
    pollingIntervalId = null;
    L.warn("Workload status polling stopped");
  }
}

/**
 * Get all cached workload statuses (for debugging/admin).
 */
export function getAllWorkloadStatuses(): WorkloadStatusCache[] {
  return Array.from(statusCache.values());
}
