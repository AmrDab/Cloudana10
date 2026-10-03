/**
 * Node orchestrator entry point.
 *
 * Runs the shared API (app.ts) plus the routers that need Node — SSH provider
 * builds, deployments, verification, orchestration, log streaming, status
 * polling — and the background loops that place and track workloads.
 *
 * Storage: the same D1/KV-shaped interface the Worker uses, backed here by
 * embedded SQLite (lib/sqlite-d1.ts) so services behave identically on both.
 */
import "dotenv/config";

import { serve } from "@hono/node-server";
import { buildApp } from "./app.js";
import { getEnv } from "./config/env.js";
import { initStorage, getD1 } from "./lib/storage.js";
import { createSqliteD1, createSqliteKV } from "./lib/sqlite-d1.js";
import { metricsMiddleware, serializeMetrics } from "./middleware/metrics.js";
import { verifyRouter } from "./routes/v1/verify.js";
import { buildProviderRouter } from "./routes/v1/build-provider.js";
import { orchestrationRouter } from "./routes/v1/orchestration.js";
import workloadStatusRouter from "./routes/v1/workload-status.js";
import providerLogsRouter from "./routes/v1/provider-logs.js";
import { deployRouter } from "./routes/v1/deploy.js";
import { startOrchestratorLoop } from "./services/orchestrator-loop.service.js";
import { startOrchestratorEventDriven } from "./services/orchestrator-event.service.js";
import { startWorkloadStatusPolling } from "./services/workload-status-poller.service.js";
import { initBuildProviderStore } from "./services/build-provider.service.js";
import { log } from "./lib/logger.js";

const L = log.api;

// Fail fast on a misconfigured orchestrator instead of discovering it per request.
const env = getEnv();

// Storage must exist before any router runs — the Worker does this per request.
initStorage(createSqliteD1(new URL("../schema.sql", import.meta.url)), createSqliteKV());

const app = buildApp({
  runtime: "node",
  pre: [metricsMiddleware],
  checks: async () => {
    try {
      await getD1().prepare("SELECT 1").first();
      return { sqlite: "connected" };
    } catch (err) {
      return { sqlite: err instanceof Error ? err.message : "disconnected" };
    }
  },
});

// Prometheus metrics (Node only — Workers have no process-wide counters).
app.get("/metrics", (c) =>
  c.text(serializeMetrics(), 200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" }),
);

// Node-only routers.
app.route("/v1", verifyRouter);
app.route("/v1", buildProviderRouter);
app.route("/v1", orchestrationRouter);
app.route("/v1", workloadStatusRouter);
app.route("/v1", providerLogsRouter);
app.route("/v1", deployRouter);

// Background loops.
if (env.ORCHESTRATOR_EVENT_DRIVEN_ENABLED) {
  startOrchestratorEventDriven();
} else {
  L.dim("Orchestrator event-driven placement disabled (ORCHESTRATOR_EVENT_DRIVEN_ENABLED=false)");
}
if (env.ORCHESTRATOR_POLL_ENABLED) {
  startOrchestratorLoop();
} else {
  L.dim("Orchestrator poll fallback disabled (ORCHESTRATOR_POLL_ENABLED=true to enable)");
}
if (env.WORKLOAD_STATUS_POLLING_ENABLED) {
  startWorkloadStatusPolling();
  L.success("Workload status polling started");
} else {
  L.dim("Workload status polling disabled (WORKLOAD_STATUS_POLLING_ENABLED=false)");
}

async function main() {
  await initBuildProviderStore();
  serve({ fetch: app.fetch, port: env.PORT });
  L.success(`Orchestrator listening on :${env.PORT}`);
  L.log(`Swagger UI: http://localhost:${env.PORT}/v1/swagger`);
}
main();
