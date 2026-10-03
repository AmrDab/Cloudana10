/**
 * Browser verifiers (no login).
 *   GET  /v1/verify/task?session=<uuid>  — A, B, C to check (about 1 in 6 planted with a wrong C)
 *   POST /v1/verify/verdict              — graded; correct verdicts earn credits (points, not CLD)
 */
import { createRoute, z } from "@hono/zod-openapi";
import { ok, fail } from "../../lib/http.js";
import { EthAddressSchema } from "../../schemas/common.schema.js";
import { gradeVerdict, nextVerifyTask } from "../../services/verify-feed.service.js";
import { createRouter, json, responses } from "./_openapi.js";

export const verifyFeedRouter = createRouter();
const TAGS = ["Verify"];
const SessionSchema = z.string().min(8).max(64).regex(/^[A-Za-z0-9-]+$/, "session must be a uuid-like id");

const taskRoute = createRoute({
  method: "get",
  path: "/verify/task",
  tags: TAGS,
  request: { query: z.object({ session: SessionSchema }) },
  responses: responses(
    {
      200: json(
        z.object({
          status: z.literal("success"),
          taskId: z.string(),
          n: z.number().int(),
          matrixA: z.array(z.number()),
          matrixB: z.array(z.number()),
          matrixC: z.array(z.number()),
        }),
        "A task: is C = A·B?",
      ),
    },
    400,
  ),
});

verifyFeedRouter.openapi(taskRoute, async (c) => ok(c, { ...(await nextVerifyTask()) }));

const verdictRoute = createRoute({
  method: "post",
  path: "/verify/verdict",
  tags: TAGS,
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            taskId: z.string().min(1).max(64),
            session: SessionSchema,
            verdict: z.enum(["valid", "invalid"]),
            address: EthAddressSchema.optional(),
          }),
        },
      },
    },
  },
  responses: responses(
    { 200: json(z.object({ status: z.literal("success"), correct: z.boolean(), credits: z.number().int() }), "Graded") },
    400,
    404,
    409,
  ),
});

verifyFeedRouter.openapi(verdictRoute, async (c) => {
  const r = await gradeVerdict(c.req.valid("json"));
  if (!r.ok) return fail(c, r.code, r.message);
  return ok(c, { correct: r.correct, credits: r.credits });
});
