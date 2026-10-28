/**
 * Cloudflare Workers entry point — api.cloudana.io.
 *
 * Storage: Cloudflare D1 (SQL) + KV (key-value), bound per request.
 * Everything else (middleware, security policy, routers, OpenAPI) comes from
 * app.ts and is shared with the Node runtime (index.ts), which mounts the same
 * routers and adds only /metrics and a 60 s cron tick.
 */
import type { MiddlewareHandler } from "hono";
import { buildApp, type AppEnv } from "./app.js";
import { initStorage, getD1 } from "./lib/storage.js";
import { resetEnv } from "./config/env.js";
import { relayFromBinding, setRelay } from "./lib/relay.js";
import { r2Artifacts, setArtifactStore } from "./lib/artifacts.js";
import { setRateLimiters } from "./middleware/rate-limit.js";

type Bindings = {
  DB: D1Database;
  CLOUDANA_KV: KVNamespace;
  /** Node relay Durable Objects (script_name = cloudana-relay); absent → relayed deployments are not probed. */
  RELAY?: DurableObjectNamespace;
  /** Job artifacts (R2 cloudana-artifacts); absent → finished jobs keep their matrices in D1. */
  ARTIFACTS?: R2Bucket;
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
  setRelay(c.env.RELAY ? relayFromBinding(c.env.RELAY) : null);
  setArtifactStore(c.env.ARTIFACTS ? r2Artifacts(c.env.ARTIFACTS) : null);
  setRateLimiters(c.env);
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
 * matmul work) moved off the heartbeat; finished jobs' matrices into R2; the price controller (steps at
 * most once per hour); and the v2 Settlement Deposited watcher (inactive until SETTLEMENT_ADDRESS is set). Each binds env/storage
 * itself; one failing job never blocks the others.
 */
async function scheduled(_event: ScheduledController, env: Bindings, ctx: ExecutionContext): Promise<void> {
  initStorage(env.DB, env.CLOUDANA_KV);
  // New columns land on the first request after a deploy; a cron tick before it must not hit "no such column".
  await (await import("./lib/schema.js")).ensureSchema().catch(() => undefined);
  setRelay(env.RELAY ? relayFromBinding(env.RELAY) : null);
  setArtifactStore(env.ARTIFACTS ? r2Artifacts(env.ARTIFACTS) : null);
  const [{ runDutiesCron }, { runPriceControllerCron }, { runDepositWatcherCron }, { moveJobArtifacts, sweepChallenges }, { runStorageCron }] = await Promise.all([
    import("./services/deployment-duties.service.js"),
    import("./services/pricing.service.js"),
    import("./services/deposit-watcher.service.js"),
    import("./services/jobs.service.js"),
    import("./services/storage.service.js"),
  ]);
  const jobs: Array<[string, () => Promise<unknown>]> = [
    ["duties", () => runDutiesCron(env as never)],
    ["artifacts", () => moveJobArtifacts()],
    ["challenges", () => sweepChallenges()],
    ["storage", () => runStorageCron(env)],
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
