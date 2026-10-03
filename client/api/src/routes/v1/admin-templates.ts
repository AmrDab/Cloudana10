/**
 * Template catalog refresh for the keeper (header X-Internal-Key = INTERNAL_API_KEY).
 *   POST /v1/admin/templates/refresh — fetch awesome-akash + Cloudana's curated list → replace the store
 * Several hundred GitHub fetches: run it against the Node orchestrator (a Worker's subrequest cap is lower).
 */
import { createRoute, z } from "@hono/zod-openapi";
import { ok } from "../../lib/http.js";
import { refreshTemplates } from "../../services/template.service.js";
import { requireInternalKey } from "./admin-epochs.js";
import { createRouter, json, responses } from "./_openapi.js";

export const adminTemplatesRouter = createRouter();

const int = z.number().int();
const refreshRoute = createRoute({
  method: "post",
  path: "/admin/templates/refresh",
  tags: ["Admin"],
  middleware: [requireInternalKey] as const,
  responses: responses(
    {
      200: json(
        z.object({ status: z.literal("success"), categories: int, templates: int, imported: int, curated: int }),
        "Stored. If GitHub was unreachable, imported is 0 and the store holds the curated list.",
      ),
    },
    401,
    503,
  ),
});

adminTemplatesRouter.openapi(refreshRoute, async (c) => ok(c, await refreshTemplates()));
