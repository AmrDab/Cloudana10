/**
 * Stripe Service — payment processing for Cloudana CLD credits.
 *
 * Supports:
 *   - Hosted Checkout (redirect flow)
 *   - Payment Intents (embedded form)
 *   - Webhook event processing
 *   - USD → CLD conversion
 *   - Auto-crediting user balance on payment confirmation
 */

import Stripe from "stripe";
import { log } from "../lib/logger.js";
import { creditBalance } from "./balance.service.js";

const L = log.api;

// ─────────────────────────────────────────────────────────────────────────────
// Stripe client (lazy-init so the app starts even without keys in dev)
// ─────────────────────────────────────────────────────────────────────────────

let _stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error(
        "STRIPE_SECRET_KEY is not set. Configure it in .env to enable payments."
      );
    }
    _stripe = new Stripe(key, {
      apiVersion: "2026-02-25.clover",
      typescript: true,
    });
  }
  return _stripe;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLD conversion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a USD amount to CLD credits using the configured rate.
 * Default: 1 USD = 100 CLD (CLD_USD_RATE=100)
 */
export function convertUsdToCld(usdAmount: number): number {
  const rate = Number(process.env.CLD_USD_RATE ?? 100);
  if (isNaN(rate) || rate <= 0) throw new Error("Invalid CLD_USD_RATE configuration");
  return Math.floor(usdAmount * rate);
}

// ─────────────────────────────────────────────────────────────────────────────
// Checkout Session (hosted redirect)
// ─────────────────────────────────────────────────────────────────────────────

export interface CheckoutSessionParams {
  /** USD amount in dollars (e.g. 10.00 for $10) */
  amountUsd: number;
  /** Wallet address or user ID */
  userId: string;
  metadata?: Record<string, string>;
  /** URL to redirect after success */
  successUrl?: string;
  /** URL to redirect after cancel */
  cancelUrl?: string;
}

export interface CheckoutSessionResult {
  sessionId: string;
  url: string;
  cldAmount: number;
  amountUsd: number;
}

