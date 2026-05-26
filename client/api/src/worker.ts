/**
 * Cloudflare Workers entry point for the Cloudana API.
 *
 * Storage: Cloudflare D1 (SQL) + KV (key-value). No external databases.
 *
 * Workers-compatible routers:
 *   - auth (viem signature verification, hono/jwt)
 *   - templates (D1 + fetch)
 *   - pouw (chain reads, in-memory certificate store)
 *   - hardware-scan (KV + fetch)
 *   - payments (Stripe + D1 balance/tx persistence)
 *   - faucet (chain writes + KV cooldown persistence)
 *
 * Excluded (Node.js-only, needs dedicated server):
 *   - orchestrator-loop, orchestrator-event (setInterval, event subscriptions)
 *   - workload-status-poller (setInterval polling)
 *   - build-provider (child_process, ssh2, fs)
 *   - verify (ssh2, net, dns)
 *   - deploy (akash SDK, heavy Node.js deps)
 *   - orchestration (imports chain-client write functions, deploy-to-provider)
 *   - provider-logs (provider node HTTP calls)
 */

import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { initStorage, getD1 } from "./lib/storage.js";
import { authRouter } from "./routes/v1/auth.js";
import { templatesRouter } from "./routes/v1/templates.js";
import { pouwRouter } from "./routes/v1/pouw.js";
import { hardwareScanRouter } from "./routes/v1/hardware-scan.js";
import { paymentsRouter } from "./routes/v1/payments.js";
import { faucetRouter } from "./routes/v1/faucet.js";

type Bindings = {
  DB: D1Database;
  CLOUDANA_KV: KVNamespace;
  [key: string]: unknown;
};

const app = new OpenAPIHono<{ Bindings: Bindings }>();

// ── Per-request init: bridge env vars + storage bindings ─────────────────────
app.use("*", async (c, next) => {
  // Bridge Worker env vars → process.env for service compatibility
  const env = c.env as Record<string, unknown>;
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      process.env[key] = value;
    }
  }

  // Init D1 + KV storage bindings
  initStorage(c.env.DB, c.env.CLOUDANA_KV);

  await next();
});

// CORS for all routes
app.use("*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "stripe-signature"],
}));

// Health check with D1 connectivity
app.get("/health", async (c) => {
  let d1Ok = false;
  try {
    const db = getD1();
    await db.prepare("SELECT 1").first();
    d1Ok = true;
  } catch {}

  const status = d1Ok ? "ok" : "degraded";
  return c.json({
    status,
    runtime: "cloudflare-workers",
    timestamp: new Date().toISOString(),
    services: {
      d1: d1Ok ? "connected" : "disconnected",
    },
  }, d1Ok ? 200 : 503);
});

// API v1 routes
app.route("/v1", authRouter);
app.route("/v1", templatesRouter);
app.route("/v1", pouwRouter);
app.route("/v1", hardwareScanRouter);
app.route("/v1", paymentsRouter);
app.route("/v1", faucetRouter);

export default app;
