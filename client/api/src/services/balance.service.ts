/**
 * Balance Service — CLD credit balance tracking for Cloudana users.
 *
 * Storage: Cloudflare D1 (SQLite at the edge).
 * Tables: balances (address → balance), transactions (credit/debit log).
 */

import { getD1 } from "../lib/storage.js";
import { log } from "../lib/logger.js";

const L = log.api;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type TransactionSource = "stripe" | "crypto" | "promo";

export interface Transaction {
  id: string;
  address: string;
  type: "credit" | "debit";
  amount: number; // CLD
  source?: TransactionSource; // for credits
  workloadId?: string; // for debits
  description?: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface UserBalance {
  address: string;
  balance: number; // CLD
  updatedAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function normalizeAddress(address: string): string {
  return address.toLowerCase().trim();
}

function generateTxId(): string {
  return `tx_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the current CLD credit balance for a user.
 */
export async function getUserBalance(address: string): Promise<UserBalance> {
  const key = normalizeAddress(address);
  const db = getD1();
  const row = await db
    .prepare("SELECT address, balance, updated_at FROM balances WHERE address = ?")
    .bind(key)
    .first<{ address: string; balance: number; updated_at: string }>();

  if (row) {
    return { address: row.address, balance: row.balance, updatedAt: new Date(row.updated_at) };
  }
  return { address: key, balance: 0, updatedAt: new Date() };
}

/**
 * Add CLD credits to a user's balance.
 */
export async function creditBalance(
  address: string,
  amount: number,
  source: TransactionSource,
  metadata?: Record<string, unknown>
): Promise<{ balance: UserBalance; transaction: Transaction }> {
  if (amount <= 0) throw new Error("Credit amount must be positive");

  const key = normalizeAddress(address);
  const db = getD1();
  const now = new Date();
  const nowIso = now.toISOString();

  // Upsert balance (SQLite INSERT ... ON CONFLICT)
  await db
    .prepare(
      "INSERT INTO balances (address, balance, updated_at) VALUES (?, ?, ?) ON CONFLICT(address) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at"
    )
    .bind(key, amount, nowIso)
    .run();

  // Read back new balance
  const row = await db
    .prepare("SELECT balance FROM balances WHERE address = ?")
    .bind(key)
    .first<{ balance: number }>();
  const newBalance = row?.balance ?? amount;

  // Record transaction
  const tx: Transaction = {
    id: generateTxId(),
    address: key,
    type: "credit",
    amount,
    source,
    timestamp: now,
    description: `${source} deposit: +${amount} CLD`,
    metadata,
  };

  await db
    .prepare(
      "INSERT INTO transactions (id, address, type, amount, source, description, timestamp, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(tx.id, key, "credit", amount, source, tx.description!, nowIso, metadata ? JSON.stringify(metadata) : null)
    .run();

  L.info(`[Balance] Credited ${amount} CLD to ${key} via ${source} (new balance: ${newBalance})`);

  return { balance: { address: key, balance: newBalance, updatedAt: now }, transaction: tx };
}

/**
 * Deduct CLD credits for a workload deployment.
 * Throws if the user has insufficient funds.
 */
export async function debitBalance(
  address: string,
  amount: number,
  workloadId: string
): Promise<{ balance: UserBalance; transaction: Transaction }> {
  if (amount <= 0) throw new Error("Debit amount must be positive");

  const key = normalizeAddress(address);
  const db = getD1();
  const now = new Date();
  const nowIso = now.toISOString();

  // Check current balance
  const current = await db
    .prepare("SELECT balance FROM balances WHERE address = ?")
    .bind(key)
    .first<{ balance: number }>();
  const currentBalance = current?.balance ?? 0;

  if (currentBalance < amount) {
    throw new Error(
      `Insufficient CLD balance. Required: ${amount}, Available: ${currentBalance}`
    );
  }

  // Debit (only if balance is still sufficient — guards against race)
  const result = await db
    .prepare(
      "UPDATE balances SET balance = balance - ?, updated_at = ? WHERE address = ? AND balance >= ? RETURNING balance"
    )
    .bind(amount, nowIso, key, amount)
    .first<{ balance: number }>();

  if (!result) {
    throw new Error(`Insufficient CLD balance (race condition). Required: ${amount}`);
  }

  const tx: Transaction = {
    id: generateTxId(),
    address: key,
    type: "debit",
    amount,
    workloadId,
    timestamp: now,
    description: `Workload deployment: -${amount} CLD (workload: ${workloadId})`,
  };

  await db
    .prepare(
      "INSERT INTO transactions (id, address, type, amount, source, workload_id, description, timestamp, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(tx.id, key, "debit", amount, null, workloadId, tx.description!, nowIso, null)
    .run();

  L.info(`[Balance] Debited ${amount} CLD from ${key} for workload ${workloadId} (new balance: ${result.balance})`);

  return { balance: { address: key, balance: result.balance, updatedAt: now }, transaction: tx };
}

/**
 * Get paginated transaction history for a user.
 */
export async function getTransactionHistory(
  address: string,
  options: { limit?: number; offset?: number } = {}
): Promise<{ transactions: Transaction[]; total: number }> {
  const key = normalizeAddress(address);
  const db = getD1();
  const { limit = 50, offset = 0 } = options;

  const countRow = await db
    .prepare("SELECT COUNT(*) as total FROM transactions WHERE address = ?")
    .bind(key)
    .first<{ total: number }>();
  const total = countRow?.total ?? 0;

  const rows = await db
    .prepare(
      "SELECT id, address, type, amount, source, workload_id, description, timestamp, metadata FROM transactions WHERE address = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?"
    )
    .bind(key, limit, offset)
    .all<{
      id: string;
      address: string;
      type: string;
      amount: number;
      source: string | null;
      workload_id: string | null;
      description: string | null;
      timestamp: string;
      metadata: string | null;
    }>();

  const transactions: Transaction[] = (rows.results ?? []).map((r) => ({
    id: r.id,
    address: r.address,
    type: r.type as "credit" | "debit",
    amount: r.amount,
    source: (r.source as TransactionSource) ?? undefined,
    workloadId: r.workload_id ?? undefined,
    description: r.description ?? undefined,
    timestamp: new Date(r.timestamp),
    metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
  }));

  return { transactions, total };
}
