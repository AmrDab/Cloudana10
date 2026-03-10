/**
 * Payment Routes — v1/payments
 *
 * POST /v1/payments/checkout        — Create Stripe hosted checkout session
 * POST /v1/payments/webhook         — Stripe webhook handler (raw body required)
 * GET  /v1/payments/balance         — Get user's CLD credit balance
 * POST /v1/payments/deposit-crypto  — Record a verified crypto deposit
 * GET  /v1/payments/history         — Transaction history
 */

import { Hono } from "hono";
import { log } from "../../lib/logger.js";
import {
  createCheckoutSession,
  createPaymentIntent,
  handleWebhook,
  convertUsdToCld,
} from "../../services/stripe.service.js";
import {
  getUserBalance,
  creditBalance,
  getTransactionHistory,
} from "../../services/balance.service.js";

const L = log.api;

export const paymentsRouter = new Hono();

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Extract caller address from Authorization header or query param */
function resolveUserId(c: { req: { header: (k: string) => string | undefined; query: (k: string) => string | undefined } }): string | null {
  // Accept: Authorization: Bearer <address>  OR  ?address=<address>
  const auth = c.req.header("authorization");
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    if (token) return token;
  }
  return c.req.query("address") ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/payments/checkout
// ─────────────────────────────────────────────────────────────────────────────

