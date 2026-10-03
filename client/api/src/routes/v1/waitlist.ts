/**
 * Waitlist (public, no login).
 *   POST /v1/waitlist             — join; idempotent on email (returns the existing standing)
 *   GET  /v1/waitlist/stats       — { total, byRole }
 *   GET  /v1/waitlist/:refCode    — { position, referrals } (no PII)
 *   GET  /v1/admin/waitlist       — full list, JSON or ?format=csv (X-Internal-Key)
 */
import { createRoute, z } from "@hono/zod-openapi";
import { ok, fail } from "../../lib/http.js";
import {
  REF_CODE_RE,
  WAITLIST_ROLES,
  fakeStanding,
  joinWaitlist,
  listWaitlist,
  standingByRefCode,
  waitlistCsv,
  waitlistStats,
} from "../../services/waitlist.service.js";
import { requireInternalKey } from "./admin-epochs.js";
import { createRouter, json, responses } from "./_openapi.js";

export const waitlistRouter = createRouter();
const TAGS = ["Waitlist"];

const INTERESTS = [
  "compute", "ai-inference", "storage", "containers", "hosting", "bandwidth", "confidential-vm", "databases", "verify",
  "cdn", "dns", "tls", "ddos", "waf", "edge-functions", "object-storage", "kv-queues", "tunnels", "zero-trust", "website-builder", "ai-gateway", "agent-desktops", "workstations",
] as const;
const DETAILS_MAX_BYTES = 2048;

const JoinBody = z.object({
  email: z.string().trim().toLowerCase().max(254).email(),
  role: z.enum(WAITLIST_ROLES),
  name: z.string().trim().max(80).optional(),
  company: z.string().trim().max(120).optional(),
  country: z
    .string()
    .regex(/^[A-Za-z]{2}$/, "expected an ISO-3166 alpha-2 code")
    .transform((s) => s.toUpperCase())
    .optional(),
  interests: z.array(z.enum(INTERESTS)).max(8).optional(),
  details: z
    .record(z.union([z.string().max(200), z.number(), z.boolean()]))
    .refine((d) => Object.keys(d).length <= 12, "at most 12 keys")
    .refine((d) => new TextEncoder().encode(JSON.stringify(d)).length <= DETAILS_MAX_BYTES, "at most 2 KB")
    .optional(),
  newsletter: z.boolean().optional(),
  consent: z.literal(true, { errorMap: () => ({ message: "consent is required" }) }),
  ref: z.string().trim().toUpperCase().max(64).optional(),
  source: z.string().trim().max(64).optional(),
  /** Honeypot: hidden from people, filled by bots. Non-empty → fake success, nothing stored. */
  website: z.string().optional(),
});

const Standing = z.object({
  status: z.literal("success"),
  position: z.number().int(),
  refCode: z.string(),
  referrals: z.number().int(),
});

const joinRoute = createRoute({
  method: "post",
  path: "/waitlist",
  tags: TAGS,
  request: { body: { required: true, content: { "application/json": { schema: JoinBody } } } },
  responses: responses(
    {
      201: json(Standing, "Joined"),
      200: json(Standing, "Already on the list — existing standing, nothing updated"),
    },
    400,
    429,
  ),
});

waitlistRouter.openapi(joinRoute, async (c) => {
  const { website, consent: _consent, ...input } = c.req.valid("json");
  if (website && website.trim() !== "") return ok(c, { ...(await fakeStanding()) }, 201);
  const r = await joinWaitlist(input);
  return ok(c, { ...r.standing }, r.created ? 201 : 200);
});

// Registered before /waitlist/{refCode} so "stats" is not read as a code.
const statsRoute = createRoute({
  method: "get",
  path: "/waitlist/stats",
  tags: TAGS,
  responses: responses(
    {
      200: json(
        z.object({
          status: z.literal("success"),
          total: z.number().int(),
          byRole: z.record(z.enum(WAITLIST_ROLES), z.number().int()),
        }),
        "Sign-up counts",
      ),
    },
    429,
  ),
});

waitlistRouter.openapi(statsRoute, async (c) => ok(c, { ...(await waitlistStats()) }));

const lookupRoute = createRoute({
  method: "get",
  path: "/waitlist/{refCode}",
  tags: TAGS,
  request: {
    params: z.object({
      refCode: z
        .string()
        .transform((s) => s.toUpperCase())
        .pipe(z.string().regex(REF_CODE_RE, "expected an 8-character ref code")),
    }),
  },
  responses: responses(
    {
      200: json(
        z.object({ status: z.literal("success"), position: z.number().int(), referrals: z.number().int() }),
        "Standing for a ref code",
      ),
    },
    400,
    404,
    429,
  ),
});

waitlistRouter.openapi(lookupRoute, async (c) => {
  const s = await standingByRefCode(c.req.valid("param").refCode);
  if (!s) return fail(c, "not_found", "Unknown ref code");
  return ok(c, { position: s.position, referrals: s.referrals });
});

const WaitlistEntry = z.object({
  id: z.string(),
  email: z.string(),
  role: z.string(),
  name: z.string().nullable(),
  company: z.string().nullable(),
  country: z.string().nullable(),
  interests: z.array(z.string()).nullable(),
  details: z.record(z.unknown()).nullable(),
  newsletter: z.boolean(),
  refCode: z.string(),
  referredBy: z.string().nullable(),
  referrals: z.number().int(),
  source: z.string().nullable(),
  createdAt: z.number().int(),
});

const adminListRoute = createRoute({
  method: "get",
  path: "/admin/waitlist",
  tags: ["Admin"],
  middleware: [requireInternalKey] as const,
  request: { query: z.object({ format: z.enum(["json", "csv"]).default("json") }) },
  responses: responses(
    {
      200: {
        description: "All sign-ups, oldest first",
        content: {
          "application/json": { schema: z.object({ status: z.literal("success"), entries: z.array(WaitlistEntry) }) },
          "text/csv": { schema: z.string() },
        },
      },
    },
    400,
    401,
    503,
  ),
});

waitlistRouter.openapi(adminListRoute, async (c) => {
  const rows = await listWaitlist();
  if (c.req.valid("query").format === "csv") {
    return c.body(waitlistCsv(rows), 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="waitlist.csv"',
    });
  }
  return ok(c, {
    entries: rows.map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role,
      name: r.name,
      company: r.company,
      country: r.country,
      interests: r.interests ? (JSON.parse(r.interests) as string[]) : null,
      details: r.details ? (JSON.parse(r.details) as Record<string, unknown>) : null,
      newsletter: r.newsletter === 1,
      refCode: r.ref_code,
      referredBy: r.referred_by,
      referrals: r.referrals,
      source: r.source,
      createdAt: r.created_at,
    })),
  });
});
