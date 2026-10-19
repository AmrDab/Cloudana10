/** GET /v1/network — live network numbers for the site. Public. */
import { createRoute, z } from "@hono/zod-openapi";
import { getD1 } from "../../lib/storage.js";
import { getEnv } from "../../config/env.js";
import { ok } from "../../lib/http.js";
import { epochOf, lastSettledEpochAt } from "../../services/ledger.service.js";
import { getPriceQuote } from "../../services/pricing.service.js";
import { signPublic } from "../../services/public-signing.service.js";
import { SignatureSchema } from "./ledger.js";
import { createRouter, json, responses } from "./_openapi.js";

export const networkRouter = createRouter();

const int = z.number().int();
const networkRoute = createRoute({
  method: "get",
  path: "/network",
  tags: ["Network"],
  responses: responses({
    200: json(
      z.object({
        status: z.literal("success"),
        nodesOnline: int,
        nodesBound: int,
        jobsQueued: int,
        jobsDone: int,
        certificates: int,
        mintedUcld: int,
        burnedUcld: int,
        verifiersToday: int,
        epoch: int,
        priceNcldPerTmac: int.openapi({ description: "Current quote converted to nano-CLD per tera-MAC at usdPerCld; locked until priceExpiresAt" }),
        priceExpiresAt: z.number(),
        baseFeeUcld: int,
        priceNusdPerTmac: int.openapi({ description: "Current quote in nano-dollars per tera-MAC (prices are quoted in USD, settled in CLD)" }),
        baseFeeUsd: z.number(),
        usdPerCld: z.number().openapi({ description: "Reference rate the quote converts at (testnet: a fixed $0.10)" }),
        prices: z
          .object({
            hostingUsdPerHour: z.number(),
            cpuUsdPerHour: z.number(),
            memUsdPerGbHour: z.number(),
            storageUsdPerGbHour: z.number(),
            volumeUsdPerGbHour: z.number(),
            gpuUsdPerHour: z.object({ standard: z.number(), large: z.number(), h100: z.number() }),
            interruptibleDiscount: z.number(),
          })
          .openapi({ description: "Hourly price table in US dollars (docs/PRICES_USD.md); a deployment's CLD price is fixed at create" }),
        lastSettledEpochAt: z.number().nullable(),
        deploymentsRunning: int,
        gpusOnline: int.openapi({ description: "GPUs in manifests of online, bound nodes that advertise the gpu capability" }),
        workstationsRunning: int,
        signature: SignatureSchema,
      }),
      "Network stats",
    ),
  }),
});

const STATS_SQL = `SELECT
  (SELECT COUNT(*) FROM nodes WHERE last_seen >= ?1) AS nodesOnline,
  (SELECT COUNT(*) FROM nodes WHERE payout IS NOT NULL) AS nodesBound,
  (SELECT COUNT(*) FROM work_jobs WHERE status IN ('queued','assigned')) AS jobsQueued,
  (SELECT COUNT(*) FROM work_jobs WHERE status = 'done') AS jobsDone,
  (SELECT COUNT(*) FROM work_jobs WHERE status = 'done' AND cert_z IS NOT NULL) AS certificates,
  (SELECT COALESCE(SUM(amount_ucld), 0) FROM reward_entries WHERE lane IN ('A','B','treasury') AND status != 'clawed') AS mintedUcld,
  (SELECT COALESCE(SUM(price_ucld), 0) FROM work_jobs WHERE status = 'done')
    + (SELECT COALESCE(SUM(fee_ucld), 0) FROM deployment_bills) AS burnedUcld,
  (SELECT COUNT(DISTINCT session) FROM verify_verdicts WHERE created_at >= ?2) AS verifiersToday,
  (SELECT COUNT(*) FROM deployments WHERE status = 'running') AS deploymentsRunning,
  (SELECT COALESCE(SUM(json_array_length(json_extract(n.manifest_json, '$.gpus'))), 0) FROM nodes n
    WHERE n.last_seen >= ?1 AND n.payout IS NOT NULL AND n.manifest_json IS NOT NULL
      AND EXISTS (SELECT 1 FROM json_each(n.work_types) w WHERE w.value = 'gpu')) AS gpusOnline,
  (SELECT COUNT(*) FROM deployments WHERE status = 'running' AND workstation = 1) AS workstationsRunning`;

