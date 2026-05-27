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
    seedCache = {
      seed: block.hash ?? `0x${Date.now().toString(16).padStart(64, "0")}`,
      blockNumber: block.number,
      fetchedAt: now,
    };
  } catch {
    // Fallback seed from timestamp window (new window every 10s)
    const window = Math.floor(now / 10000);
    seedCache = {
      seed: `0x${window.toString(16).padStart(64, "0")}`,
      blockNumber: 0n,
      fetchedAt: now,
    };
  }

  return seedCache;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

/** GET /v1/pouw/seed — Get current mining seed (sigma). */
pouwRouter.get("/pouw/seed", async (c) => {
  const { seed, blockNumber, fetchedAt } = await getChainSeed();
  return c.json({ seed, blockNumber: blockNumber.toString(), fetchedAt });
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

  const cert = parsed.data;
  L.info(`[POUW:submit] Received certificate from ${cert.providerAddress.slice(0, 10)}... n=${cert.n} diff=${cert.difficulty}`);

  const result = await verifyCertificate(cert);

  if (!result.valid) {
    L.warn(`[POUW:submit] Rejected: ${result.reason}`);
    return c.json({ status: "rejected", reason: result.reason }, 422);
  }

  // Record on-chain and distribute reward asynchronously (don't block the response)
  recordOnChain(cert).catch((err) => L.error("[POUW:submit] Chain recording error:", err));
  distributeMiningReward(cert).catch((err) =>
    L.error("[POUW:submit] Reward distribution error:", err),
  );

  return c.json({
    status: "accepted",
    certificateId: result.certificateId,
    message: "Certificate verified. Mining reward being processed.",
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
