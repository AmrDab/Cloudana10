process.env.JWT_SECRET = "x".repeat(40);

import { describe, it, expect } from "vitest";
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

async function signed(opts: { signer?: typeof nodeKey; ts?: number; body?: string; signedBody?: string; path?: string } = {}) {
  const signer = opts.signer ?? nodeKey;
  const ts = opts.ts ?? Date.now();
  const body = opts.body ?? JSON.stringify({ hello: 1 });
  const message = nodeSigningMessage("POST", opts.path ?? "/v1/nodes/heartbeat", ts, opts.signedBody ?? body);
  const signature = await signer.signMessage({ message });
  return app().request("/v1/nodes/heartbeat", {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/json",
      "X-Node": nodeKey.address,
      "X-Node-Timestamp": String(ts),
      "X-Node-Signature": signature,
    },
  });
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

  it("rejects missing headers", async () => {
    const res = await app().request("/v1/nodes/heartbeat", { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
  });
});
