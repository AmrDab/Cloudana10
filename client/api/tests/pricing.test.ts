import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll } from "vitest";
import { getD1 } from "../src/lib/storage.js";
import { feeUcld, getPriceQuote, runPriceControllerCron, stepPrice, QUOTE_LOCK_MS } from "../src/services/pricing.service.js";

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
  const s = { priceNcldPerTmac: 14_000, emaNcldPerTmac: 14_000 };

  it("holds when nothing was served", () => {
    expect(stepPrice(s, { servedMac: 0, capacityMac: 1e15 })).toEqual({ ...s, held: true, utilization: null });
  });

  it("is flat at the 70 % target and clamps to ±2 %", () => {
    expect(stepPrice(s, { servedMac: 70, capacityMac: 100 }).priceNcldPerTmac).toBe(14_000);
    expect(stepPrice(s, { servedMac: 100, capacityMac: 100 }).priceNcldPerTmac).toBe(14_280); // u=1 → +2 %
    expect(stepPrice(s, { servedMac: 1, capacityMac: 1e12 }).priceNcldPerTmac).toBe(13_720); // u≈0 → −2 %
    expect(stepPrice(s, { servedMac: 71, capacityMac: 100 }).priceNcldPerTmac).toBe(14_140); // +1 %
    expect(stepPrice(s, { servedMac: 5, capacityMac: 0 }).utilization).toBe(1); // no capacity but work served → full
  });

  it("stays within [0.1, 10] × the 30-day EMA", () => {
    expect(stepPrice({ priceNcldPerTmac: 1000, emaNcldPerTmac: 14_000 }, { servedMac: 1, capacityMac: 1e12 }).priceNcldPerTmac).toBe(1400);
    expect(stepPrice({ priceNcldPerTmac: 150_000, emaNcldPerTmac: 14_000 }, { servedMac: 1, capacityMac: 1 }).priceNcldPerTmac).toBe(140_000);
  });

  it("moves the EMA by 1/720 of the gap", () => {
    const r = stepPrice(s, { servedMac: 100, capacityMac: 100 });
    expect(r.emaNcldPerTmac).toBeCloseTo(14_000 + 280 / 720, 6);
  });
});

describe("price controller cron + quote lock (SQLite)", () => {
  const T0 = 1_800_000 * 3_600_000; // an exact hour
  const node = "0x" + "ab".repeat(20);

  beforeAll(async () => {
    await setupV1Db({ PRICE_CONTROLLER: "on", PRICE_NCLD_PER_TMAC: "14000" });
    await getD1()
      .prepare("INSERT INTO nodes (address, payout, throughput_mmac_s, last_seen) VALUES (?, ?, ?, ?)")
      .bind(node, "0x" + "cd".repeat(20), 100, T0 - 1000) // 100 MMAC/s → 3.6e11 MAC/h capacity
      .run();
  });

  it("holds at idle, steps once per hour from served/capacity, and locks quotes for 5 minutes", async () => {
    expect(await runPriceControllerCron(undefined, T0)).toMatchObject({ ran: true, held: true, priceNcldPerTmac: 14_000 });
    expect(await runPriceControllerCron(undefined, T0 + 60_000)).toEqual({ ran: false, reason: "already_stepped" });

    // Full utilization in the next hour: 3.6e11 MAC served against 3.6e11 capacity.
    const t1 = T0 + 3_600_000;
    await getD1()
      .prepare("INSERT INTO work_jobs (id, owner, work_type, n, a_json, b_json, price_ucld, status, created_at, completed_at) VALUES ('j', 'o', 'matmul', ?, '[]', '[]', 1001, 'done', ?, ?)")
      .bind(Math.round(Math.cbrt(3.6e11)), t1 - 10, t1 - 5)
      .run();
    await getD1().prepare("UPDATE nodes SET last_seen = ? WHERE address = ?").bind(t1 - 1, node).run();

    const q0 = await getPriceQuote(t1 - 1); // quote issued just before the step
    expect(q0).toEqual({ priceNcldPerTmac: 14_000, expiresAt: t1 - 1 + QUOTE_LOCK_MS });
    const step = await runPriceControllerCron(undefined, t1);
    expect(step).toMatchObject({ ran: true, held: false, priceNcldPerTmac: 14_280 });
    expect((step as { utilization: number }).utilization).toBeCloseTo(1, 2);

    expect(await getPriceQuote(t1 + 1)).toEqual(q0); // still locked at the pre-step price
    expect(await getPriceQuote(t1 + QUOTE_LOCK_MS)).toEqual({ priceNcldPerTmac: 14_280, expiresAt: t1 + 2 * QUOTE_LOCK_MS });
  });

  it("is a no-op with PRICE_CONTROLLER=off and quotes the env price", async () => {
    await setupV1Db({ PRICE_CONTROLLER: "off", PRICE_NCLD_PER_TMAC: "777" });
    expect(await runPriceControllerCron(undefined, T0)).toEqual({ ran: false, reason: "off" });
    expect((await getPriceQuote(T0)).priceNcldPerTmac).toBe(777);
  });
});
