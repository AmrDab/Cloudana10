/**
 * cloudana-keeper — Cloudflare Worker. Cron (every 5 min): one settlement pass (see run.ts).
 * Fetch: GET /health only. Nothing else is served.
 */
import { formatEther, type Address, type Hex } from "viem";
import { createApi } from "./api";
import { createChain } from "./chain";
import { runOnce, type RunSummary } from "./run";

export interface Env {
  API_URL: string;
  RPC_URL: string;
  SETTLEMENT_ADDRESS: string;
  CHAIN_ID: string;
  CLAIM_CHUNK?: string;
  POSTER_PRIVATE_KEY: string; // secret
  INTERNAL_API_KEY: string; // secret
}

// Best-effort: lives as long as this isolate does. Durable "last run" state would need KV (not in the spec).
let lastRun: RunSummary | null = null;
let lastError: string | null = null;
let running: Promise<RunSummary> | null = null;

const log = (msg: string, data?: Record<string, unknown>) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), msg, ...(data ?? {}) }, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

function deps(env: Env) {
  for (const k of ["API_URL", "RPC_URL", "SETTLEMENT_ADDRESS", "CHAIN_ID", "POSTER_PRIVATE_KEY", "INTERNAL_API_KEY"] as const) {
    if (!env[k]) throw new Error(`missing binding ${k}`);
  }
  const api = createApi(env.API_URL, env.INTERNAL_API_KEY);
  const chain = createChain({
    rpcUrl: env.RPC_URL,
    chainId: Number(env.CHAIN_ID),
    settlement: env.SETTLEMENT_ADDRESS as Address,
    posterKey: env.POSTER_PRIVATE_KEY as Hex,
  });
  return { api, chain, log, claimChunk: env.CLAIM_CHUNK ? Number(env.CLAIM_CHUNK) : undefined };
}

async function run(env: Env): Promise<RunSummary> {
  if (running) return running; // overlapping cron ticks in one isolate share the pass
  running = (async () => {
    try {
      const r = await runOnce(deps(env));
      lastRun = r;
      lastError = null;
      return r;
    } catch (e: any) {
      lastError = e?.message ?? String(e);
      log("run failed", { error: lastError });
      throw e;
    } finally {
      running = null;
    }
  })();
  return running;
}

async function health(env: Env): Promise<Response> {
  const body: Record<string, unknown> = {
    ok: true,
    now: new Date().toISOString(),
    settlement: env.SETTLEMENT_ADDRESS,
    chainId: Number(env.CHAIN_ID),
    lastRun: lastRun ? { startedAt: lastRun.startedAt, finishedAt: lastRun.finishedAt, closedNow: lastRun.closedNow, epochs: lastRun.epochs } : null,
    lastError,
  };
  try {
    const d = deps(env);
    const [bal, params, closed, posted] = await Promise.all([
      d.chain.getPosterBalance(),
      d.chain.getParams(),
      d.api.list("closed"),
      d.api.list("posted"),
    ]);
    body.posterBalanceEth = formatEther(bal);
    body.posterBalanceWei = bal.toString();
    const open = [...closed, ...posted].map((e) => e.epoch);
    body.unsettledEpochs = open.length;
    if (open.length) {
      const oldest = Math.min(...open);
      const endedAt = (oldest + 1) * Number(params.epochSeconds);
      body.oldestUnsettledEpoch = oldest;
      body.oldestUnsettledAgeSeconds = Math.max(0, Math.floor(Date.now() / 1000) - endedAt);
    } else {
      body.oldestUnsettledEpoch = null;
      body.oldestUnsettledAgeSeconds = 0;
    }
  } catch (e: any) {
    body.ok = false;
    body.healthError = e?.message ?? String(e);
  }
  return new Response(JSON.stringify(body, null, 2), {
    status: body.ok ? 200 : 503,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(run(env).catch(() => undefined));
  },
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/health") return health(env);
    return new Response("not found", { status: 404 });
  },
};
