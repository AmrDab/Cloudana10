/**
 * v1 work-pipeline tables (docs/BUILD_SPEC_V1.md §4), created at runtime so an
 * existing D1 / SQLite database picks them up without a manual migration.
 * The same statements are appended to schema.sql for fresh databases.
 *
 * ensureSchema() runs once per isolate (the promise is cached on success) and is
 * idempotent: CREATE … IF NOT EXISTS, and ALTERs that tolerate "duplicate column".
 */
import { getD1 } from "./storage.js";
import { log } from "./logger.js";

export const V1_TABLES = [
  `CREATE TABLE IF NOT EXISTS nodes (
    address TEXT PRIMARY KEY, payout TEXT, manifest_json TEXT, work_types TEXT,
    throughput_mmac_s REAL DEFAULT 1, jobs_done INTEGER DEFAULT 0, jobs_failed INTEGER DEFAULT 0,
    announced_at INTEGER, bound_at INTEGER, last_seen INTEGER)`,
  `CREATE TABLE IF NOT EXISTS work_jobs (
    id TEXT PRIMARY KEY, owner TEXT, work_type TEXT, n INTEGER, a_json TEXT, b_json TEXT,
    price_ucld INTEGER, public INTEGER DEFAULT 1, status TEXT, node TEXT, sigma TEXT,
    seed_source TEXT, draw_seed TEXT, eligible_hash TEXT, cluster_ok INTEGER,
    assigned_at INTEGER, expires_at INTEGER, result_json TEXT, cert_z TEXT,
    created_at INTEGER, completed_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS idx_work_jobs_status ON work_jobs(status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_work_jobs_owner ON work_jobs(owner, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_work_jobs_node ON work_jobs(node, status)`,
  `CREATE INDEX IF NOT EXISTS idx_work_jobs_completed ON work_jobs(status, completed_at DESC)`,
  `CREATE TABLE IF NOT EXISTS reward_entries (
    id TEXT PRIMARY KEY, job_id TEXT, epoch INTEGER, address TEXT, lane TEXT, work_type TEXT,
    amount_ucld INTEGER, vests_at INTEGER, status TEXT, created_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS idx_reward_entries_address ON reward_entries(address, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_reward_entries_epoch ON reward_entries(epoch, status)`,
  `CREATE TABLE IF NOT EXISTS epochs (
    id INTEGER PRIMARY KEY, closed_at INTEGER, fees_burned_ucld INTEGER, mint_a_ucld INTEGER,
    mint_b_ucld INTEGER, leaves_json TEXT, root TEXT, tx_hash TEXT, status TEXT)`,
  `CREATE TABLE IF NOT EXISTS verify_tasks (
    id TEXT PRIMARY KEY, job_id TEXT, n INTEGER, a_json TEXT, b_json TEXT, c_json TEXT,
    planted INTEGER, expected TEXT, created_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS verify_verdicts (
    id TEXT PRIMARY KEY, task_id TEXT, session TEXT, address TEXT, verdict TEXT,
    correct INTEGER, created_at INTEGER)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_verify_verdicts_once ON verify_verdicts(task_id, session)`,
  `CREATE TABLE IF NOT EXISTS waitlist (
    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('use','provide','verify','datacenter','partner')),
    name TEXT, company TEXT, country TEXT, interests TEXT, details TEXT,
    newsletter INTEGER NOT NULL DEFAULT 0, ref_code TEXT UNIQUE NOT NULL,
    referred_by TEXT, source TEXT, created_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS idx_waitlist_referred_by ON waitlist(referred_by)`,
  // Datacenter fleets: a node announcing with a fleet token binds to the owner's payout.
  // Only sha256(token) is stored; the token itself is shown once at creation.
  `CREATE TABLE IF NOT EXISTS fleets (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT, token_hash TEXT UNIQUE NOT NULL,
    floor_ucld_per_mmac INTEGER, created_at INTEGER, revoked_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS idx_fleets_owner ON fleets(owner, created_at)`,
  // V3 hosting (docs/V3_CONTRACT.md §2). held_ucld = µCLD currently held for the running hour;
  // stop_acked_at = when the node confirmed a stop (NULL while a stop is still owed to the node).
  `CREATE TABLE IF NOT EXISTS deployments (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, template_id TEXT, name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('static','container')),
    spec_json TEXT NOT NULL, sealed_env TEXT, price_ucld_per_hour INTEGER NOT NULL,
    status TEXT NOT NULL, status_reason TEXT, node TEXT, endpoint TEXT,
    assigned_at INTEGER, started_at INTEGER, stopped_at INTEGER,
    last_billed_at INTEGER, last_probe_at INTEGER, probe_fail INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL, held_ucld INTEGER NOT NULL DEFAULT 0, stop_acked_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS idx_deployments_owner ON deployments(owner, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_deployments_node ON deployments(node, status)`,
  `CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status, created_at)`,
  `CREATE TABLE IF NOT EXISTS deployment_events (
    id TEXT PRIMARY KEY, deployment_id TEXT NOT NULL, at INTEGER NOT NULL, level TEXT NOT NULL, message TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_deployment_events ON deployment_events(deployment_id, at DESC)`,
  // One row per hosting charge; reward_entries.job_id = deployment_bills.id, so epoch close can burn the fee.
  `CREATE TABLE IF NOT EXISTS deployment_bills (
    id TEXT PRIMARY KEY, deployment_id TEXT NOT NULL, owner TEXT NOT NULL, node TEXT, provider TEXT,
    fee_ucld INTEGER NOT NULL, billed_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_deployment_bills_dep ON deployment_bills(deployment_id, billed_at DESC)`,
  // A node that went offline and lost its deployments to the queue is owed a "stop" for each, until it confirms.
  `CREATE TABLE IF NOT EXISTS deployment_stale_nodes (
    deployment_id TEXT NOT NULL, node TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (deployment_id, node))`,
  `CREATE INDEX IF NOT EXISTS idx_deployment_stale_nodes_node ON deployment_stale_nodes(node)`,
];

