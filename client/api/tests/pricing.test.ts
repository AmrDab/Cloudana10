import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll } from "vitest";
import { getD1 } from "../src/lib/storage.js";
import { feeUcld, getPriceQuote, runPriceControllerCron, stepPrice, QUOTE_LOCK_MS } from "../src/services/pricing.service.js";
import { migratePriceUnit } from "../src/lib/schema.js";

describe("job fee", () => {
  it("is BASE_FEE + ceil(units × nCLD/TMAC / 1e15) µCLD", () => {
    expect(feeUcld(16 ** 3, 14_000, 1000)).toBe(1001); // 5.7e-8 µCLD of work rounds up to 1
    expect(feeUcld(256 ** 3, 14_000, 1000)).toBe(1001);
    expect(feeUcld(0, 14_000, 1000)).toBe(1000); // base fee only
    expect(feeUcld(1e12, 1000, 1000)).toBe(1001); // exact: 1 TMAC × 1000 nCLD = 1 µCLD
    expect(feeUcld(1e12 + 1, 1000, 1000)).toBe(1002); // one MAC over → rounds up
    expect(feeUcld(1e18, 14_000, 0)).toBe(14_000_000); // 1e22 intermediate: exact in BigInt
    expect(feeUcld(1e12, 14_000, 0)).toBe(14); // 14000 nCLD = 14 µCLD per TMAC
  });
});

describe("price controller step", () => {
  const s = { priceNusdPerTmac: 14_000, emaNusdPerTmac: 14_000 };

  it("holds when nothing was served", () => {
    expect(stepPrice(s, { servedMac: 0, capacityMac: 1e15 })).toEqual({ ...s, held: true, utilization: null });
  });

  it("is flat at the 70 % target and clamps to ±2 %", () => {
    expect(stepPrice(s, { servedMac: 70, capacityMac: 100 }).priceNusdPerTmac).toBe(14_000);
    expect(stepPrice(s, { servedMac: 100, capacityMac: 100 }).priceNusdPerTmac).toBe(14_280); // u=1 → +2 %
    expect(stepPrice(s, { servedMac: 1, capacityMac: 1e12 }).priceNusdPerTmac).toBe(13_720); // u≈0 → −2 %
    expect(stepPrice(s, { servedMac: 71, capacityMac: 100 }).priceNusdPerTmac).toBe(14_140); // +1 %
    expect(stepPrice(s, { servedMac: 5, capacityMac: 0 }).utilization).toBe(1); // no capacity but work served → full
  });

  it("stays within [0.1, 10] × the 30-day EMA", () => {
    expect(stepPrice({ priceNusdPerTmac: 1000, emaNusdPerTmac: 14_000 }, { servedMac: 1, capacityMac: 1e12 }).priceNusdPerTmac).toBe(1400);
    expect(stepPrice({ priceNusdPerTmac: 150_000, emaNusdPerTmac: 14_000 }, { servedMac: 1, capacityMac: 1 }).priceNusdPerTmac).toBe(140_000);
  });

  it("moves the EMA by 1/720 of the gap", () => {
    const r = stepPrice(s, { servedMac: 100, capacityMac: 100 });
    expect(r.emaNusdPerTmac).toBeCloseTo(14_000 + 280 / 720, 6);
  });
});

