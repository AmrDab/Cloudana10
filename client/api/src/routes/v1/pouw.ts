/**
 * PoUW API — read-only legacy views (seed, stats, leaderboard, certificates).
 *
 * The legacy write path (POST /pouw/job, GET /pouw/job, /pouw/jobs, /pouw/job/{id}, /pouw/queue, POST /pouw/submit)
 * was removed on 2026-10-13 (docs/POUW_REVIEW.md §7): it charged credits without binding the certificate to the
 * job's inputs or checking C. Paid matrix work goes through /v1/jobs and /v1/work (assigned σ, Freivalds, ledger).
 */

import { createRoute } from "@hono/zod-openapi";
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { ok, fail } from "../../lib/http.js";
import { getRpcUrl } from "../../config/contracts.js";
import { getCertificates, getMiningLeaderboard, getNetworkStats } from "../../services/certificate-store.service.js";
import {
  CertificatesQuerySchema,
  CertificatesResponseSchema,
  LeaderboardResponseSchema,
  NetworkStatsResponseSchema,
  SeedResponseSchema,
} from "../../schemas/pouw.schema.js";
import { createRouter, json, responses } from "./_openapi.js";

export const pouwRouter = createRouter();
const TAGS = ["PoUW"];

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
    const client = createPublicClient({ chain: baseSepolia, transport: http(getRpcUrl()) });
    const block = await client.getBlock({ blockTag: "latest" });
    if (!block.hash) throw new Error("no block hash");
    seedCache = { seed: block.hash, blockNumber: block.number, fetchedAt: now };
  } catch (err) {
    // NO predictable fallback: a timestamp-window seed can be pre-mined. A stale
    // REAL block hash is safe (still unpredictable when it was minted); if we
    // have never seen one, the caller gets an error and waits.
    if (seedCache) return seedCache;
    throw new Error(`chain seed unavailable: ${err instanceof Error ? err.message : err}`);
  }

  return seedCache;
}

const seedRoute = createRoute({
  method: "get",
  path: "/pouw/seed",
  tags: TAGS,
  responses: responses({ 200: json(SeedResponseSchema, "Current mining seed (latest block hash)") }, 502),
});

pouwRouter.openapi(seedRoute, async (c) => {
  try {
    const { seed, blockNumber, fetchedAt } = await getChainSeed();
    return ok(c, { seed, blockNumber: blockNumber.toString(), fetchedAt });
  } catch {
    return fail(c, "upstream_failed", "chain seed unavailable — retry shortly");
  }
});

const statsRoute = createRoute({
  method: "get",
  path: "/pouw/stats",
  tags: TAGS,
  responses: responses({ 200: json(NetworkStatsResponseSchema, "Network-wide mining stats") }, 500),
});

pouwRouter.openapi(statsRoute, async (c) => ok(c, await getNetworkStats()));

const leaderboardRoute = createRoute({
  method: "get",
  path: "/pouw/leaderboard",
  tags: TAGS,
  responses: responses({ 200: json(LeaderboardResponseSchema, "Provider mining leaderboard") }, 500),
});

pouwRouter.openapi(leaderboardRoute, async (c) => ok(c, { providers: await getMiningLeaderboard() }));

const certificatesRoute = createRoute({
  method: "get",
  path: "/pouw/certificates",
  tags: TAGS,
  request: { query: CertificatesQuerySchema },
  responses: responses({ 200: json(CertificatesResponseSchema, "Recent verified certificates") }, 500),
});

pouwRouter.openapi(certificatesRoute, async (c) => {
  const { provider, limit } = c.req.valid("query");
  const certs = await getCertificates({ providerAddress: provider, limit: limit ? Number(limit) : 50 });
  return ok(c, {
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
