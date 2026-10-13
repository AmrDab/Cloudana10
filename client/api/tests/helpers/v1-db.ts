/** In-memory SQLite behind the D1 interface, with schema.sql + ensureSchema applied. */
process.env.CLOUDANA_DB_PATH = ":memory:";
process.env.JWT_SECRET ??= "x".repeat(40);
// Mechanics tests run at a small price scale (the pre-2026-10-13 µCLD table at $0.10/CLD: hosting 50, CPU 200, RAM 100,
// disk 20, volume 2, GPUs 2,000 / 6,000 µCLD per hour) so their credit fixtures stay small. tests/prices-usd.test.ts
// checks the real dollar defaults (docs/PRICES_USD.md).
const TEST_PRICES: Record<string, string> = {
  USD_PER_CLD: "0.1",
  PRICE_HOSTING_USD_PER_HOUR: "0.000005",
  PRICE_CPU_USD_PER_HOUR: "0.00002",
  PRICE_MEM_USD_PER_GB_HOUR: "0.00001",
  PRICE_STORAGE_USD_PER_GB_HOUR: "0.000002",
  PRICE_VOLUME_USD_PER_GB_HOUR: "0.0000002",
  PRICE_GPU_STANDARD_USD_PER_HOUR: "0.0002",
  PRICE_GPU_LARGE_USD_PER_HOUR: "0.0006",
  PRICE_GPU_H100_USD_PER_HOUR: "0.0006",
};
for (const [k, v] of Object.entries(TEST_PRICES)) process.env[k] ??= v;

import { initStorage } from "../../src/lib/storage.js";
import { createSqliteD1, createSqliteKV } from "../../src/lib/sqlite-d1.js";
import { ensureSchema } from "../../src/lib/schema.js";
import { resetEnv } from "../../src/config/env.js";

export async function setupV1Db(env: Record<string, string> = {}): Promise<void> {
  Object.assign(process.env, env);
  resetEnv();
  initStorage(createSqliteD1(new URL("../../schema.sql", import.meta.url)), createSqliteKV());
  await ensureSchema();
}
