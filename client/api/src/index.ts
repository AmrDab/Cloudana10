/**
 * Node runtime entry point: the same API as the Cloudflare Worker (app.ts), on plain Node with embedded SQLite.
 *
 * What it is for: local development without Cloudflare, tests, and an independently operated orchestrator
 * (DECENTRALIZATION_ROADMAP.md phase 2 — "the orchestrator becomes replaceable"). It mounts exactly the routers the
 * Worker mounts and runs the same cron duties on a timer. The Akash/k3s/ssh2 orchestration that used to live only
 * here was removed on 2026-10-19 (ENGINEERING_BASELINE.md §5): it was never deployed and nothing reached it.
 *
 * Storage: the D1/KV-shaped interface the Worker uses, backed by node:sqlite (lib/sqlite-d1.ts), so services behave
 * identically on both runtimes. Relay and R2 are Cloudflare-only: relayed deployments are not probed and job
 * artifacts stay in SQLite on this runtime.
 */
import "dotenv/config";

import { serve } from "@hono/node-server";
import { buildApp } from "./app.js";
import { getEnv } from "./config/env.js";
import { initStorage, getD1 } from "./lib/storage.js";
import { createSqliteD1, createSqliteKV } from "./lib/sqlite-d1.js";
import { metricsMiddleware, serializeMetrics } from "./middleware/metrics.js";
import { log } from "./lib/logger.js";

const L = log.api;

// Fail fast on a misconfigured runtime instead of discovering it per request.
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

/**
 * The Worker's cron (worker.ts scheduled(), every minute) on a timer: node duties (dead-node requeue, start
 * timeouts, preemption, matmul assignment), the price controller and the deposit watcher. One failing duty never
 * blocks the others; overlapping runs are skipped.
 */
let cronRunning = false;
async function cronTick(): Promise<void> {
  if (cronRunning) return;
  cronRunning = true;
  try {
    const [{ runDutiesCron }, { runPriceControllerCron }, { runDepositWatcherCron }, { sweepChallenges }] = await Promise.all([
      import("./services/deployment-duties.service.js"),
      import("./services/pricing.service.js"),
      import("./services/deposit-watcher.service.js"),
      import("./services/jobs.service.js"),
    ]);
    const jobs: Array<[string, () => Promise<unknown>]> = [
      ["duties", () => runDutiesCron()],
      ["challenges", () => sweepChallenges()],
      ["price", () => runPriceControllerCron()],
      ["deposits", () => runDepositWatcherCron()],
    ];
    for (const [name, run] of jobs) {
      try {
        await run();
      } catch (err) {
        L.warn(`[cron] ${name} failed:`, err);
      }
    }
  } finally {
    cronRunning = false;
  }
}
if (env.NODE_CRON_ENABLED) {
  setInterval(() => void cronTick(), 60_000).unref();
  void cronTick();
} else {
  L.dim("Cron duties disabled (NODE_CRON_ENABLED=false)");
}

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  L.success(`Cloudana API (node runtime) listening on http://localhost:${info.port}`);
  L.dim(`OpenAPI: http://localhost:${info.port}/v1/swagger`);
});
