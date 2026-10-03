import { createRoute } from "@hono/zod-openapi";
import type { Context } from "hono";
import { BuildProviderService } from "../../services/build-provider.service.js";
import { ok, fail, type ErrorCode } from "../../lib/http.js";
import {
  ActionIdParamsSchema,
  BuildProviderEnvelopeSchema,
  BuildProviderLogsEnvelopeSchema,
  BuildProviderRequestSchema,
  BuildProviderStatusEnvelopeSchema,
  DeviceIdParamsSchema,
  PrepareRegistrationEnvelopeSchema,
  ProviderNodeServiceEnvelopeSchema,
  TaskIdParamsSchema,
  UpdateProviderAttributesEnvelopeSchema,
  UpdateProviderAttributesRequestSchema,
} from "../../schemas/build-provider.schema.js";
import { ApplicationError } from "../../types/k3s.js";
import { BEARER_AUTH, createRouter, json, responses } from "./_openapi.js";

function isApplicationError(e: unknown): e is ApplicationError {
  return e instanceof ApplicationError;
}

/** HTTP status carried by an ApplicationError → the matching envelope code. */
const CODE_FOR_STATUS: Record<number, ErrorCode> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  413: "payload_too_large",
  422: "unprocessable",
  429: "rate_limited",
  502: "upstream_failed",
  503: "not_configured",
};

function errorResponse(c: Context, error: unknown) {
  if (isApplicationError(error)) {
    const code = CODE_FOR_STATUS[error.statusCode] ?? "internal";
    return fail(c, code, error.payload.message, { errorCode: error.errorCode });
  }
  const msg = error instanceof Error ? error.message : "Internal server error";
  return fail(c, "internal", msg);
}

/** Service results carry their own `status`; expose it as `serviceStatus`. */
function serviceStatus<T extends { status: string }>(result: T) {
  const { status, ...rest } = result;
  return { serviceStatus: status, ...rest };
}

const buildProviderService = new BuildProviderService();

export const buildProviderRouter = createRouter();

// requireAuth is applied to /v1/build-provider/* in middleware/security.ts.
// /build-provider-status/* and /update-provider-attributes fall outside that
// pattern and are therefore documented without security.
const TAGS = ["Build Provider"];

// POST /v1/build-provider
const buildProviderRoute = createRoute({
  method: "post",
  path: "/build-provider",
  tags: TAGS,
  security: BEARER_AUTH,
  request: { body: { required: true, content: { "application/json": { schema: BuildProviderRequestSchema } } } },
  responses: responses(
    { 200: json(BuildProviderEnvelopeSchema, "Provider build process started successfully") },
    400,
    401,
    500,
  ),
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

    return ok(c, { message: result.message, action_id: result.action_id });
  } catch (error) {
    console.error("[API] Error building provider:", error);
    return errorResponse(c, error);
  }
});

// GET /v1/build-provider-status/{action_id}
const getBuildProviderStatusRoute = createRoute({
  method: "get",
  path: "/build-provider-status/{action_id}",
  tags: TAGS,
  request: { params: ActionIdParamsSchema },
  responses: responses(
    { 200: json(BuildProviderStatusEnvelopeSchema, "Build status (build state in buildStatus)") },
    404,
    500,
  ),
});

buildProviderRouter.openapi(getBuildProviderStatusRoute, async (c) => {
  try {
    const { action_id } = c.req.valid("param");
    const authHeader = c.req.header("authorization");
    const token = authHeader?.replace("Bearer ", "") || undefined;

    const { status, ...rest } = await buildProviderService.getBuildProviderStatus(action_id, token);

    return ok(c, { ...rest, buildStatus: status });
  } catch (error) {
    console.error("Error getting build provider status:", error);
    return errorResponse(c, error);
  }
});

// POST /v1/update-provider-attributes
const updateProviderAttributesRoute = createRoute({
  method: "post",
  path: "/update-provider-attributes",
  tags: TAGS,
  request: {
    body: { required: true, content: { "application/json": { schema: UpdateProviderAttributesRequestSchema } } },
  },
  responses: responses(
    { 200: json(UpdateProviderAttributesEnvelopeSchema, "Provider attributes update process started successfully") },
    400,
    500,
  ),
});

buildProviderRouter.openapi(updateProviderAttributesRoute, async (c) => {
  try {
    const input = c.req.valid("json");
    const authHeader = c.req.header("authorization");
    const token = authHeader?.replace("Bearer ", "") || undefined;

    const result = await buildProviderService.updateProviderAttributes(input, token);

    return ok(c, { message: result.message, action_id: result.action_id });
  } catch (error) {
    console.error("Error updating provider attributes:", error);
    return errorResponse(c, error);
  }
});

// GET /v1/build-provider/logs/{task_id}
const getBuildProviderLogsRoute = createRoute({
  method: "get",
  path: "/build-provider/logs/{task_id}",
  tags: TAGS,
  security: BEARER_AUTH,
  request: { params: TaskIdParamsSchema },
  responses: responses({ 200: json(BuildProviderLogsEnvelopeSchema, "Task logs") }, 401, 404, 500),
});

buildProviderRouter.openapi(getBuildProviderLogsRoute, async (c) => {
  try {
    const { task_id } = c.req.valid("param");
    const authHeader = c.req.header("authorization");
    const token = authHeader?.replace("Bearer ", "") || undefined;

    const result = await buildProviderService.getTaskLogs(task_id, token);

    return ok(c, result);
  } catch (error) {
    console.error("Error getting build provider logs:", error);
    return errorResponse(c, error);
  }
});

