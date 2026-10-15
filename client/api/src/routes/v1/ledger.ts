/** GET /v1/ledger/:address — earned µCLD by lane and status, verifier credits, latest 50 entries. Public. */
import { createRoute, z } from "@hono/zod-openapi";
import { ok } from "../../lib/http.js";
import { EthAddressSchema } from "../../schemas/common.schema.js";
import { epochJobs, ledgerSummary } from "../../services/ledger.service.js";
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

// ── GET /v1/epochs/{id}/jobs — public ─────────────────────────────────────
const EpochJobSchema = z.object({
  jobId: z.string(),
  workType: z.string(),
  provider: z.string().nullable(),
  feeUcld: z.number().int().nullable(),
  laneAUcld: z.number().int(),
  laneBUcld: z.number().int(),
  treasuryUcld: z.number().int(),
});

const epochJobsRoute = createRoute({
  method: "get",
  path: "/epochs/{id}/jobs",
  tags: ["Ledger"],
  description:
    "Every job and hosting bill in an epoch with what was paid and minted for it, by lane — enough to recompute the epoch's " +
    "Merkle leaves (one per provider: lane A and lane B summed) and its fees burned. `epoch` is null while the epoch is " +
    "still open. Page with `after` = the last jobId; `limit` ≤ 500.",
  request: {
    params: z.object({ id: z.coerce.number().int().min(0) }),
    query: z.object({ after: z.string().max(80).optional(), limit: z.coerce.number().int().min(1).max(500).optional() }),
  },
  responses: responses(
    {
      200: json(
        z.object({
          status: z.literal("success"),
          epoch: z
            .object({
              epoch: z.number().int(),
              root: z.string(),
              feesBurnedUcld: z.number().int(),
              totalLaneAUcld: z.number().int(),
              totalLaneBUcld: z.number().int(),
              treasuryUcld: z.number().int(),
              status: z.string(),
            })
            .nullable(),
          jobs: z.array(EpochJobSchema),
          next: z.string().nullable(),
        }),
        "Epoch jobs",
      ),
    },
    400,
  ),
});

ledgerRouter.openapi(epochJobsRoute, async (c) => {
  const { id } = c.req.valid("param");
  const r = await epochJobs(id, c.req.valid("query"));
  const epoch = r.epoch ? (({ leaves: _leaves, ...rest }) => rest)(r.epoch) : null;
  return ok(c, { epoch, jobs: r.jobs, next: r.next });
});
