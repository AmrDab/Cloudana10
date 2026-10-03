import { z } from "@hono/zod-openapi";
import { successSchema } from "./common.schema.js";

export const DeployRequestSchema = z.object({
  manifest: z
    .union([z.string().min(1, "'manifest' field is required"), z.record(z.unknown())])
    .openapi({ description: "SDL YAML string or JSON workload manifest" }),
  provider: z.string().optional().openapi({ description: '"akash" (default) or another provider name' }),
  providerEndpoint: z.string().optional().openapi({ description: "Deploy directly to this Cloudana provider URL" }),
  name: z.string().optional(),
});

export const DeployResponseSchema = z
  .union([
    successSchema({
      provider: z.literal("cloudana"),
      providerEndpoint: z.string(),
      workloadId: z.string(),
      instanceId: z.string(),
      result: z.record(z.unknown()),
    }),
    successSchema({
      provider: z.literal("akash"),
      deploymentId: z.string(),
      dseq: z.string(),
      owner: z.string(),
      network: z.string(),
      message: z.string(),
    }),
  ])
  .openapi({ description: "Cloudana provider deploy result, or initiated Akash deployment" });

export const DeploymentIdParamsSchema = z.object({ id: z.string().min(1) });

export const DeploymentsResponseSchema = successSchema({ deployments: z.array(z.record(z.unknown())) });
export const DeploymentResponseSchema = successSchema({ deployment: z.record(z.unknown()) });
export const CloseDeploymentResponseSchema = successSchema({ message: z.string() });
