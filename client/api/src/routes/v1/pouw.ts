/**
 * PoUW API — Proof of Useful Work.
 *
 * The loop this router closes:
 *   a wallet pays CLD credits to queue a matrix job     POST /pouw/job      (JWT)
 *   a miner claims it                                    GET  /pouw/job?provider=
 *   the miner submits certificate + result C             POST /pouw/submit
 *   the API verifies by full re-execution, pays the provider, records on Base,
 *   and the owner reads C                                GET  /pouw/job/{id} (JWT)
 *
 * Every settlement outcome (reward paid / skipped / not configured, chain
 * recorded / failed) is returned in the response and persisted — nothing is
 * fire-and-forget.
 */

import { createRoute } from "@hono/zod-openapi";
import { createMiddleware } from "hono/factory";
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { ok, fail } from "../../lib/http.js";
import { getEnv } from "../../config/env.js";
import { getRpcUrl } from "../../config/contracts.js";
import { log } from "../../lib/logger.js";
import { optionalCaller, requireAuth, type AuthVariables } from "../../middleware/auth.js";
import { verifyCertificate } from "../../services/pouw-verifier.service.js";
import { getCertificates, getMiningLeaderboard, getNetworkStats } from "../../services/certificate-store.service.js";
import { claimJob, completeJob, countQueuedJobs, enqueueJob, getJob, listJobsForOwner, type MatrixJob } from "../../services/matrix-job-queue.service.js";
import { retryUnrecordedCertificates, settleCertificate } from "../../services/pouw-settlement.service.js";
import { feeUcld, getPriceQuote } from "../../services/pricing.service.js";
import { debitBalance, getUserBalance, ucldToCld } from "../../services/balance.service.js";
import {
  CertificateRequestSchema,
  CertificatesQuerySchema,
  CertificatesResponseSchema,
  ClaimJobQuerySchema,
  ClaimJobResponseSchema,
  EnqueueJobRequestSchema,
  EnqueueJobResponseSchema,
  JobIdParamsSchema,
  JobStatusResponseSchema,
  JobsListResponseSchema,
  LeaderboardResponseSchema,
  NetworkStatsResponseSchema,
  QueueDepthResponseSchema,
  SeedResponseSchema,
  SubmitResponseSchema,
} from "../../schemas/pouw.schema.js";
import { BEARER_AUTH, createRouter, json, responses } from "./_openapi.js";

export const pouwRouter = createRouter();
const L = log.pouw;
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

// ─── Matrix job queue (the supply of paid, useful work) ──────────────────────

const summarize = (job: MatrixJob) => ({
  id: job.id,
  n: job.n,
  difficulty: job.difficulty,
  jobStatus: job.status,
  createdAt: job.createdAt,
  priceCld: job.priceCld ?? null,
  resultHash: job.resultHash ?? null,
  completedAt: job.completedAt ?? null,
});

const queueRoute = createRoute({
  method: "get",
  path: "/pouw/queue",
  tags: TAGS,
  responses: responses({ 200: json(QueueDepthResponseSchema, "Queue depth and current job price") }, 500),
});

/** The protocol job fee (pricing.service) in CLD, for this CLD-denominated legacy route. */
async function jobPriceCld(n: number): Promise<number> {
  const quote = await getPriceQuote();
  return ucldToCld(feeUcld(n ** 3, quote.priceNcldPerTmac, getEnv().BASE_FEE_UCLD));
}

pouwRouter.openapi(queueRoute, async (c) => {
  return ok(c, { queued: await countQueuedJobs(), priceCldAt64: await jobPriceCld(64) });
});

/** GET /v1/pouw/job?provider=0x… — a miner claims the next job. */
const claimJobRoute = createRoute({
  method: "get",
  path: "/pouw/job",
  tags: TAGS,
  request: { query: ClaimJobQuerySchema },
  responses: responses({ 200: json(ClaimJobResponseSchema, "Claimed job, or job: null when the queue is empty") }, 400),
});

pouwRouter.openapi(claimJobRoute, async (c) => {
  const { provider } = c.req.valid("query");
  const job = await claimJob(provider);
  if (!job) return ok(c, { job: null });
  return ok(c, {
    job: {
      workloadId: job.id,
      n: job.n,
      matrixA: job.matrixA,
      matrixB: job.matrixB,
      difficulty: job.difficulty,
      expiresAt: job.expiresAt ?? 0,
    },
  });
});

/** Internal seeding (X-Internal-Key) or a paying wallet (JWT). */
function isInternalCaller(c: { req: { header: (k: string) => string | undefined } }): boolean {
  const key = getEnv().INTERNAL_API_KEY;
  return !!key && c.req.header("x-internal-key") === key;
}

const requireJobAuthority = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  if (isInternalCaller(c)) return next();
  return requireAuth(c, next);
});

/** POST /v1/pouw/job — queue a matrix job. Wallets pay in CLD credits. */
const enqueueJobRoute = createRoute({
  method: "post",
  path: "/pouw/job",
  tags: TAGS,
  description:
    "Queue a real matrix multiplication for the network to compute. A signed-in wallet is charged the protocol " +
    "job fee (BASE_FEE_UCLD + n³ at the current nCLD/TMAC quote) in CLD credits; the X-Internal-Key header seeds work without charge.",
  security: BEARER_AUTH,
  middleware: [requireJobAuthority] as const,
  request: { body: { required: true, content: { "application/json": { schema: EnqueueJobRequestSchema } } } },
  responses: responses({ 200: json(EnqueueJobResponseSchema, "Job queued") }, 400, 401, 422),
});