export async function createCheckoutSession(
  params: CheckoutSessionParams
): Promise<CheckoutSessionResult> {
  const { amountUsd, userId, metadata = {}, successUrl, cancelUrl } = params;

  if (amountUsd <= 0) throw new Error("Amount must be positive");
  if (!userId) throw new Error("userId is required");

  const stripe = getStripe();
  const cldAmount = convertUsdToCld(amountUsd);
  const amountCents = Math.round(amountUsd * 100);

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: amountCents,
          product_data: {
            name: `${cldAmount} CLD Credits`,
            description: `Cloudana CLD credits — ${cldAmount} CLD @ $${amountUsd.toFixed(2)} USD`,
            images: [],
          },
        },
        quantity: 1,
      },
    ],
    mode: "payment",
    success_url: successUrl ?? `${appUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl ?? `${appUrl}/payment/cancel`,
    metadata: {
      userId,
      cldAmount: String(cldAmount),
      amountUsd: String(amountUsd),
      ...metadata,
    },
    client_reference_id: userId,
  });

  L.info(`[Stripe] Created checkout session ${session.id} for user ${userId} — $${amountUsd} → ${cldAmount} CLD`);

  return {
    sessionId: session.id,
    url: session.url!,
    cldAmount,
    amountUsd,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Payment Intent (embedded form)
// ─────────────────────────────────────────────────────────────────────────────

export interface PaymentIntentParams {
  /** USD amount in dollars */
  amountUsd: number;
  /** Wallet address or user ID */
  userId: string;
}

export interface PaymentIntentResult {
  clientSecret: string;
  paymentIntentId: string;
  cldAmount: number;
  amountUsd: number;
  publishableKey: string;
}

export async function createPaymentIntent(
  params: PaymentIntentParams
): Promise<PaymentIntentResult> {
  const { amountUsd, userId } = params;

  if (amountUsd <= 0) throw new Error("Amount must be positive");
  if (!userId) throw new Error("userId is required");

  const stripe = getStripe();
  const cldAmount = convertUsdToCld(amountUsd);
  const amountCents = Math.round(amountUsd * 100);

  const intent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: "usd",
    metadata: {
      userId,
      cldAmount: String(cldAmount),
      amountUsd: String(amountUsd),
    },
    description: `${cldAmount} CLD credits for ${userId}`,
    automatic_payment_methods: { enabled: true },
  });

  L.info(`[Stripe] Created payment intent ${intent.id} for user ${userId} — $${amountUsd} → ${cldAmount} CLD`);

  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY ?? "";

  return {
    clientSecret: intent.client_secret!,
    paymentIntentId: intent.id,
    cldAmount,
    amountUsd,
    publishableKey,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook handler
// ─────────────────────────────────────────────────────────────────────────────

export interface WebhookResult {
  handled: boolean;
  event: string;
  userId?: string;
  cldCredited?: number;
}

export async function handleWebhook(
  payload: string | Buffer,
  signature: string
): Promise<WebhookResult> {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
  }

  const stripe = getStripe();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    L.error(`[Stripe] Webhook signature verification failed: ${msg}`);
    throw new Error(`Webhook signature verification failed: ${msg}`);
  }

  L.info(`[Stripe] Webhook received: ${event.type}`);

  switch (event.type) {
    // ── Hosted Checkout completed ──────────────────────────────────────────
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;

      if (session.payment_status !== "paid") {
        L.info(`[Stripe] Checkout session ${session.id} not yet paid — skipping`);
        return { handled: true, event: event.type };
      }

      const userId = session.metadata?.userId ?? session.client_reference_id;
      const cldAmount = Number(session.metadata?.cldAmount ?? 0);

      if (!userId || !cldAmount) {
        L.error(`[Stripe] Missing userId or cldAmount in session metadata for ${session.id}`);
        return { handled: false, event: event.type };
      }

      await creditUserBalance(userId, cldAmount, {
        stripeSessionId: session.id,
        amountUsd: session.metadata?.amountUsd,
      });

      return { handled: true, event: event.type, userId, cldCredited: cldAmount };
    }

    // ── Async payment intent succeeded (embedded form) ────────────────────
    case "payment_intent.succeeded": {
      const intent = event.data.object as Stripe.PaymentIntent;
      const userId = intent.metadata?.userId;
      const cldAmount = Number(intent.metadata?.cldAmount ?? 0);

      if (!userId || !cldAmount) {
        L.error(`[Stripe] Missing userId or cldAmount in intent metadata for ${intent.id}`);
        return { handled: false, event: event.type };
      }

      // Guard: only credit if not already credited via checkout.session.completed
      // (the intent is also fired for hosted checkout — avoid double-crediting)
      if (!intent.metadata?.creditedViaSession) {
        await creditUserBalance(userId, cldAmount, {
          stripeIntentId: intent.id,
          amountUsd: intent.metadata?.amountUsd,
        });
      }

      return { handled: true, event: event.type, userId, cldCredited: cldAmount };
    }

    // ── Payment failed ────────────────────────────────────────────────────
    case "payment_intent.payment_failed": {
      const intent = event.data.object as Stripe.PaymentIntent;
      const userId = intent.metadata?.userId;
      L.warn(`[Stripe] Payment failed for user ${userId ?? "unknown"} (intent: ${intent.id})`);
      return { handled: true, event: event.type, userId: userId ?? undefined };
    }

    default:
      L.info(`[Stripe] Unhandled event type: ${event.type}`);
      return { handled: false, event: event.type };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Credit user balance (internal helper, also exported for admin use)
// ─────────────────────────────────────────────────────────────────────────────

export async function creditUserBalance(
  userId: string,
  cldAmount: number,
  metadata?: Record<string, unknown>
): Promise<void> {
  if (!userId) throw new Error("userId is required");
  if (cldAmount <= 0) throw new Error("cldAmount must be positive");

  await creditBalance(userId, cldAmount, "stripe", metadata);
  L.success(`[Stripe] Credited ${cldAmount} CLD to user ${userId}`);
}
