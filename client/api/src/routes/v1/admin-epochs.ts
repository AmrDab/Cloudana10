/**
 * Epoch settlement for the keeper (header X-Internal-Key = INTERNAL_API_KEY).
 *   POST /v1/admin/epochs/close        — close past, fully vested epochs → leaves per address
 *   POST /v1/admin/epochs/:id/posted   { root, txHash }
 *   POST /v1/admin/epochs/:id/settled  { txHash }
 *   POST /v1/admin/epochs/:id/vetoed   { txHash?, reason? } — reopen: posted entries → pending; next close re-closes it
 *   POST /v1/admin/epochs/:id/entries/:entryId/claw          — claw one pending entry before the re-close
 */
import { createRoute, z } from "@hono/zod-openapi";
import { createMiddleware } from "hono/factory";
import { getEnv } from "../../config/env.js";
import { ok, fail } from "../../lib/http.js";
import { clawEntry, closeEpochs, markEpochPosted, markEpochSettled, markEpochVetoed } from "../../services/ledger.service.js";
import { createRouter, json, responses } from "./_openapi.js";

export const adminEpochsRouter = createRouter();
const TAGS = ["Admin"];

export const requireInternalKey = createMiddleware(async (c, next) => {
  const key = getEnv().INTERNAL_API_KEY;
  if (!key) return fail(c, "not_configured", "INTERNAL_API_KEY is not set");
  if (c.req.header("x-internal-key") !== key) return fail(c, "unauthorized", "Invalid X-Internal-Key");
  await next();
});

const Hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected 0x + 64 hex");
const IdParam = z.object({ id: z.coerce.number().int().min(0) });
const Done = json(z.object({ status: z.literal("success") }), "Updated");

const closeRoute = createRoute({
  method: "post",
  path: "/admin/epochs/close",
  tags: TAGS,
  middleware: [requireInternalKey] as const,
  responses: responses(
    {
      200: json(
        z.object({
          status: z.literal("success"),
          epochs: z.array(
            z.object({
              id: z.number().int(),
              feesBurnedUcld: z.number().int(),
              mintAUcld: z.number().int(),
              mintBUcld: z.number().int(),
              leaves: z.array(z.object({ address: z.string(), amountUcld: z.number().int() })),
            }),
          ),
        }),
        "Closed epochs (mintAUcld includes the treasury lane)",
      ),
    },
    401,
    503,
  ),
});

adminEpochsRouter.openapi(closeRoute, async (c) => ok(c, { epochs: await closeEpochs() }));

const postedRoute = createRoute({
  method: "post",
  path: "/admin/epochs/{id}/posted",
  tags: TAGS,
  middleware: [requireInternalKey] as const,
  request: {
    params: IdParam,
    body: { required: true, content: { "application/json": { schema: z.object({ root: Hex32, txHash: Hex32 }) } } },
  },
  responses: responses({ 200: Done }, 400, 401, 404, 409, 503),
});

adminEpochsRouter.openapi(postedRoute, async (c) => {
  const { root, txHash } = c.req.valid("json");
  const r = await markEpochPosted(c.req.valid("param").id, root, txHash);
  return r.ok ? ok(c, {}) : fail(c, r.code, r.message);
});

const settledRoute = createRoute({
  method: "post",
  path: "/admin/epochs/{id}/settled",
  tags: TAGS,
  middleware: [requireInternalKey] as const,
  request: {
    params: IdParam,
    body: { required: true, content: { "application/json": { schema: z.object({ txHash: Hex32 }) } } },
  },
  responses: responses({ 200: Done }, 400, 401, 404, 409, 503),
});

adminEpochsRouter.openapi(settledRoute, async (c) => {
  const r = await markEpochSettled(c.req.valid("param").id, c.req.valid("json").txHash);
  return r.ok ? ok(c, {}) : fail(c, r.code, r.message);
});

const vetoedRoute = createRoute({
  method: "post",
  path: "/admin/epochs/{id}/vetoed",
  tags: TAGS,
  description:
    "The epoch's root was vetoed on-chain. Its posted A/B/treasury entries go back to pending and its root and " +
    "fees_burned are cleared; the next close returns it again under the same id. Repeating is a no-op; settled → 409.",
  middleware: [requireInternalKey] as const,
  request: {
    params: IdParam,
    body: {
      required: true,
      content: { "application/json": { schema: z.object({ txHash: Hex32.optional(), reason: z.string().max(500).optional() }) } },
    },
  },
  responses: responses(
    { 200: json(z.object({ status: z.literal("success"), entriesReopened: z.number().int() }), "Reopened") },
    400,
    401,
    404,
    409,
    503,
  ),
});

adminEpochsRouter.openapi(vetoedRoute, async (c) => {
  const r = await markEpochVetoed(c.req.valid("param").id, c.req.valid("json"));
  return r.ok ? ok(c, { entriesReopened: r.entriesReopened }) : fail(c, r.code, r.message);
});

const clawRoute = createRoute({
  method: "post",
  path: "/admin/epochs/{id}/entries/{entryId}/claw",
  tags: TAGS,
  description: "Claw one pending reward entry of the epoch (excluded from the next close and from minted/earned totals). Posted/settled → 409.",
  middleware: [requireInternalKey] as const,
  request: { params: IdParam.extend({ entryId: z.string().min(1).max(128) }) },
  responses: responses({ 200: Done }, 400, 401, 404, 409, 503),
});

adminEpochsRouter.openapi(clawRoute, async (c) => {
  const { id, entryId } = c.req.valid("param");
  const r = await clawEntry(id, entryId);
  return r.ok ? ok(c, {}) : fail(c, r.code, r.message);
});
