/**
 * Caller authentication for the user-facing API (ENGINEERING_BACKLOG B-7, SECURITY_AUDIT O3).
 *
 * Two bearer credentials share `Authorization: Bearer …`:
 *  - a wallet session token: HS256 JWT, JWT_TTL_SECONDS long, with a random `jti`. Minted by POST /v1/auth/login,
 *    ended by POST /v1/auth/logout (a D1 revocation list keyed by jti, kept until the token would have expired).
 *    Verification accepts JWT_SECRET and, during a rotation, JWT_SECRET_PREVIOUS, so a secret can change without
 *    signing everyone out;
 *  - a developer API key `cld_sk_…` (services/api-keys.service.ts): scoped, revocable, hashed at rest. It never
 *    reaches key management, credits, payments or provider state (`scopeFor`).
 */
import type { Context, Next } from "hono";
import { createMiddleware } from "hono/factory";
import { sign, verify } from "hono/jwt";
import { getD1 } from "../lib/storage.js";
import { normalizeAddress, type HexAddress } from "../lib/eth.js";
import { getEnv } from "../config/env.js";
import { fail } from "../lib/http.js";
import { API_KEY_PREFIX, KeyStoreUnavailable, authenticateApiKey, scopeFor, type Scope } from "../services/api-keys.service.js";

/** Hono `Variables` type for routers whose handlers read the verified caller. */
export type AuthVariables = { jwtPayload: JWTPayload };

export interface JWTPayload {
  sub: string;         // wallet address (for an API key: its owner)
  role: "user" | "provider" | "admin";
  iat: number;
  exp: number;
  /** Session tokens: random id, the handle for revocation. */
  jti?: string;
  /** How the caller authenticated; absent on session tokens minted before this field existed. */
  auth?: "wallet" | "key";
  /** API keys: which one, and what it may do. */
  keyId?: string;
  scopes?: Scope[];
}

export type AuthFailure = { code: "unauthorized" | "forbidden" | "service_unavailable"; message: string };

/** The shared revocation list is bound but cannot be read: the caller cannot tell a revoked token from a valid one. */
export class RevocationUnavailable extends Error {
  constructor() {
    super("the session revocation list cannot be read");
    this.name = "RevocationUnavailable";
  }
}

/** Resolve a bearer credential to its caller, or the reason it is refused. `method`/`path` decide an API key's scope. */
export async function resolveBearer(token: string, method: string, path: string): Promise<{ payload: JWTPayload } | { error: AuthFailure }> {
  if (token.startsWith(API_KEY_PREFIX)) {
    let caller: Awaited<ReturnType<typeof authenticateApiKey>>;
    try {
      caller = await authenticateApiKey(token);
    } catch (err) {
      if (err instanceof KeyStoreUnavailable) {
        return { error: { code: "service_unavailable", message: "The API-key store cannot be read right now; retry in a few seconds (the key was not refused)" } };
      }
      throw err;
    }
    if (!caller) return { error: { code: "unauthorized", message: "Unknown, expired or revoked API key" } };
    const need = scopeFor(method, path);
    if (!need) return { error: { code: "forbidden", message: "This endpoint needs a wallet session, not an API key" } };
    if (!caller.scopes.includes(need)) return { error: { code: "forbidden", message: `This API key lacks the "${need}" scope` } };
    return { payload: { sub: caller.owner, role: "user", iat: 0, exp: 0, auth: "key", keyId: caller.keyId, scopes: caller.scopes } };
  }
  let payload: JWTPayload | null;
  try {
    payload = await verifyBearer(token);
  } catch (err) {
    // Not a refusal: the token may well be valid. A 401 here would make every client treat a KV blip as a logout
    // (the console drops its session, and with it the secrets it has not sealed yet).
    if (err instanceof RevocationUnavailable) {
      return { error: { code: "service_unavailable", message: "The session revocation list cannot be read right now; retry in a few seconds (the token was not refused)" } };
    }
    throw err;
  }
  return payload ? { payload } : { error: { code: "unauthorized", message: "Invalid, expired or revoked token" } };
}

/**
 * Middleware: require a valid bearer credential (session token or API key with the route's scope).
 * Sets c.set("jwtPayload", payload) on success.
 */
