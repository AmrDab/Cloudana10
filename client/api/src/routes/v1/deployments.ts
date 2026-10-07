/**
 * Hosted deployments (JWT; docs/V3_CONTRACT.md §4).
 *   POST   /v1/deployments               — create; holds the first hour (422 if short)
 *   GET    /v1/deployments               — the caller's deployments, newest first
 *   GET    /v1/deployments/:id           — one deployment + events (≤ 50) + the assigned node's pubkey
 *   PATCH  /v1/deployments/:id           — workstations: extend maxHours while assigned|running
 *   PATCH  /v1/deployments/:id/secrets   — set sealedEnv while queued|assigned (containers)
 *   DELETE /v1/deployments/:id[?purge=1]  — stop now (purge: workstation volume too); the node confirms on its next heartbeat
 * Another owner's deployment answers 404, the same as a missing one.
 * The GETs first re-queue the caller's deployments whose node went offline (as heartbeats do for all).
 *
 * Hosting gateway (docs/IMPL_SPEC_2026-10.md):
 *   GET    /v1/deployments/:id/route     — public, cached 30 s: { id, state, endpoint|null, kind } for the gateway
 *   POST   /v1/admin/deployments/:id/stop — X-Internal-Key: status stopped, reason admin
 */
import { createRoute, z } from "@hono/zod-openapi";
import { ok, fail } from "../../lib/http.js";
import {
  adminStop,
  createDeployment,
  getOwnedRow,
  listDeployments,
  listEvents,
  extendWorkstation,
  nodePubkey,
  presentDeployments,
  publicRoute,
  setSealedEnv,
  stopDeployment,
} from "../../services/deployments.service.js";
import { requeueDeadNodeDeployments } from "../../services/deployment-duties.service.js";
import { log } from "../../lib/logger.js";
import { requireInternalKey } from "./admin-epochs.js";
import { BEARER_AUTH, createRouter, json, responses } from "./_openapi.js";

export const deploymentsRouter = createRouter();
const TAGS = ["Deployments"];

const Status = z.enum(["queued", "assigned", "running", "unreachable", "stopped", "failed"]);
const DeploymentSchema = z.object({
  id: z.string(),
  templateId: z.string().nullable(),
  name: z.string(),
  kind: z.enum(["static", "container", "workstation"]),
  status: Status,
  statusReason: z.string().nullable(),
  node: z.string().nullable(),
  endpoint: z.string().nullable().openapi({ description: "The node's origin (owner detail); the public address is `url`" }),
  url: z.string().nullable().openapi({ description: "Public gateway URL https://{id}.{SITES_DOMAIN}; null for workstations" }),
  priceUcldPerHour: z.number().int(),
  createdAt: z.number(),
  assignedAt: z.number().nullable(),
  startedAt: z.number().nullable(),
  stoppedAt: z.number().nullable(),
  lastProbeAt: z.number().nullable(),
  probeOk: z.boolean().nullable(),
  spec: z.record(z.unknown()).openapi({
    description: "static: { files: [{ path, bytes }] }; container/workstation: the spec with env replaced by envKeys: string[]",
  }),
  // Workstations only (docs/WORKSTATIONS.md §4):
  tier: z.enum(["on-demand", "interruptible"]).optional(),
  maxHours: z.number().int().optional(),
  hoursUsed: z.number().optional().openapi({ description: "since it started on its current node; 2 decimals" }),
  hoursLeft: z.number().optional().openapi({ description: "maxHours − hoursUsed, 0 once stopped" }),
  connect: z
    .object({ web: z.string().optional(), ssh: z.string().optional(), webToken: z.string().optional() })
    .optional()
    .openapi({
      description:
        "while running/unreachable: web = full URL (may include a token); ssh = \"ssh -p <port> <user>@<host>\"; " +
        "webToken = password for UIs whose token cannot go in the URL (GET /deployments/{id} only, never in the list)",
    }),
  gpu: z.object({ count: z.number().int(), names: z.array(z.string()) }).nullable().optional(),
});
const EventSchema = z.object({ at: z.number(), level: z.enum(["info", "warn", "error"]), message: z.string() });
const IdParam = z.object({ id: z.string().uuid("Invalid deployment id") });

