import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { generateToken } from "../src/middleware/auth.js";
import { resetEnv } from "../src/config/env.js";

const wallet = "0x00000000000000000000000000000000000000e1";
let app: ReturnType<typeof buildApp>;
let jwt: string;

describe("Stripe routes are off unless STRIPE_ENABLED=true", () => {
  beforeAll(async () => {
    delete process.env.STRIPE_ENABLED;
    await setupV1Db();
    app = buildApp({ runtime: "node" });
    jwt = await generateToken(wallet);
  });
  afterAll(() => {
    delete process.env.STRIPE_ENABLED;
    resetEnv();
  });

  const auth = () => ({ Authorization: `Bearer ${jwt}` });

  it.each([
    ["POST", "/v1/payments/checkout", JSON.stringify({ amountUsd: 10 })],
    ["POST", "/v1/payments/payment-intent", JSON.stringify({ amountUsd: 10 })],
    ["POST", "/v1/payments/webhook", "{}"],
    ["GET", "/v1/payments/session/cs_test_123", undefined],
    ["GET", "/v1/payments/convert?usd=10", undefined],
  ])("%s %s → 503 payments_disabled", async (method, path, body) => {
    const res = await app.request(path, {
      method,
      body,
      headers: { ...auth(), "Content-Type": "application/json", "stripe-signature": "t=1,v1=x" },
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "error", error: { code: "payments_disabled", message: expect.any(String) } });
  });

  it("the ledger routes (balance, history) still answer", async () => {
    const bal = await app.request("/v1/payments/balance", { headers: auth() });
    expect(bal.status).toBe(200);
    expect((await bal.json()).balance).toBe(0);
    const hist = await app.request("/v1/payments/history", { headers: auth() });
    expect(hist.status).toBe(200);
  });

  it("deposit-crypto is gone", async () => {
    const res = await app.request("/v1/payments/deposit-crypto", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ txHash: "0x" + "1".repeat(64), cldAmount: 1 }),
    });
    expect(res.status).toBe(404);
  });

  it("STRIPE_ENABLED=true (or 1, via the env.ts flag) lets a Stripe route past the gate", async () => {
    for (const v of ["true", "1"]) {
      process.env.STRIPE_ENABLED = v;
      resetEnv();
      const res = await app.request("/v1/payments/convert?usd=10");
      expect(res.status, v).toBe(200);
      expect((await res.json()).cld).toBe(1000);
    }
    process.env.STRIPE_ENABLED = "0";
    resetEnv();
    expect((await app.request("/v1/payments/convert?usd=10")).status).toBe(503);
  });
});
