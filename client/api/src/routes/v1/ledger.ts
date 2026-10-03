/** GET /v1/ledger/:address — earned µCLD by lane and status, verifier credits, latest 50 entries. Public. */
import { createRoute, z } from "@hono/zod-openapi";
import { ok } from "../../lib/http.js";
import { EthAddressSchema } from "../../schemas/common.schema.js";
import { ledgerSummary } from "../../services/ledger.service.js";
import { createRouter, json, responses } from "./_openapi.js";

export const ledgerRouter = createRouter();

const LedgerSchema = z.object({
  status: z.literal("success"),
  address: z.string(),
  pending: z.object({ A: z.number().int(), B: z.number().int(), treasury: z.number().int() }),
  vesting: z.object({ B: z.number().int() }),
  settled: z.object({ A: z.number().int(), B: z.number().int() }),
  credits: z.number().int(),
  entries: z.array(
    z.object({
      id: z.string(),
      jobId: z.string(),
      epoch: z.number().int(),
      lane: z.enum(["A", "B", "treasury", "verify"]),
      workType: z.string(),
      amountUcld: z.number().int(),
      vestsAt: z.number(),
      status: z.string(),
      createdAt: z.number(),
    }),
  ),
});

const ledgerRoute = createRoute({
  method: "get",
  path: "/ledger/{address}",
  tags: ["Ledger"],
  description: "pending = earned, not yet settled on-chain; vesting.B = the part of pending B not yet vested.",
  request: { params: z.object({ address: EthAddressSchema }) },
  responses: responses({ 200: json(LedgerSchema, "Ledger summary") }, 400),
});

ledgerRouter.openapi(ledgerRoute, async (c) => {
  const address = c.req.valid("param").address.toLowerCase();
  return ok(c, { address, ...(await ledgerSummary(address)) });
});