export const requireAuth = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return fail(c, "unauthorized", "Missing or invalid Authorization header");
  }
  const r = await resolveBearer(authHeader.slice(7).trim(), c.req.method, c.req.path);
  if ("error" in r) {
    if (r.error.code === "service_unavailable") c.header("Retry-After", "5");
    return fail(c, r.error.code, r.error.message);
  }
  c.set("jwtPayload", r.payload);
  return next();
});

/** Verified payload for a session token, or null: bad signature, expired, or revoked. Throws RevocationUnavailable. */
export async function verifyBearer(token: string): Promise<JWTPayload | null> {
  const env = getEnv();
  let payload: JWTPayload | null = null;
  const nowSec = Math.floor(Date.now() / 1000);
  // The previous secret only during its grace window, and only for tokens that expire inside it.
  const until = env.JWT_SECRET_PREVIOUS_UNTIL;
  const previous = env.JWT_SECRET_PREVIOUS && until && nowSec < until ? env.JWT_SECRET_PREVIOUS : undefined;
  for (const secret of [env.JWT_SECRET, previous]) {
    if (!secret) continue;
    try {
      const p = (await verify(token, secret, "HS256")) as unknown as JWTPayload;
      if (secret === previous && !(typeof p.exp === "number" && p.exp <= until!)) continue;
      payload = p;
      break;
    } catch {
      /* not this secret: try the previous one */
    }
  }
  if (!payload || typeof payload.sub !== "string") return null;
  if (payload.jti && (await isRevoked(payload.jti))) return null;
  return payload;
}

/** The caller if a valid bearer credential was sent, otherwise null — never rejects (a key needs the route's scope). */
export async function optionalCaller(c: Context): Promise<JWTPayload | null> {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const r = await resolveBearer(authHeader.slice(7).trim(), c.req.method, c.req.path);
  return "error" in r ? null : r.payload;
}

/**
 * Middleware: require a specific role.
 * Must be used AFTER requireAuth.
 */
export function requireRole(...roles: JWTPayload["role"][]) {
  return createMiddleware(async (c: Context, next: Next) => {
    const payload = c.get("jwtPayload") as JWTPayload | undefined;
    if (!payload || !roles.includes(payload.role)) {
      return fail(c, "forbidden", "Insufficient permissions");
    }
    return next();
  });
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Mint a wallet session token (the auth/login endpoint, after wallet signature verification).
 */
export async function generateToken(walletAddress: string, role: JWTPayload["role"] = "user"): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: JWTPayload = {
    sub: walletAddress.toLowerCase(),
    role,
    iat: now,
    exp: now + getEnv().JWT_TTL_SECONDS,
    jti: randomHex(16),
    auth: "wallet",
  };
  return sign(payload as unknown as Record<string, unknown>, getEnv().JWT_SECRET);
}

// ─── Session revocation (POST /v1/auth/logout) ──────────────────────────────
// Keyed by jti in D1 (`revoked_tokens`) for the token's remaining lifetime: one shared list every isolate reads
// with the request's other D1 work — immediate everywhere, and never against the KV quota (a day of console polls
// and node heartbeats exhausted the free tier's KV reads, which used to turn into a 503 for every wallet session).
// In memory when no storage is bound (unit tests).

const revokedMemory = new Map<string, number>();
/** The bound D1, or null when none is bound (unit tests): then the lists are per process. */
function boundD1(): D1Database | null {
  try {
    return getD1();
  } catch {
    return null;
  }
}

/**
 * End a session token now. False when the token has no jti (minted before revocation existed) or when the shared
 * revocation list could not be written — the caller must not report a revocation that only this isolate knows.
 */
