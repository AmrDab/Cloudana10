/**
 * Workload Status API Routes
 * Provides endpoints for users to query their deployed workload status, logs, and endpoints.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  getWorkloadStatus,
  refreshWorkloadStatus,
  getAllWorkloadStatuses,
} from "../../services/workload-status-poller.service.js";

const workloadStatusRouter = new Hono();
workloadStatusRouter.use("*", cors({ origin: "*" }));

// GET /v1/workload-status/:workloadId/:instanceId — get cached status for a workload
workloadStatusRouter.get("/workload-status/:workloadId/:instanceId", async (c) => {
  try {
    console.log(`❌ workloadStatusRouter.get("/workload-status/:workloadId/:instanceId": ${c.req.param("workloadId")}/${c.req.param("instanceId")}`);
    const workloadId = BigInt(c.req.param("workloadId"));
    const instanceId = BigInt(c.req.param("instanceId"));
    const forceRefresh = c.req.query("refresh") === "true";

    // let status = forceRefresh
    //   ? await refreshWorkloadStatus(workloadId, instanceId)
    //   : getWorkloadStatus(workloadId, instanceId);

    let status = await refreshWorkloadStatus(workloadId, instanceId);
    if (!status) {
      return c.json(
        {
          success: false,
          error: "Workload status not found. It may not be deployed yet or has been terminated.",
        },
        404
      );
    }

    return c.json({
      success: true,
      workloadId: status.workloadId.toString(),
      instanceId: status.instanceId.toString(),
      providerAddress: status.providerAddress,
      providerEndpoint: status.providerEndpoint,
      status: status.status,
      logs: status.logs,
      endpoints: status.endpoints,
      urls: status.urls || [], // Public URLs for accessing the workload
      lastUpdated: status.lastUpdated,
      error: status.error,
    });
  } catch (e) {
    console.error("Error fetching workload status:", e);
    return c.json(
      {
        success: false,
        error: e instanceof Error ? e.message : "Failed to fetch workload status",
      },
      500
    );
  }
});

// GET /v1/workload-status/all — get all cached workload statuses (admin/debug)
workloadStatusRouter.get("/workload-status/all", (c) => {
  try {
    const statuses = getAllWorkloadStatuses();
    return c.json({
      success: true,
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
    return c.json(
      {
        success: false,
        error: e instanceof Error ? e.message : "Failed to fetch workload statuses",
      },
      500
    );
  }
});

// GET /v1/workload-status/:workloadId/:instanceId/logs — get only logs for a workload
workloadStatusRouter.get("/workload-status/:workloadId/:instanceId/logs", async (c) => {
  try {
    const workloadId = BigInt(c.req.param("workloadId"));
    const instanceId = BigInt(c.req.param("instanceId"));
    const forceRefresh = c.req.query("refresh") === "true";

    let status = forceRefresh
      ? await refreshWorkloadStatus(workloadId, instanceId)
      : getWorkloadStatus(workloadId, instanceId);

    if (!status) {
      return c.json(
        {
          success: false,
          error: "Workload not found",
        },
        404
      );
    }

    return c.json({
      success: true,
      workloadId: status.workloadId.toString(),
      instanceId: status.instanceId.toString(),
      namespace: status.status.namespace,
      logs: status.logs || {},
      lastUpdated: status.lastUpdated,
    });
  } catch (e) {
    console.error("Error fetching workload logs:", e);
    return c.json(
      {
        success: false,
        error: e instanceof Error ? e.message : "Failed to fetch workload logs",
      },
      500
    );
  }
});

// GET /v1/workload-status/:workloadId/:instanceId/endpoints — get only endpoints for a workload
workloadStatusRouter.get("/workload-status/:workloadId/:instanceId/endpoints", async (c) => {
  try {
    const workloadId = BigInt(c.req.param("workloadId"));
    const instanceId = BigInt(c.req.param("instanceId"));
    const forceRefresh = c.req.query("refresh") === "true";

    let status = forceRefresh
      ? await refreshWorkloadStatus(workloadId, instanceId)
      : getWorkloadStatus(workloadId, instanceId);

    if (!status) {
      return c.json(
        {
          success: false,
          error: "Workload not found",
        },
        404
      );
    }

    return c.json({
      success: true,
      workloadId: status.workloadId.toString(),
      instanceId: status.instanceId.toString(),
      providerEndpoint: status.providerEndpoint,
      endpoints: status.endpoints || [],
      urls: status.urls || [], // Public URLs
      lastUpdated: status.lastUpdated,
    });
  } catch (e) {
    console.error("Error fetching workload endpoints:", e);
    return c.json(
      {
        success: false,
        error: e instanceof Error ? e.message : "Failed to fetch workload endpoints",
      },
      500
    );
  }
});

// GET /v1/workload-status/:workloadId/:instanceId/urls — get only public URLs for a workload (production endpoint)
workloadStatusRouter.get("/workload-status/:workloadId/:instanceId/urls", async (c) => {
  try {
    const workloadId = BigInt(c.req.param("workloadId"));
    const instanceId = BigInt(c.req.param("instanceId"));
    const forceRefresh = c.req.query("refresh") === "true";

    let status = forceRefresh
      ? await refreshWorkloadStatus(workloadId, instanceId)
      : getWorkloadStatus(workloadId, instanceId);

    if (!status) {
      return c.json(
        {
          success: false,
          error: "Workload not found or not deployed yet",
        },
        404
      );
    }

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

    return c.json({
      success: true,
      workloadId: status.workloadId.toString(),
      instanceId: status.instanceId.toString(),
      providerEndpoint: status.providerEndpoint,
      urls: directUrls || status.urls || [],
      lastUpdated: directUrls ? Date.now() : status.lastUpdated,
    });
  } catch (e) {
    console.error("Error fetching workload URLs:", e);
    return c.json(
      {
        success: false,
        error: e instanceof Error ? e.message : "Failed to fetch workload URLs",
      },
      500
    );
  }
});

// GET /v1/workload-status/:workloadId/:instanceId/manifest — get deployment manifest from provider
workloadStatusRouter.get("/workload-status/:workloadId/:instanceId/manifest", async (c) => {
  try {
    const workloadId = BigInt(c.req.param("workloadId"));
    const instanceId = BigInt(c.req.param("instanceId"));

    const status = getWorkloadStatus(workloadId, instanceId);

    if (!status) {
      return c.json(
        {
          success: false,
          error: "Workload not found or not deployed yet",
        },
        404
      );
    }

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

      return c.json({
        success: true,
        workloadId: workloadId.toString(),
        instanceId: instanceId.toString(),
        providerEndpoint: status.providerEndpoint,
        manifest: data.manifest,
        namespace: data.namespace,
        deployedAt: data.deployedAt,
      });
    } catch (e) {
      console.error("Failed to fetch manifest from provider:", e);
      return c.json(
        {
          success: false,
          error: e instanceof Error ? e.message : "Failed to fetch manifest from provider",
        },
        500
      );
    }
  } catch (e) {
    console.error("Error fetching workload manifest:", e);
    return c.json(
      {
        success: false,
        error: e instanceof Error ? e.message : "Failed to fetch workload manifest",
      },
      500
    );
  }
});

export default workloadStatusRouter;
