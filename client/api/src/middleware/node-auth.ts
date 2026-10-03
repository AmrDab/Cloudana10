/**
 * Node-signed requests (docs/BUILD_SPEC_V1.md §5).
 *
 *   X-Node:           node address (its own key, not the payout wallet)
 *   X-Node-Timestamp: unix ms, within ±60 s of the server clock
 *   X-Node-Signature: personal_sign over "<METHOD> <path> <timestamp> <sha256(rawBody) hex>"
 *
 * <path> is the URL pathname including /v1 (e.g. "/v1/work/submit"); an empty
 * body hashes as sha256(""). The raw body is read once here; the parsed JSON is
 * stored as c.get("nodeBody") and the address as c.get("node") (lowercase).
 */
import { createHash } from "node:crypto";
import { createMiddleware } from "hono/factory";
import { verifyMessage } from "viem";
import { fail } from "../lib/http.js";
import { isAddress, normalizeAddress } from "../lib/eth.js";

export type NodeVariables = { node: string; nodeBody: unknown };

export const NODE_SIGNATURE_WINDOW_MS = 60_000;

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** The exact message a node signs for a request. */
export function nodeSigningMessage(method: string, path: string, timestamp: string | number, rawBody: string): string {
  return `${method.toUpperCase()} ${path} ${timestamp} ${sha256Hex(rawBody)}`;
}

export const requireNode = createMiddleware<{ Variables: NodeVariables }>(async (c, next) => {
  const node = c.req.header("x-node");
  const ts = c.req.header("x-node-timestamp");
  const signature = c.req.header("x-node-signature");
  if (!node || !ts || !signature) return fail(c, "unauthorized", "Missing X-Node, X-Node-Timestamp or X-Node-Signature");
  if (!isAddress(node)) return fail(c, "unauthorized", "X-Node is not an address");
  if (!/^\d{1,16}$/.test(ts) || Math.abs(Date.now() - Number(ts)) > NODE_SIGNATURE_WINDOW_MS) {
    return fail(c, "unauthorized", "X-Node-Timestamp is outside the 60 s window");
  }
  if (!/^0x[0-9a-fA-F]+$/.test(signature)) return fail(c, "unauthorized", "Malformed X-Node-Signature");

  const rawBody = await c.req.text();
  const message = nodeSigningMessage(c.req.method, new URL(c.req.url).pathname, ts, rawBody);
  let valid = false;
  try {
    valid = await verifyMessage({ address: node as `0x${string}`, message, signature: signature as `0x${string}` });
  } catch {
    valid = false;
  }
  if (!valid) return fail(c, "unauthorized", "Invalid node signature");

  let body: unknown = {};
  if (rawBody.length > 0) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      return fail(c, "bad_request", "Invalid JSON body");
    }
  }
  c.set("node", normalizeAddress(node));
  c.set("nodeBody", body);
  await next();
});
