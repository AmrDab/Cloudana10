/**
 * Fixed-window rate limiting keyed by client IP.
 *
 * Backed by Cloudflare KV on the Worker (shared across isolates, eventually
 * consistent — good enough to stop abuse, not a precise quota) and by an
 * in-memory map on the Node orchestrator, where KV is not bound.
 */
import type { Context, Next } from "hono";
import { createMiddleware } from "hono/factory";
import { getKV } from "../lib/storage.js";
import { fail } from "../lib/http.js";
import { getEnv } from "../config/env.js";

export interface RateLimitOptions {
  /** Namespace so different routes don't share a counter. */
  bucket: string;
  /** Max requests per window per IP. */
  limit: number;
  /** Window length in seconds. KV enforces a 60 s minimum TTL. */
  windowSec: number;
  /** Counter key for a request (default: client IP). E.g. the X-Node address for node routes. */
  keyBy?: (c: Context) => string;
}

/**
 * Per-node key for limits placed AFTER requireNode: the verified address. Keying on the raw X-Node header would let
 * anyone exhaust a victim node's quota with unsigned requests.
 */
export function verifiedNodeKey(c: Context): string {
  return c.get("node") as string;
}

const memory = new Map<string, { count: number; resetAt: number }>();

export function clientIp(c: Context): string {
  return (
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

/**
 * Client IP for checks that must not be spoofable (credit caps, a node's announced host). On the Worker every
 * request carries `request.cf`, and Cloudflare sets CF-Connecting-IP itself. On Node the headers are trusted only
 * with TRUST_PROXY (a proxy in front strips client-supplied copies); otherwise the socket address, else "unknown".
 */
export function trustedClientIp(c: Context): string {
  const onWorker = (c.req.raw as Request & { cf?: unknown }).cf !== undefined;
  if (onWorker || getEnv().TRUST_PROXY) return clientIp(c);
  const socket = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket?.remoteAddress;
  return socket?.replace(/^::ffff:/, "") || "unknown";
}

async function bump(key: string, windowSec: number): Promise<number> {
  const ttl = Math.max(60, windowSec);
  try {
    const kv = getKV();
    const raw = await kv.get(key);
    const count = (raw ? Number(raw) : 0) + 1;
    await kv.put(key, String(count), { expirationTtl: ttl });
    return count;
  } catch {
    // No KV binding (Node runtime) — fall back to process memory.
    const now = Date.now();
    const entry = memory.get(key);
    if (!entry || entry.resetAt <= now) {
      memory.set(key, { count: 1, resetAt: now + ttl * 1000 });
      return 1;
    }
    entry.count += 1;
    return entry.count;
  }
}

export function rateLimit(opts: RateLimitOptions) {
  return createMiddleware(async (c: Context, next: Next) => {
    const window = Math.floor(Date.now() / 1000 / opts.windowSec);
    const key = `rl:${opts.bucket}:${(opts.keyBy ?? clientIp)(c)}:${window}`;
    const count = await bump(key, opts.windowSec);
    c.header("X-RateLimit-Limit", String(opts.limit));
    c.header("X-RateLimit-Remaining", String(Math.max(0, opts.limit - count)));
    if (count > opts.limit) {
      c.header("Retry-After", String(opts.windowSec));
      return fail(c, "rate_limited", "Too many requests", { retryAfterSec: opts.windowSec });
    }
    return next();
  });
}
