// Payment hooks — balance and transaction history
import { useQuery } from "@tanstack/react-query";
import { useWalletAuth } from "@/hooks/useWalletAuth";
import { getBalance, getTransactionHistory, type PaymentBalance, type Transaction } from "@/lib/payments";

// ── Query keys ─────────────────────────────────────────────────────────────

export const paymentQueryKeys = {
  balance: (wallet: string) => ["payments", "balance", wallet] as const,
  transactions: (wallet: string) => ["payments", "transactions", wallet] as const,
};

// ── useBalance ─────────────────────────────────────────────────────────────

/**
 * Fetch the user's CLD credit balance from the platform API.
 * Returns balance info + USD equivalent. Only runs once the wallet has signed in.
 */
export function useBalance() {
  const { address, isAuthenticated } = useWalletAuth();
  const wallet = address ?? "";

  const query = useQuery<PaymentBalance, Error>({
    queryKey: paymentQueryKeys.balance(wallet),
    queryFn: getBalance,
    enabled: isAuthenticated,
    refetchInterval: 30_000,       // Refresh every 30 s
    staleTime: 15_000,
    // Return a zeroed balance while loading so UI doesn't flicker
    placeholderData: {
      cldCredits: 0,
      usdEquivalent: 0,
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

// ── useTransactionHistory ──────────────────────────────────────────────────

/**
 * Fetch recent transaction history (deposits + deployment charges).
 */
export function useTransactionHistory(limit = 10) {
  const { address, isAuthenticated } = useWalletAuth();
  const wallet = address ?? "";

  const query = useQuery<Transaction[], Error>({
    queryKey: paymentQueryKeys.transactions(wallet),
    queryFn: () => getTransactionHistory(limit),
    enabled: isAuthenticated,
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
