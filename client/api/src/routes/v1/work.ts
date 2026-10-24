/**
 * POST /v1/work/submit (node-signed) — certificate + result for an assigned job.
 * Checks, in order: assigned to this node & not expired · node bound · σ · A/B hash binding · result bound ·
 * Freivalds on the result · on a sampled 1 in VERIFY_SAMPLE_K, transcript re-execution. Failure → 422, jobs_failed++,
 * job re-queued — except a sampled job with a right result and a wrong transcript: 422, result kept, the held pay of
 * the node's payout wallet clawed and the node suspended (ENGINEERING_BACKLOG B-6).
 *
 * Challenge-mode work types (int8-mlp, B-26) submit a commitment + result tensor instead: bound → 200 with the
 * segments to open and a deadline (drawn only after the commitment is stored); then POST /v1/work/answer opens them.
 */
import { createRoute, z } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import { ok, fail, failValidation } from "../../lib/http.js";
import { requireNode, type NodeVariables } from "../../middleware/node-auth.js";
import { rateLimit, verifiedNodeKey } from "../../middleware/rate-limit.js";
import type { AuthVariables } from "../../middleware/auth.js";
import { answerChallenge, submitWork } from "../../services/jobs.service.js";
import type { POUWCertificate } from "../../../../../pouw/src/types.js";
import type { SegmentOpening } from "../../../../../shared/verification.js";
import { createRouter, json, responses } from "./_openapi.js";
import { INT8_MLP } from "../../../../../shared/work-int8-mlp.js";

/**
 * Byte caps checked before the signature check and before any parsing (Content-Length, or counted while streaming):
 * an oversized body is 413 without being read into memory. A matmul submit at n = 256 is ~2.5 MB of JSON at most; an
 * int8-mlp answer opens 2 segments of ≤ 64×256 entries (~0.2 MB), so 1 MB is ~5× the largest.
 */
const SUBMIT_MAX_BYTES = 8 * 1024 * 1024;
const ANSWER_MAX_BYTES = 1024 * 1024;
const tooLarge = (max: number) => bodyLimit({ maxSize: max, onError: (c) => fail(c, "payload_too_large", `the body is at most ${max / (1024 * 1024)} MB`) });
const submitLimit = tooLarge(SUBMIT_MAX_BYTES);
const answerLimit = tooLarge(ANSWER_MAX_BYTES);
/** Per node (in memory, like the other node routes): an agent sends one answer per job, plus retries with backoff. */
const answerRate = rateLimit({ bucket: "work-answer", limit: 30, windowSec: 60, keyBy: verifiedNodeKey, store: "memory" });
/** The largest tensor a node ever serves: an int8-mlp activation or result, b × max(d, h). */
const MAX_SEGMENT_ENTRIES = INT8_MLP.B_MAX * INT8_MLP.DIM_MAX;

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

const TensorSchema = z.object({
  dtype: z.enum(["i8", "i32"]),
  shape: z.array(z.number().int()).min(1).max(4),
  data: z.array(z.number()).max(MAX_SEGMENT_ENTRIES),
});
const Hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const CommitSubmitSchema = z.object({
  jobId: z.string().min(1).max(64),
  commitment: z.object({
    inputHash: Hex64,
    outputHash: Hex64,
    chainRoot: Hex64,
    segments: z.array(z.object({ idx: z.number().int(), outHash: Hex64 })).max(64),
  }),
  result: TensorSchema,
});

