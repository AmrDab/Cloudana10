-- Cloudana D1 Schema
-- Run: wrangler d1 execute cloudana-db --file=./schema.sql

-- User CLD credit balances
CREATE TABLE IF NOT EXISTS balances (
  address TEXT PRIMARY KEY,
  balance REAL NOT NULL DEFAULT 0,   -- legacy float balance; migrated into balance_ucld once, then 0
  updated_at TEXT NOT NULL,
  balance_ucld INTEGER NOT NULL DEFAULT 0,  -- spendable, integer µCLD (1 CLD = 1,000,000 µCLD)
  held_ucld INTEGER NOT NULL DEFAULT 0      -- reserved for queued/running jobs
);
-- Databases created before the µCLD columns get them from src/lib/schema.ts (ALTER TABLE at runtime).

-- Credit/debit transaction history
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('credit', 'debit')),
  amount REAL NOT NULL,
  source TEXT,
  workload_id TEXT,
  description TEXT,
  timestamp TEXT NOT NULL,
  metadata TEXT
);
CREATE INDEX IF NOT EXISTS idx_transactions_address_ts ON transactions(address, timestamp DESC);

-- Replay protection for crypto deposits
CREATE TABLE IF NOT EXISTS processed_tx (
  tx_hash TEXT PRIMARY KEY,
  sender TEXT NOT NULL,
  amount REAL NOT NULL,
  processed_at TEXT NOT NULL
);

