/**
 * Hosting-gateway columns on `deployments` (docs/IMPL_SPEC_2026-10.md "Hosting gateway").
 *
 *   probe_path  — the file the uptime probe fetches from the node endpoint (index.html, else the first file sorted)
 *   probe_hash  — sha256 hex of that file's bytes at upload; the probe requires the served bytes to match
 *
 * Both are set by deployments.service at static-site upload and read by deployment-duties.service's probe.
 * Idempotent ALTERs: run them the way lib/schema.ts runs BALANCE_COLUMNS (tolerate "duplicate column").
 * Integration: append to ensureSchema() and mirror in client/api/schema.sql.
 */
export const HOSTING_MIGRATIONS: string[] = [
  "ALTER TABLE deployments ADD COLUMN probe_path TEXT",
  "ALTER TABLE deployments ADD COLUMN probe_hash TEXT",
];
