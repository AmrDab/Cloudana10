/** GET /v1/account — the signed-in wallet's credits in µCLD. */
import { createRoute, z } from "@hono/zod-openapi";
import { ok } from "../../lib/http.js";
import { getBalanceUcld } from "../../services/balance.service.js";
import { BEARER_AUTH, createRouter, json, responses } from "./_openapi.js";

export const accountRouter = createRouter();

const accountRoute = createRoute({
  method: "get",
  path: "/account",
  tags: ["Account"],
  security: BEARER_AUTH,
  responses: responses(
    {
      200: json(
        z.object({ status: z.literal("success"), address: z.string(), balanceUcld: z.number().int(), heldUcld: z.number().int() }),
        "Spendable and held credits",
      ),
    },
    401,
  ),
});

accountRouter.openapi(accountRoute, async (c) => {
  const address = c.get("jwtPayload").sub;
  const { balanceUcld, heldUcld } = await getBalanceUcld(address);
  return ok(c, { address, balanceUcld, heldUcld });
});
