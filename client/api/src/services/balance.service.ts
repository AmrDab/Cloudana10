/**
 * Balance Service — CLD credit balance tracking for Cloudana users.
 *
 * Storage: file-based JSON persistence (survives restarts).
 * Each balance entry maps a wallet address → { balance, transactions[] }.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
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
// File-backed persistent store
// ─────────────────────────────────────────────────────────────────────────────

const DATA_DIR = resolve(process.cwd(), "data");
const BALANCES_FILE = resolve(DATA_DIR, "balances.json");
const TRANSACTIONS_FILE = resolve(DATA_DIR, "transactions.json");

const balanceStore = new Map<string, UserBalance>();
const txStore = new Map<string, Transaction[]>();

/** Load persisted data from disk on startup. */
function loadFromDisk(): void {
  try {
    if (existsSync(BALANCES_FILE)) {
      const raw = JSON.parse(readFileSync(BALANCES_FILE, "utf-8")) as Record<string, UserBalance>;
      for (const [key, val] of Object.entries(raw)) {
        balanceStore.set(key, { ...val, updatedAt: new Date(val.updatedAt) });
      }
      L.info(`[Balance] Loaded ${balanceStore.size} balances from disk`);
    }
    if (existsSync(TRANSACTIONS_FILE)) {
      const raw = JSON.parse(readFileSync(TRANSACTIONS_FILE, "utf-8")) as Record<string, Transaction[]>;
      for (const [key, txs] of Object.entries(raw)) {
        txStore.set(key, txs.map((tx) => ({ ...tx, timestamp: new Date(tx.timestamp) })));
      }
      L.info(`[Balance] Loaded transactions for ${txStore.size} users from disk`);
    }
  } catch (err) {
    L.error("[Balance] Failed to load persisted data, starting fresh:", err);
  }
}

/** Persist current state to disk. */
function saveToDisk(): void {
  try {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }
    writeFileSync(
      BALANCES_FILE,
      JSON.stringify(Object.fromEntries(balanceStore), null, 2),
    );
    writeFileSync(
      TRANSACTIONS_FILE,
      JSON.stringify(Object.fromEntries(txStore), null, 2),
    );
  } catch (err) {
    L.error("[Balance] Failed to persist data to disk:", err);
  }
}

// Load on module init
loadFromDisk();

function normalizeAddress(address: string): string {
  return address.toLowerCase().trim();
}

function generateTxId(): string {
  return `tx_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function getOrCreateBalance(address: string): UserBalance {
  const key = normalizeAddress(address);
  if (!balanceStore.has(key)) {
    const entry: UserBalance = { address: key, balance: 0, updatedAt: new Date() };
    balanceStore.set(key, entry);
  }
  return balanceStore.get(key)!;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the current CLD credit balance for a user.
 */
export async function getUserBalance(address: string): Promise<UserBalance> {
  return getOrCreateBalance(address);
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
  const entry = getOrCreateBalance(key);
  entry.balance += amount;
  entry.updatedAt = new Date();
  balanceStore.set(key, entry);

  const tx: Transaction = {
    id: generateTxId(),
    address: key,
    type: "credit",
    amount,
    source,
    timestamp: new Date(),
    description: `${source} deposit: +${amount} CLD`,
    metadata,
  };

  const userTxs = txStore.get(key) ?? [];
  userTxs.push(tx);
  txStore.set(key, userTxs);

  saveToDisk();

  L.info(`[Balance] Credited ${amount} CLD to ${key} via ${source} (new balance: ${entry.balance})`);

  return { balance: entry, transaction: tx };
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
  const entry = getOrCreateBalance(key);

  if (entry.balance < amount) {
    throw new Error(
      `Insufficient CLD balance. Required: ${amount}, Available: ${entry.balance}`
    );
  }

  entry.balance -= amount;
  entry.updatedAt = new Date();
  balanceStore.set(key, entry);

  const tx: Transaction = {
    id: generateTxId(),
    address: key,
    type: "debit",
    amount,
    workloadId,
    timestamp: new Date(),
    description: `Workload deployment: -${amount} CLD (workload: ${workloadId})`,
  };

  const userTxs = txStore.get(key) ?? [];
  userTxs.push(tx);
  txStore.set(key, userTxs);

  saveToDisk();

  L.info(`[Balance] Debited ${amount} CLD from ${key} for workload ${workloadId} (new balance: ${entry.balance})`);

  return { balance: entry, transaction: tx };
}

/**
 * Get paginated transaction history for a user.
 */
export async function getTransactionHistory(
  address: string,
  options: { limit?: number; offset?: number } = {}
): Promise<{ transactions: Transaction[]; total: number }> {
  const key = normalizeAddress(address);
  const all = (txStore.get(key) ?? []).slice().reverse(); // newest first
  const { limit = 50, offset = 0 } = options;
  const transactions = all.slice(offset, offset + limit);
  return { transactions, total: all.length };
}