const CreateSchema = z.object({
  templateId: z.string().min(1).max(200).optional(),
  name: z.string().trim().min(1).max(80),
  kind: z.enum(["static", "container", "workstation"]),
  spec: z.record(z.unknown()).openapi({ description: "StaticSpec, ContainerSpec (V3 §3) or WorkstationSpec (WORKSTATIONS §1), validated per kind" }),
});

const createRouteDef = createRoute({
  method: "post",
  path: "/deployments",
  tags: TAGS,
  description:
    "Static price = PRICE_HOSTING_UCLD_PER_HOUR; container = ceil(cpu/1000×CPU + memMb/1024×MEM + storageMb/1024×STORAGE), " +
    "min the hosting price. The first hour is held from your credits. Static sites need index.html; ≤ 2 MB decoded " +
    "(and ≤ 1.9 MB encoded — D1 row limit). Container specs ≤ 32 KB.",
  security: BEARER_AUTH,
  request: { body: { required: true, content: { "application/json": { schema: CreateSchema } } } },
  responses: responses(
    {
      201: json(
        z.object({ status: z.literal("success"), id: z.string(), priceUcldPerHour: z.number().int(), deploymentStatus: z.literal("queued") }),
        "Queued. (The envelope owns `status`, so the deployment status is `deploymentStatus`.)",
      ),
    },
    400,
    401,
    413,
    422,
    429,
  ),
});

deploymentsRouter.openapi(createRouteDef, async (c) => {
  const body = c.req.valid("json");
  const r = await createDeployment({ owner: c.get("jwtPayload").sub, ...body });
  if (!r.ok) return fail(c, r.code, r.message, r.details);
  return ok(c, { id: r.id, priceUcldPerHour: r.priceUcldPerHour, deploymentStatus: "queued" as const }, 201);
});

const listRoute = createRoute({
  method: "get",
  path: "/deployments",
  tags: TAGS,
  security: BEARER_AUTH,
  responses: responses(
    { 200: json(z.object({ status: z.literal("success"), deployments: z.array(DeploymentSchema) }), "Your deployments") },
    401,
    429,
  ),
});

/** Cheap per-owner dead-node check, so a deployment does not wait for some node's heartbeat to re-queue it. */
async function requeueMine(owner: string): Promise<void> {
  await requeueDeadNodeDeployments(Date.now(), owner).catch((err) => log.api.warn("[deployments] dead-node requeue failed:", err));
}

deploymentsRouter.openapi(listRoute, async (c) => {
  const owner = c.get("jwtPayload").sub;
  await requeueMine(owner);
  return ok(c, { deployments: await listDeployments(owner) });
});

const getRoute = createRoute({
  method: "get",
  path: "/deployments/{id}",
  tags: TAGS,
  description: "nodePubkey (uncompressed secp256k1 hex) is present once a node with a key is assigned — seal secrets to it.",
  security: BEARER_AUTH,
  request: { params: IdParam },
  responses: responses(
    {
      200: json(
        z.object({
          status: z.literal("success"),
          deployment: DeploymentSchema,
          events: z.array(EventSchema),
          nodePubkey: z.string().optional(),
        }),
        "Deployment",
      ),
    },
    400,
    401,
    404,
    429,
  ),
});

deploymentsRouter.openapi(getRoute, async (c) => {
  const owner = c.get("jwtPayload").sub;
  await requeueMine(owner);
  const row = await getOwnedRow(owner, c.req.valid("param").id);
  if (!row) return fail(c, "not_found", "deployment not found");
  const pubkey = await nodePubkey(row.node);
  const [deployment] = await presentDeployments([row], true);
  return ok(c, { deployment, events: await listEvents(row.id), ...(pubkey && { nodePubkey: pubkey }) });
});

const secretsRoute = createRoute({
  method: "patch",
  path: "/deployments/{id}/secrets",
  tags: TAGS,
  description: "sealedEnv = base64(ephemeralPubkey(65) ‖ nonce(24) ‖ ciphertext) sealed to nodePubkey (V3 §6). Containers only.",
  security: BEARER_AUTH,
  request: {
    params: IdParam,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({ sealedEnv: z.string().min(1).max(16_384).regex(/^[A-Za-z0-9+/]*={0,2}$/, "sealedEnv must be base64") }),
        },
      },
    },
  },
  responses: responses({ 200: json(z.object({ status: z.literal("success") }), "Updated") }, 400, 401, 404, 409, 429),
});

