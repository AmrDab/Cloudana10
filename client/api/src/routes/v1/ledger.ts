/** GET /v1/ledger/:address — earned µCLD by lane and status, verifier credits, latest 50 entries. Public. */
import { createRoute, z } from "@hono/zod-openapi";
import { getEnv } from "../../config/env.js";
import { ok } from "../../lib/http.js";
import { EthAddressSchema } from "../../schemas/common.schema.js";
import { epochJobs, getEpochPayload, ledgerSummary } from "../../services/ledger.service.js";
import { signPublic } from "../../services/public-signing.service.js";
import { fail } from "../../lib/http.js";
import { createRouter, json, responses } from "./_openapi.js";

export const ledgerRouter = createRouter();

const LedgerSchema = z.object({
  status: z.literal("success"),
  address: z.string(),
  pending: z.object({ A: z.number().int(), B: z.number().int(), treasury: z.number().int() }),
  held: z.object({ A: z.number().int(), B: z.number().int() }),
  vesting: z.object({ B: z.number().int() }),
  settled: z.object({ A: z.number().int(), B: z.number().int() }),
  clawed: z.object({ A: z.number().int(), B: z.number().int() }),
  credits: z.number().int(),
  verifySampleK: z.number().int().openapi({ description: "One matrix job in this many has its transcript re-executed (1 = every job)." }),
  payHoldSeconds: z.number().int().openapi({ description: "How long a job's provider pay stays clawable after it verifies (0 = no hold)." }),
  verifyWarmupJobs: z.number().int().openapi({ description: "A node's first this-many matrix jobs all have their transcript re-executed (0 = none)." }),
  protocolPending: z.number().int().openapi({ description: "Protocol jobs verified but not yet closed: their subsidy share is set when the epoch closes." }),
  entries: z.array(
    z.object({
      id: z.string(),
      jobId: z.string(),
      epoch: z.number().int(),
      lane: z.enum(["A", "B", "treasury", "verify"]),
      workType: z.string(),
      protocol: z.boolean().openapi({ description: "A protocol job's entry: its amount is a share set at close, 0 while pending." }),
      amountUcld: z.number().int(),
      vestsAt: z.number(),
      releasesAt: z.number().nullable(),
      status: z.string(),
      createdAt: z.number(),
    }),
  ),
});

const ledgerRoute = createRoute({
  method: "get",
  path: "/ledger/{address}",
  tags: ["Ledger"],
  description:
    "pending = earned, not yet settled on-chain; held = the part of pending A/B still in its check window, at least " +
    "payHoldSeconds after the job verified (clawed if a sampled re-execution fails on any node paying this wallet; per " +
    "entry, releasesAt says when the window ends); vesting.B = the part of pending B, not held, not yet vested; " +
    "clawed = taken back. verifySampleK, verifyWarmupJobs and payHoldSeconds are the orchestrator's current settings.",
  request: { params: z.object({ address: EthAddressSchema }) },
  responses: responses({ 200: json(LedgerSchema, "Ledger summary") }, 400),
});

ledgerRouter.openapi(ledgerRoute, async (c) => {
  const address = c.req.valid("param").address.toLowerCase();
  const env = getEnv();
  return ok(c, { address, ...(await ledgerSummary(address)), verifySampleK: env.VERIFY_SAMPLE_K, payHoldSeconds: env.PAY_HOLD_SECONDS, verifyWarmupJobs: env.VERIFY_WARMUP_JOBS });
});

// ── GET /v1/epochs/{id} — public, signed ────────────────────────────────────
export const SignatureSchema = z
  .object({ signer: z.string(), signedAt: z.number(), sig: z.string() })
  .nullable()
  .openapi({
    description:
      "personal_sign(keccak256(canonicalJSON({ domain: \"cloudana-public-v1\", signedAt, body }))) by the instruction key " +
      "(GET /v1/nodes/instruction-key); body = the object this field sits in, without `status` and `signature`. null when the API has no key.",
  });

const epochRoute = createRoute({
  method: "get",
  path: "/epochs/{id}",
  tags: ["Ledger"],
  description:
    "A closed, posted or settled epoch exactly as the keeper posts it: Merkle leaves (account, lane A, lane B in µCLD), " +
    "root (OZ double-hash of keccak256(abi.encode(epoch, account, laneA×1e12, laneB×1e12))), fees burned, lane totals and " +
    "the treasury amount — enough to recompute the root and compare it with the one on-chain. 404 while the epoch is open.",
  request: { params: z.object({ id: z.coerce.number().int().min(0) }) },
  responses: responses(
    {
      200: json(
        z.object({
          status: z.literal("success"),
          epoch: z.number().int(),
          root: z.string(),
          feesBurnedUcld: z.number().int(),
          totalLaneAUcld: z.number().int(),
          totalLaneBUcld: z.number().int(),
          treasuryUcld: z.number().int(),
          leaves: z.array(z.object({ account: z.string(), laneAUcld: z.number().int(), laneBUcld: z.number().int() })),
          epochStatus: z.string(),
          signature: SignatureSchema,
        }),
        "Epoch payload",
      ),
    },
    400,
    404,
    429,
  ),
});

ledgerRouter.openapi(epochRoute, async (c) => {
  const p = await getEpochPayload(c.req.valid("param").id);
  if (!p) return fail(c, "not_found", "epoch is open or unknown");
  const { status: epochStatus, ...body } = p;
  const signed = { ...body, epochStatus };
  return ok(c, { ...signed, signature: await signPublic(signed) });
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
    "open (or vetoed, until it closes again) and the list is what is pending in it. Page with `after` = the last jobId; `limit` ≤ 500.",
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
