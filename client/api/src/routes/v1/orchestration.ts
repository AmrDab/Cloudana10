import { createRoute } from "@hono/zod-openapi";
import { ok, fail } from "../../lib/http.js";
import { findPlacements } from "../../services/placement.service.js";
import { getActiveProviders, getProviderByDevice, recordPlacement } from "../../services/chain-client.js";
import { getWorkloadManifestByWorkloadId } from "../../services/ipfs.service.js";
import { deployToProvider } from "../../services/deploy-to-provider.service.js";
import { registerWorkloadForPolling } from "../../services/workload-status-poller.service.js";
import {
  ExecutePlacementResponseSchema,
  OrchestrationStatusResponseSchema,
  PlacementResponseSchema,
  ProviderStatsResponseSchema,
  ProvidersResponseSchema,
  WorkloadIdParamsSchema,
  WorkloadManifestResponseSchema,
} from "../../schemas/orchestration.schema.js";
import { BEARER_AUTH, createRouter, json, responses } from "./_openapi.js";

export const orchestrationRouter = createRouter();

// requireAuth is applied to /v1/orchestration/* in middleware/security.ts.
const TAGS = ["Orchestration"];

// GET /v1/orchestration/placement — list placement decisions + summary (optimized for no_workloads / no_providers / no_capacity)
const placementRoute = createRoute({
  method: "get",
  path: "/orchestration/placement",
  tags: TAGS,
  security: BEARER_AUTH,
  responses: responses({ 200: json(PlacementResponseSchema, "Placement decisions and summary") }, 401, 500),
});

orchestrationRouter.openapi(placementRoute, async (c) => {
  try {
    const result = await findPlacements();
    return ok(c, {
      placements: result.decisions.map((d) => ({
        workloadId: d.workloadId.toString(),
        provider: d.provider,
        instanceId: d.instanceId.toString(),
      })),
      summary: result.summary,
    });
  } catch (e) {
    return fail(c, "internal", e instanceof Error ? e.message : "Placement failed");
  }
});

// GET /v1/orchestration/status — lightweight placement summary (pending count, provider count, reason)
const statusRoute = createRoute({
  method: "get",
  path: "/orchestration/status",
  tags: TAGS,
  security: BEARER_AUTH,
  responses: responses({ 200: json(OrchestrationStatusResponseSchema, "Placement summary") }, 401, 500),
});

orchestrationRouter.openapi(statusRoute, async (c) => {
  try {
    const result = await findPlacements();
    return ok(c, { summary: result.summary });
  } catch (e) {
    return fail(c, "internal", e instanceof Error ? e.message : "Status failed");
  }
});

// POST /v1/orchestration/placement/execute — run placement now: find placements, deploy to provider nodes via HTTP POST /deploy,
// then record on-chain. Provider nodes are orchestrator-controlled via HTTP, not event-driven. Requires ORCHESTRATOR_PRIVATE_KEY.
const executePlacementRoute = createRoute({
  method: "post",
  path: "/orchestration/placement/execute",
  tags: TAGS,
  security: BEARER_AUTH,
  responses: responses({ 200: json(ExecutePlacementResponseSchema, "Placement cycle executed") }, 401, 500),
});

orchestrationRouter.openapi(executePlacementRoute, async (c) => {
  try {
    const result = await findPlacements();
    const transactions: { workloadId: string; provider: string; instanceId: string; txHash?: string; error?: string; deployFailed?: boolean }[] = [];
    let placed = 0;
    let failed = 0;
    for (const d of result.decisions) {
      try {
        const deployOk = await deployToProvider(d);
        if (!deployOk) {
          transactions.push({
            workloadId: d.workloadId.toString(),
            provider: d.provider,
            instanceId: d.instanceId.toString(),
            error: "Deploy to provider failed or timeout",
            deployFailed: true,
          });
          failed += 1;
          continue;
        }
        const receipt = await recordPlacement(d.workloadId, d.provider, d.instanceId);

        // Register workload for status polling
        registerWorkloadForPolling(d.workloadId, d.instanceId, d.provider, d.endpoint, d.deviceId, d.ownerAddress);

        transactions.push({
          workloadId: d.workloadId.toString(),
          provider: d.provider,
          instanceId: d.instanceId.toString(),
          txHash: receipt.transactionHash,
        });
        placed += 1;
      } catch (e) {
        transactions.push({
          workloadId: d.workloadId.toString(),
          provider: d.provider,
          instanceId: d.instanceId.toString(),
          error: e instanceof Error ? e.message : String(e),
        });
        failed += 1;
      }
    }
    return ok(c, {
      placed,
      failed,
      transactions,
      summary: result.summary,
    });
  } catch (e) {
    return fail(c, "internal", e instanceof Error ? e.message : "Placement execute failed");
  }
});

