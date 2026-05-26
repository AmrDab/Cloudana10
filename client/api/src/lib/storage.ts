/**
 * Cloudflare Workers storage bindings — D1 (SQL) and KV (key-value).
 * Initialized per-request via Hono middleware in worker.ts.
 * Service files call getD1() / getKV() just like the old getDb().
 */

let _db: D1Database | null = null;
let _kv: KVNamespace | null = null;

/** Call once per request from Hono middleware to set bindings. */
export function initStorage(db: D1Database, kv: KVNamespace) {
  _db = db;
  _kv = kv;
}

/** Get the D1 database binding. Throws if not initialized. */
export function getD1(): D1Database {
  if (!_db) throw new Error("D1 not initialized — check wrangler.toml bindings");
  return _db;
}

/** Get the KV namespace binding. Throws if not initialized. */
export function getKV(): KVNamespace {
  if (!_kv) throw new Error("KV not initialized — check wrangler.toml bindings");
  return _kv;
}
