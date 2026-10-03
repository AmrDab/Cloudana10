/**
 * Shared OpenAPI schemas for the response envelope defined in lib/http.ts.
 *
 *   success → { status: "success", ...data }
 *   failure → { status: "error", error: { code, message, details? } }
 */
import { z } from "@hono/zod-openapi";

export const ErrorCodeSchema = z.enum([
  "bad_request",
  "validation_failed",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "rate_limited",
  "payload_too_large",
  "unprocessable",
  "upstream_failed",
  "not_configured",
  "internal",
]);

export const ErrorEnvelopeSchema = z
  .object({
    status: z.literal("error"),
    error: z.object({
      code: ErrorCodeSchema,
      message: z.string(),
      details: z.unknown().optional(),
    }),
  })
  .openapi("ErrorEnvelope");

/** Wrap a payload shape in the success envelope. */
export function successSchema<T extends z.ZodRawShape>(shape: T) {
  return z.object({ status: z.literal("success"), ...shape });
}

export const EthAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address");
