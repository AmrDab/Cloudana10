import { toast } from "sonner";
import { getAccount, watchAccount } from "@wagmi/core";
import { ApiError, DEV_BURNER, isOffline, signIn } from "@/lib/cld";
import { wagmiConfig } from "@/lib/wagmi-config";
import { appKit } from "@/context/wallet-context";

/** Human sentence for an API failure (offline is calm, not alarming). */
export function errText(e: unknown): string {
  if (isOffline(e)) return "The network API is offline. Try again when it's back.";
  if (e instanceof ApiError) {
    if (e.code === "rate_limited") return "Too many attempts. Try again in a minute.";
    return e.message;
  }
  return e instanceof Error ? e.message : "Something went wrong.";
}

/** Resolves true once a wallet is connected; opens the Reown modal (wallets, email, socials) if none is. False if closed. */
function connectWallet(): Promise<boolean> {
  if (getAccount(wagmiConfig).address) return Promise.resolve(true);
  return new Promise((resolve) => {
    let seenOpen = false;
    const done = (ok: boolean) => {
      unwatch();
      unsub();
      resolve(ok);
    };
    const unwatch = watchAccount(wagmiConfig, { onChange: (a) => a.address && done(true) });
    const unsub = appKit.subscribeState((s) => {
      if (s.open) seenOpen = true;
      else if (seenOpen && !getAccount(wagmiConfig).address) done(false);
    });
    void appKit.open();
  });
}

let pending: Promise<unknown> | null = null;
/** Sign in with the connected wallet, connecting one first if needed (or the local test wallet). One flow at a time. */
export async function signInWithToast() {
  if (pending) return pending;
  pending = (DEV_BURNER ? Promise.resolve(true) : connectWallet())
    .then((connected) => (connected ? signIn() : null))
    .then((s) => {
      if (!s) return null;
      toast.success("Signed in", { description: s.burner ? "Test wallet · this browser only" : undefined });
      return s;
    })
    .catch((e) => {
      toast.error("Couldn't sign in", { description: errText(e) });
      return null;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}
