/**
 * Node security migrations (docs/IMPL_SPEC_2026-10.md — "Node instruction signing",
 * "Node capabilities & hardening", "Hosting gateway" probe). Idempotent: every ALTER is
 * tolerated when the column already exists (ensureSchema ignores "duplicate column").
 * Integration wires NODE_SECURITY_MIGRATIONS into ensureSchema().
 */
export const NODE_SECURITY_MIGRATIONS: string[] = [
  // Host the node announced for its hosting endpoints; a reported endpoint must use exactly this host.
  "ALTER TABLE nodes ADD COLUMN public_host TEXT",
  // Agent version reported at announce; work is refused below MIN_AGENT_VERSION.
  "ALTER TABLE nodes ADD COLUMN agent_version TEXT",
  // deployments.probe_path / probe_hash (content-hash probe) live in db/migrations-hosting.ts (gateway workstream).
];
