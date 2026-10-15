/**
 * Provider nodes.
 *   POST /v1/nodes/announce  (node-signed) — register hardware + work types; optional fleetToken binds at once
 *   POST /v1/nodes/bind      (payout wallet signs the binding message)
 *   POST /v1/nodes/heartbeat (node-signed) — liveness; runs this node's hosting duties; returns its signed work
 *   GET  /v1/nodes/instruction-key — address of the key that signs node instructions (agents pin it)
 *   POST /v1/nodes/relay/ticket (node-signed) — short-lived ticket to open the relay socket (docs/V4_RELAY_CONTRACT.md)
 *   GET  /v1/nodes/mine      (JWT) — nodes bound to the caller's wallet
 * Global duties (dead-node requeue, preemption, matmul assignment) run from the cron, not here.
 */
import { createRoute, z } from "@hono/zod-openapi";
import { ok, fail } from "../../lib/http.js";
import { requireNode, type NodeVariables } from "../../middleware/node-auth.js";
import { rateLimit, trustedClientIp, verifiedNodeKey } from "../../middleware/rate-limit.js";
import type { AuthVariables } from "../../middleware/auth.js";
import { EthAddressSchema } from "../../schemas/common.schema.js";
import { announceNode, bindNode, bindNodeToFleet, getNode, listNodesForPayout, touchNode } from "../../services/nodes.service.js";
import { fleetForToken } from "../../services/fleets.service.js";
import { getActiveAssignment } from "../../services/jobs.service.js";
import { workTypeIds } from "../../services/work-types.js";
import { runDeploymentDuties } from "../../services/deployment-duties.service.js";
import { endpointAllowed } from "../../services/deployment-spec.js";
import { agentVersionAllowed, instructionSignerAddress, minAgentVersion, signInstruction } from "../../services/instruction-signing.service.js";
import { STORAGE_CAPABILITY, recordNodeNetwork, storageCapable, storageInstructions } from "../../services/storage.service.js";
import { getEnv } from "../../config/env.js";
import { issueTicket } from "../../../../../shared/relay-ticket.js";
import { pubkeyMatchesAddress } from "../../lib/eth.js";
import { log } from "../../lib/logger.js";
import { getD1 } from "../../lib/storage.js";
import { BEARER_AUTH, createRouter, json, responses } from "./_openapi.js";

export const nodesRouter = createRouter<AuthVariables & NodeVariables>();
const TAGS = ["Nodes"];
/** Capabilities a node may advertise besides registered work types (V3 §2). */
/** "any-image": runs images outside the curated list (CLOUDANA_ANY_IMAGE=1; endpoint replicas need it). */
const HOSTING_CAPABILITIES = ["hosting", "container", "gpu", "any-image"];
const NODE_SIGNED =
  "Node-signed: X-Node, X-Node-Timestamp (ms, ±60 s), X-Nonce (16 bytes hex, single use within 120 s), " +
  "X-Node-Signature = personal_sign(\"<METHOD> <path> <timestamp> <sha256(body) hex> <nonce>\").";
const HOST = /^(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9]([A-Za-z0-9-]{0,62}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,62}[A-Za-z0-9])?)*)$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
/** Cloudflare's ASN for the request (Workers only). */
const cfAsn = (c: { req: { raw: Request } }) => (c.req.raw as Request & { cf?: { asn?: number } }).cf?.asn;
/** Per-node limits, after requireNode so they key on the verified address (see middleware/security.ts). */
const announceLimit = rateLimit({ bucket: "nodes-announce", limit: 10, windowSec: 60, keyBy: verifiedNodeKey });
const heartbeatLimit = rateLimit({ bucket: "nodes-heartbeat", limit: 12, windowSec: 60, keyBy: verifiedNodeKey });
const ticketLimit = rateLimit({ bucket: "nodes-relay-ticket", limit: 12, windowSec: 60, keyBy: verifiedNodeKey });
/** Capability a relay-capable agent announces; kept only when this API runs the relay (RELAY_TICKET_SECRET). */
export const RELAY_CAPABILITY = "relay";
/** A hostname or IP as the node stores and compares it: lowercase, IPv6 without brackets. */
export const normalizeHost = (host: string) => host.toLowerCase().replace(/^\[|\]$/g, "");