const submitRoute = createRoute({
  method: "post",
  path: "/work/submit",
  tags: ["Nodes"],
  description:
    "Node-signed. matmul: { jobId, certificate, result }; returns the µCLD earned: lane A, and lane B as the most this " +
    "job's subsidy can be (scaled pro rata with every other job in the epoch if the epoch's budget binds; vesting until " +
    "vestsAt). The result is Freivalds-checked on every job and the transcript re-executed on a random 1 in 10 " +
    "(default); the pay is held until heldUntil (more than 24 h by default) and clawed, with all held pay of the node's " +
    "payout wallet, if a sampled check of a node paying that wallet fails. Challenge-mode work types (int8-mlp): " +
    "{ jobId, commitment: { inputHash, outputHash, chainRoot, segments: [{ idx, outHash }] }, result: tensor }; a " +
    "commitment that binds (σ, the job's inputs, the plan, the result) returns { challenge: { segments, deadline } }: " +
    "answer it with POST /v1/work/answer before the deadline. One commitment per assignment (a second is 409).",
  middleware: [submitLimit, requireNode] as const,
  request: {
    body: {
      required: true,
      content: {
        // Validated in the handler against the matmul or the commitment schema, so matmul errors read as before.
        "application/json": { schema: z.any().openapi({ type: "object", description: "SubmitSchema (matmul) or CommitSubmitSchema (challenge types)" }) },
      },
    },
  },
  responses: responses(
    {
      200: json(
        z.union([
          z.object({
            status: z.literal("success"),
            units: z.number().int(),
            earned: z.object({ laneAUcld: z.number().int(), laneBUcld: z.number().int() }),
            vestsAt: z.number(),
            heldUntil: z.number().openapi({ description: "When the pay leaves its check window (ms); clawable until then." }),
          }),
          z.object({
            status: z.literal("success"),
            challenge: z.object({
              segments: z.array(z.number().int()).openapi({ description: "Plan indices to open, drawn after the commitment was stored" }),
              deadline: z.number().openapi({ description: "Answer by this time (ms); later is a failed check" }),
            }),
          }),
        ]),
        "Verified and credited (matmul), or the challenge (challenge types)",
      ),
    },
    400,
    401,
    404,
    409,
    413,
    422,
  ),
});

workRouter.openapi(submitRoute, async (c) => {
  const raw = c.req.valid("json") as unknown;
  if (raw && typeof raw === "object" && "commitment" in raw) {
    const parsed = CommitSubmitSchema.safeParse(raw);
    if (!parsed.success) return failValidation(c, parsed.error);
    const r = await submitWork(c.get("node"), parsed.data);
    if (!r.ok) return fail(c, r.code, r.message);
    if ("challenge" in r) return ok(c, { challenge: r.challenge });
    return ok(c, { units: r.units, earned: r.earned, vestsAt: r.vestsAt, heldUntil: r.heldUntil });
  }
  const parsed = SubmitSchema.safeParse(raw);
  if (!parsed.success) return failValidation(c, parsed.error);
  const body = parsed.data;
  const r = await submitWork(c.get("node"), {
    jobId: body.jobId,
    certificate: body.certificate as POUWCertificate,
    result: body.result,
  });
  if (!r.ok) return fail(c, r.code, r.message);
  return ok(c, { units: r.units, earned: r.earned, vestsAt: r.vestsAt, heldUntil: r.heldUntil });
});

/** An answer opens the challenged segments (2 of int8-mlp's 4); each opening serves at most a segment's inputs and output. */
const AnswerSchema = z.object({
  jobId: z.string().min(1).max(64),
  openings: z
    .array(
      z.object({
        idx: z.number().int(),
        tensors: z.record(z.string().max(16), TensorSchema).refine((t) => Object.keys(t).length <= 8, "at most 8 tensors per opening"),
      }),
    )
    .max(8),
});

const answerRoute = createRoute({
  method: "post",
  path: "/work/answer",
  tags: ["Nodes"],
  description:
    "Node-signed, body ≤ 1 MB. The openings of exactly the segments POST /v1/work/submit challenged, before its " +
    "deadline: for each, the `seg:j` tensors it reads and its own output `seg:idx` (job inputs come from the job, " +
    "never the node). Every served tensor must hash to the commitment; a gemm segment is checked by Freivalds, an " +
    "elementwise one recomputed. Pass → settled like a matmul job (the pay held until heldUntil). A wrong, missing or " +
    "late opening → 422: the job fails (the owner's hold is released), all held pay of the node's payout wallet is " +
    "clawed and the node is suspended.",
  middleware: [answerLimit, requireNode, answerRate] as const,
  request: { body: { required: true, content: { "application/json": { schema: AnswerSchema } } } },
  responses: responses(
    {
      200: json(
        z.object({
          status: z.literal("success"),
          units: z.number().int(),
          earned: z.object({ laneAUcld: z.number().int(), laneBUcld: z.number().int() }),
          vestsAt: z.number(),
          heldUntil: z.number(),
        }),
        "Verified and credited",
      ),
    },
    400,
    401,
    404,
    409,
    413,
    422,
    429,
  ),
});

workRouter.openapi(answerRoute, async (c) => {
  const body = c.req.valid("json");
  const r = await answerChallenge(c.get("node"), { jobId: body.jobId, openings: body.openings as SegmentOpening[] });
  if (!r.ok) return fail(c, r.code, r.message);
  return ok(c, { units: r.units, earned: r.earned, vestsAt: r.vestsAt, heldUntil: r.heldUntil });
});
