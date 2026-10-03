import { z } from "@hono/zod-openapi";
import { successSchema } from "./common.schema.js";

export const ProviderAddressParamsSchema = z.object({ providerAddress: z.string().min(1) });

/** Owner may be passed as ?owner=0x… or the X-Owner-Address header. */
export const OwnerQuerySchema = z.object({
  owner: z.string().optional().openapi({ description: "Provider owner address (or X-Owner-Address header)" }),
});

export const OwnerHeaderSchema = z.object({
  "x-owner-address": z.string().optional(),
});

export const ProviderLogsQuerySchema = OwnerQuerySchema.extend({
  limit: z.string().optional().openapi({ description: "Max entries (default 500, max 5000)" }),
  since: z.string().optional().openapi({ description: "Only entries after this timestamp (ms)" }),
  level: z.string().optional(),
  category: z.string().optional(),
});

export const ProviderLogsResponseSchema = successSchema({
  providerAddress: z.string(),
  logs: z.unknown(),
  stats: z.unknown(),
  query: z.object({
    limit: z.number(),
    sinceTimestamp: z.number().optional(),
    level: z.string().optional(),
    category: z.string().optional(),
  }),
});

export const ProviderDiagnosticsResponseSchema = successSchema({
  providerAddress: z.string(),
  diagnostics: z.unknown(),
});

export const ProviderHealthResponseSchema = successSchema({
  providerAddress: z.string(),
  health: z.unknown(),
});