const AnnounceSchema = z.object({
  manifest: z.object({
    cpuThreads: z.number().int().min(0).max(4096),
    ramGB: z.number().min(0).max(1e5),
    gpus: z.array(z.object({ name: z.string().max(128), vramGB: z.number().min(0).max(1e4) })).max(64),
    os: z.string().max(128),
  }),
  benchmarkMmacPerSec: z.number().min(0).max(1e9),
  /** Work types and capabilities: "matmul", plus "hosting" (static sites) / "container" (Docker present) / "gpu" (Docker + nvidia-smi) / "any-image" (uncurated images) / "relay" (serves through the relay socket). */
  workTypes: z.array(z.string().max(64)).min(1).max(16),
  /** Uncompressed secp256k1 public key of the node key ("04" + 128 hex, no 0x); sealed secrets are encrypted to it. */
  pubkey: z
    .string()
    .regex(/^(0x)?04[0-9a-fA-F]{128}$/, "pubkey must be an uncompressed secp256k1 key (04 + 128 hex)")
    .optional(),
  /** Datacenter fleet token (cft_…): binds the node to the fleet owner's payout, no bind code. */
  fleetToken: z.string().min(1).max(128).optional(),
  /** Host the node serves hosting endpoints on; every endpoint it reports must use exactly this host. */
  publicHost: z.string().max(253).regex(HOST, "publicHost must be a hostname or IP").optional(),
  /** Agent version (semver). Nodes below MIN_AGENT_VERSION receive no work. */
  agentVersion: z.string().regex(SEMVER, "agentVersion must be x.y.z").optional(),
  /** Storage quota in GB (agent ≥ 1.4.0 with the `storage` capability and the relay; docs/V4_STORAGE_PHASE1_CONTRACT.md). */
  storageGb: z.number().min(0).max(1_000_000).optional(),
});

const announceRoute = createRoute({
  method: "post",
  path: "/nodes/announce",
  tags: TAGS,
  description:
    `${NODE_SIGNED} With fleetToken the node is bound to the fleet owner's payout immediately (bindCode null); ` +
    "an unknown or revoked token is 401, a node already bound to another wallet is 409.",
  middleware: [requireNode, announceLimit] as const,
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
  const relayOn = !!getEnv().RELAY_TICKET_SECRET;
  const storage = storageCapable(body.agentVersion, body.storageGb, relayOn && body.workTypes.includes(RELAY_CAPABILITY));
  const known = [...workTypeIds(), ...HOSTING_CAPABILITIES, ...(relayOn ? [RELAY_CAPABILITY] : []), ...(storage ? [STORAGE_CAPABILITY] : [])];
  let workTypes = body.workTypes.filter((w) => known.includes(w));
  if (workTypes.length === 0) return fail(c, "validation_failed", `workTypes must include one of: ${known.join(", ")}`);
  // A relay node serves through its outbound socket, so hosting needs no public IP (docs/V4_RELAY_CONTRACT.md).
  const relay = workTypes.includes(RELAY_CAPABILITY);
  // A node whose announced host is not publicly reachable (or missing) cannot serve hosting: never place it there,
  // so a misconfigured home node is not handed sites it then has to refuse. Reported endpoints are later checked
  // against this host, so outside DEV_MODE it must also be the IP the announce itself came from: a self-chosen
  // host would let a node bill for sites that another machine serves.
  const dev = getEnv().DEV_MODE;
  const publicHost = body.publicHost ? normalizeHost(body.publicHost) : undefined;
  const hostPublic = !!publicHost && endpointAllowed(`http://${body.publicHost}/`, dev) && (dev || publicHost === normalizeHost(trustedClientIp(c)));
  if (!hostPublic && !relay) workTypes = workTypes.filter((w) => !HOSTING_CAPABILITIES.includes(w));
  if (workTypes.every((w) => w === RELAY_CAPABILITY || w === STORAGE_CAPABILITY)) {
    return fail(c, "validation_failed", "hosting capabilities need the relay or a public publicHost equal to the node's own IP");
  }
  // Only a verified public host is stored: endpoints (legacy direct nodes, workstation SSH) are checked against it.
  const storedHost = hostPublic ? publicHost : undefined;
  // The host of a live deployment's endpoint cannot move: changing it would orphan the endpoint checks on sites
  // still being billed. Stop them first (the node re-announces every few heartbeats while unbound anyway).
  const current = await getNode(c.get("node"));
  if (current?.public_host && current.public_host !== (storedHost ?? null)) {
    const live = await getD1()
      .prepare("SELECT COUNT(*) AS n FROM deployments WHERE node = ? AND status IN ('assigned','running','unreachable')")
      .bind(c.get("node"))
      .first<{ n: number }>();
    if ((live?.n ?? 0) > 0) return fail(c, "conflict", "publicHost cannot change while this node has live deployments");
  }
  const fleet = body.fleetToken ? await fleetForToken(body.fleetToken) : null;
  if (body.fleetToken && !fleet) return fail(c, "unauthorized", "Invalid or revoked fleet token");
  // Stored as sent (the agent sends 130 hex chars, no 0x) and returned to owners as nodePubkey.
  const pubkey = body.pubkey;
  if (pubkey && !pubkeyMatchesAddress(pubkey, c.get("node"))) {
    return fail(c, "validation_failed", "pubkey is not the public key of the signing node");
  }
  const node = await announceNode(c.get("node"), body.manifest, body.benchmarkMmacPerSec, workTypes, pubkey, {
    publicHost: storedHost,
    agentVersion: body.agentVersion,
  });
  const quotaMb = workTypes.includes(STORAGE_CAPABILITY) ? Math.floor((body.storageGb ?? 0) * 1024) : 0;
  await getD1().prepare("UPDATE nodes SET storage_quota_mb = ? WHERE address = ?").bind(quotaMb, node.address).run();
  await recordNodeNetwork(node.address, trustedClientIp(c), cfAsn(c));
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
  imageAllowed: z.boolean().optional(),
  /** "start": serve it through this node's relay socket (fixed at placement). */
  relayed: z.boolean().optional(),
});