const BALANCE_COLUMNS = [
  "ALTER TABLE balances ADD COLUMN balance_ucld INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE balances ADD COLUMN held_ucld INTEGER NOT NULL DEFAULT 0",
  // One-time bind code: only the node operator sees it (printed by the agent), so
  // knowing a node's address is not enough to claim its payouts.
  "ALTER TABLE nodes ADD COLUMN bind_code TEXT",
  // Set when a node joined through a fleet token (datacenter onboarding).
  "ALTER TABLE nodes ADD COLUMN fleet_id TEXT",
  // Uncompressed secp256k1 public key of the node's identity key (sealed secrets, V3 §6).
  "ALTER TABLE nodes ADD COLUMN pubkey TEXT",
  // Workstations (docs/WORKSTATIONS.md): stored as kind 'container' (the kind CHECK cannot be altered
  // in place) with workstation = 1; ssh_endpoint = "host:port" reported by the node.
  "ALTER TABLE deployments ADD COLUMN workstation INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE deployments ADD COLUMN ssh_endpoint TEXT",
  // Workstation web token the node could not put in the URL (code-server password); owner-only.
  "ALTER TABLE deployments ADD COLUMN web_token TEXT",
  // 1 = the owner asked to delete the workstation's volume too: the node gets action "purge" until it confirms.
  "ALTER TABLE deployments ADD COLUMN purge_pending INTEGER NOT NULL DEFAULT 0",
];

// One-time move of the legacy REAL balance into integer µCLD. Zeroing `balance`
// in the same statement makes it run at most once per row.
const MIGRATE_BALANCES =
  "UPDATE balances SET balance_ucld = CAST(ROUND(balance * 1000000) AS INTEGER), balance = 0 " +
  "WHERE balance_ucld = 0 AND balance > 0";

let ready: Promise<void> | null = null;

async function run(): Promise<void> {
  const db = getD1();
  for (const sql of V1_TABLES) await db.prepare(sql).run();
  for (const sql of BALANCE_COLUMNS) {
    try {
      await db.prepare(sql).run();
    } catch (err) {
      if (!/duplicate column/i.test(String(err instanceof Error ? err.message : err))) throw err;
    }
  }
  await db.prepare(MIGRATE_BALANCES).run();
}

/** Create/upgrade the v1 tables once per isolate. Retries on the next call if it failed. */
export function ensureSchema(): Promise<void> {
  if (!ready) {
    ready = run().catch((err) => {
      ready = null;
      log.api.error("[schema] ensureSchema failed:", err);
      throw err;
    });
  }
  return ready;
}
