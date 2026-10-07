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

  // ── Chain ────────────────────────────────────────────────────────────────
  CHAIN_NETWORK: z.enum(["baseSepolia", "base"]).default("baseSepolia"),
  CHAIN_ID: z.coerce.number().int().optional(),
  RPC_URL: z.string().url().optional(),
  ORCHESTRATOR_CHAIN_RPC_URL: z.string().url().optional(),
  ORCHESTRATOR_CHAIN_WSS_URL: z.string().optional(),
  ORCHESTRATOR_RPC_TRANSPORT: z.enum(["http", "websocket"]).default("http"),
  ORCHESTRATOR_WEBSOCKET_RETRY_COUNT: int(3),
  ORCHESTRATOR_WEBSOCKET_RETRY_DELAY: int(3000),
  ORCHESTRATOR_PRIVATE_KEY: hex32.optional(),

  // ── Contracts (addresses default from shared/addresses.*.json in config/contracts.ts) ──
  POUW_VERIFIER_CONTRACT_ADDRESS: address.optional(),
  REWARD_CONTRACT_ADDRESS: address.optional(),
  CLD_TOKEN_ADDRESS: address.optional(),
  CLD_TREASURY_ADDRESS: address.optional(),

  // ── Orchestrator loops ───────────────────────────────────────────────────
  ORCHESTRATOR_EVENT_DRIVEN_ENABLED: flag(true),
  ORCHESTRATOR_EVENT_DEBOUNCE_MS: int(2000),
  ORCHESTRATOR_POLL_ENABLED: flag(false),
  ORCHESTRATOR_POLL_INTERVAL_MS: int(60_000),
  ORCHESTRATOR_DEPLOY_TIMEOUT_MS: int(15_000),
  ORCHESTRATOR_TERMINATE_TIMEOUT_MS: int(15_000),
  WORKLOAD_STATUS_POLLING_ENABLED: flag(true),
  WORKLOAD_STATUS_POLL_INTERVAL_MS: int(15_000),
  WORKLOAD_STATUS_CACHE_TTL_MS: int(60_000),

  // ── PoUW ─────────────────────────────────────────────────────────────────
  POUW_MIN_DIFFICULTY: int(8),
  /** How many times the API retries an on-chain certificate record before giving up. */
  POUW_CHAIN_RECORD_MAX_ATTEMPTS: int(5),
  POUW_MINING_POOL_WORKLOAD_ID: z.coerce.number().int().optional(),
  POUW_JOB_CLAIM_TTL_MS: int(5 * 60_000),
  POUW_FILLER_REWARD_FRACTION: z.coerce.number().min(0).max(1).default(0.1),
  POUW_FILLER_DAILY_CERT_CAP: int(20),
  MINING_REWARDS_ENABLED: flag(true),

  // ── v1 work pipeline (docs/BUILD_SPEC_V1.md) ────────────────────────────
  /** Enables POST /v1/dev/credits. Never set in production. */
  DEV_MODE: flag(false),
  /** Public testnet: /v1/dev/credits gives 10 test CLD once per wallet per day. Never on a value-bearing deployment. */
  TESTNET_CREDITS: flag(false),
  /** Testnet 3600 / 3600; mainnet 86400 / 604800 (docs/IMPL_SPEC_2026-10.md). */
  EPOCH_SECONDS: int(3600),
  VEST_B_SECONDS: int(3600),
  SUBSIDY_RHO: z.coerce.number().min(0).max(1).default(0.25),
  CLUSTER_N_MIN: int(3),
  CLUSTER_S_CAP: z.coerce.number().min(0).max(1).default(0.5),
  /** Initial/reset price in nano-CLD per tera-MAC; the hourly controller moves it from here. */
  PRICE_NCLD_PER_TMAC: int(14_000),
  /** Flat part of every job fee, µCLD. */
  BASE_FEE_UCLD: int(1000),
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
  MIN_AGENT_VERSION: z.string().default("1.1.0"),
  IMAGE_ALLOWLIST: z.string().optional(),

  // ── V3 hosting (docs/V3_CONTRACT.md §3–§4) ──────────────────────────────
  PRICE_HOSTING_UCLD_PER_HOUR: int(50),
  PRICE_CPU_UCLD_PER_HOUR: int(200),
  PRICE_MEM_UCLD_PER_GB_HOUR: int(100),
  PRICE_STORAGE_UCLD_PER_GB_HOUR: int(20),
  // Workstations (docs/WORKSTATIONS.md §2): per GPU per hour, by class; volume per GB-hour.
  PRICE_GPU_CONSUMER_UCLD_PER_HOUR: int(2000),
  PRICE_GPU_DATACENTER_UCLD_PER_HOUR: int(6000),
  PRICE_VOLUME_UCLD_PER_GB_HOUR: int(2),
  /** Fraction taken off an interruptible workstation's price. */
  INTERRUPTIBLE_DISCOUNT: z.coerce.number().min(0).max(1).default(0.5),
  /** Seconds between uptime probes of one deployment. */
  DEPLOY_PROBE_SECONDS: int(60),
  /** Consecutive failed probes before a deployment is marked unreachable (billing pauses). */
  DEPLOY_PROBE_FAILS: int(3),

  // ── Payments ─────────────────────────────────────────────────────────────
  CLD_USD_RATE: z.coerce.number().positive().default(100),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // ── Storage / IPFS ───────────────────────────────────────────────────────
  PINATA_JWT: z.string().optional(),
  PINATA_GATEWAY: z.string().url().default("https://gateway.pinata.cloud/ipfs/"),
  IPFS_GATEWAY: z.string().url().default("https://gateway.pinata.cloud"),

  // ── Akash bridge ─────────────────────────────────────────────────────────
  AKASH_BRIDGE_ENABLED: flag(false),
  AKASH_MNEMONIC: z.string().optional(),
  AKASH_RPC_URL: z.string().url().default("https://rpc.akashnet.net:443"),
  AKASH_REST_URL: z.string().url().default("https://api.akashnet.net"),
  AKASH_LCD_URL: z.string().url().default("https://rest.cosmos.directory/akash"),
  AKASH_CHAIN_ID: z.string().default("akashnet-2"),
  AKASH_NETWORK: z.string().optional(),
  AKASH_GAS_PRICE: z.string().default("0.025uakt"),
  AKASH_DEPOSIT_UAKT: z.string().default("500000"),
  AKASH_BID_TIMEOUT_MS: int(120_000),
  AKASH_NODE_STATUS_CHECK: z.string().default(""),
  AKASH_VERSION: z.string().default("v1.0.0"),

  // ── Provider build toolchain ─────────────────────────────────────────────
  HELM_VERSION: z.string().optional(),
  INGRESS_NGINX_VERSION: z.string().default("4.11.3"),
  PROVIDER_SERVICES_VERSION: z.string().default("v0.10.1"),
  PROVIDER_PRICE_SCRIPT_URL: z
    .string()
    .url()
    .default(
      "https://raw.githubusercontent.com/akash-network/helm-charts/main/charts/akash-provider/scripts/price_script_generic.sh"
    ),
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
