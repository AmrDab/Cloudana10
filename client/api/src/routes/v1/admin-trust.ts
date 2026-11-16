/**
 * Trust tiers and the abuse switch (docs/TRUST_TIERS.md §3 rule 3, §4).
 *
 * POST   /v1/admin/fleets/{id}/verified        — the fleet is verified: its nodes take trust "verified" deployments.
 * DELETE /v1/admin/fleets/{id}/verified        — no longer verified: its live trust "verified" deployments are re-queued.
 * POST   /v1/admin/deployments/{id}/abuse      — stop it, suspend its owner's wallet and stop the wallet's other work.
 * DELETE /v1/admin/accounts/{address}/suspend  — lift a wallet's suspension.
 *
 * X-Internal-Key (the keeper/gateway/admin credential), never a user session.
 */
import { createRoute, z } from "@hono/zod-openapi";
import { fail, ok } from "../../lib/http.js";
import { EthAddressSchema } from "../../schemas/common.schema.js";
import { setFleetVerified } from "../../services/fleets.service.js";
import { liftSuspension, stopForAbuse } from "../../services/deployments.service.js";
import { requireInternalKey } from "./admin-epochs.js";
import { createRouter, json, responses } from "./_openapi.js";

export const adminTrustRouter = createRouter();
const TAGS = ["Admin"];
const FleetParams = z.object({ id: z.string().regex(/^flt_[0-9a-f]{16}$/, "Invalid fleet id") });
const Verified = json(
  z.object({
    status: z.literal("success"),
    id: z.string(),
    verified: z.boolean(),
    verifiedAt: z.number().nullable(),
    requeued: z.number().int(),
  }),
  "Changed; requeued = live trust \"verified\" deployments sent back to the queue",
);

const verifyRoute = createRoute({
  method: "post",
  path: "/admin/fleets/{id}/verified",
  tags: TAGS,
  description:
    "Mark a fleet verified (docs/TRUST_TIERS.md §3 rule 3: identity checked, provider agreement signed, an abuse contact). " +
    "Its nodes then take trust \"verified\" deployments. Idempotent (keeps the first verifiedAt). 409 for a revoked fleet.",
  middleware: [requireInternalKey] as const,
  request: { params: FleetParams },
  responses: responses({ 200: Verified }, 400, 401, 404, 409, 503),
});

adminTrustRouter.openapi(verifyRoute, async (c) => {
  const { id } = c.req.valid("param");
  const r = await setFleetVerified(id, true);
  if (!r.ok) return fail(c, r.code, r.message);
  return ok(c, { id, verified: true, verifiedAt: r.verifiedAt, requeued: r.requeued });
});

const unverifyRoute = createRoute({
  method: "delete",
  path: "/admin/fleets/{id}/verified",
  tags: TAGS,
  description:
    "Take a fleet's verification back. Its nodes' live trust \"verified\" deployments are re-queued for verified fleets (each " +
    "node is owed a stop); work pinned to this fleet waits until it is verified again. Idempotent: a retry re-queues what is left.",
  middleware: [requireInternalKey] as const,
  request: { params: FleetParams },
  responses: responses({ 200: Verified }, 400, 401, 404, 503),
});

adminTrustRouter.openapi(unverifyRoute, async (c) => {
  const { id } = c.req.valid("param");
  const r = await setFleetVerified(id, false);
  if (!r.ok) return fail(c, r.code, r.message);
  return ok(c, { id, verified: false, verifiedAt: null, requeued: r.requeued });
});

const abuseRoute = createRoute({
  method: "post",
  path: "/admin/deployments/{id}/abuse",
  tags: TAGS,
  description:
    "The abuse switch (docs/TRUST_TIERS.md §4): stops the deployment (a whole endpoint when a replica is named), suspends its " +
    "owner's wallet (POST /deployments answers 403 with the reason) and stops every other live deployment of that wallet. " +
    "Each stop's reason is recorded in the deployment's events. Idempotent; 409 = something changed while stopping, retry.",
  middleware: [requireInternalKey] as const,
  request: {
    params: z.object({ id: z.string().uuid("Invalid deployment id") }),
    body: { required: true, content: { "application/json": { schema: z.object({ reason: z.string().trim().min(1).max(200) }) } } },
  },
  responses: responses(
    {
      200: json(
        z.object({ status: z.literal("success"), owner: z.string(), suspendedAt: z.number(), stopped: z.number().int() }),
        "Stopped and suspended; stopped = deployments this call stopped",
      ),
    },
    400,
    401,
    404,
    409,
    503,
  ),
});

adminTrustRouter.openapi(abuseRoute, async (c) => {
  const r = await stopForAbuse(c.req.valid("param").id, c.req.valid("json").reason);
  if (!r.ok) return fail(c, r.code, r.message);
  return ok(c, { owner: r.owner, suspendedAt: r.suspendedAt, stopped: r.stopped });
});

const liftRoute = createRoute({
  method: "delete",
  path: "/admin/accounts/{address}/suspend",
  tags: TAGS,
  description: "Lift a wallet's suspension: it can create deployments again. Nothing that was stopped is restarted. 404 when it is not suspended.",
  middleware: [requireInternalKey] as const,
  request: { params: z.object({ address: EthAddressSchema }) },
  responses: responses({ 200: json(z.object({ status: z.literal("success"), address: z.string(), suspended: z.literal(false) }), "Lifted") }, 400, 401, 404, 503),
});

adminTrustRouter.openapi(liftRoute, async (c) => {
  const { address } = c.req.valid("param");
  if (!(await liftSuspension(address))) return fail(c, "not_found", "Account is not suspended");
  return ok(c, { address: address.toLowerCase(), suspended: false as const });
});
