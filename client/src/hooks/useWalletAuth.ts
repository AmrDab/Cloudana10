// React binding for wallet sign-in (see lib/auth.ts).
import { useCallback, useState, useSyncExternalStore } from "react";
import { useAccount } from "wagmi";
import {
  authFetch,
  clearToken,
  ensureToken,
  getAuthHeader,
  getAuthVersion,
  getToken,
  subscribeAuth,
} from "@/lib/auth";

export function useWalletAuth() {
  const { address, isConnected } = useAccount();
  // Re-render whenever a token is stored, cleared or expires.
  useSyncExternalStore(subscribeAuth, getAuthVersion);

  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  /** Prompt the wallet to sign in (no-op if a valid token is cached). */
  const signIn = useCallback(async (): Promise<string> => {
    setIsSigningIn(true);
    setError(null);
    try {
      return await ensureToken();
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      throw e;
    } finally {
      setIsSigningIn(false);
    }
  }, []);

  const signOut = useCallback(() => clearToken(address), [address]);

  return {
    address,
    isConnected,
    isAuthenticated: isConnected && getToken(address) !== null,
    isSigningIn,
    error,
    signIn,
    signOut,
    ensureToken,
    getAuthHeader,
    authFetch,
  };
}
