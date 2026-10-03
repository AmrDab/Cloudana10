/**
 * Node side of hosted deployments (V3 §4).
 *   POST /v1/nodes/deployments/:id/status (node-signed) { status: running|failed|stopped, endpoint?, message? }
 * The node must be the one the deployment is assigned to (otherwise 404).
 * "stopped"/"failed" on a deployment already stopped by its owner confirms the stop.
 */
import { createRoute, z } from "@hono/zod-openapi";
import { ok, fail } from "../../lib/http.js";
import { requireNode, type NodeVariables } from "../../middleware/node-auth.js";
import { reportDeploymentStatus } from "../../services/deployment-duties.service.js";
import { createRouter, json, responses } from "./_openapi.js";

export const nodesDeploymentsRouter = createRouter<NodeVariables>();

const StatusBody = z.object({
  status: z.enum(["running", "failed", "stopped"]),
  endpoint: z
    .string()
    .max(300)
    .url()
    .refine((u) => /^https?:\/\//i.test(u), "endpoint must be http(s)")
    .optional()
    .openapi({ description: "Web endpoint, stored verbatim (a workstation's may carry a token path/query; only its origin is probed)" }),
  /** Workstations: sshd as "host:port" (IPv6 as "[addr]:port"). */
  sshEndpoint: z
    .string()
    .max(300)
    .regex(/^(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9.-]+):([1-9]\d{0,4})$/, "sshEndpoint must be host:port")
    .refine((s) => Number(s.slice(s.lastIndexOf(":") + 1)) <= 65535, "port must be ≤ 65535")
    .optional(),
  /** Workstations: a web token that cannot ride in the URL (code-server password). Shown to the owner only. */
  webToken: z.string().min(1).max(256).regex(/^[\x21-\x7e]+$/, "webToken must be printable ASCII").optional(),
  message: z.string().max(500).optional(),
});

const statusRoute = createRoute({
  method: "post",
  path: "/nodes/deployments/{id}/status",
  tags: ["Nodes"],
  description:
    "Node-signed like heartbeat. running (endpoint required; an SSH-only workstation may send sshEndpoint instead) moves assigned → running and starts the billing hour; " +
    "failed/stopped end it and settle the hold; on an owner-stopped deployment, stopped confirms the stop.",
  middleware: [requireNode] as const,
  request: {
    params: z.object({ id: z.string().uuid("Invalid deployment id") }),
    body: { required: true, content: { "application/json": { schema: StatusBody } } },
  },
  responses: responses(
    { 200: json(z.object({ status: z.literal("success"), deploymentStatus: z.string() }), "Recorded") },
    400,
    401,
    404,
    409,
    429,
  ),
});

nodesDeploymentsRouter.openapi(statusRoute, async (c) => {
  const r = await reportDeploymentStatus(c.get("node"), c.req.valid("param").id, c.req.valid("json"));
  return r.ok ? ok(c, { deploymentStatus: r.status }) : fail(c, r.code, r.message);
});
