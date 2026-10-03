/**
 * Workload Status API Routes
 * Provides endpoints for users to query their deployed workload status, logs, and endpoints.
 */
import { createRoute } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { ok, fail } from "../../lib/http.js";
import {
  getWorkloadStatus,
  refreshWorkloadStatus,
  getAllWorkloadStatuses,
} from "../../services/workload-status-poller.service.js";
import {
  AllWorkloadStatusesResponseSchema,
  RefreshQuerySchema,
  WorkloadEndpointsResponseSchema,
  WorkloadInstanceParamsSchema,
  WorkloadLogsResponseSchema,
  WorkloadManifestResponseSchema,
  WorkloadStatusResponseSchema,
  WorkloadUrlsResponseSchema,
} from "../../schemas/workload-status.schema.js";
import { createRouter, json, responses } from "./_openapi.js";

const workloadStatusRouter = createRouter();
workloadStatusRouter.use("*", cors({ origin: "*" }));

const TAGS = ["Workload Status"];

// GET /v1/workload-status/:workloadId/:instanceId — get cached status for a workload
const statusRoute = createRoute({
  method: "get",
  path: "/workload-status/{workloadId}/{instanceId}",
  tags: TAGS,
  request: { params: WorkloadInstanceParamsSchema, query: RefreshQuerySchema },
  responses: responses({ 200: json(WorkloadStatusResponseSchema, "Workload status (always refreshed)") }, 404, 500),
});

workloadStatusRouter.openapi(statusRoute, async (c) => {
  try {
    const params = c.req.valid("param");
    console.log(`❌ workloadStatusRouter.get("/workload-status/:workloadId/:instanceId": ${params.workloadId}/${params.instanceId}`);
    const workloadId = BigInt(params.workloadId);
    const instanceId = BigInt(params.instanceId);
    const forceRefresh = c.req.query("refresh") === "true";

    // let status = forceRefresh
    //   ? await refreshWorkloadStatus(workloadId, instanceId)
    //   : getWorkloadStatus(workloadId, instanceId);

    let status = await refreshWorkloadStatus(workloadId, instanceId);
    if (!status) {
      return fail(c, "not_found", "Workload status not found. It may not be deployed yet or has been terminated.");
    }

    return ok(c, {
      workloadId: status.workloadId.toString(),
      instanceId: status.instanceId.toString(),
      providerAddress: status.providerAddress,
      providerEndpoint: status.providerEndpoint,
      workloadStatus: status.status,
      logs: status.logs,
      endpoints: status.endpoints,
      urls: status.urls || [], // Public URLs for accessing the workload
      lastUpdated: status.lastUpdated,
      workloadError: status.error,
    });
  } catch (e) {
    console.error("Error fetching workload status:", e);
    return fail(c, "internal", e instanceof Error ? e.message : "Failed to fetch workload status");
  }
});

// GET /v1/workload-status/all — get all cached workload statuses (admin/debug)
const allRoute = createRoute({
  method: "get",
  path: "/workload-status/all",
  tags: TAGS,
  responses: responses({ 200: json(AllWorkloadStatusesResponseSchema, "All cached workload statuses") }, 500),
});

workloadStatusRouter.openapi(allRoute, (c) => {
  try {
    const statuses = getAllWorkloadStatuses();
    return ok(c, {
      count: statuses.length,
      statuses: statuses.map((s) => ({
        workloadId: s.workloadId.toString(),
        instanceId: s.instanceId.toString(),
        providerAddress: s.providerAddress,
        status: s.status,
        urls: s.urls || [],
        lastUpdated: s.lastUpdated,
        hasLogs: !!s.logs && Object.keys(s.logs).length > 0,
        endpointCount: s.endpoints?.length || 0,
      })),
    });
  } catch (e) {
    console.error("Error fetching all workload statuses:", e);
    return fail(c, "internal", e instanceof Error ? e.message : "Failed to fetch workload statuses");
  }
});

// GET /v1/workload-status/:workloadId/:instanceId/logs — get only logs for a workload
const logsRoute = createRoute({
  method: "get",
  path: "/workload-status/{workloadId}/{instanceId}/logs",
  tags: TAGS,
  request: { params: WorkloadInstanceParamsSchema, query: RefreshQuerySchema },
  responses: responses({ 200: json(WorkloadLogsResponseSchema, "Workload logs") }, 404, 500),
});

workloadStatusRouter.openapi(logsRoute, async (c) => {
  try {
    const params = c.req.valid("param");
    const workloadId = BigInt(params.workloadId);
    const instanceId = BigInt(params.instanceId);
    const forceRefresh = c.req.valid("query").refresh === "true";

    let status = forceRefresh
      ? await refreshWorkloadStatus(workloadId, instanceId)
      : getWorkloadStatus(workloadId, instanceId);

    if (!status) return fail(c, "not_found", "Workload not found");

    return ok(c, {
      workloadId: status.workloadId.toString(),
      instanceId: status.instanceId.toString(),
      namespace: status.status.namespace,
      logs: status.logs || {},
      lastUpdated: status.lastUpdated,
    });
  } catch (e) {
    console.error("Error fetching workload logs:", e);
    return fail(c, "internal", e instanceof Error ? e.message : "Failed to fetch workload logs");
  }
});

