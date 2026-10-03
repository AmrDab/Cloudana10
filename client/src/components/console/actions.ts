import { toast } from "sonner";
import { ApiError, isOffline, signIn } from "@/lib/cld";

/** Human sentence for an API failure (offline is calm, not alarming). */
export function errText(e: unknown): string {
  if (isOffline(e)) return "The network API is offline. Try again when it's back.";
  if (e instanceof ApiError) {
    if (e.code === "rate_limited") return "Too many attempts. Try again in a minute.";
    return e.message;
  }
  return e instanceof Error ? e.message : "Something went wrong.";
}

let pending: Promise<unknown> | null = null;
/** Sign in with the connected wallet (or the local test wallet). One flow at a time. */
export async function signInWithToast() {
  if (pending) return pending;
  pending = signIn()
    .then((s) => {
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
