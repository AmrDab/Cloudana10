import { describe, it, expect, beforeAll } from "vitest";
import { Hono } from "hono";
import { sign } from "hono/jwt";
import {
  requireAuth,
  generateToken,
  issueNonce,
  consumeNonce,
  type AuthVariables,
} from "../src/middleware/auth.js";

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
