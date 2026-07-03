/**
 * POUW API Routes — Proof of Useful Work endpoints.
 *
 * POST /v1/pouw/submit   — Provider submits a POUW certificate for verification + reward.
 * GET  /v1/pouw/seed     — Get current chain seed (sigma) for mining.
 * GET  /v1/pouw/stats    — Network-wide mining stats.
 * GET  /v1/pouw/leaderboard — Provider mining leaderboard.
 * GET  /v1/pouw/certificates — Recent verified certificates.
 */

import { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { verifyCertificate } from "../../services/pouw-verifier.service.js";
import { getCertificates, getMiningLeaderboard, getNetworkStats } from "../../services/certificate-store.service.js";
import { distributeMiningReward } from "../../services/mining-reward.service.js";
import { recordOnChain } from "../../services/pouw-chain-recorder.service.js";
import { claimJob, completeJob, enqueueJob, getJob } from "../../services/matrix-job-queue.service.js";
import { log } from "../../lib/logger.js";
import { chainId, rpcUrl } from "../../config/contracts.js";

export const pouwRouter = new OpenAPIHono();
const L = log.pouw;

// ─── Chain seed ──────────────────────────────────────────────────────────────
// Cache the latest block hash as the mining seed (refreshed every ~5s)

interface SeedCache {
  seed: string;
  blockNumber: bigint;
  fetchedAt: number;
}
let seedCache: SeedCache | null = null;
const SEED_TTL_MS = 5000;

async function getChainSeed(): Promise<SeedCache> {
  const now = Date.now();
  if (seedCache && now - seedCache.fetchedAt < SEED_TTL_MS) return seedCache;

  try {
    const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
    const block = await client.getBlock({ blockTag: "latest" });
    if (!block.hash) throw new Error("no block hash");
    seedCache = { seed: block.hash, blockNumber: block.number, fetchedAt: now };
  } catch (err) {
    // NO predictable fallback (audit finding #4): a timestamp-window seed can be
    // pre-mined. A stale REAL block hash is safe (still unpredictable when it
    // was minted); if we have never seen one, the caller gets a 503 and waits.
    if (seedCache) return seedCache;
    throw new Error(`chain seed unavailable: ${err instanceof Error ? err.message : err}`);
  }

  return seedCache;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

/** GET /v1/pouw/seed — Get current mining seed (sigma). */
pouwRouter.get("/pouw/seed", async (c) => {
  try {
    const { seed, blockNumber, fetchedAt } = await getChainSeed();
    return c.json({ seed, blockNumber: blockNumber.toString(), fetchedAt });
  } catch {
    return c.json({ status: "error", error: "chain seed unavailable — retry shortly" }, 503);
  }
});

// ─── Matrix job queue (true PoUW work supply) ────────────────────────────────

/** GET /v1/pouw/job?provider=0x… — claim the next real matrix job for mining. */
pouwRouter.get("/pouw/job", async (c) => {
  const provider = c.req.query("provider") ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(provider)) {
    return c.json({ status: "error", error: "provider query param (0x address) required" }, 400);
  }
  const job = await claimJob(provider);
  if (!job) return c.json({ status: "empty", job: null });
  return c.json({
    status: "claimed",
    job: {
      workloadId: job.id,
      n: job.n,
      matrixA: job.matrixA,
      matrixB: job.matrixB,
      difficulty: job.difficulty,
      expiresAt: job.expiresAt,
    },
  });
});

/** GET /v1/pouw/job/:id — job status (+ result once completed). */
pouwRouter.get("/pouw/job/:id", async (c) => {
  const job = await getJob(c.req.param("id"));
  if (!job) return c.json({ status: "error", error: "not found" }, 404);
  return c.json({
    id: job.id,
    n: job.n,
    difficulty: job.difficulty,
    status: job.status,
    resultHash: job.resultHash ?? null,
    result: job.status === "done" ? job.result ?? null : null,
    completedAt: job.completedAt ?? null,
  });
});

/** POST /v1/pouw/job — enqueue a real matrix job (internal; the workload
 *  pipeline calls this when a Tier-3 job is decomposed). Guarded by
 *  X-Internal-Key so the public cannot feed the reward queue. */
const EnqueueSchema = z.object({
  n: z.number().int().min(8).max(1024),
  matrixA: z.array(z.number().int()).min(64),
  matrixB: z.array(z.number().int()).min(64),
  difficulty: z.number().int().min(1).max(64).default(12),
});

pouwRouter.post("/pouw/job", async (c) => {
  const internalKey = process.env.INTERNAL_API_KEY;
  if (!internalKey) {
    return c.json({ status: "error", error: "job intake disabled (INTERNAL_API_KEY unset)" }, 503);
  }
  if (c.req.header("x-internal-key") !== internalKey) {
    return c.json({ status: "error", error: "unauthorized" }, 401);
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ status: "error", error: "Invalid JSON" }, 400);
  }
  const parsed = EnqueueSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ status: "error", error: parsed.error.issues[0]?.message ?? "Validation failed" }, 400);
  }
  const { n, matrixA, matrixB, difficulty } = parsed.data;
  if (matrixA.length !== n * n || matrixB.length !== n * n) {
    return c.json({ status: "error", error: `matrices must be n*n = ${n * n} elements` }, 400);
  }
  const job = await enqueueJob({ n, matrixA, matrixB, difficulty });
  return c.json({ status: "queued", workloadId: job.id });
});

