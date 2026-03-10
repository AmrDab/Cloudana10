import { z } from "zod";
import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { findPlacements } from "../../services/placement.service.js";
import { getActiveProviders, getProviderByDevice, recordPlacement } from "../../services/chain-client.js";
import { getWorkloadManifestByWorkloadId } from "../../services/ipfs.service.js";
import { deployToProvider } from "../../services/deploy-to-provider.service.js";
import { registerWorkloadForPolling } from "../../services/workload-status-poller.service.js";

export const orchestrationRouter = new OpenAPIHono();

// GET /v1/orchestration/placement — list placement decisions + summary (optimized for no_workloads / no_providers / no_capacity)
orchestrationRouter.get("/orchestration/placement", async (c) => {
  try {
    const result = await findPlacements();
    return c.json({
      status: "success",
      placements: result.decisions.map((d) => ({
        workloadId: d.workloadId.toString(),
        provider: d.provider,
        instanceId: d.instanceId.toString(),
      })),
      summary: result.summary,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Placement failed";
    return c.json({ status: "error", error: msg }, 500);
  }
});

// GET /v1/orchestration/status — lightweight placement summary (pending count, provider count, reason)
orchestrationRouter.get("/orchestration/status", async (c) => {
  try {
    const result = await findPlacements();
    return c.json({
      status: "success",
      summary: result.summary,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Status failed";
    return c.json({ status: "error", error: msg }, 500);
  }
});

// POST /v1/orchestration/placement/execute — run placement now: find placements, deploy to provider nodes via HTTP POST /deploy,
// then record on-chain. Provider nodes are orchestrator-controlled via HTTP, not event-driven. Requires ORCHESTRATOR_PRIVATE_KEY.
const executePlacementRoute = createRoute({
  method: "post",
  path: "/orchestration/placement/execute",
  tags: ["Orchestration"],
  request: {},
  responses: {
    200: {
      description: "Placement cycle executed",
      content: {
        "application/json": {
          schema: z.object({
            status: z.string(),
            placed: z.number(),
            failed: z.number(),
            transactions: z.array(z.object({
              workloadId: z.string(),
              provider: z.string(),
              instanceId: z.string(),
              txHash: z.string().optional(),
              error: z.string().optional(),
            })),
          }),
        },
      },
    },
    500: { description: "Internal server error" },
  },
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
    return c.json({
      status: "success",
      placed,
      failed,
      transactions,
      summary: result.summary,
    }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Placement execute failed";
    return c.json({ status: "error", error: msg }, 500);
  }
});

// GET /v1/orchestration/workloads/:workloadId/manifest — fetch workload manifest from IPFS (on-chain metadataUri)
orchestrationRouter.get("/orchestration/workloads/:workloadId/manifest", async (c) => {
  try {
    const workloadIdStr = c.req.param("workloadId");
    const workloadId = BigInt(workloadIdStr);
    const result = await getWorkloadManifestByWorkloadId(workloadId);
    if (!result) {
      return c.json({ status: "error", error: "Workload not found or manifest not available" }, 404);
    }
    return c.json({ status: "success", manifest: result.manifest, cid: result.cid });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to fetch workload manifest";
    return c.json({ status: "error", error: msg }, 500);
  }
});

// GET /v1/orchestration/providers — list active providers from chain (metadataUri only; full spec on IPFS)
orchestrationRouter.get("/orchestration/providers", async (c) => {
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
    return c.json({ status: "success", providers: withUri });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to fetch providers";
    return c.json({ status: "error", error: msg }, 500);
  }
});

// GET /v1/orchestration/provider-stats — fetch real-time stats from provider nodes
orchestrationRouter.get("/orchestration/provider-stats", async (c) => {
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
    
    return c.json({ status: "success", stats: statsObj });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to fetch provider stats";
    return c.json({ status: "error", error: msg }, 500);
  }
});