-- Template categories (ordered gallery)
CREATE TABLE IF NOT EXISTS template_categories (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_categories_order ON template_categories(sort_order);

-- Verified POUW certificates (mining proofs). UNIQUE(z) enforces replay protection.
CREATE TABLE IF NOT EXISTS pouw_certificates (
  id TEXT PRIMARY KEY,
  provider_address TEXT NOT NULL,
  device_id TEXT NOT NULL,
  matrix_size INTEGER NOT NULL,
  difficulty INTEGER NOT NULL,
  transcript_hash TEXT NOT NULL,
  z TEXT NOT NULL UNIQUE,
  timestamp INTEGER NOT NULL,
  verified_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pouw_certs_provider ON pouw_certificates(provider_address, verified_at DESC);
CREATE INDEX IF NOT EXISTS idx_pouw_certs_verified ON pouw_certificates(verified_at DESC);
-- Settlement outcome per certificate (added at runtime by certificate-store.service
-- via ALTER TABLE for databases created before these columns existed):
--   backed_by_workload INTEGER, workload_id TEXT,
--   reward_status TEXT ('paid'|'skipped'|'failed'|'disabled'|'not_configured'), reward_wei TEXT, reward_tx TEXT,
--   chain_status  TEXT ('recorded'|'pending'|'failed'|'not_configured'), chain_tx TEXT, chain_attempts INTEGER

-- Paid matrix jobs — the useful work that backs a full mining reward.
CREATE TABLE IF NOT EXISTS pouw_matrix_jobs (
  id TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  a_json TEXT NOT NULL,
  b_json TEXT NOT NULL,
  difficulty INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  provider TEXT,
  claimed_at INTEGER,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  result_json TEXT,
  result_hash TEXT,
  completed_at INTEGER,
  owner TEXT,            -- wallet that paid for the job (NULL = internal/filler seed)
  price_cld REAL         -- CLD credits debited on enqueue
);
CREATE INDEX IF NOT EXISTS idx_matrix_jobs_status ON pouw_matrix_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_matrix_jobs_owner ON pouw_matrix_jobs(owner, created_at DESC);

-- Deployment templates
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  readme TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  logo_url TEXT,
  deploy TEXT NOT NULL,
  guide TEXT,
  github_url TEXT NOT NULL DEFAULT '',
  persistent_storage_enabled INTEGER NOT NULL DEFAULT 0,
  config TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  FOREIGN KEY (category_id) REFERENCES template_categories(id)
);
CREATE INDEX IF NOT EXISTS idx_templates_category ON templates(category_id);

-- ─── v1 work pipeline (docs/BUILD_SPEC_V1.md §4) ─────────────────────────────
-- Mirrored by src/lib/schema.ts, which also creates these at runtime (IF NOT EXISTS).
-- Money is integer µCLD. work_jobs.status: queued → assigned → done | failed (expired → re-queued).
-- reward_entries.lane: A | B | treasury | verify; status: pending → posted → settled | clawed.

CREATE TABLE IF NOT EXISTS nodes (
  address TEXT PRIMARY KEY, payout TEXT, manifest_json TEXT, work_types TEXT,
  throughput_mmac_s REAL DEFAULT 1, jobs_done INTEGER DEFAULT 0, jobs_failed INTEGER DEFAULT 0,
  announced_at INTEGER, bound_at INTEGER, last_seen INTEGER,
  bind_code TEXT,  -- one-time code shown only to the node operator; required to bind, cleared after
  fleet_id TEXT,   -- set when the node joined through a fleet token
  pubkey TEXT      -- uncompressed secp256k1 hex of the node key (sealed secrets)
);

CREATE TABLE IF NOT EXISTS work_jobs (
  id TEXT PRIMARY KEY, owner TEXT, work_type TEXT, n INTEGER, a_json TEXT, b_json TEXT,
  price_ucld INTEGER, public INTEGER DEFAULT 1, status TEXT, node TEXT, sigma TEXT,
  seed_source TEXT, draw_seed TEXT, eligible_hash TEXT, cluster_ok INTEGER,
  assigned_at INTEGER, expires_at INTEGER, result_json TEXT, cert_z TEXT,
  created_at INTEGER, completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_work_jobs_status ON work_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_work_jobs_owner ON work_jobs(owner, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_jobs_node ON work_jobs(node, status);
CREATE INDEX IF NOT EXISTS idx_work_jobs_completed ON work_jobs(status, completed_at DESC);

CREATE TABLE IF NOT EXISTS reward_entries (
  id TEXT PRIMARY KEY, job_id TEXT, epoch INTEGER, address TEXT, lane TEXT, work_type TEXT,
  amount_ucld INTEGER, vests_at INTEGER, status TEXT, created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_reward_entries_address ON reward_entries(address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reward_entries_epoch ON reward_entries(epoch, status);

-- Datacenter fleets. token_hash = sha256(token); the token is shown once at creation.
-- floor_ucld_per_mmac is stored for the owner but not yet used by placement.
CREATE TABLE IF NOT EXISTS fleets (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT, token_hash TEXT UNIQUE NOT NULL,
  floor_ucld_per_mmac INTEGER, created_at INTEGER, revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_fleets_owner ON fleets(owner, created_at);

CREATE TABLE IF NOT EXISTS epochs (
  id INTEGER PRIMARY KEY, closed_at INTEGER, fees_burned_ucld INTEGER, mint_a_ucld INTEGER,
  mint_b_ucld INTEGER, leaves_json TEXT, root TEXT, tx_hash TEXT, status TEXT
);

CREATE TABLE IF NOT EXISTS verify_tasks (
  id TEXT PRIMARY KEY, job_id TEXT, n INTEGER, a_json TEXT, b_json TEXT, c_json TEXT,
  planted INTEGER, expected TEXT, created_at INTEGER
);

CREATE TABLE IF NOT EXISTS verify_verdicts (
  id TEXT PRIMARY KEY, task_id TEXT, session TEXT, address TEXT, verdict TEXT,
  correct INTEGER, created_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_verify_verdicts_once ON verify_verdicts(task_id, session);

-- ─── Waitlist (routes/v1/waitlist.ts) ─────────────────────────────────────────
-- Mirrored by src/lib/schema.ts. email is stored trimmed + lowercased.
-- interests: JSON array of service ids; details: JSON object (≤ 2 KB) of role-specific answers.
-- referred_by: another row's ref_code (only stored if it exists).
CREATE TABLE IF NOT EXISTS waitlist (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('use','provide','verify','datacenter','partner')),
  name TEXT, company TEXT, country TEXT, interests TEXT, details TEXT,
  newsletter INTEGER NOT NULL DEFAULT 0,
  ref_code TEXT UNIQUE NOT NULL,
  referred_by TEXT, source TEXT, created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_waitlist_referred_by ON waitlist(referred_by);

-- ─── V3 hosting (docs/V3_CONTRACT.md §2) ──────────────────────────────────────
-- Mirrored by src/lib/schema.ts. status: queued → assigned → running ⇄ unreachable → stopped | failed.
-- held_ucld: µCLD held for the current hour. stop_acked_at: NULL while a stop is still owed to the node.
CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL, template_id TEXT, name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('static','container')),
  spec_json TEXT NOT NULL,            -- ≤ 2 MB decoded for static, ≤ 32 KB for container
  sealed_env TEXT,                    -- ciphertext (base64), container only, optional
  price_ucld_per_hour INTEGER NOT NULL,
  status TEXT NOT NULL,               -- queued | assigned | running | unreachable | stopped | failed
  status_reason TEXT,
  node TEXT, endpoint TEXT,
  assigned_at INTEGER, started_at INTEGER, stopped_at INTEGER,
  last_billed_at INTEGER, last_probe_at INTEGER, probe_fail INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  held_ucld INTEGER NOT NULL DEFAULT 0,
  stop_acked_at INTEGER,
  workstation INTEGER NOT NULL DEFAULT 0,  -- 1 = workstation (kind stays 'container'; docs/WORKSTATIONS.md)
  ssh_endpoint TEXT,                      -- workstation sshd "host:port" reported by the node
  web_token TEXT,                         -- workstation web token not carried in the URL (owner-only)
  purge_pending INTEGER NOT NULL DEFAULT 0 -- 1 = node owes a "purge" (container + volume removed)
);
CREATE INDEX IF NOT EXISTS idx_deployments_owner ON deployments(owner, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deployments_node ON deployments(node, status);
CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status, created_at);
CREATE TABLE IF NOT EXISTS deployment_events (
  id TEXT PRIMARY KEY, deployment_id TEXT NOT NULL, at INTEGER NOT NULL, level TEXT NOT NULL, message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deployment_events ON deployment_events(deployment_id, at DESC);
-- One row per hosting charge; reward_entries.job_id = deployment_bills.id so epoch close burns the fee.
CREATE TABLE IF NOT EXISTS deployment_bills (
  id TEXT PRIMARY KEY, deployment_id TEXT NOT NULL, owner TEXT NOT NULL, node TEXT, provider TEXT,
  fee_ucld INTEGER NOT NULL, billed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deployment_bills_dep ON deployment_bills(deployment_id, billed_at DESC);
-- A node that went offline and lost its deployments to the queue is owed a "stop" for each, until it confirms.
CREATE TABLE IF NOT EXISTS deployment_stale_nodes (
  deployment_id TEXT NOT NULL, node TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (deployment_id, node)
);
CREATE INDEX IF NOT EXISTS idx_deployment_stale_nodes_node ON deployment_stale_nodes(node);