paymentsRouter.post("/payments/checkout", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ status: "error", error: "Invalid JSON body" }, 400);
  }

  const { amountUsd, userId, metadata, successUrl, cancelUrl } = body as {
    amountUsd?: number;
    userId?: string;
    metadata?: Record<string, string>;
    successUrl?: string;
    cancelUrl?: string;
  };

  // Resolve userId: body > auth header
  const resolvedUserId = userId ?? resolveUserId(c as Parameters<typeof resolveUserId>[0]) ?? null;

  if (!resolvedUserId) {
    return c.json(
      { status: "error", error: "userId is required (body field or Authorization: Bearer <address>)" },
      400
    );
  }

  if (typeof amountUsd !== "number" || amountUsd <= 0) {
    return c.json({ status: "error", error: "amountUsd must be a positive number" }, 400);
  }

  try {
    const result = await createCheckoutSession({
      amountUsd,
      userId: resolvedUserId,
      metadata,
      successUrl: typeof successUrl === "string" ? successUrl : undefined,
      cancelUrl: typeof cancelUrl === "string" ? cancelUrl : undefined,
    });

    return c.json({
      status: "success",
      sessionId: result.sessionId,
      url: result.url,
      cldAmount: result.cldAmount,
      amountUsd: result.amountUsd,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    L.error(`[Payments] Checkout error: ${msg}`);
    return c.json({ status: "error", error: msg }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/payments/payment-intent  (embedded form)
// ─────────────────────────────────────────────────────────────────────────────

paymentsRouter.post("/payments/payment-intent", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ status: "error", error: "Invalid JSON body" }, 400);
  }

  const { amountUsd, userId } = body as { amountUsd?: number; userId?: string };
  const resolvedUserId = userId ?? resolveUserId(c as Parameters<typeof resolveUserId>[0]);

  if (!resolvedUserId) {
    return c.json({ status: "error", error: "userId is required" }, 400);
  }
  if (typeof amountUsd !== "number" || amountUsd <= 0) {
    return c.json({ status: "error", error: "amountUsd must be a positive number" }, 400);
  }

  try {
    const result = await createPaymentIntent({ amountUsd, userId: resolvedUserId });
    return c.json({
      status: "success",
      clientSecret: result.clientSecret,
      paymentIntentId: result.paymentIntentId,
      cldAmount: result.cldAmount,
      amountUsd: result.amountUsd,
      publishableKey: result.publishableKey,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    L.error(`[Payments] Payment intent error: ${msg}`);
    return c.json({ status: "error", error: msg }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/payments/webhook  (Stripe sends raw body — must NOT parse JSON)
// ─────────────────────────────────────────────────────────────────────────────

paymentsRouter.post("/payments/webhook", async (c) => {
  const signature = c.req.header("stripe-signature");

  if (!signature) {
    return c.json({ status: "error", error: "Missing stripe-signature header" }, 400);
  }

  // Read raw body as text (Stripe signature verification requires the exact payload bytes)
  let rawBody: string;
  try {
    rawBody = await c.req.text();
  } catch {
    return c.json({ status: "error", error: "Failed to read request body" }, 400);
  }

  try {
    const result = await handleWebhook(rawBody, signature);
    return c.json({
      status: "success",
      received: true,
      event: result.event,
      handled: result.handled,
      ...(result.userId && { userId: result.userId }),
      ...(result.cldCredited !== undefined && { cldCredited: result.cldCredited }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    L.error(`[Payments] Webhook error: ${msg}`);
    // Return 400 so Stripe retries only on genuine signature failures
    return c.json({ status: "error", error: msg }, 400);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/payments/balance
// ─────────────────────────────────────────────────────────────────────────────

paymentsRouter.get("/payments/balance", async (c) => {
  const address = resolveUserId(c as Parameters<typeof resolveUserId>[0]);

  if (!address) {
    return c.json(
      { status: "error", error: "address is required (Authorization: Bearer <address> or ?address=<address>)" },
      400
    );
  }

  try {
    const balance = await getUserBalance(address);
    const rate = Number(process.env.CLD_USD_RATE ?? 100);
    const usdEquivalent = balance.balance / rate;

    return c.json({
      status: "success",
      address: balance.address,
      balance: balance.balance,
      currency: "CLD",
      usdEquivalent: parseFloat(usdEquivalent.toFixed(4)),
      updatedAt: balance.updatedAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    L.error(`[Payments] Balance error: ${msg}`);
    return c.json({ status: "error", error: msg }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/payments/deposit-crypto
// Record a verified crypto deposit (on-chain verification hook)
// ─────────────────────────────────────────────────────────────────────────────

paymentsRouter.post("/payments/deposit-crypto", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ status: "error", error: "Invalid JSON body" }, 400);
  }

  const { address, txHash, cldAmount, chainId } = body as {
    address?: string;
    txHash?: string;
    cldAmount?: number;
    chainId?: string | number;
  };

  const resolvedAddress = address ?? resolveUserId(c as Parameters<typeof resolveUserId>[0]);

  if (!resolvedAddress) {
    return c.json({ status: "error", error: "address is required" }, 400);
  }
  if (!txHash || typeof txHash !== "string") {
    return c.json({ status: "error", error: "txHash is required" }, 400);
  }
  if (typeof cldAmount !== "number" || cldAmount <= 0) {
    return c.json({ status: "error", error: "cldAmount must be a positive number" }, 400);
  }

  try {
    // TODO: implement on-chain verification using viem
    // Example check: verify txHash on chainId and confirm transfer to Cloudana treasury
    const isVerified = await verifyCryptoDeposit(txHash, resolvedAddress, cldAmount, chainId);

    if (!isVerified) {
      return c.json(
        { status: "error", error: "On-chain transaction verification failed" },
        422
      );
    }

    const { balance, transaction } = await creditBalance(resolvedAddress, cldAmount, "crypto", {
      txHash,
      chainId: String(chainId ?? "unknown"),
    });

    return c.json({
      status: "success",
      address: resolvedAddress,
      cldCredited: cldAmount,
      txHash,
      transactionId: transaction.id,
      newBalance: balance.balance,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    L.error(`[Payments] Crypto deposit error: ${msg}`);
    return c.json({ status: "error", error: msg }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/payments/history
// ─────────────────────────────────────────────────────────────────────────────

paymentsRouter.get("/payments/history", async (c) => {
  const address = resolveUserId(c as Parameters<typeof resolveUserId>[0]);

  if (!address) {
    return c.json(
      { status: "error", error: "address is required (Authorization: Bearer <address> or ?address=<address>)" },
      400
    );
  }

  const limitRaw = c.req.query("limit");
  const offsetRaw = c.req.query("offset");
  const limit = limitRaw ? Math.min(parseInt(limitRaw, 10) || 50, 200) : 50;
  const offset = offsetRaw ? parseInt(offsetRaw, 10) || 0 : 0;

  try {
    const { transactions, total } = await getTransactionHistory(address, { limit, offset });
    return c.json({
      status: "success",
      address: address.toLowerCase(),
      transactions,
      pagination: { total, limit, offset, hasMore: offset + limit < total },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    L.error(`[Payments] History error: ${msg}`);
    return c.json({ status: "error", error: msg }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/payments/convert  (utility: USD → CLD preview)
// ─────────────────────────────────────────────────────────────────────────────

paymentsRouter.get("/payments/convert", (c) => {
  const usdRaw = c.req.query("usd");
  const usd = parseFloat(usdRaw ?? "0");

  if (!usdRaw || isNaN(usd) || usd <= 0) {
    return c.json({ status: "error", error: "usd query param must be a positive number" }, 400);
  }

  try {
    const cld = convertUsdToCld(usd);
    const rate = Number(process.env.CLD_USD_RATE ?? 100);
    return c.json({ status: "success", usd, cld, rate, currency: "CLD" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ status: "error", error: msg }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// On-chain verification stub (implement with viem when ready)
// ─────────────────────────────────────────────────────────────────────────────

async function verifyCryptoDeposit(
  txHash: string,
  _address: string,
  _cldAmount: number,
  _chainId?: string | number
): Promise<boolean> {
  // TODO: Use viem to verify txHash on the given chain:
  //   1. Fetch transaction receipt
  //   2. Confirm it's confirmed (status=success)
  //   3. Confirm it sends to the Cloudana treasury address
  //   4. Confirm the token amount matches cldAmount (or USD equivalent)
  //   5. Guard against replay: check txHash not already processed
  L.warn(`[Payments] Crypto deposit verification for ${txHash} — stub returns true (implement with viem)`);
  return true; // stub: accept all in development
}
