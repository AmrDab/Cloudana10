/**
 * Payment Routes — v1/payments
 *
 * POST /v1/payments/checkout        — Create Stripe hosted checkout session   (Stripe; 503 unless STRIPE_ENABLED=true)
 * POST /v1/payments/payment-intent  — Create Stripe payment intent            (Stripe; 503 unless STRIPE_ENABLED=true)
 * POST /v1/payments/webhook         — Stripe webhook handler (raw body)       (Stripe; 503 unless STRIPE_ENABLED=true)
 * GET  /v1/payments/session/:id     — Confirm a hosted-checkout session       (Stripe; 503 unless STRIPE_ENABLED=true)
 * GET  /v1/payments/convert         — USD→CLD preview                         (Stripe; 503 unless STRIPE_ENABLED=true)
 * GET  /v1/payments/balance         — Get user's CLD credit balance
 * GET  /v1/payments/history         — Transaction history
 *
 * Card payments are off during the testnet (docs/DECISIONS_CONSENSUS.md): every
 * Stripe route answers 503 `payments_disabled` unless STRIPE_ENABLED === "true".
 * Crypto deposits are credited by the Settlement `Deposited` watcher
 * (services/deposit-watcher.service.ts), not by a client-reported transfer.
 *
 * Every route except the Stripe webhook and the public USD→CLD preview requires a
 * JWT (see /v1/auth). The caller's wallet is always `jwtPayload.sub` — never a
 * body field, header value or query param the client could set to someone else's
 * address.
 */

import { createRoute } from "@hono/zod-openapi";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { getEnv } from "../../config/env.js";
import { log } from "../../lib/logger.js";
import { ok, fail, errorMessage } from "../../lib/http.js";
import { requireAuth } from "../../middleware/auth.js";
import {
  createCheckoutSession,
  createPaymentIntent,
  getCheckoutSession,
  handleWebhook,
  convertUsdToCld,
} from "../../services/stripe.service.js";
import { getUserBalance, getTransactionHistory } from "../../services/balance.service.js";
import {
  BalanceResponseSchema,
  CheckoutRequestSchema,
  CheckoutResponseSchema,
  ConvertQuerySchema,
  ConvertResponseSchema,
  HistoryQuerySchema,
  HistoryResponseSchema,
  PaymentIntentRequestSchema,
  PaymentIntentResponseSchema,
  SessionParamsSchema,
  SessionResponseSchema,
  WebhookResponseSchema,
} from "../../schemas/payments.schema.js";
import { BEARER_AUTH, createRouter, json, responses } from "./_openapi.js";

const L = log.api;
const TAGS = ["Payments"];

export const paymentsRouter = createRouter();

// ─────────────────────────────────────────────────────────────────────────────
// Stripe gate — card payments are off unless STRIPE_ENABLED=true (default off; env.ts flag).
// ─────────────────────────────────────────────────────────────────────────────

export function stripeEnabled(): boolean {
  return getEnv().STRIPE_ENABLED;
}

export function paymentsDisabled(c: Context) {
  return c.json(
    { status: "error" as const, error: { code: "payments_disabled" as const, message: "Card payments are off during testnet." } },
    503,
  );
}