// GET /v1/orchestration/workloads/:workloadId/manifest — fetch workload manifest from IPFS (on-chain metadataUri)
const manifestRoute = createRoute({
  method: "get",
  path: "/orchestration/workloads/{workloadId}/manifest",
  tags: TAGS,
  security: BEARER_AUTH,
  request: { params: WorkloadIdParamsSchema },
  responses: responses({ 200: json(WorkloadManifestResponseSchema, "Workload manifest from IPFS") }, 401, 404, 500),
});

orchestrationRouter.openapi(manifestRoute, async (c) => {
  try {
    const workloadIdStr = c.req.valid("param").workloadId;
    const workloadId = BigInt(workloadIdStr);
    const result = await getWorkloadManifestByWorkloadId(workloadId);
    if (!result) {
      return fail(c, "not_found", "Workload not found or manifest not available");
    }
    return ok(c, { manifest: result.manifest, cid: result.cid });
  } catch (e) {
    return fail(c, "internal", e instanceof Error ? e.message : "Failed to fetch workload manifest");
  }
});

// GET /v1/orchestration/providers — list active providers from chain (metadataUri only; full spec on IPFS)
const providersRoute = createRoute({
  method: "get",
  path: "/orchestration/providers",
  tags: TAGS,
  security: BEARER_AUTH,
  responses: responses({ 200: json(ProvidersResponseSchema, "Active providers from chain") }, 401, 500),
});

orchestrationRouter.openapi(providersRoute, async (c) => {
  try {
    const list = await getActiveProviders();
    const withUri = await Promise.all(
      list.map(async (deviceId) => {
        const p = await getProviderByDevice(deviceId);
        const metadataUri = p?.metadataUri ?? "";
        const address = p?.providerAddr ?? "";
        return { address, deviceId, metadataUri };
      })
    );
    return ok(c, { providers: withUri });
  } catch (e) {
    return fail(c, "internal", e instanceof Error ? e.message : "Failed to fetch providers");
  }
});

// GET /v1/orchestration/provider-stats — fetch real-time stats from provider nodes
const providerStatsRoute = createRoute({
  method: "get",
  path: "/orchestration/provider-stats",
  tags: TAGS,
  security: BEARER_AUTH,
  responses: responses({ 200: json(ProviderStatsResponseSchema, "Real-time provider stats") }, 401, 500),
});

orchestrationRouter.openapi(providerStatsRoute, async (c) => {
  try {
    const { fetchMultipleProviderStats } = await import("../../services/provider-stats.service.js");
    const { fetchProviderMetadataFromUrl, isValidIPFSCID } = await import("../../services/ipfs.service.js");

    const list = await getActiveProviders();
    const providers = await Promise.all(
      list.map(async (deviceId) => {
        const p = await getProviderByDevice(deviceId);
        const metadataUri = p?.metadataUri ?? "";

        // Fetch IPFS metadata to get endpoint and specs
        let endpoint: string | undefined;
        let cpuCores: number | undefined;
        let gpuCount: number | undefined;

        if (metadataUri) {
          const url = isValidIPFSCID(metadataUri)
            ? `https://ipfs.io/ipfs/${metadataUri}`
            : metadataUri;
          const metadata = await fetchProviderMetadataFromUrl(url);
          if (metadata) {
            endpoint = metadata.endpoint;
            cpuCores = metadata.cpuCores;
            gpuCount = metadata.gpuCount;
          }
        }

        return {
          deviceId: String(deviceId),
          endpoint,
          cpuCores,
          gpuCount,
        };
      })
    );

    const statsMap = await fetchMultipleProviderStats(providers);

    // Convert Map to object for JSON response
    const statsObj: Record<string, unknown> = {};
    statsMap.forEach((stats, deviceId) => {
      statsObj[deviceId] = stats;
    });

    return ok(c, { stats: statsObj });
  } catch (e) {
    return fail(c, "internal", e instanceof Error ? e.message : "Failed to fetch provider stats");
  }
});
