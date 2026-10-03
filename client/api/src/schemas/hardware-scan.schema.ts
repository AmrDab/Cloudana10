import { z } from "@hono/zod-openapi";
import { successSchema } from "./common.schema.js";

export const ScanRequestSchema = z.object({
  endpoint: z.string().min(1).max(256).openapi({ example: "http://203.0.113.10:4040" }),
});

export const DeviceIdParamsSchema = z.object({
  deviceId: z.string().min(1),
});

export const HardwareScanResultSchema = z
  .object({
    deviceId: z.string(),
    hostname: z.string(),
    scannedAt: z.number(),
    cpu: z.object({ model: z.string(), threads: z.number() }),
    ramGB: z.number(),
    disk: z.object({ totalGB: z.number().nullable(), freeGB: z.number().nullable() }),
    gpus: z.array(
      z.object({
        index: z.number(),
        vendor: z.string(),
        name: z.string(),
        vramGB: z.number(),
        driverVersion: z.string(),
        utilizationPct: z.number(),
        tflops: z.number(),
      }),
    ),
    computeScore: z.number(),
    tier: z.string(),
    signature: z.string(),
    verifiedAt: z.number(),
    endpoint: z.string(),
  })
  .openapi("HardwareScanResult");

export const ScanResponseSchema = successSchema({ scan: HardwareScanResultSchema });
export const StoredScanResponseSchema = successSchema(HardwareScanResultSchema.shape);
