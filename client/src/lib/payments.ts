// Payment API client functions for Cloudana
// Handles Stripe checkout sessions, CLD credit balances, and crypto deposits

import { authFetch } from "@/lib/auth";
import { edgeApiBase } from "@/lib/api-base";
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

export interface CheckoutSession {
  sessionId: string;
  url: string;               // Stripe hosted checkout URL (for redirect flow)
  clientSecret?: string;     // For embedded Stripe Elements flow
}

export interface DepositCryptoResult {
  success: boolean;
  creditsAdded: number;
  newBalance: number;
  message?: string;
}

export interface CheckoutSessionStatus {
  sessionId: string;
  paymentStatus: "paid" | "unpaid" | "no_payment_required";
  cldAmount: number;
  amountUsd: number;
  userId: string;
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

interface ApiDeposit {
  cldCredited: number;
  newBalance: number;
}

interface ApiConvert {
  usd: number;
  cld: number;
  rate: number;
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
 * Create a Stripe Checkout session for adding funds.
 * @param amountUsd - Amount in USD (e.g. 10, 25, 50, 100)
 * @returns Session ID and URL for redirect
 */
export async function createCheckoutSession(amountUsd: number): Promise<CheckoutSession> {
  return apiFetch<CheckoutSession>("/payments/checkout", {
    method: "POST",
    body: JSON.stringify({ amountUsd }),
  });
}

/**
 * Get the user's current CLD credit balance on the platform.
 * Credits are accumulated via card or crypto deposits and spent on deployments.
 */
export async function getBalance(): Promise<PaymentBalance> {
  const data = await apiFetch<ApiBalance>("/payments/balance");
  return { cldCredits: data.balance, usdEquivalent: data.usdEquivalent };
}

/**
 * Record a crypto deposit after the on-chain transaction is confirmed.
 * Backend verifies the tx on-chain and credits the account.
 * @param txHash - On-chain transaction hash
 * @param amountCld - Amount of CLD tokens sent
 * @param chainId - Chain the transfer was sent on
 */
export async function depositCrypto(
  txHash: string,
  amountCld: number,
  chainId?: number
): Promise<DepositCryptoResult> {
  const data = await apiFetch<ApiDeposit>("/payments/deposit-crypto", {
    method: "POST",
    body: JSON.stringify({ txHash, cldAmount: amountCld, chainId }),
  });
  return { success: true, creditsAdded: data.cldCredited, newBalance: data.newBalance };
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

/**
 * Get current CLD/USD conversion rate.
 * 1 USD = X CLD credits on the platform.
 */
export async function getConversionRate(): Promise<{ usdToCld: number; cldToUsd: number }> {
  // Public route — must not trigger a wallet signature just to show a rate.
  const res = await fetch(`${edgeApiBase()}/payments/convert?usd=1`);
  if (!res.ok) throw new Error(`${res.status}: could not load conversion rate`);
  const data = (await res.json()) as ApiConvert;
  return { usdToCld: data.rate, cldToUsd: 1 / data.rate };
}

/**
 * Look up a Stripe checkout session after redirect return.
 */
export async function verifyCheckoutSession(sessionId: string): Promise<CheckoutSessionStatus> {
  return apiFetch<CheckoutSessionStatus>(`/payments/session/${encodeURIComponent(sessionId)}`);
}
