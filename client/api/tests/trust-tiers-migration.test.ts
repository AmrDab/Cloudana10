/**
 * Trust tiers schema (AGENTS.md rule 2): a database made before tiers gets fleets.verified_at and account_suspensions
 * from ensureSchema(), keeps its rows, and running the migration again changes nothing.
 */
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

process.env.CLOUDANA_DB_PATH = ":memory:";
process.env.JWT_SECRET ??= "x".repeat(40);

describe("trust tiers migration", () => {
  it("adds verified_at (NULL on existing fleets) and the suspensions table, idempotently", async () => {
    // schema.sql as it was before tiers: no verified_at, no account_suspensions.
    const old = readFileSync(new URL("../schema.sql", import.meta.url), "utf8")
      .replace(/--[^\n]*/g, "")
      .replace(/revoked_at INTEGER,\s*verified_at INTEGER/, "revoked_at INTEGER") // the fleets table's
      .replace(/CREATE TABLE IF NOT EXISTS account_suspensions[^;]*;/, "");
    expect(old).not.toContain("account_suspensions"); // (fleets' columns are checked below)
    const file = path.join(mkdtempSync(path.join(tmpdir(), "cld-schema-")), "schema.sql");
    writeFileSync(file, old);

    const { initStorage, getD1 } = await import("../src/lib/storage.js");
    const { createSqliteD1, createSqliteKV } = await import("../src/lib/sqlite-d1.js");
    const d1 = createSqliteD1(pathToFileURL(file));
    const kv = createSqliteKV();
    initStorage(d1, kv);
    await d1.prepare("INSERT INTO fleets (id, owner, token_hash, created_at) VALUES ('flt_0000000000000001', '0xabc', 'h', 1)").run();

    const cols = async () => ((await getD1().prepare("SELECT name FROM pragma_table_info('fleets')").all<{ name: string }>()).results ?? []).map((c) => c.name);
    expect(await cols()).not.toContain("verified_at");

    await (await import("../src/lib/schema.js")).ensureSchema();
    expect(await cols()).toContain("verified_at");
    expect(await getD1().prepare("SELECT verified_at FROM fleets WHERE id = 'flt_0000000000000001'").first()).toEqual({ verified_at: null });
    await getD1().prepare("INSERT INTO account_suspensions (address, suspended_at, reason) VALUES ('0xabc', 1, 'test')").run();

    // A second isolate runs it again on the migrated database: nothing throws, nothing is lost.
    vi.resetModules();
    const again = await import("../src/lib/storage.js");
    again.initStorage(d1, kv);
    await (await import("../src/lib/schema.js")).ensureSchema();
    expect(await again.getD1().prepare("SELECT COUNT(*) AS n FROM account_suspensions").first()).toEqual({ n: 1 });
    expect(await again.getD1().prepare("SELECT COUNT(*) AS n FROM fleets").first()).toEqual({ n: 1 });
  });
});
