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

/**
 * Cron (wrangler.toml [triggers], every minute): node duties (requeue dead nodes, preempt, assign
 * matmul work) moved off the heartbeat; the price controller (steps at most once per hour); and the
 * v2 Settlement Deposited watcher (inactive until SETTLEMENT_ADDRESS is set). Each binds env/storage
 * itself; one failing job never blocks the others.
 */
async function scheduled(_event: ScheduledController, env: Bindings, ctx: ExecutionContext): Promise<void> {
  initStorage(env.DB, env.CLOUDANA_KV);
  const [{ runDutiesCron }, { runPriceControllerCron }, { runDepositWatcherCron }] = await Promise.all([
    import("./services/deployment-duties.service.js"),
    import("./services/pricing.service.js"),
    import("./services/deposit-watcher.service.js"),
  ]);
  const jobs: Array<[string, () => Promise<unknown>]> = [
    ["duties", () => runDutiesCron(env as never)],
    ["price", () => runPriceControllerCron(env)],
    ["deposits", () => runDepositWatcherCron(env as never)],
  ];
  ctx.waitUntil(
    Promise.all(
      jobs.map(([name, run]) => run().catch((err) => console.error(`[cron] ${name} failed:`, err))),
    ),
  );
}

export default { fetch: app.fetch, scheduled };
