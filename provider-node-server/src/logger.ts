/**
 * Structured logging for Cloudana Provider Node
 * 
 * Provides high-performance structured logging with:
 * - JSON output for production (machine-readable)
 * - Pretty output for development (human-readable)
 * - Log levels: trace, debug, info, warn, error, fatal
 * - Request correlation IDs
 * - Performance tracking
 * - Contextual metadata
 * - In-memory log buffer for provider owner viewing
 */
import pino from "pino";
import { addLogEntry, type LogEntry } from "./log-buffer.js";

const isDevelopment = process.env.NODE_ENV !== "production";
const logLevel = process.env.LOG_LEVEL || (isDevelopment ? "debug" : "info");

/**
 * Custom stream that writes to both console and log buffer
 */
const logStream = {
  write: (msg: string) => {
    // Parse pino JSON log
    try {
      const log = JSON.parse(msg);
      const level = log.level;
      const module = log.module || "unknown";
      const message = log.msg || "";
      
      // Map pino numeric levels to string levels
      const levelMap: Record<number, LogEntry["level"]> = {
        10: "trace",
        20: "debug",
        30: "info",
        40: "warn",
        50: "error",
        60: "fatal",
      };
      
      // Add to buffer
      addLogEntry({
        timestamp: Date.now(),
        level: levelMap[level] || "info",
        category: module,
        message,
        data: log,
      });
    } catch {
      // Ignore parse errors
    }
  },
};

/**
 * Base logger configuration
 */
const logger = pino({
  level: logLevel,
  // Pretty print in development, JSON in production
  transport: isDevelopment
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss.l",
          ignore: "pid,hostname",
          messageFormat: "{levelLabel} [{module}] {msg}",
          levelLabel: "level",
        },
      }
    : undefined,
  // Add base metadata to all logs
  base: {
    pid: process.pid,
    hostname: process.env.HOSTNAME || "unknown",
    service: "cloudana-provider-node",
  },
  // Timestamp in ISO format
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
  // Hook to intercept logs for buffer
  hooks: {
    logMethod(inputArgs, method) {
      // Capture log for buffer (only in production with JSON output)
      if (!isDevelopment && inputArgs.length > 0) {
        const [obj, msg] = inputArgs;
        const level = method.name as LogEntry["level"];
        const module = typeof obj === "object" && obj !== null && "module" in obj 
          ? String(obj.module) 
          : "unknown";
        
        addLogEntry({
          timestamp: Date.now(),
          level,
          category: module,
          message: msg || (typeof obj === "string" ? obj : ""),
          data: typeof obj === "object" ? obj : undefined,
        });
      }
      return method.apply(this, inputArgs);
    },
  },
});

/**
 * Extended logger interface with success method
 */
export interface ExtendedLogger extends pino.Logger {
  success: pino.LogFn;
}

/**
 * Create child logger with module context and add success method
 */
export function createLogger(module: string): ExtendedLogger {
  const childLogger = logger.child({ module }) as any;
  // Add success method as an alias to info for semantic logging
  childLogger.success = childLogger.info.bind(childLogger);
  return childLogger as ExtendedLogger;
}

/**
 * Module-specific loggers
 */
export const loggers = {
  server: createLogger("server"),
  workload: createLogger("workload"),
  k8s: createLogger("k8s"),
  docker: createLogger("docker"),
  http: createLogger("http"),
  device: createLogger("device"),
};

/**
 * Log HTTP request details
 */
export function logRequest(data: {
  method: string;
  path: string;
  query?: string;
  headers?: Record<string, string>;
  body?: unknown;
  requestId?: string;
}) {
  loggers.http.info(
    {
      method: data.method,
      path: data.path,
      query: data.query,
      requestId: data.requestId,
      // Avoid logging sensitive headers
      userAgent: data.headers?.["user-agent"],
    },
    `${data.method} ${data.path}`
  );
}

/**
 * Log HTTP response details
 */
export function logResponse(data: {
  method: string;
  path: string;
  status: number;
  duration: number;
  requestId?: string;
}) {
  const level = data.status >= 500 ? "error" : data.status >= 400 ? "warn" : "info";
  loggers.http[level](
    {
      method: data.method,
      path: data.path,
      status: data.status,
      duration: `${data.duration}ms`,
      requestId: data.requestId,
    },
    `${data.method} ${data.path} ${data.status} ${data.duration}ms`
  );
}

/**
 * Log workload execution start
 */
export function logWorkloadStart(data: {
  workloadId: string;
  instanceId: string;
  manifest?: unknown;
  k8sManifest?: { namespace: string; resources: unknown[] };
}) {
  loggers.workload.info(
    {
      workloadId: data.workloadId,
      instanceId: data.instanceId,
      hasManifest: !!data.manifest,
      hasK8sManifest: !!data.k8sManifest,
      k8sResourceCount: data.k8sManifest?.resources?.length || 0,
      namespace: data.k8sManifest?.namespace,
    },
    `Starting workload execution: ${data.workloadId}/${data.instanceId}`
  );
}

