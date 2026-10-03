/**
 * D1- and KV-shaped adapters over embedded SQLite (`node:sqlite`) for the Node
 * orchestrator.
 *
 * Services are written against the Cloudflare `D1Database` / `KVNamespace`
 * surface (`getD1()`, `getKV()` in lib/storage.ts). On the Worker those are real
 * bindings; on Node nothing initialised them, so every call threw and the
 * PoUW job queue and certificate store silently fell back to memory. These
 * adapters implement the subset the codebase uses — prepare/bind/first/all/run,
 * batch, exec; get/put/delete/list — so both runtimes share one storage path.
 *
 * Node-only: imports `node:sqlite`. Never import from worker.ts.
 */
import { readFileSync } from "node:fs";
import { getSqlite } from "./sqlite.js";

type Row = Record<string, unknown>;

function statement(sql: string, params: unknown[] = []) {
  const db = getSqlite();
  const stmt = () => db.prepare(sql);
  const p = params as never[];
  const runSync = () => {
    const r = stmt().run(...p);
    return {
      success: true,
      results: [],
      meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) },
    };
  };
  return {
    bind: (...args: unknown[]) => statement(sql, args),
    first: async <T = Row>(column?: string): Promise<T | null> => {
      const row = stmt().get(...p) as Row | undefined;
      if (!row) return null;
      return (column ? row[column] : row) as T;
    },
    all: async <T = Row>() => {
      const results = stmt().all(...p) as T[];
      return { results, success: true, meta: { rows_read: results.length } };
    },
    run: async () => runSync(),
    /** Synchronous run — lets batch() execute a whole transaction without yielding. */
    _runSync: () => runSync(),
    raw: async <T = unknown[]>() => stmt().all(...p).map((row) => Object.values(row as Row)) as T[],
  };
}

/** Build a D1Database-compatible object backed by the local SQLite file. */
export function createSqliteD1(schemaPath?: URL): D1Database {
  if (schemaPath) {
    // Same schema.sql the Worker applies to D1, so the tables match exactly.
    getSqlite().exec(readFileSync(schemaPath, "utf8"));
  }
  const d1 = {
    prepare: (sql: string) => statement(sql),
    exec: async (sql: string) => {
      getSqlite().exec(sql);
      return { count: 1, duration: 0 };
    },
    // Runs the whole transaction synchronously: an `await` between BEGIN and COMMIT
    // would let a concurrent batch start its own BEGIN and fail ("transaction within
    // a transaction"). D1 batches are atomic too, so this matches its semantics.
    batch: async <T = unknown>(stmts: Array<{ _runSync: () => T }>) => {
      const db = getSqlite();
      db.exec("BEGIN");
      try {
        const out: T[] = stmts.map((s) => s._runSync());
        db.exec("COMMIT");
        return out;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
    dump: async () => {
      throw new Error("dump() is not supported by the SQLite adapter");
    },
  };
  return d1 as unknown as D1Database;
}

/** Build a KVNamespace-compatible object backed by a `kv_store` table. */
export function createSqliteKV(): KVNamespace {
  const db = getSqlite();
  db.exec(
    "CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER)",
  );
  const now = () => Math.floor(Date.now() / 1000);
  const kv = {
    get: async (key: string) => {
      const row = db
        .prepare("SELECT value, expires_at FROM kv_store WHERE key = ?")
        .get(key) as { value: string; expires_at: number | null } | undefined;
      if (!row) return null;
      if (row.expires_at !== null && row.expires_at <= now()) {
        db.prepare("DELETE FROM kv_store WHERE key = ?").run(key);
        return null;
      }
      return row.value;
    },
    put: async (key: string, value: string, opts?: { expirationTtl?: number; expiration?: number }) => {
      const expires = opts?.expiration ?? (opts?.expirationTtl ? now() + opts.expirationTtl : null);
      db.prepare(
        "INSERT INTO kv_store (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at",
      ).run(key, String(value), expires);
    },
    delete: async (key: string) => {
      db.prepare("DELETE FROM kv_store WHERE key = ?").run(key);
    },
    list: async (opts?: { prefix?: string; limit?: number }) => {
      const rows = db
        .prepare("SELECT key FROM kv_store WHERE key LIKE ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY key LIMIT ?")
        .all(`${opts?.prefix ?? ""}%`, now(), opts?.limit ?? 1000) as Array<{ key: string }>;
      return { keys: rows.map((r) => ({ name: r.key })), list_complete: true, cacheStatus: null };
    },
  };
  return kv as unknown as KVNamespace;
}
