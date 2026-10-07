/**
 * Job pricing and the hourly price controller (docs/IMPL_SPEC_2026-10.md "Units", "Price controller").
 *
 * Price unit: nano-CLD per tera-MAC (integer). Job fee in µCLD:
 *   fee = BASE_FEE_UCLD + ceil(units_mac × price / 1e15)       (1e15 = 1e12 MAC/TMAC × 1e3 nCLD/µCLD)
 *
 * Controller (once per hour, state in D1 `price_state`): u = served MAC / eligible capacity MAC over
 * the last hour; served = 0 → hold; else p ← p·clamp(1 + (u − 0.7), 0.98, 1.02), kept within
 * [0.1, 10] × the 30-day EMA. Quotes are locked for 5 minutes and returned with `expiresAt`.
 */
import { getD1, initStorage } from "../lib/storage.js";
import { getEnv, resetEnv } from "../config/env.js";
import { ensureSchema } from "../lib/schema.js";
import { log } from "../lib/logger.js";

export const QUOTE_LOCK_MS = 5 * 60_000;
export const CONTROLLER_STEP_MS = 3_600_000;
/** Hourly EMA over 30 days. */
const EMA_ALPHA = 1 / 720;
const TARGET_UTILIZATION = 0.7;
const FLOOR_X = 0.1;
const CEILING_X = 10;

/** fee = base + ceil(unitsMac × priceNcldPerTmac / 1e15), all integers (µCLD). */
export function feeUcld(unitsMac: number, priceNcldPerTmac: number, baseFeeUcld: number): number {
  const num = BigInt(unitsMac) * BigInt(priceNcldPerTmac);
  const variable = (num + 999_999_999_999_999n) / 1_000_000_000_000_000n;
  return baseFeeUcld + Number(variable);
}

export interface PriceState {
  priceNcldPerTmac: number;
  emaNcldPerTmac: number;
}

export interface PriceStep extends PriceState {
  held: boolean;
  utilization: number | null;
}

/** One controller step (pure). servedMac = 0 holds everything. */
export function stepPrice(state: PriceState, input: { servedMac: number; capacityMac: number }): PriceStep {
  if (input.servedMac <= 0) return { ...state, held: true, utilization: null };
  const u = input.capacityMac > 0 ? input.servedMac / input.capacityMac : 1;
  const factor = Math.min(1.02, Math.max(0.98, 1 + (u - TARGET_UTILIZATION)));
  const floor = Math.max(1, Math.round(state.emaNcldPerTmac * FLOOR_X));
  const ceiling = Math.max(floor, Math.round(state.emaNcldPerTmac * CEILING_X));
  const price = Math.min(ceiling, Math.max(floor, Math.round(state.priceNcldPerTmac * factor)));
  const ema = state.emaNcldPerTmac + EMA_ALPHA * (price - state.emaNcldPerTmac);
  return { priceNcldPerTmac: price, emaNcldPerTmac: ema, held: false, utilization: u };
}

interface PriceRow {
  price_ncld_per_tmac: number;
  ema_ncld_per_tmac: number;
  stepped_at: number | null;
  quote_price: number | null;
  quote_expires_at: number | null;
}

async function loadState(): Promise<PriceRow> {
  const db = getD1();
  const initial = getEnv().PRICE_NCLD_PER_TMAC;
  await db
    .prepare("INSERT OR IGNORE INTO price_state (id, price_ncld_per_tmac, ema_ncld_per_tmac) VALUES (1, ?, ?)")
    .bind(initial, initial)
    .run();
  return (await db.prepare("SELECT * FROM price_state WHERE id = 1").first<PriceRow>())!;
}

export interface PriceQuote {
  priceNcldPerTmac: number;
  expiresAt: number;
}

