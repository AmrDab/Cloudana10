/**
 * Provider nodes.
 *   POST /v1/nodes/announce  (node-signed) — register hardware + work types; optional fleetToken binds at once
 *   POST /v1/nodes/bind      (payout wallet signs the binding message)
 *   POST /v1/nodes/heartbeat (node-signed) — liveness; runs assignment + hosting duties; returns this node's work
 *   GET  /v1/nodes/mine      (JWT) — nodes bound to the caller's wallet
 */
import { createRoute, z } from "@hono/zod-openapi";
import { ok, fail } from "../../lib/http.js";
import { requireNode, type NodeVariables } from "../../middleware/node-auth.js";
import type { AuthVariables } from "../../middleware/auth.js";
import { EthAddressSchema } from "../../schemas/common.schema.js";
import { announceNode, bindNode, bindNodeToFleet, listNodesForPayout, touchNode } from "../../services/nodes.service.js";
import { fleetForToken } from "../../services/fleets.service.js";
import { getActiveAssignment, runAssignment } from "../../services/jobs.service.js";
import { workTypeIds } from "../../services/work-types.js";
import { runDeploymentDuties } from "../../services/deployment-duties.service.js";
import { pubkeyMatchesAddress } from "../../lib/eth.js";
import { log } from "../../lib/logger.js";
import { BEARER_AUTH, createRouter, json, responses } from "./_openapi.js";

export const nodesRouter = createRouter<AuthVariables & NodeVariables>();
const TAGS = ["Nodes"];
/** Capabilities a node may advertise besides registered work types (V3 §2). */
const HOSTING_CAPABILITIES = ["hosting", "container", "gpu"];
const NODE_SIGNED =
  "Node-signed: X-Node, X-Node-Timestamp (ms, ±60 s), X-Node-Signature = personal_sign(\"<METHOD> <path> <timestamp> <sha256(body) hex>\").";

const AnnounceSchema = z.object({
  manifest: z.object({
    cpuThreads: z.number().int().min(0).max(4096),
    ramGB: z.number().min(0).max(1e5),
    gpus: z.array(z.object({ name: z.string().max(128), vramGB: z.number().min(0).max(1e4) })).max(64),
    os: z.string().max(128),
  }),
  benchmarkMmacPerSec: z.number().min(0).max(1e9),
  /** Work types and capabilities: "matmul", plus "hosting" (static sites) / "container" (Docker present) / "gpu" (Docker + nvidia-smi). */
  workTypes: z.array(z.string().max(64)).min(1).max(16),
  /** Uncompressed secp256k1 public key of the node key ("04" + 128 hex, no 0x); sealed secrets are encrypted to it. */
  pubkey: z
    .string()
    .regex(/^(0x)?04[0-9a-fA-F]{128}$/, "pubkey must be an uncompressed secp256k1 key (04 + 128 hex)")
    .optional(),
  /** Datacenter fleet token (cft_…): binds the node to the fleet owner's payout, no bind code. */
  fleetToken: z.string().min(1).max(128).optional(),
});

const announceRoute = createRoute({
  method: "post",
  path: "/nodes/announce",
  tags: TAGS,
  description:
    `${NODE_SIGNED} With fleetToken the node is bound to the fleet owner's payout immediately (bindCode null); ` +
    "an unknown or revoked token is 401, a node already bound to another wallet is 409.",
  middleware: [requireNode] as const,
  request: { body: { required: true, content: { "application/json": { schema: AnnounceSchema } } } },
  responses: responses(
    {
      200: json(
        z.object({
          status: z.literal("success"),
          bound: z.boolean(),
          payout: z.string().nullable(),
          bindCode: z.string().nullable(),
          fleetId: z.string().nullable(),
        }),
        "Announced",
      ),
    },
    400,
    401,
    409,
  ),
});

nodesRouter.openapi(announceRoute, async (c) => {
  const body = c.req.valid("json");
  const known = [...workTypeIds(), ...HOSTING_CAPABILITIES];
  const workTypes = body.workTypes.filter((w) => known.includes(w));
  if (workTypes.length === 0) return fail(c, "validation_failed", `workTypes must include one of: ${known.join(", ")}`);
  const fleet = body.fleetToken ? await fleetForToken(body.fleetToken) : null;
  if (body.fleetToken && !fleet) return fail(c, "unauthorized", "Invalid or revoked fleet token");
  // Stored as sent (the agent sends 130 hex chars, no 0x) and returned to owners as nodePubkey.
  const pubkey = body.pubkey;
  if (pubkey && !pubkeyMatchesAddress(pubkey, c.get("node"))) {
    return fail(c, "validation_failed", "pubkey is not the public key of the signing node");
  }
  const node = await announceNode(c.get("node"), body.manifest, body.benchmarkMmacPerSec, workTypes, pubkey);
  if (fleet) {
    const r = await bindNodeToFleet(node.address, fleet);
    if (!r.ok) return fail(c, r.code, r.message);
    return ok(c, { bound: true, payout: fleet.owner, bindCode: null, fleetId: fleet.id });
  }
  return ok(c, {
    bound: !!node.payout,
    payout: node.payout,
    bindCode: node.payout ? null : node.bind_code ?? null,
    fleetId: node.fleet_id ?? null,
  });
});

