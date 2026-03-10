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
import { ApplicationError } from "../../types/k3s.js";

function isApplicationError(e: unknown): e is ApplicationError {
  return e instanceof ApplicationError;
}

function errorResponse(c: { json: (body: unknown, status: number) => Response }, error: unknown) {
  if (isApplicationError(error)) {
    const status = error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500;
    return c.json(
      { status: "error", error: { message: error.payload.message, error_code: error.errorCode } },
      status
    );
  }
  const msg = error instanceof Error ? error.message : "Internal server error";
  return c.json(
    { status: "error", error: { message: msg, error_code: "PRV_001" } },
    500
  );
}

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
    return errorResponse(c, error);
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
    if (isApplicationError(error) && error.statusCode === 404) {
      return c.json(
        { status: "error", error: { message: error.payload.message, error_code: error.errorCode } },
        404
      );
    }
    return errorResponse(c, error);
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
    return errorResponse(c, error);
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
    if (isApplicationError(error) && error.statusCode === 404) {
      return c.json(
        { status: "error", error: { message: error.payload.message, error_code: error.errorCode } },
        404
      );
    }
    return errorResponse(c, error);
  }
});

// GET /v1/build-provider/provider-node/status/{action_id}
const getProviderNodeStatusRoute = createRoute({
  method: "get",
  path: "/build-provider/provider-node/status/{action_id}",
  tags: ["Build Provider"],
  security: SECURITY_NONE,
  request: {
    params: z.object({
      action_id: z.string().min(1, "Action ID is required"),
    }),
  },
  responses: {
    200: {
      description: "Provider Node service status",
      content: {
        "application/json": {
          schema: z.object({
            status: z.string(),
            message: z.string().optional(),
            pid: z.number().optional(),
            pm2Status: z.string().optional(),
          }),
        },
      },
    },
    500: { description: "Internal server error" },
  },
});

buildProviderRouter.openapi(getProviderNodeStatusRoute, async (c) => {
  try {
    const { action_id } = c.req.valid("param");
    const result = await buildProviderService.getProviderNodeServiceStatus(action_id);
    return c.json(result, 200);
  } catch (error) {
    return errorResponse(c, error);
  }
});

// POST /v1/build-provider/provider-node/start/{action_id}
const startProviderNodeRoute = createRoute({
  method: "post",
  path: "/build-provider/provider-node/start/{action_id}",
  tags: ["Build Provider"],
  security: SECURITY_NONE,
  request: {
    params: z.object({
      action_id: z.string().min(1, "Action ID is required"),
    }),
  },
  responses: {
    200: {
      description: "Provider Node service started",
      content: {
        "application/json": {
          schema: z.object({
            status: z.string(),
            message: z.string().optional(),
          }),
        },
      },
    },
    500: { description: "Internal server error" },
  },
});

buildProviderRouter.openapi(startProviderNodeRoute, async (c) => {
  try {
    const { action_id } = c.req.valid("param");
    const result = await buildProviderService.startProviderNodeService(action_id);
    return c.json(result, 200);
  } catch (error) {
    return errorResponse(c, error);
  }
});

// POST /v1/build-provider/provider-node/stop/{action_id}
const stopProviderNodeRoute = createRoute({
  method: "post",
  path: "/build-provider/provider-node/stop/{action_id}",
  tags: ["Build Provider"],
  security: SECURITY_NONE,
  request: {
    params: z.object({
      action_id: z.string().min(1, "Action ID is required"),
    }),
  },
  responses: {
    200: {
      description: "Provider Node service stopped",
      content: {
        "application/json": {
          schema: z.object({
            status: z.string(),
            message: z.string().optional(),
          }),
        },
      },
    },
    500: { description: "Internal server error" },
  },
});

buildProviderRouter.openapi(stopProviderNodeRoute, async (c) => {
  try {
    const { action_id } = c.req.valid("param");
    const result = await buildProviderService.stopProviderNodeService(action_id);
    return c.json(result, 200);
  } catch (error) {
    return errorResponse(c, error);
  }
});

// --- Provider node control by device_id (for owner after registration) ---