deploymentsRouter.openapi(secretsRoute, async (c) => {
  const r = await setSealedEnv(c.get("jwtPayload").sub, c.req.valid("param").id, c.req.valid("json").sealedEnv);
  return r.ok ? ok(c, {}) : fail(c, r.code, r.message);
});

const patchRoute = createRoute({
  method: "patch",
  path: "/deployments/{id}",
  tags: TAGS,
  description:
    "Workstations: extend maxHours (must be larger than the current value) while assigned or running. " +
    "Billing continues hour by hour as before; nothing extra is held.",
  security: BEARER_AUTH,
  request: {
    params: IdParam,
    body: { required: true, content: { "application/json": { schema: z.object({ maxHours: z.number().int().min(1).max(720) }) } } },
  },
  responses: responses({ 200: json(z.object({ status: z.literal("success") }), "Updated") }, 400, 401, 404, 409, 429),
});

deploymentsRouter.openapi(patchRoute, async (c) => {
  const r = await extendWorkstation(c.get("jwtPayload").sub, c.req.valid("param").id, c.req.valid("json").maxHours);
  return r.ok ? ok(c, {}) : fail(c, r.code, r.message);
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/deployments/{id}",
  tags: TAGS,
  description:
    "Stops billing now (a running deployment pays the elapsed part of its hour; the rest of the hold is released). " +
    "The node receives action \"stop\" (\"purge\" with ?purge=1) on its heartbeats until it confirms. " +
    "purge also works on an already stopped workstation.",
  security: BEARER_AUTH,
  request: {
    params: IdParam,
    query: z.object({
      purge: z.enum(["1", "true"]).optional().openapi({ description: "Workstations: also delete the volume now (default: kept keepDays)" }),
    }),
  },
  responses: responses(
    { 200: json(z.object({ status: z.literal("success"), deploymentStatus: z.literal("stopped") }), "Stopped") },
    400,
    401,
    404,
    409,
    429,
  ),
});

deploymentsRouter.openapi(deleteRoute, async (c) => {
  const r = await stopDeployment(c.get("jwtPayload").sub, c.req.valid("param").id, !!c.req.valid("query").purge);
  return r.ok ? ok(c, { deploymentStatus: "stopped" as const }) : fail(c, r.code, r.message);
});

// ── Hosting gateway ─────────────────────────────────────────────────────────
const ROUTE_CACHE_SECONDS = 30;

const routeRoute = createRoute({
  method: "get",
  path: "/deployments/{id}/route",
  tags: TAGS,
  description:
    "Public (no auth): what the *.sites gateway needs to proxy a site. endpoint is set only while running. " +
    "Workstations answer 404. Cached 30 s (Cache-Control).",
  request: { params: IdParam },
  responses: responses(
    {
      200: json(
        z.object({
          status: z.literal("success"),
          id: z.string(),
          state: Status,
          endpoint: z.string().nullable(),
          kind: z.enum(["static", "container"]),
        }),
        "Route",
      ),
    },
    400,
    404,
    429,
  ),
});

deploymentsRouter.openapi(routeRoute, async (c) => {
  c.header("Cache-Control", `public, max-age=${ROUTE_CACHE_SECONDS}`);
  const r = await publicRoute(c.req.valid("param").id);
  if (!r) return fail(c, "not_found", "deployment not found");
  return ok(c, { id: r.id, state: r.state, endpoint: r.endpoint, kind: r.kind });
});

const adminStopRoute = createRoute({
  method: "post",
  path: "/admin/deployments/{id}/stop",
  tags: ["Admin"],
  description: "Stops any deployment (status stopped, reason admin); the node receives action \"stop\" on its heartbeats until it confirms.",
  middleware: [requireInternalKey] as const,
  request: { params: IdParam },
  responses: responses(
    { 200: json(z.object({ status: z.literal("success"), deploymentStatus: z.literal("stopped") }), "Stopped") },
    400,
    401,
    404,
    409,
    503,
  ),
});

deploymentsRouter.openapi(adminStopRoute, async (c) => {
  const r = await adminStop(c.req.valid("param").id);
  return r.ok ? ok(c, { deploymentStatus: "stopped" as const }) : fail(c, r.code, r.message);
});
