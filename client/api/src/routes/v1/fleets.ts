/**
 * Datacenter fleets (JWT; the caller's wallet is the fleet owner and payout).
 *   POST   /v1/fleets       — create; returns the token once (only its hash is kept)
 *   GET    /v1/fleets       — the caller's fleets with node counts (never the token)
 *   PATCH  /v1/fleets/:id   — rename / set the floor price
 *   DELETE /v1/fleets/:id   — revoke: new announces with the token fail; its nodes are unbound
 *   POST   /v1/fleets/:id/nodes/:address/evict — unbind one node of the fleet
 * Another owner's fleet answers 404, the same as a missing one.
 */
import { createRoute, z } from "@hono/zod-openapi";
import { ok, fail } from "../../lib/http.js";
import { EthAddressSchema } from "../../schemas/common.schema.js";
import { MAX_ACTIVE_FLEETS, createFleet, evictFleetNode, listFleets, revokeFleet, updateFleet } from "../../services/fleets.service.js";
import { BEARER_AUTH, createRouter, json, responses } from "./_openapi.js";

export const fleetsRouter = createRouter();
const TAGS = ["Fleets"];

const Name = z.string().trim().min(1).max(80);
const Floor = z.number().int().min(0).max(1e12);
const IdParam = z.object({ id: z.string().regex(/^flt_[0-9a-f]{16}$/, "Invalid fleet id") });

const FleetSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  floorUcldPerMmac: z.number().int().nullable(),
  createdAt: z.number(),
  revokedAt: z.number().nullable(),
  nodes: z.number().int(),
  nodesOnline: z.number().int(),
  jobsDone: z.number().int(),
});

const createFleetRoute = createRoute({
  method: "post",
  path: "/fleets",
  tags: TAGS,
  description:
    `Create a fleet token. The token is returned only in this response — store it (e.g. as a Kubernetes secret). ` +
    `At most ${MAX_ACTIVE_FLEETS} active fleets per wallet. floorUcldPerMmac is stored but not yet used by placement.`,
  security: BEARER_AUTH,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: z.object({ name: Name.optional(), floorUcldPerMmac: Floor.optional() }) } },
    },
  },
  responses: responses(
    { 201: json(z.object({ status: z.literal("success"), id: z.string(), token: z.string() }), "Fleet created") },
    400,
    401,
    409,
    429,
  ),
});

fleetsRouter.openapi(createFleetRoute, async (c) => {
  const body = c.req.valid("json");
  const r = await createFleet(c.get("jwtPayload").sub, body.name ?? null, body.floorUcldPerMmac ?? null);
  if (!r.ok) return fail(c, r.code, r.message);
  return ok(c, { id: r.id, token: r.token }, 201);
});

const listFleetsRoute = createRoute({
  method: "get",
  path: "/fleets",
  tags: TAGS,
  description: "Your fleets, oldest first, including revoked ones (revokedAt set).",
  security: BEARER_AUTH,
  responses: responses({ 200: json(z.object({ status: z.literal("success"), fleets: z.array(FleetSchema) }), "Your fleets") }, 401),
});

fleetsRouter.openapi(listFleetsRoute, async (c) => ok(c, { fleets: await listFleets(c.get("jwtPayload").sub) }));

const patchFleetRoute = createRoute({
  method: "patch",
  path: "/fleets/{id}",
  tags: TAGS,
  description: "Omitted fields are unchanged; null clears.",
  security: BEARER_AUTH,
  request: {
    params: IdParam,
    body: {
      required: true,
      content: { "application/json": { schema: z.object({ name: Name.nullable().optional(), floorUcldPerMmac: Floor.nullable().optional() }) } },
    },
  },
  responses: responses({ 200: json(z.object({ status: z.literal("success"), fleet: FleetSchema }), "Updated") }, 400, 401, 404),
});

fleetsRouter.openapi(patchFleetRoute, async (c) => {
  const { id } = c.req.valid("param");
  const owner = c.get("jwtPayload").sub;
  if (!(await updateFleet(owner, id, c.req.valid("json")))) return fail(c, "not_found", "Fleet not found");
  const fleet = (await listFleets(owner)).find((f) => f.id === id)!;
  return ok(c, { fleet });
});

const deleteFleetRoute = createRoute({
  method: "delete",
  path: "/fleets/{id}",
  tags: TAGS,
  description: "Revoke (idempotent). New announces with this token get 401; the fleet's nodes are unbound and their live deployments re-queued.",
  security: BEARER_AUTH,
  request: { params: IdParam },
  responses: responses(
    { 200: json(z.object({ status: z.literal("success"), revoked: z.literal(true), revokedAt: z.number() }), "Revoked") },
    400,
    401,
    404,
  ),
});

fleetsRouter.openapi(deleteFleetRoute, async (c) => {
  const revokedAt = await revokeFleet(c.get("jwtPayload").sub, c.req.valid("param").id);
  if (revokedAt === null) return fail(c, "not_found", "Fleet not found");
  return ok(c, { revoked: true as const, revokedAt });
});

const evictRoute = createRoute({
  method: "post",
  path: "/fleets/{id}/nodes/{address}/evict",
  tags: TAGS,
  description:
    "Evict a node from your fleet: it is unbound (no payout, no fleet; a fresh bind code on its next announce) " +
    "and its live deployments are re-queued for other nodes. 404 when the fleet is not yours or the node is not in it.",
  security: BEARER_AUTH,
  request: { params: IdParam.extend({ address: EthAddressSchema }) },
  responses: responses(
    { 200: json(z.object({ status: z.literal("success"), evicted: z.string(), requeued: z.number().int() }), "Evicted") },
    400,
    401,
    404,
  ),
});

fleetsRouter.openapi(evictRoute, async (c) => {
  const { id, address } = c.req.valid("param");
  const r = await evictFleetNode(c.get("jwtPayload").sub, id, address);
  if (!r) return fail(c, "not_found", "Fleet or node not found");
  return ok(c, r);
});
