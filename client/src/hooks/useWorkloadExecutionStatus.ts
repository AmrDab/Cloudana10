import { useState, useEffect } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";

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
        console.log(`✅ useWorkloadExecutionStatus: ${API_BASE}/v1/workload-status/${workloadId}/${instanceId}`);
        const response = await fetch(
          `${API_BASE}/v1/workload-status/${workloadId}/${instanceId}`
        );
        
        if (!response.ok) {
          if (response.status === 404) {
            setData(null);
            return;
          }
          throw new Error(`Failed to fetch workload status: ${response.statusText}`);
        }
        
        const result = await response.json();
        
        if (result.success) {
          setData(result);
        } else {
          throw new Error(result.error || "Unknown error");
        }
      } catch (e) {
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
      const response = await fetch(
        `${API_BASE}/v1/workload-status/${workloadId}/${instanceId}/logs?refresh=true`
      );
      
      if (!response.ok) {
        throw new Error(`Failed to fetch logs: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (result.success) {
        setLogs(result.logs);
      } else {
        throw new Error(result.error || "Unknown error");
      }
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
        const response = await fetch(
          `${API_BASE}/v1/workload-status/${workloadId}/${instanceId}/endpoints`
        );
        
        if (!response.ok) {
          throw new Error(`Failed to fetch endpoints: ${response.statusText}`);
        }
        
        const result = await response.json();
        
        if (result.success) {
          setEndpoints(result.endpoints);
        } else {
          throw new Error(result.error || "Unknown error");
        }
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
