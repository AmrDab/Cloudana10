/**
 * POST /v1/work/submit (node-signed) — certificate + result for an assigned job.
 * Checks, in order: assigned to this node & not expired · node bound · σ · A/B hash binding ·
 * transcript verify · Freivalds on the result. Failure → 422, jobs_failed++, job re-queued.
 */
import { createRoute, z } from "@hono/zod-openapi";
import { ok, fail } from "../../lib/http.js";
import { requireNode, type NodeVariables } from "../../middleware/node-auth.js";
import type { AuthVariables } from "../../middleware/auth.js";
import { submitWork } from "../../services/jobs.service.js";
import type { POUWCertificate } from "../../../../../pouw/src/types.js";
import { createRouter, json, responses } from "./_openapi.js";

export const workRouter = createRouter<AuthVariables & NodeVariables>();

const MAX = 256 * 256;
const CertificateSchema = z
  .object({
    sigma: z.string().max(256),
    n: z.number().int(),
    r: z.number().int(),
    matrixAHash: z.string().max(128),
    matrixBHash: z.string().max(128),
    transcriptHash: z.string().max(128),
    z: z.string().max(128),
    difficulty: z.number().int().min(0).max(256),
    timestamp: z.number(),
    providerAddress: z.string().max(64),
    deviceId: z.string().max(128),
    matrixA: z.array(z.number()).max(MAX),
    matrixB: z.array(z.number()).max(MAX),
  })
  .passthrough();

const SubmitSchema = z.object({
  jobId: z.string().min(1).max(64),
  certificate: CertificateSchema,
  result: z.array(z.number()).max(MAX),
});

const submitRoute = createRoute({
  method: "post",
  path: "/work/submit",
  tags: ["Nodes"],
  description: "Node-signed. Returns the µCLD earned (lane A now, lane B vesting until vestsAt).",
  middleware: [requireNode] as const,
  request: { body: { required: true, content: { "application/json": { schema: SubmitSchema } } } },
  responses: responses(
    {
      200: json(
        z.object({
          status: z.literal("success"),
          units: z.number().int(),
          earned: z.object({ laneAUcld: z.number().int(), laneBUcld: z.number().int() }),
          vestsAt: z.number(),
        }),
        "Verified and credited",
      ),
    },
    400,
    401,
    404,
    409,
    422,
  ),
});

workRouter.openapi(submitRoute, async (c) => {
  const body = c.req.valid("json");
  const r = await submitWork(c.get("node"), {
    jobId: body.jobId,
    certificate: body.certificate as POUWCertificate,
    result: body.result,
  });
  if (!r.ok) return fail(c, r.code, r.message);
  return ok(c, { units: r.units, earned: r.earned, vestsAt: r.vestsAt });
});
