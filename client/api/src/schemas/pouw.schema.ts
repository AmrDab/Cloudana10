import { z } from "@hono/zod-openapi";
import { successSchema } from "./common.schema.js";

const Hex64 = z.string().length(64);
const Address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected a 0x address");

export const SeedResponseSchema = successSchema({
  seed: z.string(),
  blockNumber: z.string(),
  fetchedAt: z.number(),
});

export const ClaimJobQuerySchema = z.object({
  provider: Address.openapi({ description: "Provider wallet claiming the job" }),
});

export const MatrixJobSchema = z.object({
  workloadId: z.string(),
  n: z.number(),
  matrixA: z.array(z.number()),
  matrixB: z.array(z.number()),
  difficulty: z.number(),
  expiresAt: z.number(),
});

export const ClaimJobResponseSchema = successSchema({
  job: MatrixJobSchema.nullable().openapi({ description: "null when the queue is empty" }),
});

export const JobIdParamsSchema = z.object({ id: z.string().min(1).max(64) });

export const JobSummarySchema = z.object({
  id: z.string(),
  n: z.number(),
  difficulty: z.number(),
  jobStatus: z.enum(["queued", "claimed", "done"]),
  createdAt: z.number(),
  priceCld: z.number().nullable(),
  resultHash: z.string().nullable(),
  completedAt: z.number().nullable(),
});

export const JobStatusResponseSchema = successSchema({
  ...JobSummarySchema.shape,
  /** The decoded product C = A·B. Only returned to the wallet that paid for the job. */
  result: z.array(z.number()).nullable(),
});

export const JobsListResponseSchema = successSchema({
  jobs: z.array(JobSummarySchema),
});

export const QueueDepthResponseSchema = successSchema({
  queued: z.number().openapi({ description: "Jobs waiting for a miner (incl. expired claims)" }),
  priceCldAt64: z.number().openapi({ description: "Current price of a 64×64 job in CLD credits" }),
});

export const EnqueueJobRequestSchema = z.object({
  n: z.number().int().min(8).max(1024),
  matrixA: z.array(z.number().int()).min(64),
  matrixB: z.array(z.number().int()).min(64),
  difficulty: z.number().int().min(1).max(64).default(12),
});

export const EnqueueJobResponseSchema = successSchema({
  workloadId: z.string(),
  priceCld: z.number().openapi({ description: "CLD credits debited (0 for internal seeding)" }),
  balanceCld: z.number().nullable().openapi({ description: "Owner's remaining credit balance" }),
});

export const CertificateRequestSchema = z.object({
  sigma: z.string().min(64).max(66),
  n: z.number().int().min(8).max(1024),
  r: z.number().int().min(1),
  matrixAHash: Hex64,
  matrixBHash: Hex64,
  transcriptHash: Hex64,
  z: Hex64,
  difficulty: z.number().int().min(1).max(256),
  timestamp: z.number().int(),
  providerAddress: Address,
  deviceId: z.string().startsWith("0x"),
  matrixA: z.array(z.number()).min(64).max(1024 * 1024),
  matrixB: z.array(z.number()).min(64).max(1024 * 1024),
  /** Present when the certificate was mined ON a claimed queue job (true PoUW). */
  workloadId: z.string().max(64).optional(),
  /** The decoded useful output C = A·B — required alongside workloadId. */
  result: z.array(z.number()).max(1024 * 1024).optional(),
});

export const SettlementSchema = z.object({
  backedByWorkload: z.boolean(),
  workloadId: z.string().nullable(),
  reward: z.object({
    status: z.enum(["paid", "skipped", "failed", "disabled", "not_configured"]),
    wei: z.string().nullable(),
    tx: z.string().nullable(),
    reason: z.string().nullable(),
  }),
  chain: z.object({
    status: z.enum(["recorded", "pending", "failed", "not_configured"]),
    tx: z.string().nullable(),
    reason: z.string().nullable(),
  }),
});

export const SubmitResponseSchema = successSchema({
  certificateId: z.string(),
  backedByWorkload: z.boolean(),
  settlement: SettlementSchema,
  message: z.string(),
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
