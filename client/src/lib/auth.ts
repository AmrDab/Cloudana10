// Wallet sign-in for the Cloudana API.
// Flow: GET /auth/nonce → wallet signs the server's message → POST /auth/login → JWT.
// The JWT is cached in memory + sessionStorage, keyed by lowercase wallet address.
// It is never written to localStorage and never read from VITE_ env (those are public).
import { getAccount, signMessage, watchAccount } from "@wagmi/core";
import { wagmiConfig } from "@/lib/wagmi-config";
import { readApiError } from "@/lib/api-error";

const API_BASE = (import.meta.env.VITE_API_URL || "http://localhost:7002") + "/v1";
const STORAGE_PREFIX = "cloudana.auth.";
/** Treat a token as expired this long before its real `exp`, so we re-sign before a 401. */
const REFRESH_MARGIN_MS = 60_000;

// ── Types ────────────────────────────────────────────────────────────────────

interface NonceResponse {
  nonce: string;
  message: string;
  expiresAt: string;
}

interface LoginResponse {
  token: string;
  expiresIn: number;
  address: string;
}

interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
}

// ── Store ────────────────────────────────────────────────────────────────────

const memory = new Map<string, CachedToken>();
const inflight = new Map<string, Promise<string>>();
const listeners = new Set<() => void>();
let version = 0;

function notify() {
  version++;
  listeners.forEach((l) => l());
}

/** Subscribe to token changes (for useSyncExternalStore). */
export function subscribeAuth(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Changes whenever any cached token is set or cleared. */
export function getAuthVersion(): number {
  return version;
}

/** Read the `exp` claim (seconds) from a JWT and return it as epoch ms. */
function decodeExpiry(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const { exp } = JSON.parse(json) as { exp?: unknown };
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

function remember(key: string, entry: CachedToken) {
  memory.set(key, entry);
  // Flip subscribers to "signed out" when the token enters its refresh window.
  const delay = Math.min(entry.expiresAt - REFRESH_MARGIN_MS - Date.now(), 2_147_483_647);
  setTimeout(() => {
    if (memory.get(key)?.token === entry.token) clearToken(key);
  }, Math.max(delay, 0));
}

function readCached(key: string): string | null {
  let entry = memory.get(key);
  if (!entry) {
    try {
      const stored = sessionStorage.getItem(STORAGE_PREFIX + key);
      const expiresAt = stored ? decodeExpiry(stored) : null;
      if (stored && expiresAt) {
        entry = { token: stored, expiresAt };
        remember(key, entry);
      }
    } catch {
      // sessionStorage unavailable — memory cache only
    }
  }
  if (!entry) return null;
  if (entry.expiresAt - REFRESH_MARGIN_MS <= Date.now()) {
    clearToken(key);
    return null;
  }
  return entry.token;
}

function storeToken(key: string, token: string, expiresIn: number) {
  const expiresAt = decodeExpiry(token) ?? Date.now() + expiresIn * 1000;
  remember(key, { token, expiresAt });
  try {
    sessionStorage.setItem(STORAGE_PREFIX + key, token);
  } catch {
    // sessionStorage unavailable — memory cache only
  }
  notify();
}

/** Drop the cached token for one address, or for every address when omitted. */
export function clearToken(address?: string) {
  const keys = address ? [address.toLowerCase()] : Array.from(memory.keys());
  for (const key of keys) {
    memory.delete(key);
    try {
      sessionStorage.removeItem(STORAGE_PREFIX + key);
    } catch {
      // ignore
    }
  }
  if (!address) {
    try {
      Object.keys(sessionStorage)
        .filter((k) => k.startsWith(STORAGE_PREFIX))
        .forEach((k) => sessionStorage.removeItem(k));
    } catch {
      // ignore
    }
  }
  notify();
}

function currentAddress(): `0x${string}` | undefined {
  return getAccount(wagmiConfig).address;
}

// Clear the previous wallet's token on disconnect or account switch.
// (Reconnect on page load goes undefined → address, so it never clears.)
watchAccount(wagmiConfig, {
  onChange(account, prev) {
    if (prev.address && prev.address.toLowerCase() !== account.address?.toLowerCase()) {
      clearToken(prev.address);
    }
  },
});

// ── Public API ───────────────────────────────────────────────────────────────

/** Valid (not near expiry) cached token for `address`, or null. Never prompts the wallet. */
export function getToken(address: string | undefined = currentAddress()): string | null {
  return address ? readCached(address.toLowerCase()) : null;
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const text = await res.text().catch(() => "");
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON
  }
  const { message } = readApiError(body, "");
  if (message && typeof body === "object") return `${fallback}: ${message}`;
  return `${fallback} (${res.status}${text ? `: ${text}` : ""})`;
}

async function login(address: `0x${string}`): Promise<string> {
  const key = address.toLowerCase();

  const nonceRes = await fetch(`${API_BASE}/auth/nonce?address=${encodeURIComponent(address)}`);
  if (!nonceRes.ok) throw new Error(await errorMessage(nonceRes, "Could not start wallet sign-in"));
  const { message } = (await nonceRes.json()) as NonceResponse;

  const signature = await signMessage(wagmiConfig, { account: address, message });

  const loginRes = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, message, signature }),
  });
  if (!loginRes.ok) throw new Error(await errorMessage(loginRes, "Wallet sign-in failed"));
  const { token, expiresIn } = (await loginRes.json()) as LoginResponse;

  if (currentAddress()?.toLowerCase() !== key) {
    throw new Error("Wallet changed during sign-in. Please try again.");
  }
  storeToken(key, token, expiresIn);
  return token;
}

/**
 * Return a valid JWT for the connected wallet, asking the wallet to sign a
 * login message if there is no cached token. Concurrent calls share one prompt.
 */
export async function ensureToken(): Promise<string> {
  const address = currentAddress();
  if (!address) throw new Error("Connect your wallet first.");
  const key = address.toLowerCase();

  const cached = readCached(key);
  if (cached) return cached;

  const pending = inflight.get(key);
  if (pending) return pending;

  const p = login(address).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** `{ Authorization: "Bearer <jwt>" }` for the connected wallet (may prompt a signature). */
export async function getAuthHeader(): Promise<{ Authorization: string }> {
  return { Authorization: `Bearer ${await ensureToken()}` };
}

/**
 * fetch() against the API with the wallet JWT attached. `path` is relative to
 * `${VITE_API_URL}/v1` unless it is an absolute URL. On 401 the token is
 * dropped, the wallet re-signs once, and the request is retried once.
 */
export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = /^https?:\/\//.test(path) ? path : `${API_BASE}${path}`;

  const send = async () => {
    const headers = new Headers(init.headers);
    const { Authorization } = await getAuthHeader();
    headers.set("Authorization", Authorization);
    return fetch(url, { ...init, headers });
  };

  const res = await send();
  if (res.status !== 401) return res;

  clearToken(currentAddress());
  return send();
}
