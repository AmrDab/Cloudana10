import { z } from "@hono/zod-openapi";
import { successSchema } from "./common.schema.js";

export const SeedResponseSchema = successSchema({
  seed: z.string(),
  blockNumber: z.string(),
  fetchedAt: z.number(),
});

export const NetworkStatsResponseSchema = successSchema({
  totalCertificates: z.number(),
  activeProviders: z.number(),
  certsLast1Min: z.number(),
  certsLast5Min: z.number(),
  networkHashRate: z.number(),
  totalDifficultyMined: z.number(),
});

export const LeaderboardResponseSchema = successSchema({
  providers: z.array(z.record(z.unknown())),
});

export const CertificatesQuerySchema = z.object({
  provider: z.string().optional().openapi({ description: "Filter by provider address" }),
  limit: z.string().optional(),
});

export const CertificatesResponseSchema = successSchema({
  certificates: z.array(
    z.object({
      id: z.string(),
      providerAddress: z.string(),
      deviceId: z.string(),
      n: z.number(),
      difficulty: z.number(),
      z: z.string(),
      transcriptHash: z.string(),
      verifiedAt: z.number(),
    }),
  ),
});
