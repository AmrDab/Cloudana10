import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Stripe from "stripe";
import { handleWebhook } from "../src/services/stripe.service.js";
import { getUserBalance } from "../src/services/balance.service.js";
import { resetEnv } from "../src/config/env.js";

const SECRET = "whsec_test_dummy";
const payer = "0x00000000000000000000000000000000000000a1";
const other = "0x00000000000000000000000000000000000000b2";

function signed(session: Record<string, unknown>) {
  const payload = JSON.stringify({ id: "evt_1", object: "event", type: "checkout.session.completed", data: { object: session } });
  const header = new Stripe("sk_test_dummy").webhooks.generateTestHeaderString({ payload, secret: SECRET });
  return [payload, header] as const;
}

describe("checkout.session.completed credits what was paid", () => {
  beforeAll(async () => {
    await setupV1Db({ STRIPE_SECRET_KEY: "sk_test_dummy", STRIPE_WEBHOOK_SECRET: SECRET });
  });
  afterAll(() => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    resetEnv();
  });

  it("ignores caller-controlled metadata amount and recipient", async () => {
    // $1 paid; metadata claims 1,000,000 CLD for another wallet (what a caller could set before the fix).
    const [payload, header] = signed({
      id: "cs_test_1", object: "checkout.session", payment_status: "paid", currency: "usd", amount_total: 100,
      client_reference_id: payer, metadata: { userId: other, cldAmount: "1000000", amountUsd: "1" },
    });
    const res = await handleWebhook(payload, header);
    expect(res).toMatchObject({ handled: true, userId: payer, cldCredited: 10 });   // $1 at USD_PER_CLD 0.1
    expect((await getUserBalance(payer)).balance).toBe(10);
    expect((await getUserBalance(other)).balance).toBe(0);
  });

  it("credits nothing for a non-USD or zero-amount session", async () => {
    const [payload, header] = signed({
      id: "cs_test_2", object: "checkout.session", payment_status: "paid", currency: "eur", amount_total: 100,
      client_reference_id: other, metadata: { userId: other, cldAmount: "1000" },
    });
    expect(await handleWebhook(payload, header)).toMatchObject({ handled: false });
    expect((await getUserBalance(other)).balance).toBe(0);
  });
});
