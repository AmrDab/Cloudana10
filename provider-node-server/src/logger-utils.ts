/**
 * Logging utility functions and helpers
 */
import type { Context } from "hono";
import { loggers } from "./logger.js";

/**
 * Measure and log function execution time
 */
export async function logExecutionTime<T>(
  operation: string,
  fn: () => Promise<T>,
  metadata?: Record<string, unknown>
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    const duration = Date.now() - start;
    loggers.server.debug(
      { operation, duration: `${duration}ms`, ...metadata },
      `${operation} completed in ${duration}ms`
    );
    return result;
  } catch (error) {
    const duration = Date.now() - start;
    loggers.server.error(
      {
        operation,
        duration: `${duration}ms`,
        error: error instanceof Error ? error.message : String(error),
        ...metadata,
      },
      `${operation} failed after ${duration}ms`
    );
    throw error;
  }
}

/**
 * Log with context from Hono request
 */
export function logWithContext(
  c: Context,
  level: "debug" | "info" | "warn" | "error",
  message: string,
  data?: Record<string, unknown>
) {
  const requestId = c.get("requestId") as string | undefined;
  const context = {
    requestId,
    method: c.req.method,
    path: c.req.path,
    ...data,
  };

  loggers.http[level](context, message);
}

/**
 * Create a request-scoped logger
 */
export function createRequestLogger(c: Context) {
  const requestId = c.get("requestId") as string | undefined;
  const baseContext = {
    requestId,
    method: c.req.method,
    path: c.req.path,
  };

  return {
    debug: (data: Record<string, unknown>, message: string) =>
      loggers.http.debug({ ...baseContext, ...data }, message),
    info: (data: Record<string, unknown>, message: string) =>
      loggers.http.info({ ...baseContext, ...data }, message),
    warn: (data: Record<string, unknown>, message: string) =>
      loggers.http.warn({ ...baseContext, ...data }, message),
    error: (data: Record<string, unknown>, message: string) =>
      loggers.http.error({ ...baseContext, ...data }, message),
  };
}

/**
 * Sanitize sensitive data before logging
 */
export function sanitizeForLog(data: unknown): unknown {
  if (typeof data !== "object" || data === null) {
    return data;
  }

  const sanitized = { ...data } as Record<string, unknown>;
  const sensitiveKeys = ["password", "token", "secret", "apiKey", "privateKey", "authorization"];

  for (const key of Object.keys(sanitized)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some((sensitive) => lowerKey.includes(sensitive))) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof sanitized[key] === "object" && sanitized[key] !== null) {
      sanitized[key] = sanitizeForLog(sanitized[key]);
    }
  }

  return sanitized;
}

/**
 * Format bytes for logging
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/**
 * Format duration for logging
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(2)}m`;
  return `${(ms / 3600000).toFixed(2)}h`;
}

/**
 * Batch log multiple operations
 */
export function logBatch(
  level: "debug" | "info" | "warn" | "error",
  operations: Array<{ message: string; data?: Record<string, unknown> }>
) {
  operations.forEach(({ message, data }) => {
    loggers.server[level](data || {}, message);
  });
}

/**
 * Log with retry context
 */
export function logRetry(data: {
  operation: string;
  attempt: number;
  maxAttempts: number;
  error?: string;
  delay?: number;
}) {
  loggers.server.warn(
    {
      operation: data.operation,
      attempt: data.attempt,
      maxAttempts: data.maxAttempts,
      error: data.error,
      nextRetryIn: data.delay ? `${data.delay}ms` : undefined,
    },
    `Retry ${data.attempt}/${data.maxAttempts} for ${data.operation}`
  );
}

/**
 * Log system resource usage
 */
export function logSystemResources() {
  const used = process.memoryUsage();
  loggers.server.debug(
    {
      memory: {
        heapUsed: formatBytes(used.heapUsed),
        heapTotal: formatBytes(used.heapTotal),
        external: formatBytes(used.external),
        rss: formatBytes(used.rss),
      },
      uptime: formatDuration(process.uptime() * 1000),
    },
    "System resource usage"
  );
}

/**
 * Create a timing context for complex operations
 */
export class TimingContext {
  private startTime: number;
  private checkpoints: Map<string, number> = new Map();

  constructor(private operation: string) {
    this.startTime = Date.now();
  }

  checkpoint(name: string) {
    this.checkpoints.set(name, Date.now() - this.startTime);
  }

  complete(success: boolean = true, metadata?: Record<string, unknown>) {
    const totalDuration = Date.now() - this.startTime;
    const checkpointData = Object.fromEntries(
      Array.from(this.checkpoints.entries()).map(([name, time]) => [name, `${time}ms`])
    );

    const level = success ? "info" : "error";
    loggers.server[level](
      {
        operation: this.operation,
        totalDuration: `${totalDuration}ms`,
        checkpoints: checkpointData,
        success,
        ...metadata,
      },
      `${this.operation} ${success ? "completed" : "failed"} in ${totalDuration}ms`
    );
  }
}

/**
 * Example usage of TimingContext:
 * 
 * const timing = new TimingContext("deploy-workload");
 * 
 * // ... do some work
 * timing.checkpoint("ipfs-fetch");
 * 
 * // ... do more work
 * timing.checkpoint("k8s-apply");
 * 
 * // ... finish
 * timing.complete(true, { workloadId: "123" });
 */
