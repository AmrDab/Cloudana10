/**
 * Prometheus metrics middleware for Cloudana orchestrator.
 * Exposes /metrics endpoint for scraping.
 */
import type { Context, Next } from "hono";
import { createMiddleware } from "hono/factory";

// In-memory metrics store (lightweight, no external deps)
const metrics = {
  httpRequestsTotal: new Map<string, number>(),
  httpRequestDurationMs: new Map<string, number[]>(),
  httpRequestsInFlight: 0,

  // Business metrics
  workloadsCreated: 0,
  workloadsPlaced: 0,
  pouwCertificatesSubmitted: 0,
  pouwCertificatesVerified: 0,
  providersRegistered: 0,
  rewardsDistributed: 0,

  // Error tracking
  errorsTotal: new Map<string, number>(),
};

/**
 * Increment a counter metric.
 */
export function incCounter(name: keyof typeof metrics) {
  if (typeof metrics[name] === "number") {
    (metrics[name] as number)++;
  }
}

/**
 * Middleware: track HTTP request metrics.
 */
export const metricsMiddleware = createMiddleware(async (c: Context, next: Next) => {
  const start = Date.now();
  metrics.httpRequestsInFlight++;

  try {
    await next();
  } finally {
    metrics.httpRequestsInFlight--;
    const duration = Date.now() - start;
    const method = c.req.method;
    const path = c.req.routePath || c.req.path;
    const status = c.res.status;
    const key = `${method}:${path}:${status}`;

    // Count requests
    metrics.httpRequestsTotal.set(key, (metrics.httpRequestsTotal.get(key) || 0) + 1);

    // Track durations (keep last 1000 per route)
    if (!metrics.httpRequestDurationMs.has(key)) {
      metrics.httpRequestDurationMs.set(key, []);
    }
    const durations = metrics.httpRequestDurationMs.get(key)!;
    durations.push(duration);
    if (durations.length > 1000) durations.shift();

    // Track errors
    if (status >= 400) {
      const errKey = `${method}:${path}:${status}`;
      metrics.errorsTotal.set(errKey, (metrics.errorsTotal.get(errKey) || 0) + 1);
    }
  }
});

/**
 * Serialize metrics in Prometheus text format.
 */
export function serializeMetrics(): string {
  const lines: string[] = [];

  // HTTP request totals
  lines.push("# HELP http_requests_total Total HTTP requests");
  lines.push("# TYPE http_requests_total counter");
  for (const [key, count] of metrics.httpRequestsTotal) {
    const [method, path, status] = key.split(":");
    lines.push(`http_requests_total{method="${method}",path="${path}",status="${status}"} ${count}`);
  }

  // HTTP request duration
  lines.push("# HELP http_request_duration_ms HTTP request duration in milliseconds");
  lines.push("# TYPE http_request_duration_ms summary");
  for (const [key, durations] of metrics.httpRequestDurationMs) {
    if (durations.length === 0) continue;
    const [method, path, status] = key.split(":");
    const sorted = [...durations].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];
    const sum = sorted.reduce((a, b) => a + b, 0);
    lines.push(`http_request_duration_ms{method="${method}",path="${path}",status="${status}",quantile="0.5"} ${p50}`);
    lines.push(`http_request_duration_ms{method="${method}",path="${path}",status="${status}",quantile="0.95"} ${p95}`);
    lines.push(`http_request_duration_ms{method="${method}",path="${path}",status="${status}",quantile="0.99"} ${p99}`);
    lines.push(`http_request_duration_ms_sum{method="${method}",path="${path}",status="${status}"} ${sum}`);
    lines.push(`http_request_duration_ms_count{method="${method}",path="${path}",status="${status}"} ${durations.length}`);
  }

  // In-flight requests
  lines.push("# HELP http_requests_in_flight Current HTTP requests being processed");
  lines.push("# TYPE http_requests_in_flight gauge");
  lines.push(`http_requests_in_flight ${metrics.httpRequestsInFlight}`);

  // Business metrics
  lines.push("# HELP cloudana_workloads_created_total Total workloads created");
  lines.push("# TYPE cloudana_workloads_created_total counter");
  lines.push(`cloudana_workloads_created_total ${metrics.workloadsCreated}`);

  lines.push("# HELP cloudana_workloads_placed_total Total workloads placed on providers");
  lines.push("# TYPE cloudana_workloads_placed_total counter");
  lines.push(`cloudana_workloads_placed_total ${metrics.workloadsPlaced}`);

  lines.push("# HELP cloudana_pouw_certificates_submitted_total Total POUW certificates submitted");
  lines.push("# TYPE cloudana_pouw_certificates_submitted_total counter");
  lines.push(`cloudana_pouw_certificates_submitted_total ${metrics.pouwCertificatesSubmitted}`);

  lines.push("# HELP cloudana_providers_registered_total Total providers registered");
  lines.push("# TYPE cloudana_providers_registered_total counter");
  lines.push(`cloudana_providers_registered_total ${metrics.providersRegistered}`);

  // Errors
  lines.push("# HELP http_errors_total Total HTTP errors");
  lines.push("# TYPE http_errors_total counter");
  for (const [key, count] of metrics.errorsTotal) {
    const [method, path, status] = key.split(":");
    lines.push(`http_errors_total{method="${method}",path="${path}",status="${status}"} ${count}`);
  }

  // Node.js process metrics
  const mem = process.memoryUsage();
  lines.push("# HELP process_heap_bytes Node.js heap memory usage");
  lines.push("# TYPE process_heap_bytes gauge");
  lines.push(`process_heap_bytes ${mem.heapUsed}`);
  lines.push(`process_heap_total_bytes ${mem.heapTotal}`);
  lines.push(`process_rss_bytes ${mem.rss}`);

  lines.push("# HELP process_uptime_seconds Process uptime");
  lines.push("# TYPE process_uptime_seconds gauge");
  lines.push(`process_uptime_seconds ${Math.floor(process.uptime())}`);

  return lines.join("\n") + "\n";
}
