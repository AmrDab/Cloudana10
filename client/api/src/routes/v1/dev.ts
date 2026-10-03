/**
 * POST /v1/dev/credits — test credits for the signed-in wallet.
 * - DEV_MODE (local): +10 CLD on every call.
 * - TESTNET_CREDITS (public testnet): +10 CLD once per wallet per 24 h. Credits have no monetary value.
 * 404 when neither flag is on, so the route does not exist on a value-bearing deployment.
 */
import { createRoute, z } from "@hono/zod-openapi";
import { getEnv } from "../../config/env.js";
import { ok, fail } from "../../lib/http.js";
import { getKV } from "../../lib/storage.js";
import { creditUcld } from "../../services/balance.service.js";
import { BEARER_AUTH, createRouter, json, responses } from "./_openapi.js";

export const DEV_CREDITS_UCLD = 10_000_000;
const TESTNET_COOLDOWN_SEC = 86_400;

export const devRouter = createRouter();

const creditsRoute = createRoute({
  method: "post",
  path: "/dev/credits",
  tags: ["Dev"],
  description: "Test credits: 10 CLD (no monetary value). Unlimited locally; once per wallet per day on the public testnet.",
  security: BEARER_AUTH,
  responses: responses({ 200: json(z.object({ status: z.literal("success"), balanceUcld: z.number().int() }), "Credited") }, 401, 404, 429),
});

devRouter.openapi(creditsRoute, async (c) => {
  const env = getEnv();
  if (!env.DEV_MODE && !env.TESTNET_CREDITS) return fail(c, "not_found", "Not found");
  const wallet = c.get("jwtPayload").sub.toLowerCase();
  if (!env.DEV_MODE) {
    const key = `testnet-credits:${wallet}`;
    const kv = getKV();
    if (await kv.get(key)) return fail(c, "rate_limited", "Test credits are limited to once per day per wallet.");
    await kv.put(key, String(Date.now()), { expirationTtl: TESTNET_COOLDOWN_SEC });
  }
  const balanceUcld = await creditUcld(wallet, DEV_CREDITS_UCLD);
  return ok(c, { balanceUcld });
});