/** The price jobs are charged at now; locked for QUOTE_LOCK_MS once issued. */
export async function getPriceQuote(now = Date.now()): Promise<PriceQuote> {
  const env = getEnv();
  if (env.PRICE_CONTROLLER === "off") return { priceNcldPerTmac: env.PRICE_NCLD_PER_TMAC, expiresAt: now + QUOTE_LOCK_MS };
  const row = await loadState();
  if (row.quote_price != null && row.quote_expires_at != null && row.quote_expires_at > now) {
    return { priceNcldPerTmac: row.quote_price, expiresAt: row.quote_expires_at };
  }
  const expiresAt = now + QUOTE_LOCK_MS;
  await getD1()
    .prepare("UPDATE price_state SET quote_price = ?, quote_expires_at = ? WHERE id = 1")
    .bind(row.price_ncld_per_tmac, expiresAt)
    .run();
  return { priceNcldPerTmac: row.price_ncld_per_tmac, expiresAt };
}

/** served MAC (verified jobs completed in the window) and eligible capacity MAC (bound nodes seen in the window). */
async function utilizationWindow(from: number, to: number): Promise<{ servedMac: number; capacityMac: number }> {
  const row = await getD1()
    .prepare(
      "SELECT (SELECT COALESCE(SUM(n * n * n), 0) FROM work_jobs WHERE status = 'done' AND completed_at >= ?1 AND completed_at < ?2) AS served, " +
        "(SELECT COALESCE(SUM(throughput_mmac_s), 0) FROM nodes WHERE payout IS NOT NULL AND last_seen >= ?1) AS mmac_s",
    )
    .bind(from, to)
    .first<{ served: number; mmac_s: number }>();
  return { servedMac: row?.served ?? 0, capacityMac: (row?.mmac_s ?? 0) * 1e6 * ((to - from) / 1000) };
}

/** Worker bindings → process.env + storage, the way worker.ts does per request. */
function bindWorkerEnv(env: Record<string, unknown>): void {
  let changed = false;
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string" && process.env[key] !== value) {
      process.env[key] = value;
      changed = true;
    }
  }
  if (changed) resetEnv();
  if (env.DB) initStorage(env.DB as D1Database, env.CLOUDANA_KV as KVNamespace);
}

export type ControllerRun =
  | { ran: false; reason: "off" | "already_stepped" }
  | ({ ran: true } & PriceStep);

/**
 * Cron entry: step the price at most once per clock hour (safe to call every 5 min).
 * `env` = Worker bindings when called from a scheduled handler; omit on Node.
 */
export async function runPriceControllerCron(env?: Record<string, unknown>, now = Date.now()): Promise<ControllerRun> {
  if (env) bindWorkerEnv(env);
  await ensureSchema();
  if (getEnv().PRICE_CONTROLLER === "off") return { ran: false, reason: "off" };
  const row = await loadState();
  const hour = Math.floor(now / CONTROLLER_STEP_MS);
  if (row.stepped_at != null && Math.floor(row.stepped_at / CONTROLLER_STEP_MS) >= hour) return { ran: false, reason: "already_stepped" };

  const window = await utilizationWindow(now - CONTROLLER_STEP_MS, now);
  const step = stepPrice({ priceNcldPerTmac: row.price_ncld_per_tmac, emaNcldPerTmac: row.ema_ncld_per_tmac }, window);
  // Conditional on the hour so two concurrent cron isolates cannot both step.
  const r = await getD1()
    .prepare(
      "UPDATE price_state SET price_ncld_per_tmac = ?, ema_ncld_per_tmac = ?, stepped_at = ? WHERE id = 1 AND (stepped_at IS NULL OR stepped_at < ?)",
    )
    .bind(step.priceNcldPerTmac, step.emaNcldPerTmac, now, hour * CONTROLLER_STEP_MS)
    .run();
  if ((r.meta?.changes ?? 0) === 0) return { ran: false, reason: "already_stepped" };
  log.api.info(
    `[price] ${step.held ? "hold (no work served)" : `u=${step.utilization!.toFixed(3)}`} → ${step.priceNcldPerTmac} nCLD/TMAC (ema ${step.emaNcldPerTmac.toFixed(1)})`,
  );
  return { ran: true, ...step };
}
