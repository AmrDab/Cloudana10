import { z } from "@hono/zod-openapi";
import { successSchema } from "./common.schema.js";

export const WorkloadInstanceParamsSchema = z.object({
  workloadId: z.string().min(1),
  instanceId: z.string().min(1),
});

export const RefreshQuerySchema = z.object({
  refresh: z.string().optional().openapi({ description: '"true" to refresh from the provider first' }),
});

const WorkloadStatusDetailSchema = z
  .object({ instanceStatus: z.string(), namespace: z.string().optional(), deployedAt: z.number().optional() })
  .passthrough();

export const WorkloadStatusResponseSchema = successSchema({
  workloadId: z.string(),
  instanceId: z.string(),
  providerAddress: z.string(),
  providerEndpoint: z.string(),
  workloadStatus: WorkloadStatusDetailSchema,
  logs: z.unknown(),
  endpoints: z.unknown(),
  urls: z.array(z.string()),
  lastUpdated: z.number(),
  workloadError: z.string().optional(),
});

export const AllWorkloadStatusesResponseSchema = successSchema({
  count: z.number(),
  statuses: z.array(
    z.object({
      workloadId: z.string(),
      instanceId: z.string(),
      providerAddress: z.string(),
      status: WorkloadStatusDetailSchema,
      urls: z.array(z.string()),
      lastUpdated: z.number(),
      hasLogs: z.boolean(),
      endpointCount: z.number(),
    }),
  ),
});

export const WorkloadLogsResponseSchema = successSchema({
  workloadId: z.string(),
  instanceId: z.string(),
  namespace: z.string().optional(),
  logs: z.unknown(),
  lastUpdated: z.number(),
});

export const WorkloadEndpointsResponseSchema = successSchema({
  workloadId: z.string(),
  instanceId: z.string(),
  providerEndpoint: z.string(),
  endpoints: z.array(z.unknown()),
  urls: z.array(z.string()),
  lastUpdated: z.number(),
});

export const WorkloadUrlsResponseSchema = successSchema({
  workloadId: z.string(),
  instanceId: z.string(),
  providerEndpoint: z.string(),
  urls: z.array(z.string()),
  lastUpdated: z.number(),
});

export const WorkloadManifestResponseSchema = successSchema({
  workloadId: z.string(),
  instanceId: z.string(),
  providerEndpoint: z.string(),
  manifest: z.unknown(),
  namespace: z.string().optional(),
  deployedAt: z.number().optional(),
});
