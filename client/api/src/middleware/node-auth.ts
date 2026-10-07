/**
 * Node-signed requests (docs/BUILD_SPEC_V1.md §5, docs/IMPL_SPEC_2026-10.md "Node instruction signing").
 *
 *   X-Node:           node address (its own key, not the payout wallet)
 *   X-Node-Timestamp: unix ms, within ±60 s of the server clock
 *   X-Nonce:          16 random bytes as 32 hex chars (required; agents ≥ 1.1.0 — the minimum — always send it)
 *   X-Node-Signature: personal_sign over "<METHOD> <path> <timestamp> <sha256(rawBody) hex> <nonce>"
 *
 * <path> is the URL pathname including /v1 (e.g. "/v1/work/submit"); an empty
 * body hashes as sha256(""). The nonce is part of the signed message.
 * Replay: a (node, nonce) pair is accepted once; a repeat within NODE_REPLAY_TTL_SEC is 401. The check is one
 * atomic INSERT into D1 `node_nonces` (process memory when storage is not bound). Keying on the signature instead
 * (as nonce-less agents < 1.1.0 did) is not safe: ECDSA malleability yields a different valid signature for replay.
 * The raw body is read once here; the parsed JSON is stored as c.get("nodeBody") and the
 * address as c.get("node") (lowercase).
 */
import { createHash } from "node:crypto";
import { createMiddleware } from "hono/factory";
import { verifyMessage } from "viem";
import { fail } from "../lib/http.js";
import { isAddress, normalizeAddress } from "../lib/eth.js";
import { getD1 } from "../lib/storage.js";

export type NodeVariables = { node: string; nodeBody: unknown };

export const NODE_SIGNATURE_WINDOW_MS = 60_000;
/** Longer than the signature window so a request cannot be replayed once its first copy is forgotten. */
export const NODE_REPLAY_TTL_SEC = 120;
const NONCE = /^[0-9a-f]{32}$/i;

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** The exact message a node signs for a request. */
export function nodeSigningMessage(method: string, path: string, timestamp: string | number, rawBody: string, nonce?: string): string {
  return `${method.toUpperCase()} ${path} ${timestamp} ${sha256Hex(rawBody)}${nonce ? ` ${nonce}` : ""}`;
}

const seenMemory = new Map<string, number>();

/**
 * Record `key`; true when it was already recorded within the TTL. The INSERT either lands or hits the primary key,
 * so two concurrent copies of one request cannot both pass (a KV get-then-put would let them). Expired rows are
 * swept in the same batch.
 */
export async function seenBefore(key: string, ttlSec = NODE_REPLAY_TTL_SEC): Promise<boolean> {
  const now = Date.now();
  try {
    const db = getD1();
    const [, inserted] = await db.batch([
      db.prepare("DELETE FROM node_nonces WHERE expires_at <= ?").bind(now),
      db.prepare("INSERT INTO node_nonces (key, expires_at) VALUES (?, ?) ON CONFLICT(key) DO NOTHING").bind(key, now + ttlSec * 1000),
    ]);
    return (inserted.meta?.changes ?? 0) === 0;
  } catch {
    if (seenMemory.size > 10_000) for (const [k, exp] of seenMemory) if (exp <= now) seenMemory.delete(k);
    const exp = seenMemory.get(key);
    if (exp !== undefined && exp > now) return true;
    seenMemory.set(key, now + ttlSec * 1000);
    return false;
  }
}

export const requireNode = createMiddleware<{ Variables: NodeVariables }>(async (c, next) => {
  const node = c.req.header("x-node");
  const ts = c.req.header("x-node-timestamp");
  const signature = c.req.header("x-node-signature");
  const nonce = c.req.header("x-nonce");
  if (!node || !ts || !signature) return fail(c, "unauthorized", "Missing X-Node, X-Node-Timestamp or X-Node-Signature");
  if (!isAddress(node)) return fail(c, "unauthorized", "X-Node is not an address");
  if (!/^\d{1,16}$/.test(ts) || Math.abs(Date.now() - Number(ts)) > NODE_SIGNATURE_WINDOW_MS) {
    return fail(c, "unauthorized", "X-Node-Timestamp is outside the 60 s window");
  }
  if (!/^0x[0-9a-fA-F]+$/.test(signature)) return fail(c, "unauthorized", "Malformed X-Node-Signature");
  if (!nonce) return fail(c, "unauthorized", "Missing X-Nonce (upgrade the node agent)");
  if (!NONCE.test(nonce)) return fail(c, "unauthorized", "X-Nonce must be 16 bytes as hex");

  const rawBody = await c.req.text();
  const message = nodeSigningMessage(c.req.method, new URL(c.req.url).pathname, ts, rawBody, nonce);
  let valid = false;
  try {
    valid = await verifyMessage({ address: node as `0x${string}`, message, signature: signature as `0x${string}` });
  } catch {
    valid = false;
  }
  if (!valid) return fail(c, "unauthorized", "Invalid node signature");

  const address = normalizeAddress(node);
  if (await seenBefore(`${address}:${nonce.toLowerCase()}`)) {
    return fail(c, "unauthorized", "Replayed request (nonce already used)");
  }

  let body: unknown = {};
  if (rawBody.length > 0) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      return fail(c, "bad_request", "Invalid JSON body");
    }
  }
  c.set("node", address);
  c.set("nodeBody", body);
  await next();
});
