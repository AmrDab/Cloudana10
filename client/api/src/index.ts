// Load environment variables FIRST, before any other imports
import "dotenv/config";

import { serve } from "@hono/node-server";
import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { cors } from "hono/cors";
import { authRouter } from "./routes/v1/auth.js";
import { templatesRouter } from "./routes/v1/templates.js";
import { verifyRouter } from "./routes/v1/verify.js";
import { buildProviderRouter } from "./routes/v1/build-provider.js";
import { orchestrationRouter } from "./routes/v1/orchestration.js";
import { requireAuth } from "./middleware/auth.js";
import { metricsMiddleware, serializeMetrics } from "./middleware/metrics.js";
import workloadStatusRouter from "./routes/v1/workload-status.js";
import providerLogsRouter from "./routes/v1/provider-logs.js";
import { deployRouter } from "./routes/v1/deploy.js";
import { paymentsRouter } from "./routes/v1/payments.js";
import { faucetRouter } from "./routes/v1/faucet.js";
import { pouwRouter } from "./routes/v1/pouw.js";
import { hardwareScanRouter } from "./routes/v1/hardware-scan.js";
import { startOrchestratorLoop } from "./services/orchestrator-loop.service.js";
import { startOrchestratorEventDriven } from "./services/orchestrator-event.service.js";
import { startWorkloadStatusPolling } from "./services/workload-status-poller.service.js";
import { connectMongo } from "./lib/mongo.js";
import { initBuildProviderStore } from "./services/build-provider.service.js";
import { log } from "./lib/logger.js";

const PORT = Number(process.env.PORT);
const L = log.api;
L.info("port", PORT);
const app = new OpenAPIHono();

// Enable CORS for all routes
app.use("*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
}));

app.use("*", metricsMiddleware);

// Protect sensitive endpoints with JWT auth
app.use("/v1/build-provider/*", requireAuth);
app.use("/v1/orchestration/*", requireAuth);

// OpenAPI configuration
app.openAPIRegistry.registerComponent("securitySchemes", "BearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT"
});

// Prometheus metrics endpoint
app.get("/metrics", (c) => {
  return c.text(serializeMetrics(), 200, {
    "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
  });
});

// Enhanced health check
app.get("/health", async (c) => {
  const checks: Record<string, string> = {
    api: "ok",
    uptime: `${Math.floor(process.uptime())}s`,
  };

  return c.json({
    status: "ok",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    checks,
  });
});

// API v1 routes
app.route("/v1", authRouter);
app.route("/v1", templatesRouter);
app.route("/v1", verifyRouter);
app.route("/v1", buildProviderRouter);
app.route("/v1", orchestrationRouter);
app.route("/v1", workloadStatusRouter);
app.route("/v1", providerLogsRouter);
app.route("/v1", deployRouter);
app.route("/v1", paymentsRouter);
app.route("/v1", faucetRouter);
app.route("/v1", pouwRouter);
app.route("/v1", hardwareScanRouter);

// OpenAPI JSON endpoint
app.get("/v1/doc", (c) => {
  return c.json(app.getOpenAPIDocument({
    openapi: "3.0.0",
    info: {
      title: "Cloudana API",
      description: "Cloudana backend API for templates",
      version: "1.0.0"
    },
    servers: [
      {
        url: `http://localhost:${PORT}`,
        description: "API Server"
      }
    ]
  }));
});

// Swagger UI endpoint
app.get("/v1/swagger", swaggerUI({ url: "/v1/doc" }));

const port = PORT;

// Event-driven orchestrator: enabled by default. Listens for WorkloadCreated and runs placement.
const eventDrivenDisabled = process.env.ORCHESTRATOR_EVENT_DRIVEN_ENABLED === "false" || process.env.ORCHESTRATOR_EVENT_DRIVEN_ENABLED === "0";
if (!eventDrivenDisabled) {
  startOrchestratorEventDriven();
} else {
  L.dim("Orchestrator event-driven disabled (set ORCHESTRATOR_EVENT_DRIVEN_ENABLED=false to disable)");
}

// Optional polling fallback: run placement on a timer (e.g. backup or when event-driven is off).
if (process.env.ORCHESTRATOR_POLL_ENABLED === "true" || process.env.ORCHESTRATOR_POLL_ENABLED === "1") {
  startOrchestratorLoop();
} else {
  L.dim("Orchestrator poll disabled (set ORCHESTRATOR_POLL_ENABLED=true to enable)");
}

// Workload status polling: tracks execution status, logs, and endpoints from provider nodes
const statusPollingDisabled = process.env.WORKLOAD_STATUS_POLLING_ENABLED === "false" || process.env.WORKLOAD_STATUS_POLLING_ENABLED === "0";
if (!statusPollingDisabled) {
  startWorkloadStatusPolling();
  L.success("Workload status polling started");
} else {
  L.dim("Workload status polling disabled (set WORKLOAD_STATUS_POLLING_ENABLED=false to disable)");
}

async function main() {
  try {
    await connectMongo();
  } catch (err) {
    L.error("MongoDB connection failed", err);
    process.exit(1);
  }
  await initBuildProviderStore();
  L.success(`Server is running on port ${port}`);
  L.log(`Swagger UI: http://localhost:${port}/v1/swagger`);
  L.log(`OpenAPI JSON: http://localhost:${port}/v1/doc`);
  serve({
    fetch: app.fetch,
    port,
  });
}
main();
