/**
 * Local SQLite (Node 24 built-in `node:sqlite`) for the Node orchestrator's own state.
 * Zero native dependencies — portable to any arch and trivial to run in a container
 * (Akash) with a persistent volume. Path via CLOUDANA_DB_PATH (default ./data/cloudana.sqlite).
 *
 * This is the Node-runtime datastore (replaces the old MongoDB dependency). The
 * Cloudflare Worker edge API uses D1 instead and never imports this module.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

let db: DatabaseSync | null = null;

export function getSqlite(): DatabaseSync {
  if (db) return db;
  const path = process.env.CLOUDANA_DB_PATH ?? "./data/cloudana.sqlite";
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  return db;
}

export function closeSqlite(): void {
  if (db) {
    db.close();
    db = null;
  }
}
