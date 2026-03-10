/**
 * Balance Service — CLD credit balance tracking for Cloudana users.
 *
 * Storage: in-memory (Map) with interfaces designed for MongoDB drop-in replacement.
 * Each balance entry maps a wallet address → { balance, transactions[] }.
 */

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
// In-memory store (swap with MongoDB collections later)
// ─────────────────────────────────────────────────────────────────────────────

const balanceStore = new Map<string, UserBalance>();
const txStore = new Map<string, Transaction[]>();

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
