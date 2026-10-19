/**
 * Caller authentication for the user-facing API (ENGINEERING_BACKLOG B-7, SECURITY_AUDIT O3).
 *
 * Two bearer credentials share `Authorization: Bearer …`:
 *  - a wallet session token: HS256 JWT, JWT_TTL_SECONDS long, with a random `jti`. Minted by POST /v1/auth/login,
 *    ended by POST /v1/auth/logout (a KV revocation list keyed by jti, kept until the token would have expired).
 *    Verification accepts JWT_SECRET and, during a rotation, JWT_SECRET_PREVIOUS, so a secret can change without
 *    signing everyone out;
 *  - a developer API key `cld_sk_…` (services/api-keys.service.ts): scoped, revocable, hashed at rest. It never
 *    reaches key management, credits, payments or provider state (`scopeFor`).
 */
import type { Context, Next } from "hono";
import { createMiddleware } from "hono/factory";
import { sign, verify } from "hono/jwt";
import { getKV } from "../lib/storage.js";
import { normalizeAddress, type HexAddress } from "../lib/eth.js";
import { getEnv } from "../config/env.js";
import { fail } from "../lib/http.js";
import { API_KEY_PREFIX, authenticateApiKey, scopeFor, type Scope } from "../services/api-keys.service.js";

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

export type AuthFailure = { code: "unauthorized" | "forbidden"; message: string };

/** Resolve a bearer credential to its caller, or the reason it is refused. `method`/`path` decide an API key's scope. */
export async function resolveBearer(token: string, method: string, path: string): Promise<{ payload: JWTPayload } | { error: AuthFailure }> {
  if (token.startsWith(API_KEY_PREFIX)) {
    const caller = await authenticateApiKey(token);
    if (!caller) return { error: { code: "unauthorized", message: "Unknown, expired or revoked API key" } };
    const need = scopeFor(method, path);
    if (!need) return { error: { code: "forbidden", message: "This endpoint needs a wallet session, not an API key" } };
    if (!caller.scopes.includes(need)) return { error: { code: "forbidden", message: `This API key lacks the "${need}" scope` } };
    return { payload: { sub: caller.owner, role: "user", iat: 0, exp: 0, auth: "key", keyId: caller.keyId, scopes: caller.scopes } };
  }
  const payload = await verifyBearer(token);
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
  if ("error" in r) return fail(c, r.error.code, r.error.message);
  c.set("jwtPayload", r.payload);
  return next();
});

/** Verified payload for a session token, or null: bad signature, expired, or revoked. */
export async function verifyBearer(token: string): Promise<JWTPayload | null> {
  const env = getEnv();
  let payload: JWTPayload | null = null;
  for (const secret of [env.JWT_SECRET, env.JWT_SECRET_PREVIOUS]) {
    if (!secret) continue;
    try {
      payload = (await verify(token, secret, "HS256")) as unknown as JWTPayload;
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
// Keyed by jti in KV for the token's remaining lifetime; in memory when KV is not bound (unit tests). KV is
// eventually consistent across colos (about a minute); in the colo that revoked, immediate.

const revokedMemory = new Map<string, number>();
const revokedKey = (jti: string) => `revoked:${jti}`;

/** End a session token now. False when the token has no jti (minted before revocation existed). */
export async function revokeToken(payload: Pick<JWTPayload, "jti" | "exp">): Promise<boolean> {
  if (!payload.jti) return false;
  const ttl = Math.max(60, payload.exp - Math.floor(Date.now() / 1000));
  try {
    await getKV().put(revokedKey(payload.jti), "1", { expirationTtl: ttl });
  } catch {
    revokedMemory.set(payload.jti, Date.now() + ttl * 1000);
  }
  return true;
}

async function isRevoked(jti: string): Promise<boolean> {
  const until = revokedMemory.get(jti);
  if (until !== undefined) {
    if (until > Date.now()) return true;
    revokedMemory.delete(jti);
  }
  try {
    return (await getKV().get(revokedKey(jti))) !== null;
  } catch {
    return false;
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

function nonceKey(address: HexAddress): string {
  return `nonce:${address}`;
}

function buildSignInMessage(address: HexAddress, nonce: string, issuedAt: string): string {
  return `Cloudana sign-in\nAddress: ${address}\nNonce: ${nonce}\nIssued: ${issuedAt}`;
}

async function nonceStorePut(key: string, value: string): Promise<void> {
  try {
    await getKV().put(key, value, { expirationTtl: NONCE_TTL_SEC });
  } catch {
    nonceMemory.set(key, { value, expiresAt: Date.now() + NONCE_TTL_SEC * 1000 });
  }
}

async function nonceStoreTake(key: string): Promise<string | null> {
  try {
    const kv = getKV();
    const value = await kv.get(key);
    if (value !== null) await kv.delete(key);
    return value;
  } catch {
    const entry = nonceMemory.get(key);
    nonceMemory.delete(key);
    return entry && entry.expiresAt > Date.now() ? entry.value : null;
  }
}

/** Issue a nonce and the exact message the wallet must sign. */
export async function issueNonce(rawAddress: string): Promise<IssuedNonce> {
  const address = normalizeAddress(rawAddress);
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const nonce = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const issuedAt = new Date().toISOString();
  const message = buildSignInMessage(address, nonce, issuedAt);
  await nonceStorePut(nonceKey(address), message);
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
  const stored = await nonceStoreTake(nonceKey(normalizeAddress(rawAddress)));
  return stored !== null && stored === message;
}
