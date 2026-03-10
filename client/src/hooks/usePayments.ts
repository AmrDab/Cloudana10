// Payment hooks — balance, add funds mutation, transaction history
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import {
  getBalance,
  createCheckoutSession,
  depositCrypto,
  getTransactionHistory,
  getConversionRate,
  type PaymentBalance,
  type Transaction,
  type CheckoutSession,
} from "@/lib/payments";

// ── Query keys ─────────────────────────────────────────────────────────────

export const paymentQueryKeys = {
  balance: (wallet: string) => ["payments", "balance", wallet] as const,
  transactions: (wallet: string) => ["payments", "transactions", wallet] as const,
  rate: () => ["payments", "rate"] as const,
};

// ── useBalance ─────────────────────────────────────────────────────────────

/**
 * Fetch the user's CLD credit balance from the platform API.
 * Returns balance info + USD equivalent + conversion rate.
 */
export function useBalance() {
  const { address, isConnected } = useAccount();
  const wallet = address ?? "";

  const query = useQuery<PaymentBalance, Error>({
    queryKey: paymentQueryKeys.balance(wallet),
    queryFn: () => getBalance(wallet),
    enabled: isConnected && !!wallet,
    refetchInterval: 30_000,       // Refresh every 30 s
    staleTime: 15_000,
    // Return a zeroed balance while loading so UI doesn't flicker
    placeholderData: {
      cldCredits: 0,
      usdEquivalent: 0,
      cldToUsdRate: 0.1,           // Default fallback rate
    },
  });

  return {
    balance: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

// ── useConversionRate ──────────────────────────────────────────────────────

/**
 * Fetch the current USD ↔ CLD conversion rate.
 * Cached for 5 minutes — rates don't change frequently.
 */
export function useConversionRate() {
  const query = useQuery({
    queryKey: paymentQueryKeys.rate(),
    queryFn: getConversionRate,
    staleTime: 5 * 60_000,
    // Fallback while loading
    placeholderData: { usdToCld: 10, cldToUsd: 0.1 },
  });

  return {
    rate: query.data,
    isLoading: query.isLoading,
  };
}

// ── useAddFunds ────────────────────────────────────────────────────────────

export interface AddFundsCardParams {
  method: "card";
  amountUsd: number;
}

export interface AddFundsCryptoParams {
  method: "crypto";
  txHash: string;
  amountCld: number;
}

export type AddFundsParams = AddFundsCardParams | AddFundsCryptoParams;

export interface AddFundsResult {
  method: "card" | "crypto";
  /** For card: Stripe checkout session (redirect or embed) */
  session?: CheckoutSession;
  /** For crypto: deposit confirmation */
  creditsAdded?: number;
  newBalance?: number;
}

/**
 * Mutation to add funds to the user's account.
 * - Card: creates a Stripe checkout session → caller handles redirect/embed
 * - Crypto: records the on-chain deposit tx after confirmation
 */
export function useAddFunds() {
  const { address } = useAccount();
  const qc = useQueryClient();
  const wallet = address ?? "";

  const mutation = useMutation<AddFundsResult, Error, AddFundsParams>({
    mutationFn: async (params) => {
      if (params.method === "card") {
        const session = await createCheckoutSession(params.amountUsd, wallet);
        return { method: "card", session };
      } else {
        const result = await depositCrypto(params.txHash, params.amountCld, wallet);
        return {
          method: "crypto",
          creditsAdded: result.creditsAdded,
          newBalance: result.newBalance,
        };
      }
    },
    onSuccess: () => {
      // Invalidate balance so it refetches after a successful deposit
      if (wallet) {
        qc.invalidateQueries({ queryKey: paymentQueryKeys.balance(wallet) });
        qc.invalidateQueries({ queryKey: paymentQueryKeys.transactions(wallet) });
      }
    },
  });

  return {
    addFunds: mutation.mutate,
    addFundsAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
    data: mutation.data,
    reset: mutation.reset,
  };
}

// ── useTransactionHistory ──────────────────────────────────────────────────

/**
 * Fetch recent transaction history (deposits + deployment charges).
 */
export function useTransactionHistory(limit = 10) {
  const { address, isConnected } = useAccount();
  const wallet = address ?? "";

  const query = useQuery<Transaction[], Error>({
    queryKey: paymentQueryKeys.transactions(wallet),
    queryFn: () => getTransactionHistory(wallet, limit),
    enabled: isConnected && !!wallet,
    staleTime: 30_000,
    placeholderData: [],
  });

  return {
    transactions: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
