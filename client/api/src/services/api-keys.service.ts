/**
 * Developer API keys (ENGINEERING_BACKLOG B-7).
 *
 * A key is `cld_sk_` + 24 random bytes (base64url), sent as `Authorization: Bearer …` exactly like a session token.
 * Only its sha256 is stored; the token is shown once. Keys carry scopes (`read`, `jobs`, `deployments`), may expire,
 * and are revoked by their owner's wallet session. A key can never manage keys, buy credits, touch payments or
 * provider state (`scopeFor`): those need the wallet.
 *
 * Lookups are cached per isolate for API_KEY_CACHE_SECONDS (positive results only), so a revocation made in another
 * isolate takes effect within that window; in the isolate that revoked, at once.
 */
import { createHash, randomBytes } from "node:crypto";
import { getD1 } from "../lib/storage.js";
import { getEnv } from "../config/env.js";
import { normalizeAddress } from "../lib/eth.js";

export const API_KEY_PREFIX = "cld_sk_";
export const MAX_KEYS_PER_ACCOUNT = 20;
export const SCOPES = ["read", "jobs", "deployments"] as const;
export type Scope = (typeof SCOPES)[number];

export interface ApiKey {
  id: string;
  name: string;
  /** The first 8 characters after cld_sk_, to tell keys apart in a list. */
  prefix: string;
  scopes: Scope[];
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;
  revokedAt: number | null;
}

interface Row {
  id: string;
  owner: string;
  name: string;
  prefix: string;
  hash: string;
  scopes: string;
  created_at: number;
  last_used_at: number | null;
  expires_at: number | null;
  revoked_at: number | null;
}

const hashKey = (token: string) => createHash("sha256").update(token).digest("hex");
const view = (r: Row): ApiKey => ({
  id: r.id,
  name: r.name,
  prefix: r.prefix,
  scopes: JSON.parse(r.scopes) as Scope[],
  createdAt: r.created_at,
  lastUsedAt: r.last_used_at,
  expiresAt: r.expires_at,
  revokedAt: r.revoked_at,
});

export type CreateKeyResult =
  | { ok: true; key: ApiKey & { token: string } }
  | { ok: false; code: "conflict" | "validation_failed"; message: string };

/** Mint a key for `owner`. The token is returned once; only its hash is stored. */
export async function createApiKey(
  owner: string,
  name: string,
  scopes: readonly Scope[],
  expiresInDays?: number,
  now = Date.now(),
): Promise<CreateKeyResult> {
  const who = normalizeAddress(owner);
  const unique = [...new Set(scopes)].filter((s): s is Scope => (SCOPES as readonly string[]).includes(s));
  if (unique.length === 0) return { ok: false, code: "validation_failed", message: `scopes must include at least one of ${SCOPES.join(", ")}` };
  const db = getD1();
  const live = await db
    .prepare("SELECT COUNT(*) AS n FROM api_keys WHERE owner = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)")
    .bind(who, now)
    .first<{ n: number }>();
  if ((live?.n ?? 0) >= MAX_KEYS_PER_ACCOUNT) {
    return { ok: false, code: "conflict", message: `an account has at most ${MAX_KEYS_PER_ACCOUNT} live API keys; revoke one first` };
  }
  const token = API_KEY_PREFIX + randomBytes(24).toString("base64url");
  const key: ApiKey = {
    id: crypto.randomUUID(),
    name,
    prefix: token.slice(API_KEY_PREFIX.length, API_KEY_PREFIX.length + 8),
    scopes: unique,
    createdAt: now,
    lastUsedAt: null,
    expiresAt: expiresInDays ? now + expiresInDays * 86_400_000 : null,
    revokedAt: null,
  };
  await db
    .prepare("INSERT INTO api_keys (id, owner, name, prefix, hash, scopes, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(key.id, who, name, key.prefix, hashKey(token), JSON.stringify(unique), now, key.expiresAt)
    .run();
  return { ok: true, key: { ...key, token } };
}

/** The owner's keys, newest first, revoked ones included (they say when). */
export async function listApiKeys(owner: string): Promise<ApiKey[]> {
  const res = await getD1()
    .prepare("SELECT * FROM api_keys WHERE owner = ? ORDER BY created_at DESC LIMIT 100")
    .bind(normalizeAddress(owner))
    .all<Row>();
  return (res.results ?? []).map(view);
}

/** Revoke one of the owner's live keys. False when it is not theirs or already revoked. */
export async function revokeApiKey(owner: string, id: string, now = Date.now()): Promise<boolean> {
  const r = await getD1()
    .prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND owner = ? AND revoked_at IS NULL")
    .bind(now, id, normalizeAddress(owner))
    .run();
  const done = (r.meta?.changes ?? 0) > 0;
  if (done) for (const [h, e] of cache) if (e.caller.keyId === id) cache.delete(h);
  return done;
}

export interface KeyCaller {
  owner: string;
  keyId: string;
  scopes: Scope[];
}

const cache = new Map<string, { caller: KeyCaller; until: number; touched: number }>();
const CACHE_MAX = 10_000;
const TOUCH_EVERY_MS = 60_000;

/** The caller behind a `cld_sk_` token, or null (unknown, expired, revoked, or storage unavailable). */
export async function authenticateApiKey(token: string, now = Date.now()): Promise<KeyCaller | null> {
  if (!token.startsWith(API_KEY_PREFIX) || token.length > 128) return null;
  const h = hashKey(token);
  const hit = cache.get(h);
  if (hit && hit.until > now) {
    await touch(hit, now);
    return hit.caller;
  }
  let row: Row | null;
  try {
    row = await getD1().prepare("SELECT * FROM api_keys WHERE hash = ?").bind(h).first<Row>();
  } catch {
    return null;
  }
  if (!row || row.revoked_at !== null || (row.expires_at !== null && row.expires_at <= now)) return null;
  const entry = {
    caller: { owner: row.owner, keyId: row.id, scopes: JSON.parse(row.scopes) as Scope[] },
    // The cache never outlives the key: an expiry inside the window ends the entry there.
    until: Math.min(now + getEnv().API_KEY_CACHE_SECONDS * 1000, row.expires_at ?? Number.POSITIVE_INFINITY),
    touched: 0,
  };
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(h, entry);
  await touch(entry, now);
  return entry.caller;
}

/** last_used_at, written at most once a minute per key. */
async function touch(entry: { caller: KeyCaller; touched: number }, now: number): Promise<void> {
  if (now - entry.touched < TOUCH_EVERY_MS) return;
  entry.touched = now;
  await getD1().prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").bind(now, entry.caller.keyId).run().catch(() => undefined);
}

/** Tests: forget cached lookups. */
export function forgetApiKeyCache(): void {
  cache.clear();
}

/**
 * The scope a request needs when made with an API key; null = never with a key (wallet session only): key
 * management, credits and payments, provider and fleet state, session endpoints.
 */
export function scopeFor(method: string, path: string): Scope | null {
  const p = path.replace(/\/+$/, "");
  const under = (base: string) => p === base || p.startsWith(base + "/");
  if (under("/v1/keys") || under("/v1/auth") || under("/v1/payments") || under("/v1/dev") || under("/v1/providers") || under("/v1/fleets") || under("/v1/nodes")) {
    return null;
  }
  if (method === "GET" || method === "HEAD") return "read";
  if (under("/v1/jobs")) return "jobs";
  if (under("/v1/deployments") || under("/v1/ipfs")) return "deployments";
  return null;
}
