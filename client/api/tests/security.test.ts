import { describe, it, expect, beforeAll } from "vitest";
import { Hono } from "hono";
import { applySecurity } from "../src/middleware/security.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
});

function buildApp() {
  const app = new Hono();
  applySecurity(app);
  app.get("/v1/payments/balance", (c) => c.json({ ok: true }));
  app.get("/v1/providers/scan", (c) => c.json({ ok: true }));
  app.get("/v1/ipfs/pin", (c) => c.json({ ok: true }));
  app.get("/v1/faucet/claim", (c) => c.json({ ok: true }));
  return app;
}

describe("applySecurity", () => {
  it("requires auth on /v1/providers/scan", async () => {
    const app = buildApp();
    const res = await app.request("/v1/providers/scan");
    expect(res.status).toBe(401);
  });

  it("requires auth on /v1/ipfs/pin", async () => {
    const app = buildApp();
    const res = await app.request("/v1/ipfs/pin");
    expect(res.status).toBe(401);
  });

  it("does not auth-gate /v1/faucet/claim", async () => {
    const app = buildApp();
    const res = await app.request("/v1/faucet/claim");
    expect(res.status).toBe(200);
  });
});
