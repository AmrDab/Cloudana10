/**
 * Payment Routes — v1/payments
 *
 * POST /v1/payments/checkout        — Create Stripe hosted checkout session
 * POST /v1/payments/webhook         — Stripe webhook handler (raw body required)
 * GET  /v1/payments/balance         — Get user's CLD credit balance
 * POST /v1/payments/deposit-crypto  — Record a verified crypto deposit
 * GET  /v1/payments/history         — Transaction history
 * GET  /v1/payments/session/:id     — Confirm a hosted-checkout session after redirect
 *
 * Every route except the Stripe webhook and the public USD→CLD preview requires a
 * JWT (see /v1/auth). The caller's wallet is always `jwtPayload.sub` — never a
 * body field, header value or query param the client could set to someone else's
 * address.
 */

import { createRoute } from "@hono/zod-openapi";
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
import {
  getUserBalance,
  creditBalance,
  getTransactionHistory,
} from "../../services/balance.service.js";
import {
  BalanceResponseSchema,
  CheckoutRequestSchema,
  CheckoutResponseSchema,
  ConvertQuerySchema,
  ConvertResponseSchema,
  DepositCryptoRequestSchema,
  DepositCryptoResponseSchema,
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
// POST /v1/payments/checkout
// ─────────────────────────────────────────────────────────────────────────────

const checkoutRoute = createRoute({
  method: "post",
  path: "/payments/checkout",
  tags: TAGS,
  security: BEARER_AUTH,
  middleware: [requireAuth] as const,
  request: { body: { required: true, content: { "application/json": { schema: CheckoutRequestSchema } } } },
  responses: responses({ 200: json(CheckoutResponseSchema, "Hosted checkout session created") }, 400, 401, 429, 500),
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
  middleware: [requireAuth] as const,
  request: { body: { required: true, content: { "application/json": { schema: PaymentIntentRequestSchema } } } },
  responses: responses({ 200: json(PaymentIntentResponseSchema, "Payment intent created") }, 400, 401, 429, 500),
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
  responses: responses({ 200: json(WebhookResponseSchema, "Event received") }, 400, 429),
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
// POST /v1/payments/deposit-crypto
// Record a verified crypto deposit (on-chain verification hook)
// ─────────────────────────────────────────────────────────────────────────────

const depositCryptoRoute = createRoute({
  method: "post",
  path: "/payments/deposit-crypto",
  tags: TAGS,
  security: BEARER_AUTH,
  middleware: [requireAuth] as const,
  request: { body: { required: true, content: { "application/json": { schema: DepositCryptoRequestSchema } } } },
  responses: responses(
    { 200: json(DepositCryptoResponseSchema, "Deposit verified on-chain and credited") },
    400,
    401,
    422,
    429,
    500,
  ),
});

paymentsRouter.openapi(depositCryptoRoute, async (c) => {
  const { txHash, cldAmount, chainId } = c.req.valid("json");

  // The on-chain Transfer must originate from the authenticated wallet.
  const resolvedAddress = c.get("jwtPayload").sub;

  try {
    const isVerified = await verifyCryptoDeposit(txHash, resolvedAddress, cldAmount, chainId);

    if (!isVerified) {
      return fail(c, "unprocessable", "On-chain transaction verification failed");
    }

    const { balance, transaction } = await creditBalance(resolvedAddress, cldAmount, "crypto", {
      txHash,
      chainId: String(chainId ?? "unknown"),
    });

    return ok(c, {
      address: resolvedAddress,
      cldCredited: cldAmount,
      txHash,
      transactionId: transaction.id,
      newBalance: balance.balance,
    });
  } catch (err) {
    const msg = errorMessage(err);
    L.error(`[Payments] Crypto deposit error: ${msg}`);
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
  middleware: [requireAuth] as const,
  request: { params: SessionParamsSchema },
  responses: responses({ 200: json(SessionResponseSchema, "Checkout session state") }, 400, 401, 404, 429),
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
// GET /v1/payments/convert  (utility: USD → CLD preview)
// ─────────────────────────────────────────────────────────────────────────────

const convertRoute = createRoute({
  method: "get",
  path: "/payments/convert",
  tags: TAGS,
  request: { query: ConvertQuerySchema },
  responses: responses({ 200: json(ConvertResponseSchema, "USD → CLD preview") }, 400, 429, 500),
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

// ─────────────────────────────────────────────────────────────────────────────
// On-chain verification — verify crypto deposits using viem + D1 replay guard
// ─────────────────────────────────────────────────────────────────────────────

import { createPublicClient, http, parseAbiItem, formatUnits, type Hash } from "viem";
import { baseSepolia, base } from "viem/chains";
import { getD1 } from "../../lib/storage.js";

// Treasury address where CLD deposits go (set in env or use RewardContract)
const TREASURY_ADDRESS = (process.env.CLD_TREASURY_ADDRESS || "0x427830A20C4752eb30C47e0d2572A457ebF4A8AD").toLowerCase();

// CLD token address on Base Sepolia
const CLD_TOKEN_ADDRESS = (process.env.CLD_TOKEN_ADDRESS || "0xcfd19DF5a3f963Dabf52aC7B46d4780Cc0E599e2").toLowerCase();

async function verifyCryptoDeposit(
  txHash: string,
  senderAddress: string,
  cldAmount: number,
  chainId?: string | number
): Promise<boolean> {
  // Normalize inputs
  const txHashNorm = txHash.toLowerCase() as Hash;
  const senderNorm = senderAddress.toLowerCase();
  const resolvedChainId = Number(chainId) || 84532; // Default to Base Sepolia

  // 1. Check for replay attack (D1-backed)
  const db = getD1();
  const existing = await db
    .prepare("SELECT tx_hash FROM processed_tx WHERE tx_hash = ?")
    .bind(txHashNorm)
    .first();
  if (existing) {
    L.warn(`[Payments] Replay attempt: txHash ${txHashNorm} already processed`);
    return false;
  }

  // 2. Create viem client for the correct chain
  const chain = resolvedChainId === 8453 ? base : baseSepolia;
  const rpcUrl = resolvedChainId === 8453
    ? "https://mainnet.base.org"
    : "https://sepolia.base.org";

  const client = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  try {
    // 3. Get transaction receipt
    const receipt = await client.getTransactionReceipt({ hash: txHashNorm });

    if (!receipt) {
      L.warn(`[Payments] Transaction ${txHashNorm} not found`);
      return false;
    }

    // 4. Check transaction succeeded
    if (receipt.status !== "success") {
      L.warn(`[Payments] Transaction ${txHashNorm} failed (status: ${receipt.status})`);
      return false;
    }

    // 5. Find CLD Transfer event to treasury
    let foundTransfer = false;
    let transferredAmount = 0n;

    for (const log of receipt.logs) {
      // Check if this is a Transfer event from CLD token
      if (log.address.toLowerCase() !== CLD_TOKEN_ADDRESS) continue;
      if (log.topics[0] !== "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef") continue; // Transfer signature

      // Decode Transfer event
      const from = ("0x" + (log.topics[1] as string).slice(26)).toLowerCase();
      const to = ("0x" + (log.topics[2] as string).slice(26)).toLowerCase();
      const value = BigInt(log.data);

      // Check sender and recipient
      if (from === senderNorm && to === TREASURY_ADDRESS) {
        foundTransfer = true;
        transferredAmount = value;
        break;
      }
    }

    if (!foundTransfer) {
      L.warn(`[Payments] No valid CLD transfer found in tx ${txHashNorm} from ${senderNorm} to treasury`);
      return false;
    }

    // 6. Verify amount (allow 1% tolerance for rounding)
    const expectedAmount = BigInt(Math.floor(cldAmount * 1e18)); // CLD has 18 decimals
    const tolerance = expectedAmount / 100n; // 1%
    const minAmount = expectedAmount - tolerance;
    const maxAmount = expectedAmount + tolerance;

    if (transferredAmount < minAmount || transferredAmount > maxAmount) {
      L.warn(`[Payments] Amount mismatch: expected ~${cldAmount} CLD, got ${formatUnits(transferredAmount, 18)} CLD`);
      return false;
    }

    // 7. Mark as processed (prevent replay) — D1
    await db
      .prepare("INSERT INTO processed_tx (tx_hash, sender, amount, processed_at) VALUES (?, ?, ?, ?)")
      .bind(txHashNorm, senderNorm, cldAmount, new Date().toISOString())
      .run();

    L.info(`[Payments] Verified crypto deposit: ${formatUnits(transferredAmount, 18)} CLD from ${senderNorm} (tx: ${txHashNorm})`);
    return true;

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    L.error(`[Payments] On-chain verification error: ${msg}`);
    return false;
  }
}