/**
 * Log workload execution success
 */
export function logWorkloadSuccess(data: {
  workloadId: string;
  instanceId: string;
  executionMode: "k8s-api" | "kubectl" | "docker" | "placeholder";
  duration?: number;
  details?: string;
}) {
  loggers.workload.info(
    {
      workloadId: data.workloadId,
      instanceId: data.instanceId,
      executionMode: data.executionMode,
      duration: data.duration ? `${data.duration}ms` : undefined,
      details: data.details,
    },
    `Workload executed successfully: ${data.workloadId}/${data.instanceId} via ${data.executionMode}`
  );
}

/**
 * Log workload execution failure
 */
export function logWorkloadError(data: {
  workloadId: string;
  instanceId: string;
  error: Error | string;
  executionMode?: string;
  phase?: string;
}) {
  const errorMessage = typeof data.error === "string" ? data.error : data.error.message;
  const errorStack = typeof data.error === "object" ? data.error.stack : undefined;

  loggers.workload.error(
    {
      workloadId: data.workloadId,
      instanceId: data.instanceId,
      error: errorMessage,
      stack: errorStack,
      executionMode: data.executionMode,
      phase: data.phase,
    },
    `Workload execution failed: ${data.workloadId}/${data.instanceId} - ${errorMessage}`
  );
}

/**
 * Log K8s resource creation
 */
export function logK8sResource(data: {
  action: "create" | "update" | "delete" | "apply";
  resource: string;
  namespace: string;
  name?: string;
  success: boolean;
  error?: string;
}) {
  const level = data.success ? "info" : "error";
  loggers.k8s[level](
    {
      action: data.action,
      resource: data.resource,
      namespace: data.namespace,
      name: data.name,
      success: data.success,
      error: data.error,
    },
    `K8s ${data.action} ${data.resource}${data.name ? ` ${data.name}` : ""} in ${data.namespace}: ${data.success ? "success" : "failed"}`
  );
}

/**
 * Log Docker operation
 */
export function logDockerOperation(data: {
  action: "run" | "stop" | "remove";
  workloadId: string;
  instanceId: string;
  image?: string;
  command?: string;
  containerId?: string;
  success: boolean;
  error?: string;
}) {
  const level = data.success ? "info" : "error";
  loggers.docker[level](
    {
      action: data.action,
      workloadId: data.workloadId,
      instanceId: data.instanceId,
      image: data.image,
      command: data.command,
      containerId: data.containerId,
      success: data.success,
      error: data.error,
    },
    `Docker ${data.action} for workload ${data.workloadId}/${data.instanceId}: ${data.success ? "success" : "failed"}`
  );
}

/**
 * Log device info query
 */
export function logDeviceInfo(data: {
  deviceId: string;
  hostname: string;
  cpuCores: number;
  memoryTotalGB: number;
  requestId?: string;
}) {
  loggers.device.debug(
    {
      deviceId: data.deviceId.slice(0, 16) + "...",
      hostname: data.hostname,
      cpuCores: data.cpuCores,
      memoryTotalGB: data.memoryTotalGB,
      requestId: data.requestId,
    },
    `Device info requested: ${data.hostname} (${data.cpuCores} cores, ${data.memoryTotalGB}GB RAM)`
  );
}

/**
 * Log system startup
 */
export function logStartup(data: {
  port: number;
  deviceId: string;
  hostname: string;
  nodeEnv: string;
  logLevel: string;
  k8sAvailable: boolean;
}) {
  loggers.server.info(
    {
      port: data.port,
      deviceId: data.deviceId.slice(0, 16) + "...",
      hostname: data.hostname,
      nodeEnv: data.nodeEnv,
      logLevel: data.logLevel,
      k8sAvailable: data.k8sAvailable,
      pid: process.pid,
    },
    `Provider node started on port ${data.port}`
  );
}

/**
 * Log performance metrics
 */
export function logMetrics(data: {
  activeWorkloads: number;
  totalWorkloadsProcessed: number;
  avgExecutionTime?: number;
  successRate?: number;
}) {
  loggers.server.info(
    {
      metrics: {
        activeWorkloads: data.activeWorkloads,
        totalWorkloadsProcessed: data.totalWorkloadsProcessed,
        avgExecutionTime: data.avgExecutionTime ? `${data.avgExecutionTime}ms` : undefined,
        successRate: data.successRate ? `${(data.successRate * 100).toFixed(2)}%` : undefined,
      },
    },
    `Provider metrics: ${data.activeWorkloads} active, ${data.totalWorkloadsProcessed} processed`
  );
}

export default logger;
