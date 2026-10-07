/**
 * Balance Service — CLD credit balance tracking for Cloudana users.
 *
 * Storage: Cloudflare D1 (SQLite at the edge).
 * Tables: balances (address → balance_ucld / held_ucld), transactions (credit/debit log).
 *
 * Money is stored as integer µCLD (1 CLD = 1,000,000 µCLD). The CLD-denominated
 * functions below (getUserBalance, creditBalance, debitBalance) keep their old
 * signatures for the payments and legacy PoUW routes and convert at the edge;
 * new code uses the µCLD helpers (getBalanceUcld, creditUcld, hold, capture, release).
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

export const UCLD_PER_CLD = 1_000_000;

/** CLD (possibly fractional) → integer µCLD. */
export function cldToUcld(cld: number): number {
  return Math.round(cld * UCLD_PER_CLD);
}

/** Integer µCLD → CLD number, for API responses that still speak CLD. */
export function ucldToCld(ucld: number): number {
  return ucld / UCLD_PER_CLD;
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
    .prepare("SELECT address, balance_ucld, updated_at FROM balances WHERE address = ?")
    .bind(key)
    .first<{ address: string; balance_ucld: number; updated_at: string }>();

  if (row) {
    return { address: row.address, balance: ucldToCld(row.balance_ucld), updatedAt: new Date(row.updated_at) };
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
  const now = new Date();
  const { tx, statements } = creditBalanceStatements(key, amount, source, now, metadata);
  await getD1().batch(statements);
  const newBalance = ucldToCld((await getBalanceUcld(key)).balanceUcld);

  L.info(`[Balance] Credited ${amount} CLD to ${key} via ${source} (new balance: ${newBalance})`);

  return { balance: { address: key, balance: newBalance, updatedAt: now }, transaction: tx };
}

/**
 * The balance credit and its transaction row as unexecuted statements, so a caller can run them in one
 * `db.batch([...])` together with its own rows (D1 batches are transactional: all or nothing).
 */
export function creditBalanceStatements(
  address: string,
  amount: number,
  source: TransactionSource,
  now = new Date(),
  metadata?: Record<string, unknown>
): { tx: Transaction; statements: D1PreparedStatement[] } {
  if (amount <= 0) throw new Error("Credit amount must be positive");
  const key = normalizeAddress(address);
  const ucld = cldToUcld(amount);
  assertUcld(ucld);
  const nowIso = now.toISOString();
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
  const db = getD1();
  return {
    tx,
    statements: [
      db
        .prepare(
          "INSERT INTO balances (address, balance, updated_at, balance_ucld, held_ucld) VALUES (?, 0, ?, ?, 0) " +
            "ON CONFLICT(address) DO UPDATE SET balance_ucld = balance_ucld + excluded.balance_ucld, updated_at = excluded.updated_at"
        )
        .bind(key, nowIso, ucld),
      db
        .prepare(
          "INSERT INTO transactions (id, address, type, amount, source, description, timestamp, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(tx.id, key, "credit", amount, source, tx.description!, nowIso, metadata ? JSON.stringify(metadata) : null),
    ],
  };
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

  const ucld = cldToUcld(amount);
  const currentBalance = (await getBalanceUcld(key)).balanceUcld;
  if (currentBalance < ucld) {
    throw new Error(
      `Insufficient CLD balance. Required: ${amount}, Available: ${ucldToCld(currentBalance)}`
    );
  }

  // Debit (only if balance is still sufficient — guards against race)
  const debited = await db
    .prepare(
      "UPDATE balances SET balance_ucld = balance_ucld - ?, updated_at = ? WHERE address = ? AND balance_ucld >= ? RETURNING balance_ucld"
    )
    .bind(ucld, nowIso, key, ucld)
    .first<{ balance_ucld: number }>();

  if (!debited) {
    throw new Error(`Insufficient CLD balance (race condition). Required: ${amount}`);
  }
  const result = { balance: ucldToCld(debited.balance_ucld) };

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

// ─────────────────────────────────────────────────────────────────────────────
// Integer µCLD ledger (v1 work pipeline)
// ─────────────────────────────────────────────────────────────────────────────

export interface BalanceUcld {
  balanceUcld: number; // spendable
  heldUcld: number; // reserved for queued/running jobs
}

function assertUcld(ucld: number): void {
  if (!Number.isSafeInteger(ucld) || ucld <= 0) throw new Error(`µCLD amount must be a positive integer, got ${ucld}`);
}

export async function getBalanceUcld(address: string): Promise<BalanceUcld> {
  const row = await getD1()
    .prepare("SELECT balance_ucld, held_ucld FROM balances WHERE address = ?")
    .bind(normalizeAddress(address))
    .first<{ balance_ucld: number; held_ucld: number }>();
  return { balanceUcld: row?.balance_ucld ?? 0, heldUcld: row?.held_ucld ?? 0 };
}

/** Add spendable µCLD. Returns the new spendable balance. */
export async function creditUcld(address: string, ucld: number): Promise<number> {
  assertUcld(ucld);
  const row = await getD1()
    .prepare(
      "INSERT INTO balances (address, balance, updated_at, balance_ucld, held_ucld) VALUES (?, 0, ?, ?, 0) " +
        "ON CONFLICT(address) DO UPDATE SET balance_ucld = balance_ucld + excluded.balance_ucld, updated_at = excluded.updated_at " +
        "RETURNING balance_ucld"
    )
    .bind(normalizeAddress(address), new Date().toISOString(), ucld)
    .first<{ balance_ucld: number }>();
  return row?.balance_ucld ?? ucld;
}

/** Move µCLD from spendable to held. Returns the new balances, or null if funds are insufficient. */
export async function hold(address: string, ucld: number): Promise<BalanceUcld | null> {
  assertUcld(ucld);
  const row = await getD1()
    .prepare(
      "UPDATE balances SET balance_ucld = balance_ucld - ?, held_ucld = held_ucld + ?, updated_at = ? " +
        "WHERE address = ? AND balance_ucld >= ? RETURNING balance_ucld, held_ucld"
    )
    .bind(ucld, ucld, new Date().toISOString(), normalizeAddress(address), ucld)
    .first<{ balance_ucld: number; held_ucld: number }>();
  return row ? { balanceUcld: row.balance_ucld, heldUcld: row.held_ucld } : null;
}

/** Spend held µCLD (the fee is burned on-chain at epoch settlement). False if not enough is held. */
export async function capture(address: string, ucld: number): Promise<boolean> {
  assertUcld(ucld);
  const r = await getD1()
    .prepare("UPDATE balances SET held_ucld = held_ucld - ?, updated_at = ? WHERE address = ? AND held_ucld >= ?")
    .bind(ucld, new Date().toISOString(), normalizeAddress(address), ucld)
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

/** Return held µCLD to spendable. False if not enough is held. */
export async function release(address: string, ucld: number): Promise<boolean> {
  assertUcld(ucld);
  const r = await getD1()
    .prepare(
      "UPDATE balances SET held_ucld = held_ucld - ?, balance_ucld = balance_ucld + ?, updated_at = ? " +
        "WHERE address = ? AND held_ucld >= ?"
    )
    .bind(ucld, ucld, new Date().toISOString(), normalizeAddress(address), ucld)
    .run();
  return (r.meta?.changes ?? 0) > 0;
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