pouwRouter.openapi(enqueueJobRoute, async (c) => {
  const { n, matrixA, matrixB, difficulty: requested } = c.req.valid("json");
  if (matrixA.length !== n * n || matrixB.length !== n * n) {
    return fail(c, "validation_failed", `matrices must be n*n = ${n * n} elements`);
  }
  // A certificate below the network minimum is rejected at verification, so a
  // job asking for less could never be settled as backed. Clamp at intake.
  const difficulty = Math.max(requested, getEnv().POUW_MIN_DIFFICULTY);

  if (isInternalCaller(c)) {
    const job = await enqueueJob({ n, matrixA, matrixB, difficulty });
    return ok(c, { workloadId: job.id, priceCld: 0, balanceCld: null });
  }

  const owner = c.get("jwtPayload").sub;
  const price = await jobPriceCld(n);
  const current = await getUserBalance(owner);
  if (current.balance < price) {
    return fail(c, "unprocessable", `Insufficient CLD credits: job costs ${price}, balance is ${current.balance}`);
  }

  const job = await enqueueJob({ n, matrixA, matrixB, difficulty, owner, priceCld: price });
  const { balance } = await debitBalance(owner, price, job.id);
  L.info(`[POUW:job] ${owner.slice(0, 10)}… paid ${price} CLD for job ${job.id} (n=${n})`);
  return ok(c, { workloadId: job.id, priceCld: price, balanceCld: balance.balance });
});

/** GET /v1/pouw/jobs — the signed-in wallet's jobs. */
const listJobsRoute = createRoute({
  method: "get",
  path: "/pouw/jobs",
  tags: TAGS,
  security: BEARER_AUTH,
  middleware: [requireAuth] as const,
  responses: responses({ 200: json(JobsListResponseSchema, "Jobs paid for by the caller, newest first") }, 401),
});

pouwRouter.openapi(listJobsRoute, async (c) => {
  const jobs = await listJobsForOwner(c.get("jwtPayload").sub);
  return ok(c, { jobs: jobs.map(summarize) });
});

/** GET /v1/pouw/job/{id} — status; the result only for the wallet that paid. */
const jobStatusRoute = createRoute({
  method: "get",
  path: "/pouw/job/{id}",
  tags: TAGS,
  security: BEARER_AUTH,
  request: { params: JobIdParamsSchema },
  responses: responses({ 200: json(JobStatusResponseSchema, "Job status; result once done, for the owner") }, 404),
});

pouwRouter.openapi(jobStatusRoute, async (c) => {
  const job = await getJob(c.req.valid("param").id);
  if (!job) return fail(c, "not_found", "Job not found");
  const caller = await optionalCaller(c);
  const mayReadResult = !job.owner || caller?.sub === job.owner;
  return ok(c, {
    ...summarize(job),
    result: job.status === "done" && mayReadResult ? job.result ?? null : null,
  });
});

// ─── Certificates ────────────────────────────────────────────────────────────

/** POST /v1/pouw/submit — a miner submits a certificate (+ result if backed). */
const submitRoute = createRoute({
  method: "post",
  path: "/pouw/submit",
  tags: TAGS,
  request: { body: { required: true, content: { "application/json": { schema: CertificateRequestSchema } } } },
  responses: responses({ 200: json(SubmitResponseSchema, "Certificate verified; settlement outcome included") }, 400, 422, 429),
});

pouwRouter.openapi(submitRoute, async (c) => {
  const { result: usefulResult, ...cert } = c.req.valid("json");
  L.info(`[POUW:submit] ${cert.providerAddress.slice(0, 10)}… n=${cert.n} d=${cert.difficulty}${cert.workloadId ? ` job=${cert.workloadId}` : " (filler)"}`);

  const verdict = await verifyCertificate(cert);
  if (!verdict.valid || !verdict.certificateId) {
    L.warn(`[POUW:submit] Rejected: ${verdict.reason}`);
    return fail(c, "unprocessable", verdict.reason ?? "Certificate rejected");
  }

  // "Backed" is decided by the queue, server-side — never by the payload. The job
  // must exist, be claimed by this provider, be unexpired, and C must be n×n.
  let backedByWorkload = false;
  if (cert.workloadId && usefulResult) {
    backedByWorkload = await completeJob(cert.workloadId, cert.providerAddress, usefulResult);
    if (!backedByWorkload) {
      L.warn(`[POUW:submit] job ${cert.workloadId} did not validate (unclaimed/expired/foreign) — filler`);
    }
  }

  const settlement = await settleCertificate(
    verdict.certificateId,
    cert,
    backedByWorkload,
    backedByWorkload ? (cert.workloadId ?? null) : null,
  );

  // Opportunistic: clear a little of any on-chain backlog on each accepted cert.
  retryUnrecordedCertificates(2).catch(() => undefined);

  const message = backedByWorkload
    ? `Verified against a paid job. Reward: ${settlement.reward.status}. On-chain record: ${settlement.chain.status}.`
    : `Verified as filler (no paid job attached). Reward: ${settlement.reward.status}. On-chain record: ${settlement.chain.status}.`;

  return ok(c, {
    certificateId: verdict.certificateId,
    backedByWorkload,
    settlement: {
      backedByWorkload: settlement.backedByWorkload,
      workloadId: settlement.workloadId,
      reward: settlement.reward,
      chain: { status: settlement.chain.status, tx: settlement.chain.tx, reason: settlement.chain.reason },
    },
    message,
  });
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