/** POST /v1/pouw/submit — Submit a POUW certificate for verification and reward. */
const CertificateSchema = z.object({
  sigma: z.string().min(64).max(66),
  n: z.number().int().min(8).max(1024),
  r: z.number().int().min(1),
  matrixAHash: z.string().length(64),
  matrixBHash: z.string().length(64),
  transcriptHash: z.string().length(64),
  z: z.string().length(64),
  difficulty: z.number().int().min(1).max(256),
  timestamp: z.number().int(),
  providerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  deviceId: z.string().startsWith("0x"),
  matrixA: z.array(z.number()).min(64).max(1024 * 1024),
  matrixB: z.array(z.number()).min(64).max(1024 * 1024),
  /** Present when the certificate was mined ON a claimed queue job (true PoUW). */
  workloadId: z.string().max(64).optional(),
  /** The decoded useful output C = A·B — required alongside workloadId. */
  result: z.array(z.number()).max(1024 * 1024).optional(),
});

pouwRouter.post("/pouw/submit", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ status: "error", error: "Invalid JSON" }, 400);
  }

  const parsed = CertificateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ status: "error", error: parsed.error.issues[0]?.message ?? "Validation failed" }, 400);
  }

  const { result: usefulResult, ...cert } = parsed.data;
  L.info(`[POUW:submit] Received certificate from ${cert.providerAddress.slice(0, 10)}... n=${cert.n} diff=${cert.difficulty}${cert.workloadId ? ` workload=${cert.workloadId}` : " (filler)"}`);

  const result = await verifyCertificate(cert);

  if (!result.valid) {
    L.warn(`[POUW:submit] Rejected: ${result.reason}`);
    return c.json({ status: "rejected", reason: result.reason }, 422);
  }

  // TRUE PoUW gate: "backed" is decided by the QUEUE (server-side), never by
  // the submitted payload. The job must exist, be claimed by this provider,
  // be unexpired, and the result must have the right shape.
  let backedByWorkload = false;
  if (cert.workloadId && usefulResult) {
    backedByWorkload = await completeJob(cert.workloadId, cert.providerAddress, usefulResult);
    if (!backedByWorkload) {
      L.warn(`[POUW:submit] workloadId ${cert.workloadId} did not validate (unclaimed/expired/foreign) — treating as filler`);
    }
  }

  // Record on-chain and distribute reward asynchronously (don't block the response)
  recordOnChain(cert).catch((err) => L.error("[POUW:submit] Chain recording error:", err));
  distributeMiningReward(cert, backedByWorkload).catch((err) =>
    L.error("[POUW:submit] Reward distribution error:", err),
  );

  return c.json({
    status: "accepted",
    certificateId: result.certificateId,
    backedByWorkload,
    message: backedByWorkload
      ? "Certificate verified against a real workload. Full mining reward being processed."
      : "Certificate verified (filler). Reduced, capped reward being processed.",
  });
});

/** GET /v1/pouw/stats — Network-wide mining stats. */
pouwRouter.get("/pouw/stats", async (c) => {
  return c.json(await getNetworkStats());
});

/** GET /v1/pouw/leaderboard — Provider mining leaderboard. */
pouwRouter.get("/pouw/leaderboard", async (c) => {
  const leaderboard = await getMiningLeaderboard();
  return c.json({ providers: leaderboard });
});

/** GET /v1/pouw/certificates — Recent verified certificates. */
pouwRouter.get("/pouw/certificates", async (c) => {
  const { provider, limit } = c.req.query() as { provider?: string; limit?: string };
  const certs = await getCertificates({
    providerAddress: provider,
    limit: limit ? Number(limit) : 50,
  });
  return c.json({
    certificates: certs.map((sc) => ({
      id: sc.id,
      providerAddress: sc.cert.providerAddress,
      deviceId: sc.cert.deviceId,
      n: sc.cert.n,
      difficulty: sc.cert.difficulty,
      z: sc.cert.z.slice(0, 16) + "...",
      transcriptHash: sc.cert.transcriptHash.slice(0, 16) + "...",
      verifiedAt: sc.verifiedAt,
    })),
  });
});
