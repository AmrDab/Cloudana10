/**
 * Storage phase 1 node routes (docs/V4_STORAGE_PHASE1_CONTRACT.md §B): a node downloads a copy it was told to fetch
 * (only while pending) and reports what it holds, deleted or failed to fetch. Both are node-signed.
 */
import { createRoute, z } from "@hono/zod-openapi";
import { fail, ok } from "../../lib/http.js";
import { requireNode, type NodeVariables } from "../../middleware/node-auth.js";
import { rateLimit, verifiedNodeKey } from "../../middleware/rate-limit.js";
import { getNode } from "../../services/nodes.service.js";
import { applyReports, downloadCopy } from "../../services/storage.service.js";
import { createRouter, json, responses } from "./_openapi.js";

export const nodesStorageRouter = createRouter<NodeVariables>();

const TAGS = ["Nodes"];
/** Per node (after requireNode): a node fetches ≤ 4 copies a heartbeat and reports once. */
const downloadLimit = rateLimit({ bucket: "nodes-storage-copy", limit: 60, windowSec: 60, keyBy: verifiedNodeKey });
const reportLimit = rateLimit({ bucket: "nodes-storage-report", limit: 20, windowSec: 60, keyBy: verifiedNodeKey });
const IdParam = z.object({ id: z.string().regex(/^[0-9a-f-]{36}$/, "copy id") });

// A binary body: a plain route (OpenAPI describes JSON).
nodesStorageRouter.get("/nodes/storage/copies/:id", requireNode, downloadLimit, async (c) => {
  const parsed = IdParam.safeParse({ id: c.req.param("id") });
  if (!parsed.success) return fail(c, "validation_failed", "copy id");
  if (!(await getNode(c.get("node")))) return fail(c, "not_found", "node not announced");
  const r = await downloadCopy(c.get("node"), parsed.data.id);
  if (!r.ok) return fail(c, r.code, r.message);
  return c.body(r.body as Uint8Array<ArrayBuffer>, 200, { "content-type": "application/octet-stream", "x-storage-root": r.root, "cache-control": "no-store" });
});

const reportRoute = createRoute({
  method: "post",
  path: "/nodes/storage/report",
  tags: TAGS,
  description:
    "Node-signed. held: a pending copy downloaded and checked against its root (its first check comes at once); " +
    "deleted: a dropping copy removed; failed: a pending copy that couldn't be fetched (placed elsewhere; the node backs off).",
  middleware: [requireNode, reportLimit] as const,
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            copies: z.array(z.object({ id: z.string().regex(/^[0-9a-f-]{36}$/), state: z.enum(["held", "deleted", "failed"]) })).max(100),
          }),
        },
      },
    },
  },
  responses: responses({ 200: json(z.object({ status: z.literal("success"), applied: z.number().int() }), "Applied") }, 400, 401, 404, 429),
});

nodesStorageRouter.openapi(reportRoute, async (c) => {
  if (!(await getNode(c.get("node")))) return fail(c, "not_found", "node not announced");
  const applied = await applyReports(c.get("node"), c.req.valid("json").copies);
  return ok(c, { applied });
});
