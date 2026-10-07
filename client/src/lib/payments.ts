// Payment API client functions for Cloudana
// Handles the CLD credit balance and transaction history. Card checkout and the
// client-reported crypto deposit were removed for the testnet: card payments are
// off, and escrow deposits are credited by the API's Settlement `Deposited` watcher.

import { authFetch } from "@/lib/auth";
import { ApiError, readJson } from "@/lib/api-error";

// ── Types ────────────────────────────────────────────────────────────────────

export interface PaymentBalance {
  cldCredits: number;        // CLD credit balance (platform credits, not on-chain)
  usdEquivalent: number;     // USD value of credit balance
}

export interface Transaction {
  id: string;
  type: "card_deposit" | "crypto_deposit" | "promo_credit" | "deployment_charge";
  amountUsd?: number;
  amountCld: number;
  status: "pending" | "completed" | "failed";
  createdAt: string;         // ISO timestamp
  txHash?: string;           // On-chain tx hash for crypto deposits
  description?: string;
}

// Raw API shapes (see client/api/src/routes/v1/payments.ts)
interface ApiBalance {
  balance: number;
  usdEquivalent: number;
}

interface ApiTransaction {
  id: string;
  type: "credit" | "debit";
  amount: number;
  source?: "stripe" | "crypto" | "promo";
  description?: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

// ── API helpers ───────────────────────────────────────────────────────────────

/** Authenticated request (wallet JWT). Throws with the server's error message on failure. */
async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await authFetch(path, {
    credentials: "include",
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });

  try {
    return await readJson<T>(res, res.statusText || "Request failed");
  } catch (e) {
    if (e instanceof ApiError) e.message = `${e.status}: ${e.message}`;
    throw e;
  }
}

// ── Payment API functions ─────────────────────────────────────────────────────
// The wallet is identified by the JWT (lib/auth.ts); no address is sent.

/**
 * Get the user's current CLD credit balance on the platform.
 */
export async function getBalance(): Promise<PaymentBalance> {
  const data = await apiFetch<ApiBalance>("/payments/balance");
  return { cldCredits: data.balance, usdEquivalent: data.usdEquivalent };
}

/**
 * Fetch transaction history for the signed-in wallet.
 */
export async function getTransactionHistory(limit = 10, offset = 0): Promise<Transaction[]> {
  const data = await apiFetch<{ transactions: ApiTransaction[] }>(
    `/payments/history?limit=${limit}&offset=${offset}`
  );
  return data.transactions.map((tx) => ({
    id: tx.id,
    type:
      tx.type === "debit"
        ? "deployment_charge"
        : tx.source === "stripe"
          ? "card_deposit"
          : tx.source === "crypto"
            ? "crypto_deposit"
            : "promo_credit",
    amountCld: tx.amount,
    status: "completed",
    createdAt: tx.timestamp,
    txHash: typeof tx.metadata?.txHash === "string" ? tx.metadata.txHash : undefined,
    description: tx.description,
  }));
}
