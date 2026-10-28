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
  pubkey TEXT,     -- uncompressed secp256k1 hex of the node key (sealed secrets)
  public_host TEXT, -- host the node announced; hosting endpoints must use exactly this host
  agent_version TEXT, -- work is refused below MIN_AGENT_VERSION
  relay_at INTEGER,   -- last heartbeat with an open relay socket (docs/V4_RELAY_CONTRACT.md)
  -- Storage phase 1 (docs/V4_STORAGE_PHASE1_CONTRACT.md §B)
  storage_quota_mb INTEGER NOT NULL DEFAULT 0, -- declared; effective = min(this, 1 GB × (1 + passed days))
  net_prefix TEXT, asn INTEGER,               -- /24 or /48 and ASN seen at announce / heartbeat (copy placement)
  storage_next_check_at INTEGER, storage_cooldown_until INTEGER, storage_backoff_until INTEGER,
  storage_strikes INTEGER NOT NULL DEFAULT 0, storage_passed_days INTEGER NOT NULL DEFAULT 0,
  storage_open_day INTEGER, storage_inconclusive INTEGER NOT NULL DEFAULT 0,
  -- Node state model (ENGINEERING_BACKLOG B-8): active | draining (owner: no new work) | suspended (admin: no work,
  -- live deployments re-queued, no relay ticket)
  state TEXT NOT NULL DEFAULT 'active', state_reason TEXT, state_at INTEGER
);

