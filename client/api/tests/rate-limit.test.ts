import { describe, it, expect, afterEach } from "vitest";
import { Hono } from "hono";
import { rateLimit, setRateLimiters, type RateLimiter } from "../src/middleware/rate-limit.js";

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

  describe("with the Workers rate-limiting binding (B-25)", () => {
    afterEach(() => setRateLimiters({}));
    /** A binding stand-in: `limit` passes within its fixed limit, per key, and counts its calls. */
    const fake = (limit: number) => {
      const counts = new Map<string, number>();
      const limiter: RateLimiter & { calls: number } = {
        calls: 0,
        async limit({ key }) {
          limiter.calls++;
          const n = (counts.get(key) ?? 0) + 1;
          counts.set(key, n);
          return { success: n <= limit };
        },
      };
      return limiter;
    };

    it("a shared bucket with a bound (limit, window) counts in the binding, per bucket and key, with no Remaining header", async () => {
      const rl = fake(3);
      setRateLimiters({ RL_3_60: rl, OTHER: "x" });
      const app = new Hono();
      app.use("/a", rateLimit({ bucket: "a", limit: 3, windowSec: 60 }));
      app.use("/b", rateLimit({ bucket: "b", limit: 3, windowSec: 60 }));
      app.get("/*", (c) => c.json({ ok: true }));
      const headers = { "cf-connecting-ip": "7.7.7.7" };
      for (let i = 0; i < 3; i++) expect((await app.request("/a", { headers })).status).toBe(200);
      const over = await app.request("/a", { headers });
      expect(over.status).toBe(429);
      expect(over.headers.get("X-RateLimit-Limit")).toBe("3");
      expect(over.headers.get("X-RateLimit-Remaining")).toBeNull();
      expect((await app.request("/b", { headers })).status).toBe(200); // another bucket, same IP
      expect(rl.calls).toBe(5);
    });

    it("an unmatched (limit, window), a memory bucket and a failing binding use the counter", async () => {
      const rl = fake(3);
      const broken: RateLimiter = { limit: async () => { throw new Error("binding down"); } };
      setRateLimiters({ RL_3_60: rl, RL_2_60: broken });
      const app = new Hono();
      app.use("/kv", rateLimit({ bucket: "kv", limit: 4, windowSec: 60 }));
      app.use("/mem", rateLimit({ bucket: "mem", limit: 3, windowSec: 60, store: "memory" }));
      app.use("/down", rateLimit({ bucket: "down", limit: 2, windowSec: 60 }));
      app.get("/*", (c) => c.json({ ok: true }));
      const headers = { "cf-connecting-ip": "8.8.8.8" };
      expect((await app.request("/kv", { headers })).headers.get("X-RateLimit-Remaining")).toBe("3");
      expect((await app.request("/mem", { headers })).headers.get("X-RateLimit-Remaining")).toBe("2");
      expect(rl.calls).toBe(0);
      for (let i = 0; i < 2; i++) expect((await app.request("/down", { headers })).status).toBe(200);
      expect((await app.request("/down", { headers })).status).toBe(429); // counted in memory after the binding failed
    });
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
