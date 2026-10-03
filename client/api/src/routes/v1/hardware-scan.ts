/**
 * Hardware scan routes.
 *
 * POST /v1/providers/scan          — trigger a hardware scan on a provider endpoint (JWT required)
 * GET  /v1/providers/:deviceId/hardware — retrieve the last stored scan for a device
 */
import { createRoute } from "@hono/zod-openapi";
import { ok, fail, errorMessage } from "../../lib/http.js";
import { scanProviderHardware, getHardwareScan, validateProviderEndpoint } from "../../services/hardware-scan.service.js";
import {
  DeviceIdParamsSchema,
  ScanRequestSchema,
  ScanResponseSchema,
  StoredScanResponseSchema,
} from "../../schemas/hardware-scan.schema.js";
import { BEARER_AUTH, createRouter, json, responses } from "./_openapi.js";

export const hardwareScanRouter = createRouter();

// POST /v1/providers/scan — requireAuth + rate limit are applied in middleware/security.ts.
const scanRoute = createRoute({
  method: "post",
  path: "/providers/scan",
  tags: ["Hardware Scan"],
  security: BEARER_AUTH,
  request: { body: { required: true, content: { "application/json": { schema: ScanRequestSchema } } } },
  responses: responses({ 200: json(ScanResponseSchema, "Fresh hardware scan of the provider") }, 400, 401, 429, 502),
});

hardwareScanRouter.openapi(scanRoute, async (c) => {
  const { endpoint } = c.req.valid("json");

  const check = validateProviderEndpoint(endpoint);
  if (!check.ok) return fail(c, "bad_request", check.reason);

  try {
    const scan = await scanProviderHardware(check.url);
    return ok(c, { scan });
  } catch (err) {
    return fail(c, "upstream_failed", errorMessage(err));
  }
});

// GET /v1/providers/:deviceId/hardware
const storedScanRoute = createRoute({
  method: "get",
  path: "/providers/{deviceId}/hardware",
  tags: ["Hardware Scan"],
  request: { params: DeviceIdParamsSchema },
  responses: responses({ 200: json(StoredScanResponseSchema, "Last stored scan for the device") }, 404),
});

hardwareScanRouter.openapi(storedScanRoute, async (c) => {
  const { deviceId } = c.req.valid("param");
  const scan = await getHardwareScan(deviceId);
  if (!scan) return fail(c, "not_found", "No hardware scan found for this device");
  return ok(c, { ...scan });
});
