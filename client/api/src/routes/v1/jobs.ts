/**
 * Users' work jobs (JWT).
 *   POST /v1/jobs      — queue a job; its price is held from the caller's credits
 *   GET  /v1/jobs      — the caller's jobs
 *   GET  /v1/jobs/:id  — one job; `result` only for its owner
 */
import { createRoute, z } from "@hono/zod-openapi";
import { ok, fail } from "../../lib/http.js";
import { enqueueWorkJob, getWorkJob, listWorkJobs, toSummary } from "../../services/jobs.service.js";
import { MATMUL_N_MAX, MATMUL_N_MIN } from "../../services/work-types.js";
import { BEARER_AUTH, createRouter, json, responses } from "./_openapi.js";

export const jobsRouter = createRouter();
const TAGS = ["Jobs"];

const JobSummarySchema = z.object({
  id: z.string(),
  workType: z.string(),
  n: z.number().int(),
  priceUcld: z.number().int(),
  public: z.boolean(),
  status: z.string(),
  node: z.string().nullable(),
  createdAt: z.number(),
  assignedAt: z.number().nullable(),
  completedAt: z.number().nullable(),
});

const MAX_ENTRIES = MATMUL_N_MAX * MATMUL_N_MAX;
const CreateJobSchema = z.object({
  workType: z.literal("matmul"),
  n: z.number().int().min(MATMUL_N_MIN).max(MATMUL_N_MAX),
  matrixA: z.array(z.number().int()).max(MAX_ENTRIES),
  matrixB: z.array(z.number().int()).max(MAX_ENTRIES),
  public: z.boolean().optional().default(true),
  /** Optional ceiling in µCLD: the job is refused (422) if the protocol price is above it. */
  maxPriceUcld: z.number().int().positive().optional(),
});

const createJobRoute = createRoute({
  method: "post",
  path: "/jobs",
  tags: TAGS,
  description: "Queue work. Price = max(1, ceil(n³ × PRICE_UCLD_PER_MMAC / 1e6)) µCLD, held until the result verifies.",
  security: BEARER_AUTH,
  request: { body: { required: true, content: { "application/json": { schema: CreateJobSchema } } } },
  responses: responses(
    {
      200: json(
        z.object({ status: z.literal("success"), jobId: z.string(), priceUcld: z.number().int(), balanceUcld: z.number().int() }),
        "Job queued",
      ),
    },
    400,
    401,
    422,
  ),
});

jobsRouter.openapi(createJobRoute, async (c) => {
  const body = c.req.valid("json");
  const r = await enqueueWorkJob({ owner: c.get("jwtPayload").sub, ...body });
  if (!r.ok) return fail(c, r.code, r.message);
  return ok(c, { jobId: r.jobId, priceUcld: r.priceUcld, balanceUcld: r.balanceUcld });
});

const listJobsRoute = createRoute({
  method: "get",
  path: "/jobs",
  tags: TAGS,
  security: BEARER_AUTH,
  responses: responses({ 200: json(z.object({ status: z.literal("success"), jobs: z.array(JobSummarySchema) }), "Your jobs") }, 401),
});

jobsRouter.openapi(listJobsRoute, async (c) => ok(c, { jobs: await listWorkJobs(c.get("jwtPayload").sub) }));

const getJobRoute = createRoute({
  method: "get",
  path: "/jobs/{id}",
  tags: TAGS,
  security: BEARER_AUTH,
  request: { params: z.object({ id: z.string().min(1).max(64) }) },
  responses: responses(
    {
      200: json(
        z.object({
          status: z.literal("success"),
          job: JobSummarySchema.extend({
            result: z.array(z.number()).optional(),
            certificate: z
              .object({
                z: z.string().nullable(),
                sigma: z.string().nullable(),
                node: z.string().nullable(),
                seedSource: z.string().nullable(),
                drawSeed: z.string().nullable(),
                eligibleHash: z.string().nullable(),
                clusterOk: z.boolean().nullable(),
              })
              .nullable(),
          }),
        }),
        "Job (nested: the job has its own status field)",
      ),
    },
    401,
    404,
  ),
});

jobsRouter.openapi(getJobRoute, async (c) => {
  const row = await getWorkJob(c.req.valid("param").id);
  if (!row) return fail(c, "not_found", "job not found");
  const isOwner = row.owner === c.get("jwtPayload").sub.toLowerCase();
  return ok(c, {
    job: {
      ...toSummary(row),
      ...(isOwner && row.result_json ? { result: JSON.parse(row.result_json) as number[] } : {}),
      certificate: row.sigma
        ? {
            z: row.cert_z,
            sigma: row.sigma,
            node: row.node,
            seedSource: row.seed_source,
            drawSeed: row.draw_seed,
            eligibleHash: row.eligible_hash,
            clusterOk: row.cluster_ok === null ? null : row.cluster_ok === 1,
          }
        : null,
    },
  });
});
