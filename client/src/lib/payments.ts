// Payment API client functions for Cloudana
// Handles Stripe checkout sessions, CLD credit balances, and crypto deposits

const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/v1`
  : "http://localhost:7002/v1";

// ── Types ────────────────────────────────────────────────────────────────────

export interface PaymentBalance {
  cldCredits: number;        // CLD credit balance (platform credits, not on-chain)
  usdEquivalent: number;     // USD value of credit balance
  cldToUsdRate: number;      // Current conversion rate: 1 USD = X CLD
}

export interface Transaction {
  id: string;
  type: "card_deposit" | "crypto_deposit" | "deployment_charge" | "refund";
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

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

// ── Payment API functions ─────────────────────────────────────────────────────

/**
 * Create a Stripe Checkout session for adding funds.
 * @param amountUsd - Amount in USD (e.g. 10, 25, 50, 100)
 * @param walletAddress - User's wallet address (for credit assignment)
 * @returns Session ID and URL for redirect, or clientSecret for embedded form
 */
export async function createCheckoutSession(
  amountUsd: number,
  walletAddress?: string
): Promise<CheckoutSession> {
  return apiFetch<CheckoutSession>("/payments/checkout-session", {
    method: "POST",
    body: JSON.stringify({ amountUsd, walletAddress }),
  });
}

/**
 * Get the user's current CLD credit balance on the platform.
 * Credits are accumulated via card or crypto deposits and spent on deployments.
 */
export async function getBalance(walletAddress: string): Promise<PaymentBalance> {
  return apiFetch<PaymentBalance>(
    `/payments/balance?wallet=${encodeURIComponent(walletAddress)}`
  );
}

/**
 * Record a crypto deposit after the on-chain transaction is confirmed.
 * Backend verifies the tx on-chain and credits the account.
 * @param txHash - On-chain transaction hash
 * @param amountCld - Amount of CLD tokens sent
 * @param walletAddress - Sender wallet address
 */
export async function depositCrypto(
  txHash: string,
  amountCld: number,
  walletAddress: string
): Promise<DepositCryptoResult> {
  return apiFetch<DepositCryptoResult>("/payments/deposit-crypto", {
    method: "POST",
    body: JSON.stringify({ txHash, amountCld, walletAddress }),
  });
}

/**
 * Fetch transaction history for a wallet address.
 */
export async function getTransactionHistory(
  walletAddress: string,
  limit = 10
): Promise<Transaction[]> {
  return apiFetch<Transaction[]>(
    `/payments/transactions?wallet=${encodeURIComponent(walletAddress)}&limit=${limit}`
  );
}

/**
 * Get current CLD/USD conversion rate.
 * 1 USD = X CLD credits on the platform.
 */
export async function getConversionRate(): Promise<{ usdToCld: number; cldToUsd: number }> {
  return apiFetch<{ usdToCld: number; cldToUsd: number }>("/payments/rate");
}

/**
 * Verify a Stripe checkout session after redirect return.
 * Returns whether payment was successful.
 */
export async function verifyCheckoutSession(
  sessionId: string
): Promise<{ success: boolean; creditsAdded?: number; newBalance?: number }> {
  return apiFetch<{ success: boolean; creditsAdded?: number; newBalance?: number }>(
    `/payments/verify-session?sessionId=${encodeURIComponent(sessionId)}`
  );
}
