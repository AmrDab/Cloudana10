import { z } from "zod";
import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { BuildProviderService } from "../../services/build-provider.service.js";
import {
  BuildProviderRequestSchema,
  BuildProviderResponseSchema,
  UpdateProviderAttributesRequestSchema,
  UpdateProviderAttributesResponseSchema,
  BuildProviderStatusResponseSchema,
  BuildProviderLogsResponseSchema,
} from "../../schemas/build-provider.schema.js";

const buildProviderService = new BuildProviderService();

export const buildProviderRouter = new OpenAPIHono();

// Security: Bearer token required
type SecurityRequirement = Record<string, string[]>;
const SECURITY_BEARER: SecurityRequirement[] = [{ BearerAuth: [] }];
const SECURITY_NONE: SecurityRequirement[] = [];

// POST /v1/build-provider
const buildProviderRoute = createRoute({
  method: "post",
  path: "/build-provider",
  tags: ["Build Provider"],
  security: SECURITY_NONE,
  request: {
    body: {
      content: {
        "application/json": {
          schema: BuildProviderRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Provider build process started successfully",
      content: {
        "application/json": {
          schema: BuildProviderResponseSchema,
        },
      },
    },
    400: {
      description: "Bad request - invalid input",
      content: {
        "application/json": {
          schema: z.object({
            status: z.string(),
            error: z.object({
              message: z.string(),
              error_code: z.string(),
              details: z.array(z.object({
                field: z.string(),
                message: z.string(),
              })).optional(),
            }),
          }),
        },
      },
    },
    401: {
      description: "Unauthorized - invalid or missing authentication token",
    },
    500: {
      description: "Internal server error",
    },
  },
});

buildProviderRouter.openapi(buildProviderRoute, async (c) => {
  try {
    const input = c.req.valid("json");
    const authHeader = c.req.header("authorization");
    const token = authHeader?.replace("Bearer ", "") || undefined;

    console.log("[API] /v1/build-provider called");
    console.log("[API] Request body:", JSON.stringify(input, null, 2));

    const result = await buildProviderService.buildProvider(input, token);

    console.log("[API] /v1/build-provider backend response:", result);

    return c.json(result, 200);
  } catch (error) {
    console.error("[API] Error building provider:", error);

    if (error instanceof Error) {
      // Check if it's a validation or known error
      if (error.message.includes("HTTP 400") || error.message.includes("invalid")) {
        return c.json(
          {
            status: "error",
            error: {
              message: error.message,
              error_code: "PRV_001",
            },
          },
          400
        );
      }

      if (error.message.includes("HTTP 401") || error.message.includes("Unauthorized")) {
        return c.json(
          {
            status: "error",
            error: {
              message: "Unauthorized - invalid or missing authentication token",
              error_code: "AUTH_001",
            },
          },
          401
        );
      }
    }

    return c.json(
      {
        status: "error",
        error: {
          message: error instanceof Error ? error.message : "Failed to build provider",
          error_code: "PRV_001",
        },
      },
      500
    );
  }
});

// GET /v1/build-provider-status/{action_id}
const getBuildProviderStatusRoute = createRoute({
  method: "get",
  path: "/build-provider-status/{action_id}",
  tags: ["Build Provider"],
  security: SECURITY_NONE, // Can be changed to SECURITY_BEARER if auth is required
  request: {
    params: z.object({
      action_id: z.string().min(1, "Action ID is required"),
    }),
  },
  responses: {
    200: {
      description: "Build provider status retrieved successfully",
      content: {
        "application/json": {
          schema: BuildProviderStatusResponseSchema,
        },
      },
    },
    404: {
      description: "Action not found",
    },
    500: {
      description: "Internal server error",
    },
  },
});

buildProviderRouter.openapi(getBuildProviderStatusRoute, async (c) => {
  try {
    const { action_id } = c.req.valid("param");
    const authHeader = c.req.header("authorization");
    const token = authHeader?.replace("Bearer ", "") || undefined;

    const result = await buildProviderService.getBuildProviderStatus(action_id, token);

    return c.json(result, 200);
  } catch (error) {
    console.error("Error getting build provider status:", error);

    if (error instanceof Error) {
      if (error.message.includes("HTTP 404") || error.message.includes("not found")) {
        return c.json(
          {
            status: "error",
            error: {
              message: "Action not found",
              error_code: "PRV_004",
            },
          },
          404
        );
      }
    }

    return c.json(
      {
        status: "error",
        error: {
          message: error instanceof Error ? error.message : "Failed to get build provider status",
          error_code: "PRV_002",
        },
      },
      500
    );
  }
});

// POST /v1/update-provider-attributes
const updateProviderAttributesRoute = createRoute({
  method: "post",
  path: "/update-provider-attributes",
  tags: ["Build Provider"],
  security: SECURITY_BEARER,
  request: {
    body: {
      content: {
        "application/json": {
          schema: UpdateProviderAttributesRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Provider attributes update process started successfully",
      content: {
        "application/json": {
          schema: UpdateProviderAttributesResponseSchema,
        },
      },
    },
    400: {
      description: "Bad request - invalid input",
      content: {
        "application/json": {
          schema: z.object({
            status: z.string(),
            error: z.object({
              message: z.string(),
              error_code: z.string(),
              details: z.array(z.object({
                field: z.string(),
                message: z.string(),
              })).optional(),
            }),
          }),
        },
      },
    },
    401: {
      description: "Unauthorized - invalid or missing authentication token",
    },
    500: {
      description: "Internal server error",
    },
  },
});

buildProviderRouter.openapi(updateProviderAttributesRoute, async (c) => {
  try {
    const input = c.req.valid("json");
    const authHeader = c.req.header("authorization");
    const token = authHeader?.replace("Bearer ", "") || undefined;

    const result = await buildProviderService.updateProviderAttributes(input, token);

    return c.json(result, 200);
  } catch (error) {
    console.error("Error updating provider attributes:", error);

    if (error instanceof Error) {
      if (error.message.includes("HTTP 400") || error.message.includes("invalid")) {
        return c.json(
          {
            status: "error",
            error: {
              message: error.message,
              error_code: "PRV_003",
            },
          },
          400
        );
      }

      if (error.message.includes("HTTP 401") || error.message.includes("Unauthorized")) {
        return c.json(
          {
            status: "error",
            error: {
              message: "Unauthorized - invalid or missing authentication token",
              error_code: "AUTH_001",
            },
          },
          401
        );
      }
    }

    return c.json(
      {
        status: "error",
        error: {
          message: error instanceof Error ? error.message : "Failed to update provider attributes",
          error_code: "PRV_003",
        },
      },
      500
    );
  }
});

// GET /v1/build-provider/logs/{task_id}
const getBuildProviderLogsRoute = createRoute({
  method: "get",
  path: "/build-provider/logs/{task_id}",
  tags: ["Build Provider"],
  security: SECURITY_NONE, // Can be changed to SECURITY_BEARER if auth is required
  request: {
    params: z.object({
      task_id: z.string().min(1, "Task ID is required"),
    }),
  },
  responses: {
    200: {
      description: "Task logs retrieved successfully",
      content: {
        "application/json": {
          schema: BuildProviderLogsResponseSchema,
        },
      },
    },
    404: {
      description: "Task not found",
    },
    500: {
      description: "Internal server error",
    },
  },
});

buildProviderRouter.openapi(getBuildProviderLogsRoute, async (c) => {
  try {
    const { task_id } = c.req.valid("param");
    const authHeader = c.req.header("authorization");
    const token = authHeader?.replace("Bearer ", "") || undefined;

    const result = await buildProviderService.getTaskLogs(task_id, token);

    return c.json(result, 200);
  } catch (error) {
    console.error("Error getting build provider logs:", error);

    if (error instanceof Error) {
      if (error.message.includes("HTTP 404") || error.message.includes("not found")) {
        return c.json(
          {
            status: "error",
            error: {
              message: "Task not found",
              error_code: "PRV_005",
            },
          },
          404
        );
      }
    }

    return c.json(
      {
        status: "error",
        error: {
          message: error instanceof Error ? error.message : "Failed to get task logs",
          error_code: "PRV_003",
        },
      },
      500
    );
  }
});