// GET /v1/workload-status/:workloadId/:instanceId/endpoints — get only endpoints for a workload
const endpointsRoute = createRoute({
  method: "get",
  path: "/workload-status/{workloadId}/{instanceId}/endpoints",
  tags: TAGS,
  request: { params: WorkloadInstanceParamsSchema, query: RefreshQuerySchema },
  responses: responses({ 200: json(WorkloadEndpointsResponseSchema, "Workload endpoints") }, 404, 500),
});

workloadStatusRouter.openapi(endpointsRoute, async (c) => {
  try {
    const params = c.req.valid("param");
    const workloadId = BigInt(params.workloadId);
    const instanceId = BigInt(params.instanceId);
    const forceRefresh = c.req.valid("query").refresh === "true";

    let status = forceRefresh
      ? await refreshWorkloadStatus(workloadId, instanceId)
      : getWorkloadStatus(workloadId, instanceId);

    if (!status) return fail(c, "not_found", "Workload not found");

    return ok(c, {
      workloadId: status.workloadId.toString(),
      instanceId: status.instanceId.toString(),
      providerEndpoint: status.providerEndpoint,
      endpoints: status.endpoints || [],
      urls: status.urls || [], // Public URLs
      lastUpdated: status.lastUpdated,
    });
  } catch (e) {
    console.error("Error fetching workload endpoints:", e);
    return fail(c, "internal", e instanceof Error ? e.message : "Failed to fetch workload endpoints");
  }
});

// GET /v1/workload-status/:workloadId/:instanceId/urls — get only public URLs for a workload (production endpoint)
const urlsRoute = createRoute({
  method: "get",
  path: "/workload-status/{workloadId}/{instanceId}/urls",
  tags: TAGS,
  request: { params: WorkloadInstanceParamsSchema, query: RefreshQuerySchema },
  responses: responses({ 200: json(WorkloadUrlsResponseSchema, "Workload public URLs") }, 404, 500),
});

workloadStatusRouter.openapi(urlsRoute, async (c) => {
  try {
    const params = c.req.valid("param");
    const workloadId = BigInt(params.workloadId);
    const instanceId = BigInt(params.instanceId);
    const forceRefresh = c.req.valid("query").refresh === "true";

    let status = forceRefresh
      ? await refreshWorkloadStatus(workloadId, instanceId)
      : getWorkloadStatus(workloadId, instanceId);

    if (!status) return fail(c, "not_found", "Workload not found or not deployed yet");

    // Also fetch directly from provider for most up-to-date URLs
    let directUrls: string[] | undefined;
    if (status.providerEndpoint && forceRefresh) {
      try {
        const baseUrl = status.providerEndpoint.replace(/\/+$/, "");
        const urlsRes = await fetch(
          `${baseUrl}/workload/${workloadId}/${instanceId}/urls`,
          {
            method: "GET",
            signal: AbortSignal.timeout(5000),
          }
        );

        if (urlsRes.ok) {
          const data = (await urlsRes.json()) as { urls?: string[] };
          directUrls = data.urls;
        }
      } catch (e) {
        console.warn("Failed to fetch URLs directly from provider:", e);
      }
    }

    return ok(c, {
      workloadId: status.workloadId.toString(),
      instanceId: status.instanceId.toString(),
      providerEndpoint: status.providerEndpoint,
      urls: directUrls || status.urls || [],
      lastUpdated: directUrls ? Date.now() : status.lastUpdated,
    });
  } catch (e) {
    console.error("Error fetching workload URLs:", e);
    return fail(c, "internal", e instanceof Error ? e.message : "Failed to fetch workload URLs");
  }
});

// GET /v1/workload-status/:workloadId/:instanceId/manifest — get deployment manifest from provider
const manifestRoute = createRoute({
  method: "get",
  path: "/workload-status/{workloadId}/{instanceId}/manifest",
  tags: TAGS,
  request: { params: WorkloadInstanceParamsSchema },
  responses: responses({ 200: json(WorkloadManifestResponseSchema, "Deployment manifest from the provider") }, 404, 500),
});

workloadStatusRouter.openapi(manifestRoute, async (c) => {
  try {
    const params = c.req.valid("param");
    const workloadId = BigInt(params.workloadId);
    const instanceId = BigInt(params.instanceId);

    const status = getWorkloadStatus(workloadId, instanceId);

    if (!status) return fail(c, "not_found", "Workload not found or not deployed yet");

    // Fetch manifest directly from provider
    try {
      const baseUrl = status.providerEndpoint.replace(/\/+$/, "");
      const manifestRes = await fetch(
        `${baseUrl}/workload/${workloadId}/${instanceId}/manifest`,
        {
          method: "GET",
          signal: AbortSignal.timeout(5000),
        }
      );

      if (!manifestRes.ok) {
        throw new Error(`Provider returned ${manifestRes.status}`);
      }

      const data = (await manifestRes.json()) as {
        manifest?: unknown;
        namespace?: string;
        deployedAt?: number;
      };

      return ok(c, {
        workloadId: workloadId.toString(),
        instanceId: instanceId.toString(),
        providerEndpoint: status.providerEndpoint,
        manifest: data.manifest,
        namespace: data.namespace,
        deployedAt: data.deployedAt,
      });
    } catch (e) {
      console.error("Failed to fetch manifest from provider:", e);
      return fail(c, "internal", e instanceof Error ? e.message : "Failed to fetch manifest from provider");
    }
  } catch (e) {
    console.error("Error fetching workload manifest:", e);
    return fail(c, "internal", e instanceof Error ? e.message : "Failed to fetch workload manifest");
  }
});

export default workloadStatusRouter;
