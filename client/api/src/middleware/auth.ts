/**
 * JWT authentication middleware for Cloudana API.
 * Protects sensitive endpoints (build-provider, deploy, admin operations).
 */
import type { Context, Next } from "hono";
import { createMiddleware } from "hono/factory";
import { sign, verify } from "hono/jwt";
import { getKV } from "../lib/storage.js";
import { normalizeAddress, type HexAddress } from "../lib/eth.js";
import { getEnv } from "../config/env.js";
import { fail } from "../lib/http.js";

/** Hono `Variables` type for routers whose handlers read the verified caller. */
export type AuthVariables = { jwtPayload: JWTPayload };

function getJwtSecret(): string {
  return getEnv().JWT_SECRET;
}

export interface JWTPayload {
  sub: string;         // wallet address
  role: "user" | "provider" | "admin";
  iat: number;
  exp: number;
}

/**
 * Middleware: require a valid JWT Bearer token.
 * Sets c.set("jwtPayload", payload) on success.
 */
export const requireAuth = createMiddleware(async (c: Context, next: Next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return fail(c, "unauthorized", "Missing or invalid Authorization header");
  }

  const payload = await verifyBearer(authHeader.slice(7));
  if (!payload) return fail(c, "unauthorized", "Invalid or expired token");
  c.set("jwtPayload", payload);
  return next();
});

/** Verified payload for a bearer token, or null. Used for optional-auth routes. */
export async function verifyBearer(token: string): Promise<JWTPayload | null> {
  try {
    return (await verify(token, getJwtSecret(), "HS256")) as unknown as JWTPayload;
  } catch {
    return null;
  }
}

/** The caller if a valid bearer token was sent, otherwise null — never rejects. */
export async function optionalCaller(c: Context): Promise<JWTPayload | null> {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  return verifyBearer(authHeader.slice(7));
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

/**
 * Generate a JWT token for a wallet address.
 * Used by the auth/login endpoint after wallet signature verification.
 */
export async function generateToken(walletAddress: string, role: JWTPayload["role"] = "user"): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: JWTPayload = {
    sub: walletAddress.toLowerCase(),
    role,
    iat: now,
    exp: now + 24 * 60 * 60, // 24 hours
  };
  return sign(payload as unknown as Record<string, unknown>, getJwtSecret());
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
