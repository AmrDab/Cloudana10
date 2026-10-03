import { useState, useEffect } from "react";
import { nodeApiBase } from "@/lib/api-base";
import { ApiError, fetchJson } from "@/lib/api-error";

const API_BASE = nodeApiBase();

interface WorkloadExecutionStatus {
  workloadId: string;
  instanceId: string;
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
    };
  };
  logs?: Record<string, string>;
  endpoints?: Array<{
    name: string;
    type: string;
    ports: Array<{
      port: number;
      nodePort?: number;
      protocol: string;
    }>;
  }>;
  /** Public URLs from provider (e.g. http://<provider-ip>:<nodePort>) for HostUri / open in browser */
  urls?: string[];
  lastUpdated: number;
  error?: string;
}

/** Response body: `status`/`error` arrive as `workloadStatus`/`workloadError` (older servers: `status`/`error`). */
type WorkloadStatusBody = Omit<WorkloadExecutionStatus, "status" | "error"> & {
  workloadStatus?: WorkloadExecutionStatus["status"];
  workloadError?: string;
  status?: WorkloadExecutionStatus["status"] | string;
  error?: unknown;
};

function toExecutionStatus(body: WorkloadStatusBody): WorkloadExecutionStatus {
  const { workloadStatus, workloadError, status, error, ...rest } = body;
  return {
    ...rest,
    status: workloadStatus ?? (status as WorkloadExecutionStatus["status"]),
    error: workloadError ?? (typeof error === "string" ? error : undefined),
  };
}

export function useWorkloadExecutionStatus(workloadId?: bigint, instanceId?: bigint) {
  const [data, setData] = useState<WorkloadExecutionStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (workloadId === undefined || instanceId === undefined) {
      return;
    }

    const fetchStatus = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        console.log(`✅ useWorkloadExecutionStatus: ${API_BASE}/workload-status/${workloadId}/${instanceId}`);
        const result = await fetchJson<WorkloadStatusBody>(
          `${API_BASE}/workload-status/${workloadId}/${instanceId}`,
          "Failed to fetch workload status",
        );
        setData(toExecutionStatus(result));
      } catch (e) {
        // Not deployed yet / terminated: no status, not an error.
        if (e instanceof ApiError && e.code === "not_found") {
          setData(null);
          return;
        }
        setError(e instanceof Error ? e : new Error(String(e)));
        setData(null);
      } finally {
        setIsLoading(false);
      }
    };

    // Fetch immediately
    fetchStatus();

    // Poll every 10 seconds for updates
    const interval = setInterval(fetchStatus, 10000);

    return () => clearInterval(interval);
  }, [workloadId, instanceId]);

  return { data, isLoading, error };
}

export function useWorkloadLogs(workloadId?: bigint, instanceId?: bigint) {
  const [logs, setLogs] = useState<Record<string, string> | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refresh = async () => {
    if (workloadId === undefined || instanceId === undefined) {
      return;
    }

    setIsLoading(true);
    setError(null);
    
    try {
      const result = await fetchJson<{ logs: Record<string, string> }>(
        `${API_BASE}/workload-status/${workloadId}/${instanceId}/logs?refresh=true`,
        "Failed to fetch logs",
      );
      setLogs(result.logs);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (workloadId !== undefined && instanceId !== undefined) {
      refresh();
    }
  }, [workloadId, instanceId]);

  return { logs, isLoading, error, refresh };
}

export function useWorkloadEndpoints(workloadId?: bigint, instanceId?: bigint) {
  const [endpoints, setEndpoints] = useState<WorkloadExecutionStatus["endpoints"] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (workloadId === undefined || instanceId === undefined) {
      return;
    }

    const fetchEndpoints = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        const result = await fetchJson<{ endpoints: WorkloadExecutionStatus["endpoints"] }>(
          `${API_BASE}/workload-status/${workloadId}/${instanceId}/endpoints`,
          "Failed to fetch endpoints",
        );
        setEndpoints(result.endpoints);
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        setIsLoading(false);
      }
    };

    fetchEndpoints();
  }, [workloadId, instanceId]);

  return { endpoints, isLoading, error };
}
