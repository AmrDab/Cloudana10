import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { rateLimit } from "../src/middleware/rate-limit.js";

function buildApp() {
  const app = new Hono();
  app.use("/*", rateLimit({ bucket: "test", limit: 3, windowSec: 60 }));
  app.get("/", (c) => c.json({ ok: true }));
  return app;
}

describe("rateLimit", () => {
  it("allows requests up to the limit, then 429s with Retry-After", async () => {
    const app = buildApp();
    const headers = { "cf-connecting-ip": "1.2.3.4" };

    for (let i = 0; i < 3; i++) {
      const res = await app.request("/", { headers });
      expect(res.status).toBe(200);
    }

    const res4 = await app.request("/", { headers });
    expect(res4.status).toBe(429);
    expect(res4.headers.get("Retry-After")).toBe("60");
  });

  it("tracks a different IP independently", async () => {
    const app = buildApp();
    for (let i = 0; i < 3; i++) {
      const res = await app.request("/", { headers: { "cf-connecting-ip": "5.6.7.8" } });
      expect(res.status).toBe(200);
    }
    const other = await app.request("/", { headers: { "cf-connecting-ip": "9.9.9.9" } });
    expect(other.status).toBe(200);
  });

  it("decrements X-RateLimit-Remaining", async () => {
    const app = buildApp();
    const headers = { "cf-connecting-ip": "1.1.1.1" };
    const res1 = await app.request("/", { headers });
    expect(res1.headers.get("X-RateLimit-Remaining")).toBe("2");
    const res2 = await app.request("/", { headers });
    expect(res2.headers.get("X-RateLimit-Remaining")).toBe("1");
    const res3 = await app.request("/", { headers });
    expect(res3.headers.get("X-RateLimit-Remaining")).toBe("0");
  });
});