const providerNodeStatusByDeviceRoute = createRoute({
  method: "get",
  path: "/build-provider/provider-node/status-by-device/{device_id}",
  tags: ["Build Provider"],
  security: SECURITY_NONE,
  request: {
    params: z.object({
      device_id: z.string().min(1, "Device ID is required"),
    }),
  },
  responses: {
    200: {
      description: "Provider Node service status by device ID",
      content: {
        "application/json": {
          schema: z.object({
            status: z.string(),
            message: z.string().optional(),
            pid: z.number().optional(),
            pm2Status: z.string().optional(),
          }),
        },
      },
    },
    500: { description: "Internal server error" },
  },
});

buildProviderRouter.openapi(providerNodeStatusByDeviceRoute, async (c) => {
  try {
    const { device_id } = c.req.valid("param");
    const result = await buildProviderService.getProviderNodeServiceStatusByDeviceId(decodeURIComponent(device_id));
    return c.json(result, 200);
  } catch (error) {
    return errorResponse(c, error);
  }
});

const startProviderNodeByDeviceRoute = createRoute({
  method: "post",
  path: "/build-provider/provider-node/start-by-device/{device_id}",
  tags: ["Build Provider"],
  security: SECURITY_NONE,
  request: {
    params: z.object({
      device_id: z.string().min(1, "Device ID is required"),
    }),
  },
  responses: {
    200: {
      description: "Provider Node service started",
      content: {
        "application/json": {
          schema: z.object({
            status: z.string(),
            message: z.string().optional(),
          }),
        },
      },
    },
    500: { description: "Internal server error" },
  },
});

buildProviderRouter.openapi(startProviderNodeByDeviceRoute, async (c) => {
  try {
    const { device_id } = c.req.valid("param");
    const result = await buildProviderService.startProviderNodeServiceByDeviceId(decodeURIComponent(device_id));
    return c.json(result, 200);
  } catch (error) {
    return errorResponse(c, error);
  }
});

const stopProviderNodeByDeviceRoute = createRoute({
  method: "post",
  path: "/build-provider/provider-node/stop-by-device/{device_id}",
  tags: ["Build Provider"],
  security: SECURITY_NONE,
  request: {
    params: z.object({
      device_id: z.string().min(1, "Device ID is required"),
    }),
  },
  responses: {
    200: {
      description: "Provider Node service stopped",
      content: {
        "application/json": {
          schema: z.object({
            status: z.string(),
            message: z.string().optional(),
          }),
        },
      },
    },
    500: { description: "Internal server error" },
  },
});

buildProviderRouter.openapi(stopProviderNodeByDeviceRoute, async (c) => {
  try {
    const { device_id } = c.req.valid("param");
    const result = await buildProviderService.stopProviderNodeServiceByDeviceId(decodeURIComponent(device_id));
    return c.json(result, 200);
  } catch (error) {
    return errorResponse(c, error);
  }
});

// GET /v1/build-provider/prepare-registration/:device_id — real device spec for registration confirm modal
const prepareRegistrationRoute = createRoute({
  method: "get",
  path: "/build-provider/prepare-registration/{device_id}",
  tags: ["Build Provider"],
  security: SECURITY_NONE,
  request: {
    params: z.object({
      device_id: z.string().min(1, "Device ID is required"),
    }),
  },
  responses: {
    200: {
      description: "Device ID and real device spec for registration (cap offered spec in UI)",
      content: {
        "application/json": {
          schema: z.object({
            device_id: z.string(),
            real_spec: z.object({
              cpuModel: z.string(),
              cpuCores: z.number(),
              memoryTotalBytes: z.number(),
              memoryFreeBytes: z.number().optional(),
              diskTotalBytes: z.number().nullable().optional(),
              diskFreeBytes: z.number().nullable().optional(),
            }).nullable(),
          }),
        },
      },
    },
    404: {
      description: "No build found for this device ID",
    },
    500: { description: "Internal server error" },
  },
});

buildProviderRouter.openapi(prepareRegistrationRoute, async (c) => {
  try {
    const { device_id } = c.req.valid("param");
    const decoded = decodeURIComponent(device_id);
    const result = buildProviderService.getPrepareRegistration(decoded);
    if (!result) {
      return c.json({ status: "error", error: { message: "No build found for this device ID.", error_code: "PRV_NOT_FOUND" } }, 404);
    }
    return c.json(result, 200);
  } catch (error) {
    return errorResponse(c, error);
  }
});
