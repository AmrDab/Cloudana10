import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { TemplateService } from "../../services/template.service.js";
import {
  GetTemplateByIdParamsSchema,
  GetTemplateByIdResponseSchema,
  GetTemplatesFullResponseSchema,
  GetTemplatesListResponseSchema
} from "../../schemas/template.schema.js";

const templateService = new TemplateService();

export const templatesRouter = new OpenAPIHono();

// Security: No authentication required for these endpoints
type SecurityRequirement = Record<string, string[]>;
const SECURITY_NONE: SecurityRequirement[] = [];

// GET /v1/templates-list
const getTemplatesListRoute = createRoute({
  method: "get",
  path: "/templates-list",
  tags: ["Templates"],
  security: SECURITY_NONE,
  responses: {
    200: {
      description: "Returns a list of deployment templates grouped by categories",
      content: {
        "application/json": {
          schema: GetTemplatesListResponseSchema
        }
      }
    }
  }
});

templatesRouter.openapi(getTemplatesListRoute, async (c) => {
  const templatesPerCategory = await templateService.getTemplateGallery();
  
  return c.json({
    data: templatesPerCategory
  }, 200);
});

// GET /v1/templates
const getTemplatesFullRoute = createRoute({
  method: "get",
  path: "/templates",
  tags: ["Templates"],
  security: SECURITY_NONE,
  responses: {
    200: {
      description: "Returns a list of deployment templates grouped by categories with full details",
      content: {
        "application/json": {
          schema: GetTemplatesFullResponseSchema
        }
      }
    }
  }
});

templatesRouter.openapi(getTemplatesFullRoute, async (c) => {
  const templatesPerCategory = await templateService.getTemplateGallery();
  
  return c.json(templatesPerCategory, 200);
});

// GET /v1/templates/:id
const getTemplateByIdRoute = createRoute({
  method: "get",
  path: "/templates/{id}",
  tags: ["Templates"],
  security: SECURITY_NONE,
  request: {
    params: GetTemplateByIdParamsSchema
  },
  responses: {
    200: {
      description: "Return a template by id",
      content: {
        "application/json": {
          schema: GetTemplateByIdResponseSchema
        }
      }
    },
    404: {
      description: "Template not found"
    }
  }
});

templatesRouter.openapi(getTemplateByIdRoute, async (c) => {
  const { id } = c.req.valid("param");
  const template = await templateService.getTemplateById(id);

  if (!template) {
    return c.json(
      {
        error: "Template not found"
      },
      404
    );
  }

  return c.json({
    data: template
  }, 200);
});