CREATE TABLE IF NOT EXISTS work_jobs (
  id TEXT PRIMARY KEY, owner TEXT, work_type TEXT, n INTEGER, a_json TEXT, b_json TEXT,
  price_ucld INTEGER, public INTEGER DEFAULT 1, status TEXT, node TEXT, sigma TEXT,
  seed_source TEXT, draw_seed TEXT, eligible_hash TEXT, cluster_ok INTEGER,
  assigned_at INTEGER, expires_at INTEGER, result_json TEXT, cert_z TEXT,
  created_at INTEGER, completed_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0, -- verification failures; 3 → failed, hold released
  artifact TEXT, -- R2 key once a finished job's matrices moved out of D1 (a_json/b_json/result_json then NULL)
  eligible_json TEXT, -- the eligible set the draw ran over (sorted Candidate[]), published for replay at /v1/draws/{id}
  fee_captured_at INTEGER, -- set in the same transaction that captures the fee and writes the rewards (submitWork)
  sample_check TEXT, -- sampled transcript re-execution (B-6): NULL = not sampled, 'passed', 'failed' or 'reversed' (claw undone)
  protocol INTEGER NOT NULL DEFAULT 0, -- 1 = issued by the orchestrator to an idle node (D1): owner 'protocol', price 0, lane B from the epoch budget
  -- Challenge-mode work (B-26): a non-matmul job's input, the node's commitment, the segments drawn after it was stored,
  -- the answer deadline, and the payout wallet at commit time that a failed challenge claws (all NULL for matmul).
  input_json TEXT, commitment_json TEXT, challenge_json TEXT, challenge_expires_at INTEGER, commit_payout TEXT,
  -- With an artifact store the input lives there instead (input_json NULL): its key and sha256 of its JSON.
  input_ref TEXT, input_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_work_jobs_status ON work_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_work_jobs_owner ON work_jobs(owner, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_jobs_node ON work_jobs(node, status);
CREATE INDEX IF NOT EXISTS idx_work_jobs_completed ON work_jobs(status, completed_at DESC);

CREATE TABLE IF NOT EXISTS reward_entries (
  id TEXT PRIMARY KEY, job_id TEXT, epoch INTEGER, address TEXT, lane TEXT, work_type TEXT,
  amount_ucld INTEGER, vests_at INTEGER, status TEXT, created_at INTEGER,
  units INTEGER -- protocol work (D1): verified MACs; amount_ucld is set from the epoch's remaining budget at close
);
CREATE INDEX IF NOT EXISTS idx_reward_entries_address ON reward_entries(address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reward_entries_epoch ON reward_entries(epoch, status);
CREATE INDEX IF NOT EXISTS idx_reward_entries_job ON reward_entries(job_id);
-- Which failed sampled checks (work_jobs.id) cover which clawed entry: an entry stays clawed while any claw covers it, so
-- reversing one claw never restores pay another still holds back; entries clawed another way have no row.
CREATE TABLE IF NOT EXISTS reward_claws (entry_id TEXT NOT NULL, job_id TEXT NOT NULL, PRIMARY KEY (entry_id, job_id));
CREATE INDEX IF NOT EXISTS idx_reward_claws_job ON reward_claws(job_id);

-- Datacenter fleets. token_hash = sha256(token); the token is shown once at creation.
-- floor_ucld_per_mmac is stored for the owner but not yet used by placement.
CREATE TABLE IF NOT EXISTS fleets (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT, token_hash TEXT UNIQUE NOT NULL,
  floor_ucld_per_mmac INTEGER, created_at INTEGER, revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_fleets_owner ON fleets(owner, created_at);

-- Settlement v2: mint_a/mint_b = lane totals, treasury_ucld is posted as an amount (not a leaf), root is computed at close.
CREATE TABLE IF NOT EXISTS epochs (
  id INTEGER PRIMARY KEY, closed_at INTEGER, fees_burned_ucld INTEGER, mint_a_ucld INTEGER,
  mint_b_ucld INTEGER, leaves_json TEXT, root TEXT, tx_hash TEXT, status TEXT,
  treasury_ucld INTEGER, settled_at INTEGER,
  vetoed_root TEXT -- the root the guardian vetoed: the epoch is parked while a close would rebuild it (D3)
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
  purge_pending INTEGER NOT NULL DEFAULT 0, -- 1 = node owes a "purge" (container + volume removed)
  probe_path TEXT, probe_hash TEXT,        -- static: file + sha256 the 60 s probe must match; endpoints: the health path
  relayed INTEGER NOT NULL DEFAULT 0,      -- 1 = served through the node's relay socket (no public endpoint)
  parent_id TEXT,                          -- GPU endpoint replica: the endpoint (parent) row it belongs to
  replicas INTEGER NOT NULL DEFAULT 0,     -- > 0 = a GPU endpoint (parent row; never on a node; docs/V4_ENDPOINTS_CONTRACT.md)
  last_logs TEXT,                          -- the node's `docker logs` tail from its last failed report
  last_ok_at INTEGER,                      -- last passing probe: an outage from here on is not charged
  probe_inconclusive INTEGER NOT NULL DEFAULT 0, -- inconclusive probes in a row; the third counts as a failure
  start_attempts INTEGER NOT NULL DEFAULT 0, -- start timeouts so far (assigned, never reported); DEPLOY_START_ATTEMPTS of them fail it
  seal_timeouts INTEGER NOT NULL DEFAULT 0 -- endpoint replica re-queues for secrets never sealed; DEPLOY_START_ATTEMPTS abandon the endpoint
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
-- Guards one-off data migrations (key 'epoch_seconds' = the EPOCH_SECONDS reward_entries.epoch was computed with).
CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- Price controller state (docs/IMPL_SPEC_2026-10.md): one row, id = 1.
CREATE TABLE IF NOT EXISTS price_state (
  id INTEGER PRIMARY KEY CHECK (id = 1), price_nusd_per_tmac INTEGER NOT NULL, ema_nusd_per_tmac REAL NOT NULL,
  stepped_at INTEGER, quote_price INTEGER, quote_expires_at INTEGER
);

-- Testnet credit caps (routes/v1/dev.ts): one row per wallet / IP bucket / ASN-day, claimed with an atomic upsert.
CREATE TABLE IF NOT EXISTS testnet_claims (key TEXT PRIMARY KEY, at INTEGER NOT NULL, n INTEGER NOT NULL DEFAULT 1);
-- Node request nonces (middleware/node-auth.ts): INSERT … ON CONFLICT DO NOTHING makes the replay check atomic.
CREATE TABLE IF NOT EXISTS node_nonces (key TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_node_nonces_expires ON node_nonces(expires_at);
-- Session revocation (POST /v1/auth/logout) and sign-in nonces live in D1, not KV: read with the request's other D1
-- work, never against the KV quota (middleware/auth.ts).
CREATE TABLE IF NOT EXISTS revoked_tokens (jti TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires ON revoked_tokens(expires_at);
CREATE TABLE IF NOT EXISTS login_nonces (key TEXT PRIMARY KEY, message TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_login_nonces_expires ON login_nonces(expires_at);
-- GPU endpoint keys (docs/V4_ENDPOINTS_CONTRACT.md): the key is shown once at create; only its sha256 is stored.
CREATE TABLE IF NOT EXISTS endpoint_keys (
  id TEXT PRIMARY KEY, deployment_id TEXT NOT NULL, name TEXT NOT NULL, prefix TEXT NOT NULL, hash TEXT NOT NULL,
  created_at INTEGER NOT NULL, revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_endpoint_keys_dep ON endpoint_keys(deployment_id, created_at);
-- Developer API keys (ENGINEERING_BACKLOG B-7): sha256 of the token, JSON scopes, optional expiry, revocation time.
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL, prefix TEXT NOT NULL, hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL, created_at INTEGER NOT NULL, last_used_at INTEGER, expires_at INTEGER, revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_api_keys_owner ON api_keys(owner, created_at DESC);
-- Report a problem (docs/V4_VERIFIED_SERVICES.md §5): one row per report; ≤ 5 per owner per UTC day.
CREATE TABLE IF NOT EXISTS deployment_reports (
  id TEXT PRIMARY KEY, deployment_id TEXT NOT NULL, owner TEXT NOT NULL, at INTEGER NOT NULL,
  probe_ok INTEGER, forgiven_ucld INTEGER NOT NULL DEFAULT 0, note TEXT
);
CREATE INDEX IF NOT EXISTS idx_deployment_reports_owner ON deployment_reports(owner, at);
-- Storage phase 1 (docs/V4_STORAGE_PHASE1_CONTRACT.md §B): objects (job artifacts), provider copies, node-day checks.
CREATE TABLE IF NOT EXISTS storage_objects (
  id TEXT PRIMARY KEY,            -- the artifact's R2 key
  size INTEGER NOT NULL,          -- plaintext bytes
  leaves INTEGER NOT NULL,        -- 64 KiB leaves (the verifier's own count; the root does not bind it)
  created_at INTEGER NOT NULL,
  next_attempt_at INTEGER         -- non-null while copies are missing
);
CREATE INDEX IF NOT EXISTS idx_storage_objects_due ON storage_objects(next_attempt_at) WHERE next_attempt_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS storage_copies (
  id TEXT PRIMARY KEY, object_id TEXT NOT NULL, copy_idx INTEGER NOT NULL, node TEXT NOT NULL,
  nonce TEXT NOT NULL,            -- 8 random bytes (hex): the copy's IV prefix
  root TEXT NOT NULL,             -- Merkle root of the copy's ciphertext
  state TEXT NOT NULL,            -- pending | held | suspect | dropping
  fetches INTEGER NOT NULL DEFAULT 0, assigned_at INTEGER NOT NULL, held_at INTEGER, checked_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_storage_copies_live ON storage_copies(object_id, copy_idx) WHERE state <> 'dropping';
CREATE INDEX IF NOT EXISTS idx_storage_copies_node ON storage_copies(node, state);
CREATE INDEX IF NOT EXISTS idx_storage_copies_object ON storage_copies(object_id, state);
CREATE INDEX IF NOT EXISTS idx_storage_copies_pending ON storage_copies(assigned_at) WHERE state = 'pending';
CREATE INDEX IF NOT EXISTS idx_storage_copies_suspect ON storage_copies(checked_at) WHERE state = 'suspect';
CREATE INDEX IF NOT EXISTS idx_storage_objects_created ON storage_objects(created_at);
CREATE TABLE IF NOT EXISTS storage_checks (
  node TEXT NOT NULL, day INTEGER NOT NULL, samples INTEGER NOT NULL DEFAULT 0, misses INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (node, day)
);
CREATE INDEX IF NOT EXISTS idx_work_jobs_unmoved ON work_jobs(completed_at) WHERE status = 'done' AND artifact IS NULL;
