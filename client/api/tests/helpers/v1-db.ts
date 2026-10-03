/** In-memory SQLite behind the D1 interface, with schema.sql + ensureSchema applied. */
process.env.CLOUDANA_DB_PATH = ":memory:";
process.env.JWT_SECRET ??= "x".repeat(40);

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
