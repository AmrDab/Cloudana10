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
// On-chain verification — verify crypto deposits using viem
// ─────────────────────────────────────────────────────────────────────────────

import { createPublicClient, http, parseAbiItem, formatUnits, type Hash } from "viem";
import { baseSepolia, base } from "viem/chains";

// Treasury address where CLD deposits go (set in env or use RewardContract)
const TREASURY_ADDRESS = (process.env.CLD_TREASURY_ADDRESS || "0x427830A20C4752eb30C47e0d2572A457ebF4A8AD").toLowerCase();

// CLD token address on Base Sepolia
const CLD_TOKEN_ADDRESS = (process.env.CLD_TOKEN_ADDRESS || "0xcfd19DF5a3f963Dabf52aC7B46d4780Cc0E599e2").toLowerCase();

// Track processed transactions to prevent replay
const processedTxHashes = new Set<string>();

// ERC20 Transfer event signature
const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

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

  // 1. Check for replay attack
  if (processedTxHashes.has(txHashNorm)) {
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

    // 7. Mark as processed (prevent replay)
    processedTxHashes.add(txHashNorm);

    L.info(`[Payments] ✓ Verified crypto deposit: ${formatUnits(transferredAmount, 18)} CLD from ${senderNorm} (tx: ${txHashNorm})`);
    return true;

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    L.error(`[Payments] On-chain verification error: ${msg}`);
    return false;
  }
}
