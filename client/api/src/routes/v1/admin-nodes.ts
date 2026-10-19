/**
 * Admin node state (ENGINEERING_BACKLOG B-8; docs/V4_REVIEW_CLOUD.md (a)).
 *
 * POST   /v1/admin/nodes/{address}/suspend  — no new work, live deployments re-queued now, no relay ticket; the node
 *                                              keeps heartbeating so it learns to stop. Only this lifts it.
 * DELETE /v1/admin/nodes/{address}/suspend  — back to active.
 *
 * X-Internal-Key (the keeper/gateway/admin credential), never a user session.
 */
import { createRoute, z } from "@hono/zod-openapi";
import { fail, ok } from "../../lib/http.js";
import { EthAddressSchema } from "../../schemas/common.schema.js";
import { NODE_STATES, setNodeSuspended } from "../../services/nodes.service.js";
import { requireInternalKey } from "./admin-epochs.js";
import { createRouter, json, responses } from "./_openapi.js";

export const adminNodesRouter = createRouter();
const TAGS = ["Admin"];
const Params = z.object({ address: EthAddressSchema });
const Result = json(
  z.object({ status: z.literal("success"), address: z.string(), state: z.enum(NODE_STATES), requeued: z.number().int() }),
  "State changed; requeued = live deployments sent back to the queue",
);

const suspendRoute = createRoute({
  method: "post",
  path: "/admin/nodes/{address}/suspend",
  tags: TAGS,
  description:
    "Suspend a node: it is given no new jobs, deployments or storage copies, its live deployments are re-queued for other " +
    "nodes now (it is owed a stop for each), and it gets no relay ticket. Its owner cannot lift this. Active matmul " +
    "assignments expire on their own (ASSIGNMENT_TTL_SECONDS).",
  middleware: [requireInternalKey] as const,
  request: { params: Params, body: { required: true, content: { "application/json": { schema: z.object({ reason: z.string().trim().min(1).max(200) }) } } } },
  responses: responses({ 200: Result }, 400, 401, 404, 503),
});

adminNodesRouter.openapi(suspendRoute, async (c) => {
  const { address } = c.req.valid("param");
  const { reason } = c.req.valid("json");
  const r = await setNodeSuspended(address, true, reason);
  if (!r.ok) return fail(c, r.code, r.message);
  return ok(c, { address: address.toLowerCase(), state: r.state, requeued: r.requeued });
});

const unsuspendRoute = createRoute({
  method: "delete",
  path: "/admin/nodes/{address}/suspend",
  tags: TAGS,
  description: "Lift a suspension: the node is active again and takes work on its next heartbeat.",
  middleware: [requireInternalKey] as const,
  request: { params: Params },
  responses: responses({ 200: Result }, 400, 401, 404, 503),
});

adminNodesRouter.openapi(unsuspendRoute, async (c) => {
  const { address } = c.req.valid("param");
  const r = await setNodeSuspended(address, false, null);
  if (!r.ok) return fail(c, r.code, r.message);
  return ok(c, { address: address.toLowerCase(), state: r.state, requeued: r.requeued });
});
