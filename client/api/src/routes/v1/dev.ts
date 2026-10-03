/**
 * POST /v1/dev/credits — DEV_MODE only: +10 CLD of credits to the signed-in wallet.
 * 404 when DEV_MODE is off, so the route does not exist in production.
 */
import { createRoute, z } from "@hono/zod-openapi";
import { getEnv } from "../../config/env.js";
import { ok, fail } from "../../lib/http.js";
import { creditUcld } from "../../services/balance.service.js";
import { BEARER_AUTH, createRouter, json, responses } from "./_openapi.js";

export const DEV_CREDITS_UCLD = 10_000_000;

export const devRouter = createRouter();

const creditsRoute = createRoute({
  method: "post",
  path: "/dev/credits",
  tags: ["Dev"],
  description: "Local development only (DEV_MODE=true): adds 10 CLD of credits to the caller.",
  security: BEARER_AUTH,
  responses: responses({ 200: json(z.object({ status: z.literal("success"), balanceUcld: z.number().int() }), "Credited") }, 401, 404),
});

devRouter.openapi(creditsRoute, async (c) => {
  if (!getEnv().DEV_MODE) return fail(c, "not_found", "Not found");
  const balanceUcld = await creditUcld(c.get("jwtPayload").sub, DEV_CREDITS_UCLD);
  return ok(c, { balanceUcld });
});
