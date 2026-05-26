-- Cloudana D1 Schema
-- Run: wrangler d1 execute cloudana-db --file=./schema.sql

-- User CLD credit balances
CREATE TABLE IF NOT EXISTS balances (
  address TEXT PRIMARY KEY,
  balance REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

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
