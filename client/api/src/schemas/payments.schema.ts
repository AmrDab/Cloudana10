import { z } from "@hono/zod-openapi";
import { successSchema } from "./common.schema.js";

const PositiveAmountUsd = z
  .number({ invalid_type_error: "amountUsd must be a positive number" })
  .positive("amountUsd must be a positive number");

export const CheckoutRequestSchema = z.object({
  amountUsd: PositiveAmountUsd,
  metadata: z.record(z.string()).optional(),
  successUrl: z.string().optional(),
  cancelUrl: z.string().optional(),
});

export const CheckoutResponseSchema = successSchema({
  sessionId: z.string(),
  url: z.string().nullable(),
  cldAmount: z.number(),
  amountUsd: z.number(),
});

export const PaymentIntentRequestSchema = z.object({
  amountUsd: PositiveAmountUsd,
});

export const PaymentIntentResponseSchema = successSchema({
  clientSecret: z.string(),
  paymentIntentId: z.string(),
  cldAmount: z.number(),
  amountUsd: z.number(),
  publishableKey: z.string(),
});

export const WebhookResponseSchema = successSchema({
  received: z.literal(true),
  event: z.string(),
  handled: z.boolean(),
  userId: z.string().optional(),
  cldCredited: z.number().optional(),
});

export const BalanceResponseSchema = successSchema({
  address: z.string(),
  balance: z.number(),
  currency: z.literal("CLD"),
  usdEquivalent: z.number(),
  updatedAt: z.string(),
});

export const HistoryQuerySchema = z.object({
  limit: z.string().optional().openapi({ description: "Page size (default 50, max 200)" }),
  offset: z.string().optional().openapi({ description: "Offset (default 0)" }),
});

export const HistoryResponseSchema = successSchema({
  address: z.string(),
  transactions: z.array(z.record(z.unknown())),
  pagination: z.object({
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
    hasMore: z.boolean(),
  }),
});

export const SessionParamsSchema = z.object({
  id: z.string().regex(/^cs_(test|live)_[A-Za-z0-9]+$/, "Invalid session id"),
});

export const SessionResponseSchema = successSchema({
  sessionId: z.string(),
  paymentStatus: z.string(),
  cldAmount: z.number(),
  amountUsd: z.number(),
  userId: z.string().nullable(),
});

export const ConvertQuerySchema = z.object({
  usd: z.string().optional().openapi({ description: "USD amount (positive number)" }),
});

export const ConvertResponseSchema = successSchema({
  usd: z.number(),
  cld: z.number(),
  rate: z.number(),
  currency: z.literal("CLD"),
});