const requireStripe = createMiddleware(async (c, next) => {
  if (!stripeEnabled()) return paymentsDisabled(c);
  await next();
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/payments/checkout
// ─────────────────────────────────────────────────────────────────────────────

const checkoutRoute = createRoute({
  method: "post",
  path: "/payments/checkout",
  tags: TAGS,
  security: BEARER_AUTH,
  middleware: [requireStripe, requireAuth] as const,
  request: { body: { required: true, content: { "application/json": { schema: CheckoutRequestSchema } } } },
  responses: responses({ 200: json(CheckoutResponseSchema, "Hosted checkout session created") }, 400, 401, 429, 500, 503),
});

paymentsRouter.openapi(checkoutRoute, async (c) => {
  const { amountUsd, metadata, successUrl, cancelUrl } = c.req.valid("json");
  const resolvedUserId = c.get("jwtPayload").sub;

  try {
    const result = await createCheckoutSession({
      amountUsd,
      userId: resolvedUserId,
      metadata,
      successUrl,
      cancelUrl,
    });

    return ok(c, {
      sessionId: result.sessionId,
      url: result.url,
      cldAmount: result.cldAmount,
      amountUsd: result.amountUsd,
    });
  } catch (err) {
    const msg = errorMessage(err);
    L.error(`[Payments] Checkout error: ${msg}`);
    return fail(c, "internal", msg);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/payments/payment-intent  (embedded form)
// ─────────────────────────────────────────────────────────────────────────────

const paymentIntentRoute = createRoute({
  method: "post",
  path: "/payments/payment-intent",
  tags: TAGS,
  security: BEARER_AUTH,
  middleware: [requireStripe, requireAuth] as const,
  request: { body: { required: true, content: { "application/json": { schema: PaymentIntentRequestSchema } } } },
  responses: responses({ 200: json(PaymentIntentResponseSchema, "Payment intent created") }, 400, 401, 429, 500, 503),
});

paymentsRouter.openapi(paymentIntentRoute, async (c) => {
  const { amountUsd } = c.req.valid("json");
  const resolvedUserId = c.get("jwtPayload").sub;

  try {
    const result = await createPaymentIntent({ amountUsd, userId: resolvedUserId });
    return ok(c, {
      clientSecret: result.clientSecret,
      paymentIntentId: result.paymentIntentId,
      cldAmount: result.cldAmount,
      amountUsd: result.amountUsd,
      publishableKey: result.publishableKey,
    });
  } catch (err) {
    const msg = errorMessage(err);
    L.error(`[Payments] Payment intent error: ${msg}`);
    return fail(c, "internal", msg);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/payments/webhook  (Stripe sends raw body — must NOT parse JSON)
// No body schema on purpose: a validator would consume the body before the
// signature check reads the exact raw bytes.
// ─────────────────────────────────────────────────────────────────────────────

const webhookRoute = createRoute({
  method: "post",
  path: "/payments/webhook",
  tags: TAGS,
  description: "Stripe webhook. Requires the stripe-signature header; the raw body is verified as sent.",
  middleware: [requireStripe] as const,
  responses: responses({ 200: json(WebhookResponseSchema, "Event received") }, 400, 429, 503),
});

paymentsRouter.openapi(webhookRoute, async (c) => {
  const signature = c.req.header("stripe-signature");

  if (!signature) {
    return fail(c, "bad_request", "Missing stripe-signature header");
  }

  // Read raw body as text (Stripe signature verification requires the exact payload bytes)
  let rawBody: string;
  try {
    rawBody = await c.req.text();
  } catch {
    return fail(c, "bad_request", "Failed to read request body");
  }

  try {
    const result = await handleWebhook(rawBody, signature);
    return ok(c, {
      received: true,
      event: result.event,
      handled: result.handled,
      ...(result.userId && { userId: result.userId }),
      ...(result.cldCredited !== undefined && { cldCredited: result.cldCredited }),
    });
  } catch (err) {
    const msg = errorMessage(err);
    L.error(`[Payments] Webhook error: ${msg}`);
    // Return 400 so Stripe retries only on genuine signature failures
    return fail(c, "bad_request", msg);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/payments/balance
// ─────────────────────────────────────────────────────────────────────────────

const balanceRoute = createRoute({
  method: "get",
  path: "/payments/balance",
  tags: TAGS,
  security: BEARER_AUTH,
  middleware: [requireAuth] as const,
  responses: responses({ 200: json(BalanceResponseSchema, "Caller's CLD credit balance") }, 401, 429, 500),
});

paymentsRouter.openapi(balanceRoute, async (c) => {
  const address = c.get("jwtPayload").sub;

  try {
    const balance = await getUserBalance(address);
    const rate = Number(process.env.CLD_USD_RATE ?? 100);
    const usdEquivalent = balance.balance / rate;

    return ok(c, {
      address: balance.address,
      balance: balance.balance,
      currency: "CLD",
      usdEquivalent: parseFloat(usdEquivalent.toFixed(4)),
      updatedAt: balance.updatedAt,
    });
  } catch (err) {
    const msg = errorMessage(err);
    L.error(`[Payments] Balance error: ${msg}`);
    return fail(c, "internal", msg);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/payments/history
// ─────────────────────────────────────────────────────────────────────────────

const historyRoute = createRoute({
  method: "get",
  path: "/payments/history",
  tags: TAGS,
  security: BEARER_AUTH,
  middleware: [requireAuth] as const,
  request: { query: HistoryQuerySchema },
  responses: responses({ 200: json(HistoryResponseSchema, "Caller's transaction history") }, 401, 429, 500),
});

paymentsRouter.openapi(historyRoute, async (c) => {
  const address = c.get("jwtPayload").sub;

  const { limit: limitRaw, offset: offsetRaw } = c.req.valid("query");
  const limit = limitRaw ? Math.min(parseInt(limitRaw, 10) || 50, 200) : 50;
  const offset = offsetRaw ? parseInt(offsetRaw, 10) || 0 : 0;

  try {
    const { transactions, total } = await getTransactionHistory(address, { limit, offset });
    return ok(c, {
      address: address.toLowerCase(),
      transactions,
      pagination: { total, limit, offset, hasMore: offset + limit < total },
    });
  } catch (err) {
    const msg = errorMessage(err);
    L.error(`[Payments] History error: ${msg}`);
    return fail(c, "internal", msg);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/payments/session/:id  — confirm a hosted-checkout session after redirect
// ─────────────────────────────────────────────────────────────────────────────

const sessionRoute = createRoute({
  method: "get",
  path: "/payments/session/{id}",
  tags: TAGS,
  security: BEARER_AUTH,
  middleware: [requireStripe, requireAuth] as const,
  request: { params: SessionParamsSchema },
  responses: responses({ 200: json(SessionResponseSchema, "Checkout session state") }, 400, 401, 404, 429, 503),
});

paymentsRouter.openapi(sessionRoute, async (c) => {
  const { id: sessionId } = c.req.valid("param");

  try {
    const session = await getCheckoutSession(sessionId);
    // A session belongs to the wallet it was created for; don't leak others'.
    if (session.userId?.toLowerCase() !== c.get("jwtPayload").sub) {
      return fail(c, "not_found", "Session not found");
    }
    return ok(c, { ...session });
  } catch (err) {
    const msg = errorMessage(err);
    L.error(`[Payments] Session lookup error: ${msg}`);
    return fail(c, "not_found", "Session not found");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/payments/convert  (utility: USD → CLD purchase preview)
// ─────────────────────────────────────────────────────────────────────────────

const convertRoute = createRoute({
  method: "get",
  path: "/payments/convert",
  tags: TAGS,
  middleware: [requireStripe] as const,
  request: { query: ConvertQuerySchema },
  responses: responses({ 200: json(ConvertResponseSchema, "USD → CLD preview") }, 400, 429, 500, 503),
});

paymentsRouter.openapi(convertRoute, (c) => {
  const usdRaw = c.req.valid("query").usd;
  const usd = parseFloat(usdRaw ?? "0");

  if (!usdRaw || isNaN(usd) || usd <= 0) {
    return fail(c, "bad_request", "usd query param must be a positive number");
  }

  try {
    const cld = convertUsdToCld(usd);
    const rate = Number(process.env.CLD_USD_RATE ?? 100);
    return ok(c, { usd, cld, rate, currency: "CLD" });
  } catch (err) {
    return fail(c, "internal", errorMessage(err));
  }
});