const StorageOpSchema = z.union([
  z.object({ op: z.literal("fetch"), copy: z.string(), size: z.number().int(), leaves: z.number().int(), root: z.string() }),
  z.object({ op: z.literal("delete"), copy: z.string() }),
]);

const HeartbeatResponseSchema = z.object({
  status: z.literal("success"),
  assignment: AssignmentSchema.nullable(),
  deployments: z.array(NodeDeploymentSchema),
  /** Storage-capable nodes only (docs/V4_STORAGE_PHASE1_CONTRACT.md): signed with assignment and deployments. */
  storage: z.array(StorageOpSchema).optional(),
  /** Signature over { nodeAddress, ts, nonce, body: { assignment, deployments } } — see GET /v1/nodes/instruction-key. Absent only when the API has no signing key. */
  sig: z.string().optional(),
  ts: z.number().optional(),
  nonce: z.string().optional(),
  minAgentVersion: z.string(),
  /** True when this node's agent is below minAgentVersion: it got no work (stops are still delivered). */
  upgradeRequired: z.boolean(),
});

const heartbeatRoute = createRoute({
  method: "post",
  path: "/nodes/heartbeat",
  tags: TAGS,
  description:
    `${NODE_SIGNED} Body {} (optionally { agentVersion }). Unbound nodes never receive assignments. deployments: "start" (full spec, re-sent until ` +
    `the node reports running/failed) and "stop" / "purge" (spec null, re-sent until the node reports stopped; "purge" also ` +
    `deletes a workstation's volume). Stops/purges come before starts. The response is signed (sig, ts, nonce) with the ` +
    `instruction key; agents verify it against the pinned signer and ignore unsigned or stale instructions.`,
  middleware: [requireNode, heartbeatLimit] as const,
  responses: responses({ 200: json(HeartbeatResponseSchema, "Current assignment and hosting instructions, signed") }, 401, 404, 429),
});

