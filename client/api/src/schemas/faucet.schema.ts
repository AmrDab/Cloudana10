import { z } from "@hono/zod-openapi";
import { successSchema } from "./common.schema.js";

export const FaucetClaimRequestSchema = z.object({
  address: z.string().openapi({ example: "0x0000000000000000000000000000000000000000" }),
});

export const FaucetClaimResponseSchema = successSchema({
  txHash: z.string(),
  amount: z.string(),
  nextClaimAt: z.string(),
});

export const FaucetStatusQuerySchema = z.object({
  address: z.string().trim().min(1, "Missing address"),
});

export const FaucetStatusResponseSchema = successSchema({
  canClaim: z.boolean(),
  cooldownMs: z.number(),
  nextClaimAt: z.string().nullable(),
  dripAmount: z.string(),
});
