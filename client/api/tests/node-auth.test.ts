process.env.JWT_SECRET = "x".repeat(40);

import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { requireNode, nodeSigningMessage, type NodeVariables } from "../src/middleware/node-auth.js";

const nodeKey = privateKeyToAccount(generatePrivateKey());
const otherKey = privateKeyToAccount(generatePrivateKey());

function app() {
  const a = new Hono<{ Variables: NodeVariables }>();
  a.post("/v1/nodes/heartbeat", requireNode, (c) => c.json({ node: c.get("node"), body: c.get("nodeBody") }));
  return a;
}

type SignOpts = { signer?: typeof nodeKey; ts?: number; body?: string; signedBody?: string; path?: string; nonce?: string | null; signature?: string };
async function signed(opts: SignOpts = {}) {
  const signer = opts.signer ?? nodeKey;
  const ts = opts.ts ?? Date.now();
  const body = opts.body ?? JSON.stringify({ hello: 1 });
  const nonce = opts.nonce === undefined ? randomBytes(16).toString("hex") : opts.nonce;
  const message = nodeSigningMessage("POST", opts.path ?? "/v1/nodes/heartbeat", ts, opts.signedBody ?? body, nonce ?? undefined);
  const signature = opts.signature ?? (await signer.signMessage({ message }));
  return app().request("/v1/nodes/heartbeat", {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/json",
      "X-Node": nodeKey.address,
      "X-Node-Timestamp": String(ts),
      ...(nonce !== null && { "X-Nonce": nonce }),
      "X-Node-Signature": signature,
    },
  });
}

/** The other valid ECDSA signature for the same message (s' = n - s, v flipped): what a replayer can derive. */
function malleate(sig: string): string {
  const N = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");
  const r = sig.slice(2, 66);
  const s = BigInt("0x" + sig.slice(66, 130));
  const v = Number("0x" + sig.slice(130));
  return `0x${r}${(N - s).toString(16).padStart(64, "0")}${(v === 27 ? 28 : 27).toString(16)}`;
}

describe("node-signed requests", () => {
  it("accepts a good signature and exposes the node and parsed body", async () => {
    const res = await signed();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ node: nodeKey.address.toLowerCase(), body: { hello: 1 } });
  });

  it("accepts an empty body (hash of the empty string)", async () => {
    expect((await signed({ body: "" })).status).toBe(200);
  });

  it("rejects a signature from another key", async () => {
    expect((await signed({ signer: otherKey })).status).toBe(401);
  });

  it("rejects a signature over a different body or path", async () => {
    expect((await signed({ signedBody: "{}" })).status).toBe(401);
    expect((await signed({ path: "/v1/work/submit" })).status).toBe(401);
  });

  it("rejects an expired or future timestamp", async () => {
    expect((await signed({ ts: Date.now() - 61_000 })).status).toBe(401);
    expect((await signed({ ts: Date.now() + 61_000 })).status).toBe(401);
  });

  it("requires X-Nonce: a nonce-less request is refused even when its signature is valid", async () => {
    const res = await signed({ nonce: null });
    expect(res.status).toBe(401);
    expect((await res.json()).error.message).toMatch(/nonce/i);
  });

  it("accepts a nonce once; a replay with the malleated (still valid) signature is refused too", async () => {
    const ts = Date.now();
    const nonce = randomBytes(16).toString("hex");
    const body = JSON.stringify({ hello: 2 });
    const sig = await nodeKey.signMessage({ message: nodeSigningMessage("POST", "/v1/nodes/heartbeat", ts, body, nonce) });
    expect((await signed({ ts, nonce, body, signature: sig })).status).toBe(200);
    const replay = await signed({ ts, nonce, body, signature: malleate(sig) });
    expect(replay.status).toBe(401);
    expect((await replay.json()).error.message).toMatch(/replay/i);
  });

  it("rejects missing headers", async () => {
    const res = await app().request("/v1/nodes/heartbeat", { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
  });
});