// GET /v1/build-provider/provider-node/status/{action_id}
const getProviderNodeStatusRoute = createRoute({
  method: "get",
  path: "/build-provider/provider-node/status/{action_id}",
  tags: TAGS,
  security: BEARER_AUTH,
  request: { params: ActionIdParamsSchema },
  responses: responses({ 200: json(ProviderNodeServiceEnvelopeSchema, "Provider Node service status") }, 401, 500),
});

buildProviderRouter.openapi(getProviderNodeStatusRoute, async (c) => {
  try {
    const { action_id } = c.req.valid("param");
    const result = await buildProviderService.getProviderNodeServiceStatus(action_id);
    return ok(c, serviceStatus(result));
  } catch (error) {
    return errorResponse(c, error);
  }
});

// POST /v1/build-provider/provider-node/start/{action_id}
const startProviderNodeRoute = createRoute({
  method: "post",
  path: "/build-provider/provider-node/start/{action_id}",
  tags: TAGS,
  security: BEARER_AUTH,
  request: { params: ActionIdParamsSchema },
  responses: responses({ 200: json(ProviderNodeServiceEnvelopeSchema, "Provider Node start attempted") }, 401, 500),
});

buildProviderRouter.openapi(startProviderNodeRoute, async (c) => {
  try {
    const { action_id } = c.req.valid("param");
    const result = await buildProviderService.startProviderNodeService(action_id);
    return ok(c, serviceStatus(result));
  } catch (error) {
    return errorResponse(c, error);
  }
});

// POST /v1/build-provider/provider-node/stop/{action_id}
const stopProviderNodeRoute = createRoute({
  method: "post",
  path: "/build-provider/provider-node/stop/{action_id}",
  tags: TAGS,
  security: BEARER_AUTH,
  request: { params: ActionIdParamsSchema },
  responses: responses({ 200: json(ProviderNodeServiceEnvelopeSchema, "Provider Node stop attempted") }, 401, 500),
});

buildProviderRouter.openapi(stopProviderNodeRoute, async (c) => {
  try {
    const { action_id } = c.req.valid("param");
    const result = await buildProviderService.stopProviderNodeService(action_id);
    return ok(c, serviceStatus(result));
  } catch (error) {
    return errorResponse(c, error);
  }
});

// --- Provider node control by device_id (for owner after registration) ---

const providerNodeStatusByDeviceRoute = createRoute({
  method: "get",
  path: "/build-provider/provider-node/status-by-device/{device_id}",
  tags: TAGS,
  security: BEARER_AUTH,
  request: { params: DeviceIdParamsSchema },
  responses: responses(
    { 200: json(ProviderNodeServiceEnvelopeSchema, "Provider Node service status by device ID") },
    401,
    500,
  ),
});

buildProviderRouter.openapi(providerNodeStatusByDeviceRoute, async (c) => {
  try {
    const { device_id } = c.req.valid("param");
    const result = await buildProviderService.getProviderNodeServiceStatusByDeviceId(decodeURIComponent(device_id));
    return ok(c, serviceStatus(result));
  } catch (error) {
    return errorResponse(c, error);
  }
});

const startProviderNodeByDeviceRoute = createRoute({
  method: "post",
  path: "/build-provider/provider-node/start-by-device/{device_id}",
  tags: TAGS,
  security: BEARER_AUTH,
  request: { params: DeviceIdParamsSchema },
  responses: responses({ 200: json(ProviderNodeServiceEnvelopeSchema, "Provider Node start attempted") }, 401, 500),
});

buildProviderRouter.openapi(startProviderNodeByDeviceRoute, async (c) => {
  try {
    const { device_id } = c.req.valid("param");
    const result = await buildProviderService.startProviderNodeServiceByDeviceId(decodeURIComponent(device_id));
    return ok(c, serviceStatus(result));
  } catch (error) {
    return errorResponse(c, error);
  }
});

const stopProviderNodeByDeviceRoute = createRoute({
  method: "post",
  path: "/build-provider/provider-node/stop-by-device/{device_id}",
  tags: TAGS,
  security: BEARER_AUTH,
  request: { params: DeviceIdParamsSchema },
  responses: responses({ 200: json(ProviderNodeServiceEnvelopeSchema, "Provider Node stop attempted") }, 401, 500),
});

buildProviderRouter.openapi(stopProviderNodeByDeviceRoute, async (c) => {
  try {
    const { device_id } = c.req.valid("param");
    const result = await buildProviderService.stopProviderNodeServiceByDeviceId(decodeURIComponent(device_id));
    return ok(c, serviceStatus(result));
  } catch (error) {
    return errorResponse(c, error);
  }
});

// GET /v1/build-provider/prepare-registration/:device_id — real device spec for registration confirm modal
const prepareRegistrationRoute = createRoute({
  method: "get",
  path: "/build-provider/prepare-registration/{device_id}",
  tags: TAGS,
  security: BEARER_AUTH,
  request: { params: DeviceIdParamsSchema },
  responses: responses(
    { 200: json(PrepareRegistrationEnvelopeSchema, "Device ID and real device spec for registration") },
    401,
    404,
    500,
  ),
});

buildProviderRouter.openapi(prepareRegistrationRoute, async (c) => {
  try {
    const { device_id } = c.req.valid("param");
    const decoded = decodeURIComponent(device_id);
    const result = buildProviderService.getPrepareRegistration(decoded);
    if (!result) return fail(c, "not_found", "No build found for this device ID.");
    return ok(c, result);
  } catch (error) {
    return errorResponse(c, error);
  }
});
