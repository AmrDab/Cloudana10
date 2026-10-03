import { z } from "@hono/zod-openapi";
import { successSchema } from "./common.schema.js";

const PlacementSummarySchema = z.record(z.unknown()).openapi({ description: "Placement summary (pending, providers, reason)" });

export const PlacementResponseSchema = successSchema({
  placements: z.array(z.object({ workloadId: z.string(), provider: z.string(), instanceId: z.string() })),
  summary: PlacementSummarySchema,
});

export const OrchestrationStatusResponseSchema = successSchema({ summary: PlacementSummarySchema });

export const ExecutePlacementResponseSchema = successSchema({
  placed: z.number(),
  failed: z.number(),
  transactions: z.array(
    z.object({
      workloadId: z.string(),
      provider: z.string(),
      instanceId: z.string(),
      txHash: z.string().optional(),
      error: z.string().optional(),
      deployFailed: z.boolean().optional(),
    }),
  ),
  summary: PlacementSummarySchema,
});

export const WorkloadIdParamsSchema = z.object({ workloadId: z.string().min(1) });

export const WorkloadManifestResponseSchema = successSchema({
  manifest: z.unknown(),
  cid: z.string(),
});

export const ProvidersResponseSchema = successSchema({
  providers: z.array(z.object({ address: z.string(), deviceId: z.string(), metadataUri: z.string() })),
});

export const ProviderStatsResponseSchema = successSchema({
  stats: z.record(z.unknown()).openapi({ description: "Real-time stats keyed by deviceId" }),
});