describe("price controller cron + quote lock (SQLite)", () => {
  const T0 = 1_800_000 * 3_600_000; // an exact hour
  const node = "0x" + "ab".repeat(20);

  beforeAll(async () => {
    await setupV1Db({ PRICE_CONTROLLER: "on", PRICE_NUSD_PER_TMAC: "1400" });
    await getD1()
      .prepare("INSERT INTO nodes (address, payout, throughput_mmac_s, last_seen) VALUES (?, ?, ?, ?)")
      .bind(node, "0x" + "cd".repeat(20), 100, T0 - 1000) // 100 MMAC/s → 3.6e11 MAC/h capacity
      .run();
  });

  it("holds at idle, steps once per hour from served/capacity, and locks quotes for 5 minutes", async () => {
    expect(await runPriceControllerCron(undefined, T0)).toMatchObject({ ran: true, held: true, priceNusdPerTmac: 1400 });
    expect(await runPriceControllerCron(undefined, T0 + 60_000)).toEqual({ ran: false, reason: "already_stepped" });

    // Full utilization in the next hour: 3.6e11 MAC served against 3.6e11 capacity.
    const t1 = T0 + 3_600_000;
    await getD1()
      .prepare("INSERT INTO work_jobs (id, owner, work_type, n, a_json, b_json, price_ucld, status, created_at, completed_at) VALUES ('j', 'o', 'matmul', ?, '[]', '[]', 1001, 'done', ?, ?)")
      .bind(Math.round(Math.cbrt(3.6e11)), t1 - 10, t1 - 5)
      .run();
    await getD1().prepare("UPDATE nodes SET last_seen = ? WHERE address = ?").bind(t1 - 1, node).run();

    const q0 = await getPriceQuote(t1 - 1); // quote issued just before the step
    // $1,400 nano per TMAC at $0.10/CLD = 14,000 nCLD/TMAC; the $0.0001 base fee = 1,000 µCLD.
    expect(q0).toEqual({
      priceNusdPerTmac: 1400, usdPerCld: 0.1, priceNcldPerTmac: 14_000, baseFeeUsd: 0.0001, baseFeeUcld: 1000, expiresAt: t1 - 1 + QUOTE_LOCK_MS,
    });
    const step = await runPriceControllerCron(undefined, t1);
    expect(step).toMatchObject({ ran: true, held: false, priceNusdPerTmac: 1428 });
    expect((step as { utilization: number }).utilization).toBeCloseTo(1, 2);

    expect(await getPriceQuote(t1 + 1)).toEqual(q0); // still locked at the pre-step price
    expect(await getPriceQuote(t1 + QUOTE_LOCK_MS)).toMatchObject({ priceNusdPerTmac: 1428, priceNcldPerTmac: 14_280, expiresAt: t1 + 2 * QUOTE_LOCK_MS });
  });

  it("is a no-op with PRICE_CONTROLLER=off and quotes the env price", async () => {
    await setupV1Db({ PRICE_CONTROLLER: "off", PRICE_NUSD_PER_TMAC: "777" });
    expect(await runPriceControllerCron(undefined, T0)).toEqual({ ran: false, reason: "off" });
    expect(await getPriceQuote(T0)).toMatchObject({ priceNusdPerTmac: 777, priceNcldPerTmac: 7770 });
  });
});

describe("price unit migration (nano-CLD → nano-dollars)", () => {
  it("renames and converts a legacy price_state once, dropping an open quote", async () => {
    await setupV1Db({ USD_PER_CLD: "0.1" });
    const db = getD1();
    // Rebuild a pre-2026-10-13 table: nCLD columns, 14,280 nCLD with an open quote.
    await db.prepare("DROP TABLE price_state").run();
    await db
      .prepare(
        "CREATE TABLE price_state (id INTEGER PRIMARY KEY CHECK (id = 1), price_ncld_per_tmac INTEGER NOT NULL, " +
          "ema_ncld_per_tmac REAL NOT NULL, stepped_at INTEGER, quote_price INTEGER, quote_expires_at INTEGER)",
      )
      .run();
    await db.prepare("INSERT INTO price_state VALUES (1, 14280, 14000.5, 1, 14280, 9999999999999)").run();
    await db.prepare("DELETE FROM schema_meta WHERE key = 'price_unit'").run();
    await migratePriceUnit(db);
    const row = await db.prepare("SELECT * FROM price_state").first<Record<string, number | null>>();
    expect(row).toMatchObject({ id: 1, price_nusd_per_tmac: 1428, stepped_at: 1, quote_price: null, quote_expires_at: null });
    expect(row!.ema_nusd_per_tmac).toBeCloseTo(1400.05, 9);
    await migratePriceUnit(db); // recorded: never converts twice
    expect((await db.prepare("SELECT price_nusd_per_tmac AS p FROM price_state").first<{ p: number }>())!.p).toBe(1428);
  });
});
