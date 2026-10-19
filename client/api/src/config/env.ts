/**
 * Validated runtime configuration — the one place that reads process.env.
 *
 * Parsed lazily on first use: on the Cloudflare Worker, bindings are copied
 * into process.env per request by worker.ts, so nothing here may run at import
 * time. The parsed result is cached; tests call resetEnv() between cases.
 *
 * Rules: anything with a safe default gets one here so services stop inventing
 * their own; anything secret or deployment-specific is optional and the
 * consuming service decides how to degrade when it is absent (and says so in
 * its response — never silently).
 */
import { z } from "zod";
import { log } from "../lib/logger.js";

const flag = (def: boolean) =>
  z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => (v === undefined ? def : v === "true" || v === "1"));

const int = (def: number) => z.coerce.number().int().default(def);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected a 0x address");
const hex32 = z.string().regex(/^(0x)?[0-9a-fA-F]{64}$/, "expected a 32-byte hex key");

export const envSchema = z.object({
  // ── Runtime ──────────────────────────────────────────────────────────────
  PORT: int(7002),
  APP_URL: z.string().url().default("http://localhost:3000"),
  CLOUDANA_DB_PATH: z.string().default("./data/cloudana.sqlite"),

  // ── Auth / internal ──────────────────────────────────────────────────────
  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
  INTERNAL_API_KEY: z.string().min(16).optional(),

  // ── Chain (read-only; the API Worker holds no chain key) ──────────────────
  CHAIN_NETWORK: z.enum(["baseSepolia", "base"]).default("baseSepolia"),
  CHAIN_ID: z.coerce.number().int().optional(),
  /** Generic read-only RPC fallback (config/contracts.ts getRpcUrl); CHAIN_RPC_URL below takes precedence. */
  RPC_URL: z.string().url().optional(),

  // ── Node runtime (src/index.ts) ──────────────────────────────────────────
  /** Run the Worker's cron duties on a 60 s timer (dead-node requeue, start timeouts, assignment, price, deposits). */
  NODE_CRON_ENABLED: flag(true),

  // ── v1 work pipeline (docs/BUILD_SPEC_V1.md) ────────────────────────────
  /** Enables POST /v1/dev/credits. Never set in production. */
  DEV_MODE: flag(false),
  /** Public testnet: /v1/dev/credits gives 10 test CLD once per wallet per day. Never on a value-bearing deployment. */
  TESTNET_CREDITS: flag(false),
  /** Testnet 3600 / 3600; mainnet 86400 / 604800 (docs/IMPL_SPEC_2026-10.md). */
  EPOCH_SECONDS: int(3600),
  VEST_B_SECONDS: int(3600),
  SUBSIDY_RHO: z.coerce.number().min(0).max(1).default(0.04), // capped at RHO_MAX (ledger.service.ts)
  CLUSTER_N_MIN: int(3),
  CLUSTER_S_CAP: z.coerce.number().min(0).max(1).default(0.5),
  // Prices are quoted in US dollars and settled in CLD (docs/TOKENOMICS_USD_PRICING.md, docs/PRICES_USD.md).
  /** The reference rate: US dollars per CLD. Testnet: a fixed $0.10; after listing a TWAP replaces it (behind a flag). */
  USD_PER_CLD: z.coerce.number().positive().default(0.1),
  /** Initial/reset price in nano-dollars per tera-MAC (≈ $2.02 per H100-hour); the hourly controller moves it from here. */
  PRICE_NUSD_PER_TMAC: int(1400),
  /** Flat part of every job fee, US dollars. */
  BASE_FEE_USD: z.coerce.number().min(0).default(0.0001),
  PRICE_CONTROLLER: z.enum(["on", "off"]).default("on"),
  /** Lane-B subsidy per epoch: 80 % of the chain allowance for a 1 h epoch at 1M supply, 8 %/yr. */
  EPOCH_SUBSIDY_BUDGET_UCLD: int(7_300_000),
  NODE_ACTIVE_SECONDS: int(45),
  ASSIGNMENT_TTL_SECONDS: int(60),
  /** Source of the assignment seed (latest block hash). Unset → local fallback seed. */
  CHAIN_RPC_URL: z.string().url().optional(),
  /** v2 CloudanaSettlement on Base Sepolia; the Deposited watcher is inactive while unset. */
  SETTLEMENT_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  DEPOSIT_WATCHER_START_BLOCK: z.coerce.number().int().nonnegative().optional(),
  /** Blocks behind the chain head the deposit watcher stays, so a reorged Deposited log is never credited. */
  DEPOSIT_CONFIRMATIONS: int(10),
  /**
   * Node runtime only: trust CF-Connecting-IP / X-Forwarded-For for the client IP (set when a trusted proxy fronts
   * the orchestrator). Off: the socket address is used. The Worker always trusts CF-Connecting-IP (Cloudflare sets it).
   */
  TRUST_PROXY: flag(false),
  /** Card payments (Stripe) are off unless explicitly enabled. */
  STRIPE_ENABLED: flag(false),
  /** Public hosting gateway domain: https://{deploymentId}.{SITES_DOMAIN}. */
  SITES_DOMAIN: z.string().default("sites.cloudana.io"),
  /** Node instructions: signer key (Worker secret, not a chain key), minimum agent, extra image regexes. */
  INSTRUCTION_SIGNING_KEY: z.string().optional(),
  // Relay (docs/V4_RELAY_CONTRACT.md): HMAC secret shared with cloudana-relay (≥ 32 chars; unset → no relay, nodes
  // stay in legacy direct mode), the URL nodes open, and how fresh a node's `relay: true` heartbeat must be.
  RELAY_TICKET_SECRET: z.string().min(32).optional(),
  RELAY_URL: z.string().default("wss://relay.cloudana.io/connect"),
  RELAY_FRESH_SECONDS: int(45),
  MIN_AGENT_VERSION: z.string().default("1.3.0"),
  // Storage phase 1 (docs/V4_STORAGE_PHASE1_CONTRACT.md): key-encryption key (Worker secret, base64 of 32 bytes; unset
  // → no provider copies, artifacts stay R2-only; DEV_MODE uses a fixed dev key), copies per object, copy retention.
  STORAGE_KEK: z.string().optional(),
  STORAGE_COPIES: int(2),
  STORAGE_RETENTION_DAYS: int(30),
  IMAGE_ALLOWLIST: z.string().optional(),

  // ── Hourly prices in US dollars (docs/PRICES_USD.md); converted to µCLD at USD_PER_CLD when a deployment is created.
  PRICE_HOSTING_USD_PER_HOUR: z.coerce.number().min(0).default(0.0014),
  PRICE_CPU_USD_PER_HOUR: z.coerce.number().min(0).default(0.01),
  PRICE_MEM_USD_PER_GB_HOUR: z.coerce.number().min(0).default(0.0012),
  PRICE_STORAGE_USD_PER_GB_HOUR: z.coerce.number().min(0).default(0.0001),
  PRICE_VOLUME_USD_PER_GB_HOUR: z.coerce.number().min(0).default(0.0001),
  /** Per GPU per hour, by tier (shared/gpu-tier.ts). */
  PRICE_GPU_STANDARD_USD_PER_HOUR: z.coerce.number().min(0).default(0.3),
  PRICE_GPU_LARGE_USD_PER_HOUR: z.coerce.number().min(0).default(1.2),
  PRICE_GPU_H100_USD_PER_HOUR: z.coerce.number().min(0).default(2),
  /** Fraction taken off an interruptible workstation's price. */
  INTERRUPTIBLE_DISCOUNT: z.coerce.number().min(0).max(1).default(0.5),
  /** Seconds between uptime probes of one deployment. */
  DEPLOY_PROBE_SECONDS: int(60),
  /** Consecutive failed probes before a deployment is marked unreachable (billing pauses). */
  DEPLOY_PROBE_FAILS: int(3),
  /**
   * Seconds a container, workstation or endpoint replica may stay `assigned` (start sent, no running/failed report)
   * before it is taken back from that node and re-queued; covers a long image pull plus the health grace.
   */
  DEPLOY_START_TIMEOUT_SECONDS: int(3600),
  /** The same for static sites, which start in seconds. */
  DEPLOY_START_TIMEOUT_STATIC_SECONDS: int(600),
  /** Start timeouts (each on a different node) before a deployment is failed and its hold released. */
  DEPLOY_START_ATTEMPTS: int(3),

  // ── Payments ─────────────────────────────────────────────────────────────
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // ── Storage / IPFS ───────────────────────────────────────────────────────
  PINATA_JWT: z.string().optional(),
  PINATA_GATEWAY: z.string().url().default("https://gateway.pinata.cloud/ipfs/"),
  IPFS_GATEWAY: z.string().url().default("https://gateway.pinata.cloud"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/** Parsed, validated configuration. Throws a readable error listing every bad variable. */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  if (parsed.data.JWT_SECRET.length < 32) {
    log.config.warn("JWT_SECRET is shorter than 32 characters — rotate to a longer random value");
  }
  cached = parsed.data;
  return cached;
}

/** Forget the cached parse (tests, or after process.env changes). */
export function resetEnv(): void {
  cached = null;
}
