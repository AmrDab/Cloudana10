/**
 * Provider Logs Service
 * Fetches logs and diagnostics from provider nodes (provider-node-server) for owner viewing.
 * Verifies ownership before returning data.
 */
import type { Address } from "viem";
import { getProviderByAddress, getDeviceOwner } from "./chain-client.js";
import { fetchProviderCapacityAndEndpointFromIpfsUrl } from "./provider-metadata.service.js";
import { log } from "../lib/logger.js";

const L = log.orchestratorEvent;

const FETCH_TIMEOUT_MS = 10_000;

/** Resolve chain provider to owner and endpoint (endpoint from IPFS metadata). */
async function resolveProviderOwnerAndEndpoint(providerAddress: Address): Promise<{ owner: string; endpoint: string } | null> {
  const provider = await getProviderByAddress(providerAddress);
  if (!provider?.metadataUri) return null;
  const [owner, capacity] = await Promise.all([
    getDeviceOwner(provider.deviceId),
    fetchProviderCapacityAndEndpointFromIpfsUrl(provider.metadataUri),
  ]);
  const endpoint = capacity?.endpoint;
  if (!owner || !endpoint) return null;
  return { owner, endpoint };
}

interface ProviderLog {
  timestamp: number;
  level: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
  category: string;
  message: string;
  data?: unknown;
}

interface ProviderDiagnostics {
  timestamp: string;
  deviceId: string;
  health: {
    status: string;
    uptime: number;
    checks: {
      memory: { status: string; used: number; total: number; percentUsed: number };
      cpu: { status: string; cores: number; model: string };
      kubernetes: { status: string; available: boolean };
      workloads: { status: string; active: number; total: number };
    };
  };
  metrics: {
    activeWorkloads: number;
    totalWorkloads: number;
    successfulWorkloads: number;
    failedWorkloads: number;
  };
  logs: {
    totalEntries: number;
    oldestTimestamp: number | null;
    newestTimestamp: number | null;
    levelCounts: Record<string, number>;
    categoryCounts: Record<string, number>;
  };
  kubernetes: {
    available: boolean;
    enabled: boolean;
  };
  instances: {
    count: number;
    list: Array<{
      workloadId: string;
      instanceId: string;
      status: string;
      namespace?: string;
      deployedAt?: number;
    }>;
  };
  system: {
    nodeVersion: string;
    platform: string;
    arch: string;
    uptimeSeconds: number;
    pid: number;
  };
}

/**
 * Verify that the requester owns the provider.
 */
export async function verifyProviderOwnership(
  providerAddress: Address,
  ownerAddress: Address
): Promise<boolean> {
  try {
    const resolved = await resolveProviderOwnerAndEndpoint(providerAddress);
    if (!resolved) {
      L.warn(`Provider ${providerAddress} not found on chain or missing metadata`);
      return false;
    }
    const isOwner = resolved.owner.toLowerCase() === ownerAddress.toLowerCase();
    if (!isOwner) {
      L.warn(
        `Ownership verification failed: ${ownerAddress} is not owner of provider ${providerAddress} (owner: ${resolved.owner})`
      );
    }
    return isOwner;
  } catch (e) {
    L.error(
      `Failed to verify provider ownership: ${e instanceof Error ? e.message : e}`
    );
    return false;
  }
}

/**
 * Fetch logs from a provider node.
 */
export async function fetchProviderLogs(
  providerAddress: Address,
  options: {
    limit?: number;
    sinceTimestamp?: number;
    level?: string;
    category?: string;
  } = {}
): Promise<{ success: boolean; logs?: ProviderLog[]; stats?: any; error?: string }> {
  try {
    const resolved = await resolveProviderOwnerAndEndpoint(providerAddress);
    if (!resolved) {
      return { success: false, error: "Provider not found or missing endpoint" };
    }
    const baseUrl = resolved.endpoint.replace(/\/+$/, "");
    const params = new URLSearchParams();
    if (options.limit) params.set("limit", options.limit.toString());
    if (options.sinceTimestamp) params.set("since", options.sinceTimestamp.toString());
    if (options.level) params.set("level", options.level);
    if (options.category) params.set("category", options.category);
    const url = params.toString() ? `${baseUrl}/logs?${params.toString()}` : `${baseUrl}/logs`;
    
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `Provider returned status ${response.status}`,
      };
    }

    const data = (await response.json()) as { status?: string; message?: string; logs?: ProviderLog[]; stats?: any };
    
    if (data.status !== "success") {
      return {
        success: false,
        error: data.message || "Provider returned error",
      };
    }

    return {
      success: true,
      logs: data.logs,
      stats: data.stats,
    };
  } catch (e) {
    L.error(
      `Failed to fetch provider logs: ${e instanceof Error ? e.message : e}`
    );
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Fetch diagnostics from a provider node.
 */
export async function fetchProviderDiagnostics(
  providerAddress: Address
): Promise<{ success: boolean; diagnostics?: ProviderDiagnostics; error?: string }> {
  try {
    const resolved = await resolveProviderOwnerAndEndpoint(providerAddress);
    if (!resolved) {
      return { success: false, error: "Provider not found or missing endpoint" };
    }
    const baseUrl = resolved.endpoint.replace(/\/+$/, "");
    const url = `${baseUrl}/diagnostics`;
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `Provider returned status ${response.status}`,
      };
    }

    const data = (await response.json()) as { status?: string; message?: string } & ProviderDiagnostics;
    
    if (data.status !== "success") {
      return {
        success: false,
        error: data.message || "Provider returned error",
      };
    }

    return {
      success: true,
      diagnostics: data as ProviderDiagnostics,
    };
  } catch (e) {
    L.error(
      `Failed to fetch provider diagnostics: ${e instanceof Error ? e.message : e}`
    );
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Fetch provider health status.
 */
export async function fetchProviderHealth(
  providerAddress: Address
): Promise<{ success: boolean; health?: unknown; error?: string }> {
  try {
    const resolved = await resolveProviderOwnerAndEndpoint(providerAddress);
    if (!resolved) {
      return { success: false, error: "Provider not found or missing endpoint" };
    }
    const baseUrl = resolved.endpoint.replace(/\/+$/, "");
    const url = `${baseUrl}/health`;
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `Provider returned status ${response.status}`,
      };
    }

    const data = await response.json();
    
    return {
      success: true,
      health: data,
    };
  } catch (e) {
    L.error(
      `Failed to fetch provider health: ${e instanceof Error ? e.message : e}`
    );
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