networkRouter.openapi(networkRoute, async (c) => {
  const env = getEnv();
  const now = Date.now();
  const [row, quote, settledAt] = await Promise.all([
    getD1().prepare(STATS_SQL).bind(now - env.NODE_ACTIVE_SECONDS * 1000, now - 86_400_000).first<Record<string, number>>(),
    getPriceQuote(now),
    lastSettledEpochAt(),
  ]);
  const stats = {
    nodesOnline: row?.nodesOnline ?? 0,
    nodesBound: row?.nodesBound ?? 0,
    jobsQueued: row?.jobsQueued ?? 0,
    jobsDone: row?.jobsDone ?? 0,
    certificates: row?.certificates ?? 0,
    mintedUcld: row?.mintedUcld ?? 0,
    burnedUcld: row?.burnedUcld ?? 0,
    verifiersToday: row?.verifiersToday ?? 0,
    epoch: epochOf(now),
    priceNcldPerTmac: quote.priceNcldPerTmac,
    priceExpiresAt: quote.expiresAt,
    baseFeeUcld: quote.baseFeeUcld,
    priceNusdPerTmac: quote.priceNusdPerTmac,
    baseFeeUsd: quote.baseFeeUsd,
    usdPerCld: quote.usdPerCld,
    prices: {
      hostingUsdPerHour: env.PRICE_HOSTING_USD_PER_HOUR,
      cpuUsdPerHour: env.PRICE_CPU_USD_PER_HOUR,
      memUsdPerGbHour: env.PRICE_MEM_USD_PER_GB_HOUR,
      storageUsdPerGbHour: env.PRICE_STORAGE_USD_PER_GB_HOUR,
      volumeUsdPerGbHour: env.PRICE_VOLUME_USD_PER_GB_HOUR,
      gpuUsdPerHour: { standard: env.PRICE_GPU_STANDARD_USD_PER_HOUR, large: env.PRICE_GPU_LARGE_USD_PER_HOUR, h100: env.PRICE_GPU_H100_USD_PER_HOUR },
      interruptibleDiscount: env.INTERRUPTIBLE_DISCOUNT,
    },
    lastSettledEpochAt: settledAt,
    deploymentsRunning: row?.deploymentsRunning ?? 0,
    gpusOnline: row?.gpusOnline ?? 0,
    workstationsRunning: row?.workstationsRunning ?? 0,
  };
  // Signed so mirrors and dashboards can prove what the orchestrator claimed at signedAt.
  return ok(c, { ...stats, signature: await signPublic(stats, now) });
});

const RECENT_LIMIT = 12;
const recentRoute = createRoute({
  method: "get",
  path: "/network/recent",
  tags: ["Network"],
  description: `The last ${RECENT_LIMIT} verified public jobs, newest first. No owner or payer information.`,
  responses: responses(
    {
      200: json(
        z.object({
          status: z.literal("success"),
          jobs: z.array(
            z.object({
              id: z.string(),
              n: int,
              workType: z.string(),
              node: z.string().nullable(),
              z: z.string().nullable(),
              priceUcld: int,
              finishedAt: z.number(),
            }),
          ),
        }),
        "Recent jobs",
      ),
    },
    429,
  ),
});

networkRouter.openapi(recentRoute, async (c) => {
  const rows = await getD1()
    .prepare(
      "SELECT id, n, work_type, node, cert_z, price_ucld, completed_at FROM work_jobs " +
        "WHERE status = 'done' AND public = 1 ORDER BY completed_at DESC LIMIT ?",
    )
    .bind(RECENT_LIMIT)
    .all<{ id: string; n: number; work_type: string; node: string | null; cert_z: string | null; price_ucld: number; completed_at: number }>();
  return ok(c, {
    jobs: (rows.results ?? []).map((r) => ({
      id: r.id,
      n: r.n,
      workType: r.work_type,
      node: r.node,
      z: r.cert_z,
      priceUcld: r.price_ucld,
      finishedAt: r.completed_at,
    })),
  });
});
