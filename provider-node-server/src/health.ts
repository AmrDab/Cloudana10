/**
 * Health check and metrics endpoint
 * Provides system health status with detailed logging
 */
import { loggers, logMetrics } from "./logger.js";
import { freemem, totalmem, cpus, uptime } from "node:os";
import type { Context } from "hono";

interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  uptime: number;
  checks: {
    memory: {
      status: "ok" | "warning" | "critical";
      used: number;
      total: number;
      percentUsed: number;
    };
    cpu: {
      status: "ok";
      cores: number;
      model: string;
    };
    kubernetes: {
      status: "ok" | "unavailable";
      available: boolean;
    };
    workloads: {
      status: "ok";
      active: number;
      total: number;
    };
  };
}

interface MetricsData {
  activeWorkloads: number;
  totalWorkloads: number;
  successfulWorkloads: number;
  failedWorkloads: number;
  lastWorkloadTime?: number;
}

// In-memory metrics store
const metricsStore: MetricsData = {
  activeWorkloads: 0,
  totalWorkloads: 0,
  successfulWorkloads: 0,
  failedWorkloads: 0,
};

/**
 * Update metrics when workload starts
 */
export function recordWorkloadStart() {
  metricsStore.activeWorkloads++;
  metricsStore.totalWorkloads++;
  metricsStore.lastWorkloadTime = Date.now();
  
  loggers.server.debug(
    { 
      activeWorkloads: metricsStore.activeWorkloads,
      totalWorkloads: metricsStore.totalWorkloads
    },
    "Workload started - metrics updated"
  );
}

/**
 * Update metrics when workload completes
 */
export function recordWorkloadComplete(success: boolean) {
  metricsStore.activeWorkloads = Math.max(0, metricsStore.activeWorkloads - 1);
  
  if (success) {
    metricsStore.successfulWorkloads++;
  } else {
    metricsStore.failedWorkloads++;
  }
  
  loggers.server.debug(
    { 
      activeWorkloads: metricsStore.activeWorkloads,
      success,
      successfulWorkloads: metricsStore.successfulWorkloads,
      failedWorkloads: metricsStore.failedWorkloads
    },
    `Workload completed (${success ? "success" : "failed"}) - metrics updated`
  );
}

/**
 * Get current metrics
 */
export function getMetrics(): MetricsData {
  return { ...metricsStore };
}

/**
 * Calculate success rate
 */
function getSuccessRate(): number {
  const total = metricsStore.successfulWorkloads + metricsStore.failedWorkloads;
  if (total === 0) return 1.0;
  return metricsStore.successfulWorkloads / total;
}

/**
 * Check memory health
 */
function checkMemoryHealth(): HealthStatus["checks"]["memory"] {
  const free = freemem();
  const total = totalmem();
  const used = total - free;
  const percentUsed = (used / total) * 100;
  
  let status: "ok" | "warning" | "critical" = "ok";
  if (percentUsed > 90) {
    status = "critical";
  } else if (percentUsed > 75) {
    status = "warning";
  }
  
  return {
    status,
    used,
    total,
    percentUsed: Math.round(percentUsed),
  };
}

/**
 * Check Kubernetes availability
 */
async function checkKubernetesHealth(): Promise<HealthStatus["checks"]["kubernetes"]> {
  try {
    const { isK8sAvailable } = await import("./k8s-client.js");
    const available = isK8sAvailable();
    return {
      status: available ? "ok" : "unavailable",
      available,
    };
  } catch (e) {
    return {
      status: "unavailable",
      available: false,
    };
  }
}

/**
 * Get comprehensive health status
 */
export async function getHealthStatus(instances: Map<string, unknown>): Promise<HealthStatus> {
  const memory = checkMemoryHealth();
  const k8s = await checkKubernetesHealth();
  const cpuList = cpus();
  
  const status: HealthStatus["status"] =
    memory.status === "critical" ? "unhealthy" :
    memory.status === "warning" ? "degraded" :
    "healthy";
  
  const health: HealthStatus = {
    status,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(uptime()),
    checks: {
      memory,
      cpu: {
        status: "ok",
        cores: cpuList.length,
        model: cpuList[0]?.model || "Unknown",
      },
      kubernetes: k8s,
      workloads: {
        status: "ok",
        active: metricsStore.activeWorkloads,
        total: metricsStore.totalWorkloads,
      },
    },
  };
  
  loggers.server.debug(
    {
      healthStatus: status,
      memoryUsedPercent: memory.percentUsed,
      k8sAvailable: k8s.available,
      activeWorkloads: metricsStore.activeWorkloads,
    },
    `Health check: ${status}`
  );
  
  return health;
}

/**
 * Log periodic metrics
 */
export function logPeriodicMetrics() {
  const successRate = getSuccessRate();
  const avgExecutionTime = metricsStore.lastWorkloadTime
    ? Date.now() - metricsStore.lastWorkloadTime
    : undefined;
  
  logMetrics({
    activeWorkloads: metricsStore.activeWorkloads,
    totalWorkloadsProcessed: metricsStore.totalWorkloads,
    avgExecutionTime,
    successRate,
  });
}

/**
 * Health check endpoint handler
 */
export async function handleHealthCheck(c: Context, instances: Map<string, unknown>) {
  const health = await getHealthStatus(instances);
  
  if (health.status === "unhealthy") {
    return c.json(health, 503);
  }
  
  if (health.status === "degraded") {
    return c.json(health, 200); // Still operational but degraded
  }
  
  return c.json(health, 200);
}

/**
 * Metrics endpoint handler
 */
export function handleMetrics(c: Context) {
  const metrics = getMetrics();
  const successRate = getSuccessRate();
  
  loggers.server.debug(
    { metricsRequested: true, totalWorkloads: metrics.totalWorkloads },
    "Metrics endpoint accessed"
  );
  
  return c.json({
    timestamp: new Date().toISOString(),
    uptime: Math.floor(uptime()),
    workloads: {
      active: metrics.activeWorkloads,
      total: metrics.totalWorkloads,
      successful: metrics.successfulWorkloads,
      failed: metrics.failedWorkloads,
      successRate: Math.round(successRate * 100),
    },
    lastWorkloadTime: metrics.lastWorkloadTime
      ? new Date(metrics.lastWorkloadTime).toISOString()
      : null,
  });
}

/**
 * Start periodic metrics logging (every 5 minutes)
 */
export function startMetricsLogging() {
  const interval = 5 * 60 * 1000; // 5 minutes
  
  setInterval(() => {
    logPeriodicMetrics();
  }, interval);
  
  loggers.server.info(
    { interval: "5m" },
    "Started periodic metrics logging"
  );
}