export async function revokeToken(payload: Pick<JWTPayload, "jti" | "exp">): Promise<boolean> {
  if (!payload.jti) return false;
  const expiresAt = Math.max(Date.now() + 60_000, payload.exp * 1000);
  const db = boundD1();
  if (!db) {
    revokedMemory.set(payload.jti, expiresAt);
    return true;
  }
  try {
    await db.batch([
      db.prepare("DELETE FROM revoked_tokens WHERE expires_at <= ?").bind(Date.now()),
      db.prepare("INSERT INTO revoked_tokens (jti, expires_at) VALUES (?, ?) ON CONFLICT(jti) DO UPDATE SET expires_at = excluded.expires_at").bind(payload.jti, expiresAt),
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Neither open nor closed: a list that cannot be read makes the check unavailable (the request answers 503), so a
 * blip is never reported as "valid" nor as "revoked" (which would sign every console out and drop unsealed secrets).
 */
async function isRevoked(jti: string): Promise<boolean> {
  const db = boundD1();
  if (!db) {
    const until = revokedMemory.get(jti);
    if (until !== undefined && until > Date.now()) return true;
    revokedMemory.delete(jti);
    return false;
  }
  try {
    const row = await db.prepare("SELECT 1 AS r FROM revoked_tokens WHERE jti = ? AND expires_at > ?").bind(jti, Date.now()).first<{ r: number }>();
    return row !== null && row !== undefined;
  } catch {
    throw new RevocationUnavailable();
  }
}

// ─── Sign-in nonces ──────────────────────────────────────────────────────────
// A login signature must cover a server-issued, single-use nonce. Without it a
// captured signature could be replayed to mint fresh JWTs indefinitely.

const NONCE_TTL_SEC = 300;
const nonceMemory = new Map<string, { value: string; expiresAt: number }>();

export interface IssuedNonce {
  nonce: string;
  message: string;
  expiresAt: string;
}

// Keyed per nonce, not per address: issuing a nonce for an address (which anyone can do, it is unauthenticated)
// never invalidates one still in flight for that address.
function nonceKey(address: HexAddress, nonce: string): string {
  return `nonce:${address}:${nonce}`;
}
const NONCE_IN_MESSAGE = /^Nonce: ([0-9a-f]{32})$/m;

function buildSignInMessage(address: HexAddress, nonce: string, issuedAt: string): string {
  return `Cloudana sign-in\nAddress: ${address}\nNonce: ${nonce}\nIssued: ${issuedAt}`;
}

// Nonces live in D1 (`login_nonces`), like node nonces: one shared store, taken with a single DELETE … RETURNING.
// (In KV, a put that failed on quota fell back to memory while a get that found nothing did not look there — every
// sign-in then failed until midnight UTC.) In memory when no storage is bound (unit tests).
async function nonceStorePut(key: string, value: string): Promise<void> {
  const expiresAt = Date.now() + NONCE_TTL_SEC * 1000;
  const db = boundD1();
  if (!db) {
    nonceMemory.set(key, { value, expiresAt });
    return;
  }
  await db.batch([
    db.prepare("DELETE FROM login_nonces WHERE expires_at <= ?").bind(Date.now()),
    db.prepare("INSERT OR REPLACE INTO login_nonces (key, message, expires_at) VALUES (?, ?, ?)").bind(key, value, expiresAt),
  ]);
}

async function nonceStoreTake(key: string): Promise<string | null> {
  const db = boundD1();
  if (!db) {
    const entry = nonceMemory.get(key);
    nonceMemory.delete(key);
    return entry && entry.expiresAt > Date.now() ? entry.value : null;
  }
  const row = await db.prepare("DELETE FROM login_nonces WHERE key = ? AND expires_at > ? RETURNING message").bind(key, Date.now()).first<{ message: string }>();
  return row?.message ?? null;
}

/** Issue a nonce and the exact message the wallet must sign. */
export async function issueNonce(rawAddress: string): Promise<IssuedNonce> {
  const address = normalizeAddress(rawAddress);
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const nonce = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const issuedAt = new Date().toISOString();
  const message = buildSignInMessage(address, nonce, issuedAt);
  await nonceStorePut(nonceKey(address, nonce), message);
  return {
    nonce,
    message,
    expiresAt: new Date(Date.now() + NONCE_TTL_SEC * 1000).toISOString(),
  };
}

/**
 * Consume the nonce for an address. Returns true only if `message` is exactly
 * the message issued for it and it has not been used or expired.
 */
export async function consumeNonce(rawAddress: string, message: string): Promise<boolean> {
  const nonce = NONCE_IN_MESSAGE.exec(message)?.[1];
  if (!nonce) return false;
  const stored = await nonceStoreTake(nonceKey(normalizeAddress(rawAddress), nonce));
  return stored !== null && stored === message;
}