const BindSchema = z.object({
  node: EthAddressSchema,
  payout: EthAddressSchema,
  message: z.string().min(1).max(512),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/, "Invalid signature"),
  code: z.string().regex(/^[0-9a-f]{16}$/, "Invalid bind code"),
});

const bindRoute = createRoute({
  method: "post",
  path: "/nodes/bind",
  tags: TAGS,
  description:
    "Bind a payout wallet to a node. The payout wallet signs exactly " +
    "\"Cloudana node binding\nNode: <node lowercase>\nPayout: <payout lowercase>\nIssued: <ISO>\" (Issued within 10 min). First binding wins.",
  request: { body: { required: true, content: { "application/json": { schema: BindSchema } } } },
  responses: responses({ 200: json(z.object({ status: z.literal("success"), bound: z.literal(true) }), "Bound") }, 400, 401, 404, 409),
});

nodesRouter.openapi(bindRoute, async (c) => {
  const { node, payout, message, signature, code } = c.req.valid("json");
  const r = await bindNode(node, payout, message, signature, code);
  if (!r.ok) return fail(c, r.code, r.message);
  return ok(c, { bound: true as const });
});

const AssignmentSchema = z.object({
  jobId: z.string(),
  workType: z.string(),
  n: z.number().int(),
  matrixA: z.array(z.number()),
  matrixB: z.array(z.number()),
  sigma: z.string(),
  expiresAt: z.number(),
});

const NodeDeploymentSchema = z.object({
  id: z.string(),
  action: z.enum(["start", "stop", "purge"]),
  kind: z.enum(["static", "container", "workstation"]),
  spec: z.record(z.unknown()).nullable(),
  sealedEnv: z.string().optional(),
});

const heartbeatRoute = createRoute({
  method: "post",
  path: "/nodes/heartbeat",
  tags: TAGS,
  description:
    `${NODE_SIGNED} Body {}. Unbound nodes never receive assignments. deployments: "start" (full spec, re-sent until ` +
    `the node reports running/failed) and "stop" / "purge" (spec null, re-sent until the node reports stopped; "purge" also ` +
      `deletes a workstation's volume). Stops/purges come before starts.`,
  middleware: [requireNode] as const,
  responses: responses(
    {
      200: json(
        z.object({ status: z.literal("success"), assignment: AssignmentSchema.nullable(), deployments: z.array(NodeDeploymentSchema) }),
        "Current assignment and hosting instructions",
      ),
    },
    401,
    404,
  ),
});

nodesRouter.openapi(heartbeatRoute, async (c) => {
  const node = c.get("node");
  await touchNode(node);
  try {
    await runAssignment();
  } catch (err) {
    log.api.warn("[nodes] assignment on heartbeat failed:", err);
  }
  const deployments = await runDeploymentDuties(node).catch((err) => {
    log.api.warn("[nodes] deployment duties on heartbeat failed:", err);
    return [];
  });
  return ok(c, { assignment: await getActiveAssignment(node), deployments });
});

const MyNodeSchema = z.object({
  address: z.string(),
  lastSeen: z.number().nullable(),
  online: z.boolean(),
  boundAt: z.number().nullable(),
  manifest: z
    .object({
      cpuThreads: z.number(),
      ramGB: z.number(),
      gpus: z.array(z.object({ name: z.string(), vramGB: z.number() })),
      os: z.string(),
      benchmarkMmacPerSec: z.number().optional(),
    })
    .nullable(),
  throughputMmacPerSec: z.number(),
  workTypes: z.array(z.string()),
  fleetId: z.string().nullable(),
  jobsDone: z.number().int(),
  jobsFailed: z.number().int(),
  earnedUcld: z.number().int(),
  deploymentsRunning: z.number().int(),
});

const mineRoute = createRoute({
  method: "get",
  path: "/nodes/mine",
  tags: TAGS,
  description:
    "Nodes bound to the caller's wallet. online = seen within NODE_ACTIVE_SECONDS. manifest.benchmarkMmacPerSec is the " +
    "self-reported benchmark; throughputMmacPerSec is the verified weight. earnedUcld = lane A + B for this node's jobs " +
    "plus hosting lane A for the hours it served; deploymentsRunning = its deployments in status running.",
  security: BEARER_AUTH,
  responses: responses({ 200: json(z.object({ status: z.literal("success"), nodes: z.array(MyNodeSchema) }), "Your nodes") }, 401),
});

nodesRouter.openapi(mineRoute, async (c) => ok(c, { nodes: await listNodesForPayout(c.get("jwtPayload").sub) }));
