import { describe, it, expect, beforeAll } from "vitest";
import { Hono } from "hono";
import { sign } from "hono/jwt";
import {
  requireAuth,
  generateToken,
  issueNonce,
  consumeNonce,
  revokeToken,
  verifyBearer,
  type AuthVariables,
} from "../src/middleware/auth.js";
import { resetEnv } from "../src/config/env.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
});

function buildApp() {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.get("/protected", requireAuth, (c) => {
    const payload = c.get("jwtPayload");
    return c.json({ sub: payload.sub });
  });
  return app;
}

describe("requireAuth / generateToken", () => {
  it("accepts a valid token and exposes lowercased sub", async () => {
    const token = await generateToken("0xABCDEF0000000000000000000000000000000001");
    const app = buildApp();
    const res = await app.request("/protected", { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sub).toBe("0xabcdef0000000000000000000000000000000001");
  });

  it("rejects a missing header", async () => {
    const app = buildApp();
    const res = await app.request("/protected");
    expect(res.status).toBe(401);
  });

  it("rejects a non-Bearer header", async () => {
    const app = buildApp();
    const res = await app.request("/protected", { headers: { Authorization: "Basic abc123" } });
    expect(res.status).toBe(401);
  });

  it("rejects a garbage token", async () => {
    const app = buildApp();
    const res = await app.request("/protected", { headers: { Authorization: "Bearer not-a-jwt" } });
    expect(res.status).toBe(401);
  });

  it("rejects a token signed with a different secret", async () => {
    const badToken = await sign(
      { sub: "0xabc", role: "user", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 },
      "wrong-secret",
    );
    const app = buildApp();
    const res = await app.request("/protected", { headers: { Authorization: `Bearer ${badToken}` } });
    expect(res.status).toBe(401);
  });
});

describe("issueNonce / consumeNonce", () => {
  it("returns a message containing the lowercased address and the nonce", async () => {
    const issued = await issueNonce("0xABCDEF0000000000000000000000000000000002");
    expect(issued.message).toContain("0xabcdef0000000000000000000000000000000002");
    expect(issued.message).toContain(issued.nonce);
  });

  it("succeeds once with the exact message, then fails on second use", async () => {
    const address = "0xABCDEF0000000000000000000000000000000003";
    const issued = await issueNonce(address);
    expect(await consumeNonce(address, issued.message)).toBe(true);
    expect(await consumeNonce(address, issued.message)).toBe(false);
  });

  it("fails with an altered message", async () => {
    const address = "0xABCDEF0000000000000000000000000000000004";
    const issued = await issueNonce(address);
    expect(await consumeNonce(address, issued.message + "x")).toBe(false);
  });

  it("fails for a different address", async () => {
    const address = "0xABCDEF0000000000000000000000000000000005";
    const other = "0xABCDEF0000000000000000000000000000000006";
    const issued = await issueNonce(address);
    expect(await consumeNonce(other, issued.message)).toBe(false);
  });
});

describe("session lifecycle (B-7)", () => {
  it("tokens carry a jti and the configured lifetime; a revoked one is refused at once", async () => {
    const token = await generateToken("0xABCDEF0000000000000000000000000000000002");
    const payload = (await verifyBearer(token))!;
    expect(payload.jti).toMatch(/^[0-9a-f]{32}$/);
    expect(payload.auth).toBe("wallet");
    expect(payload.exp - payload.iat).toBe(86_400);
    const app = buildApp();
    expect((await app.request("/protected", { headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);
    expect(await revokeToken(payload)).toBe(true);
    expect((await app.request("/protected", { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401);
    // A token minted before jti existed cannot be revoked, only expire.
    expect(await revokeToken({ exp: payload.exp })).toBe(false);
  });

  it("accepts tokens signed with JWT_SECRET_PREVIOUS during a rotation, and nothing else", async () => {
    process.env.JWT_SECRET_PREVIOUS = "the-secret-before-rotation";
    resetEnv();
    try {
      const claims = { sub: "0xabc", role: "user", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 };
      const old = await sign(claims, "the-secret-before-rotation");
      const current = await sign(claims, "test-secret");
      const wrong = await sign(claims, "some-other-secret");
      const app = buildApp();
      expect((await app.request("/protected", { headers: { Authorization: `Bearer ${old}` } })).status).toBe(200);
      expect((await app.request("/protected", { headers: { Authorization: `Bearer ${current}` } })).status).toBe(200);
      expect((await app.request("/protected", { headers: { Authorization: `Bearer ${wrong}` } })).status).toBe(401);
    } finally {
      delete process.env.JWT_SECRET_PREVIOUS;
      resetEnv();
    }
  });

  it("an API key against an app without storage is refused, not an error", async () => {
    const app = buildApp();
    const res = await app.request("/protected", { headers: { Authorization: "Bearer cld_sk_" + "a".repeat(32) } });
    expect(res.status).toBe(401);
  });
});
