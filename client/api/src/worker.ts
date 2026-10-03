/**
 * Cloudflare Workers entry point — api.cloudana.io.
 *
 * Storage: Cloudflare D1 (SQL) + KV (key-value), bound per request.
 * Everything else (middleware, security policy, routers, OpenAPI) comes from
 * app.ts and is shared with the Node orchestrator.
 *
 * Node-only routers (build-provider, verify, deploy, orchestration,
 * provider-logs, workload-status) need ssh2 / child_process / long-lived loops
 * and are mounted only by index.ts.
 */
import type { MiddlewareHandler } from "hono";
import { buildApp, type AppEnv } from "./app.js";
import { initStorage, getD1 } from "./lib/storage.js";
import { resetEnv } from "./config/env.js";

type Bindings = {
  DB: D1Database;
  CLOUDANA_KV: KVNamespace;
  [key: string]: unknown;
};

/** Bridge Worker bindings into the process-style config the services expect. */
const bindBindings: MiddlewareHandler<AppEnv<Bindings>> = async (c, next) => {
  let changed = false;
  for (const [key, value] of Object.entries(c.env)) {
    if (typeof value === "string" && process.env[key] !== value) {
      process.env[key] = value;
      changed = true;
    }
  }
  if (changed) resetEnv();
  initStorage(c.env.DB, c.env.CLOUDANA_KV);
  await next();
};

const app = buildApp<Bindings>({
  runtime: "cloudflare-workers",
  pre: [bindBindings],
  checks: async () => {
    try {
      await getD1().prepare("SELECT 1").first();
      return { d1: "connected" };
    } catch (err) {
      return { d1: err instanceof Error ? err.message : "disconnected" };
    }
  },
});

export default app;