nodesRouter.openapi(heartbeatRoute, async (c) => {
  const node = c.get("node");
  await touchNode(node);
  const body = (c.get("nodeBody") ?? {}) as { agentVersion?: unknown; relay?: unknown };
  // The agent's relay socket is open (and answered a ping recently): relayed placement may use this node.
  if (body.relay === true) await getD1().prepare("UPDATE nodes SET relay_at = ? WHERE address = ?").bind(Date.now(), node).run();
  const row = await getNode(node);
  if (row) await recordNodeNetwork(node, trustedClientIp(c), cfAsn(c), row);
  const version = typeof body.agentVersion === "string" && SEMVER.test(body.agentVersion) ? body.agentVersion : row?.agent_version ?? null;
  if (row && version && version !== row.agent_version) {
    await getD1().prepare("UPDATE nodes SET agent_version = ? WHERE address = ?").bind(version, node).run();
  }
  const allowed = agentVersionAllowed(version);
  let deployments = await runDeploymentDuties(node).catch((err) => {
    log.api.warn("[nodes] deployment duties on heartbeat failed:", err);
    return [];
  });
  // Below the minimum version: no new work (stops and purges still go out so the node winds down cleanly).
  if (!allowed) deployments = deployments.filter((d) => d.action !== "start");
  // Storage-capable nodes get a third signed key; others keep the exact { assignment, deployments } body 1.3.x verifies.
  const storage = row ? await storageInstructions(node, row.work_types ?? null, allowed).catch(() => null) : null;
  const instructions = {
    assignment: allowed ? await getActiveAssignment(node) : null,
    deployments,
    ...(storage ? { storage } : {}),
  };
  const envelope = await signInstruction(node, instructions);
  if (!envelope) log.api.warn("[nodes] INSTRUCTION_SIGNING_KEY is not set — heartbeat instructions go out unsigned (agents ignore them)");
  return ok(c, { ...instructions, ...(envelope ?? {}), minAgentVersion: minAgentVersion(), upgradeRequired: !allowed });
});

const ticketRoute = createRoute({
  method: "post",
  path: "/nodes/relay/ticket",
  tags: TAGS,
  description:
    `${NODE_SIGNED} Body {}. A single-use ticket (valid 60 s) to open wss://<relay>/connect?ticket=… ` +
    "(docs/V4_RELAY_CONTRACT.md). 503 not_configured when this API runs no relay — the agent stays in legacy mode.",
  middleware: [requireNode, ticketLimit] as const,
  responses: responses(
    { 200: json(z.object({ status: z.literal("success"), ticket: z.string(), url: z.string(), expiresAt: z.number() }), "Ticket") },
    401,
    403,
    429,
    503,
  ),
});

nodesRouter.openapi(ticketRoute, async (c) => {
  const env = getEnv();
  if (!env.RELAY_TICKET_SECRET) return fail(c, "not_configured", "this API runs no relay");
  // Only an announced, bound node gets a socket (an evicted or unknown key reconnects to nothing). 403, never 404:
  // the agent reads 404 as "this API has no relay" and would fall back to legacy mode.
  const row = await getNode(c.get("node"));
  if (!row?.payout) return fail(c, "forbidden", "announce and bind this node before opening the relay");
  const { ticket, expiresAt } = await issueTicket(env.RELAY_TICKET_SECRET, c.get("node"));
  return ok(c, { ticket, url: env.RELAY_URL, expiresAt });
});

const instructionKeyRoute = createRoute({
  method: "get",
  path: "/nodes/instruction-key",
  tags: TAGS,
  description:
    "Address of the key that signs node instructions (heartbeat sig). Agents pin it (CLOUDANA_INSTRUCTION_SIGNER); " +
    "this endpoint is for operators to confirm the pin, not a trust anchor. 503 when the API has no signing key.",
  responses: responses({ 200: json(z.object({ status: z.literal("success"), signer: z.string(), minAgentVersion: z.string() }), "Signer") }, 503),
});

nodesRouter.openapi(instructionKeyRoute, async (c) => {
  const signer = instructionSignerAddress();
  if (!signer) return fail(c, "not_configured", "INSTRUCTION_SIGNING_KEY is not configured");
  return ok(c, { signer, minAgentVersion: minAgentVersion() });
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
