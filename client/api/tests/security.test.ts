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
  app.get("/v1/deployments", (c) => c.json({ ok: true }));
  app.get("/v1/deployments/:id/route", (c) => c.json({ ok: true }));
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

  it("GET /v1/deployments/:id/route is public with its own 3000/min bucket, not the 300/min deployments-read one", async () => {
    const app = buildApp();
    const ip = { "cf-connecting-ip": "198.51.100.77" };
    const route = await app.request("/v1/deployments/6f1c2a3e-1111-4222-8333-444455556666/route", { headers: ip });
    expect(route.status).toBe(200);
    expect(route.headers.get("X-RateLimit-Limit")).toBe("3000");
    expect(route.headers.get("X-RateLimit-Remaining")).toBe("2999");
    // Authenticated deployment reads stay JWT-gated (requireAuth runs before their own 300/min bucket).
    expect((await app.request("/v1/deployments", { headers: ip })).status).toBe(401);
  });

  it("does not auth-gate /v1/faucet/claim", async () => {
    const app = buildApp();
    const res = await app.request("/v1/faucet/claim");
    expect(res.status).toBe(200);
  });
});
