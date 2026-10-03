// Routing for "open the waitlist" requests. One behaviour everywhere: if the page has an inline
// waitlist form (the homepage §8), scroll to it and prefill; otherwise open the WaitlistHost dialog.
import type { ServiceId } from "@/lib/services";

export type WaitlistRole = "use" | "provide" | "verify" | "datacenter" | "partner";
export type WaitlistRequest = { role?: WaitlistRole; interests?: ServiceId[]; n: number };

let seq = 0;
let inline: ((r: WaitlistRequest) => void) | null = null;
const hosts = new Set<(r: WaitlistRequest) => void>();

export function openWaitlist(opts: { role?: WaitlistRole; interests?: ServiceId[] } = {}): void {
  const r = { ...opts, n: ++seq };
  if (inline) inline(r);
  else if (hosts.size) hosts.forEach((h) => h(r));
  else if (import.meta.env.DEV) console.warn("[waitlist] openWaitlist() called but no <WaitlistHost/> is mounted");
}

export function registerInline(fn: (r: WaitlistRequest) => void) {
  inline = fn;
  return () => {
    if (inline === fn) inline = null;
  };
}

export function registerHost(fn: (r: WaitlistRequest) => void) {
  hosts.add(fn);
  return () => {
    hosts.delete(fn);
  };
}

// ── Referral capture: ?r=CODE on landing is kept and sent as `ref` on signup ──
const REF_KEY = "cld.ref";
export function captureReferral() {
  try {
    const r = new URLSearchParams(window.location.search).get("r");
    if (r && /^[A-Za-z0-9]{4,64}$/.test(r)) localStorage.setItem(REF_KEY, r.toUpperCase());
  } catch {
    /* storage blocked */
  }
}
export function storedReferral(): string | undefined {
  try {
    return localStorage.getItem(REF_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** utm_source, else the referring site's host (never our own). */
export function signupSource(): string | undefined {
  const utm = new URLSearchParams(window.location.search).get("utm_source");
  if (utm) return utm.slice(0, 64);
  try {
    const host = document.referrer ? new URL(document.referrer).host : "";
    return host && host !== window.location.host ? host.slice(0, 64) : undefined;
  } catch {
    return undefined;
  }
}
