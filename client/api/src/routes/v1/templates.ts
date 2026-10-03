import { createRoute } from "@hono/zod-openapi";
import { TemplateService } from "../../services/template.service.js";
import { ok, fail } from "../../lib/http.js";
import { createRouter, json, responses } from "./_openapi.js";
import {
  GetTemplateByIdParamsSchema,
  GetTemplateByIdResponseSchema,
  GetTemplatesFullResponseSchema,
  GetTemplatesListResponseSchema
} from "../../schemas/template.schema.js";

const templateService = new TemplateService();

export const templatesRouter = createRouter();

// No authentication required for these endpoints.

// GET /v1/templates-list
const getTemplatesListRoute = createRoute({
  method: "get",
  path: "/templates-list",
  tags: ["Templates"],
  responses: responses({ 200: json(GetTemplatesListResponseSchema, "Deployment templates grouped by category") }, 500),
});

templatesRouter.openapi(getTemplatesListRoute, async (c) => {
  const templatesPerCategory = await templateService.getTemplateGallery();
  return ok(c, { data: templatesPerCategory });
});

// GET /v1/templates
const getTemplatesFullRoute = createRoute({
  method: "get",
  path: "/templates",
  tags: ["Templates"],
  responses: responses({ 200: json(GetTemplatesFullResponseSchema, "Deployment templates grouped by category, with full details") }, 500),
});

templatesRouter.openapi(getTemplatesFullRoute, async (c) => {
  const templatesPerCategory = await templateService.getTemplateGallery();
  return ok(c, { data: templatesPerCategory });
});

// GET /v1/templates/:id
const getTemplateByIdRoute = createRoute({
  method: "get",
  path: "/templates/{id}",
  tags: ["Templates"],
  request: {
    params: GetTemplateByIdParamsSchema
  },
  responses: responses({ 200: json(GetTemplateByIdResponseSchema, "A template by id") }, 404, 500),
});

templatesRouter.openapi(getTemplateByIdRoute, async (c) => {
  const { id } = c.req.valid("param");
  const template = await templateService.getTemplateById(id);
  if (!template) return fail(c, "not_found", "Template not found");
  return ok(c, { data: template });
});
