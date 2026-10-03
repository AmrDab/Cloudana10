import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { nodeApiBase } from "@/lib/api-base";
import { fetchJson } from "@/lib/api-error";

const API_BASE = nodeApiBase();

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

export function useProviderLogs(providerAddress?: `0x${string}`) {
  const { address } = useAccount();
  const [logs, setLogs] = useState<ProviderLog[] | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchLogs = async (options: {
    limit?: number;
    sinceTimestamp?: number;
    level?: string;
    category?: string;
  } = {}) => {
    if (!providerAddress || !address) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set("owner", address);
      if (options.limit) params.set("limit", options.limit.toString());
      if (options.sinceTimestamp) params.set("since", options.sinceTimestamp.toString());
      if (options.level) params.set("level", options.level);
      if (options.category) params.set("category", options.category);

      const result = await fetchJson<{ logs: ProviderLog[]; stats: any }>(
        `${API_BASE}/provider-logs/${providerAddress}?${params.toString()}`,
        "Failed to fetch provider logs",
      );
      setLogs(result.logs);
      setStats(result.stats);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (providerAddress && address) {
      fetchLogs();
    }
  }, [providerAddress, address]);

  return { logs, stats, isLoading, error, refresh: fetchLogs };
}

export function useProviderDiagnostics(providerAddress?: `0x${string}`) {
  const { address } = useAccount();
  const [diagnostics, setDiagnostics] = useState<ProviderDiagnostics | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchDiagnostics = async () => {
    if (!providerAddress || !address) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await fetchJson<{ diagnostics: ProviderDiagnostics }>(
        `${API_BASE}/provider-diagnostics/${providerAddress}?owner=${address}`,
        "Failed to fetch provider diagnostics",
      );
      setDiagnostics(result.diagnostics);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (providerAddress && address) {
      fetchDiagnostics();
      
      // Auto-refresh every 30 seconds
      const interval = setInterval(fetchDiagnostics, 30000);
      return () => clearInterval(interval);
    }
  }, [providerAddress, address]);

  return { diagnostics, isLoading, error, refresh: fetchDiagnostics };
}

export function useProviderHealth(providerAddress?: `0x${string}`) {
  const { address } = useAccount();
  const [health, setHealth] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchHealth = async () => {
    if (!providerAddress || !address) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await fetchJson<{ health: any }>(
        `${API_BASE}/provider-health/${providerAddress}?owner=${address}`,
        "Failed to fetch provider health",
      );
      setHealth(result.health);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (providerAddress && address) {
      fetchHealth();
      
      // Auto-refresh every 15 seconds
      const interval = setInterval(fetchHealth, 15000);
      return () => clearInterval(interval);
    }
  }, [providerAddress, address]);

  return { health, isLoading, error, refresh: fetchHealth };
}
