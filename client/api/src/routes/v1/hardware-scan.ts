/**
 * Hardware scan routes.
 *
 * POST /v1/providers/scan          — trigger a hardware scan on a provider endpoint
 * GET  /v1/providers/:deviceId/hardware — retrieve the last stored scan for a device
 */
import { Hono } from "hono";
import { scanProviderHardware, getHardwareScan } from "../../services/hardware-scan.service.js";

export const hardwareScanRouter = new Hono();

// POST /v1/providers/scan
// Body: { endpoint: "http://provider-ip:4040" }
hardwareScanRouter.post("/providers/scan", async (c) => {
  let body: { endpoint?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const { endpoint } = body;
  if (!endpoint || typeof endpoint !== "string") {
    return c.json({ success: false, error: "endpoint (string) is required" }, 400);
  }

  try {
    const scan = await scanProviderHardware(endpoint);
    return c.json({ success: true, scan });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, error: msg }, 500);
  }
});

// GET /v1/providers/:deviceId/hardware
hardwareScanRouter.get("/providers/:deviceId/hardware", async (c) => {
  const { deviceId } = c.req.param();
  const scan = await getHardwareScan(deviceId);
  if (!scan) return c.json({ error: "No hardware scan found for this device" }, 404);
  return c.json(scan);
});
