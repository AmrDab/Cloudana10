/**
 * Orchestrator loop: periodically find placement decisions and deploy to the provider.
 * The API holds no chain key, so placements are tracked by the status poller, not the WorkloadRegistry.
 */
import { findPlacements } from "./placement.service.js";
import { getWorkloadManifestByWorkloadId } from "./ipfs.service.js";
import { deployToProvider } from "./deploy-to-provider.service.js";
import { getPlacementByWorkloadId, registerWorkloadForPolling } from "./workload-status-poller.service.js";
import { log } from "../lib/logger.js";
import { getEnv } from "../config/env.js";

const L = log.orchestratorLoop;
let intervalId: ReturnType<typeof setInterval> | null = null;
let cycleId = 0;

export function getOrchestratorPollIntervalMs(): number {
  return getEnv().ORCHESTRATOR_POLL_INTERVAL_MS;
}

async function runPlacementCycle(): Promise<void> {
  const id = ++cycleId;
  L.info(`[cycle ${id}] START`);
  try {
    const result = await findPlacements();
    L.log(
      `[cycle ${id}] findPlacements() -> decisions=${result.decisions.length} ` +
      `| pendingWorkloads=${result.summary.pendingWorkloadCount} activeProviders=${result.summary.activeProviderCount} ` +
      `placed=${result.summary.placedCount} unplaced=${result.summary.unplacedCount} reason=${result.summary.reason}`
    );
    if (result.decisions.length === 0) {
      if (result.summary.reason !== "no_workloads") {
        L.log(`[cycle ${id}] no placements: ${result.summary.reason}`);
      }
      L.dim(`[cycle ${id}] END (no decisions)`);
      return;
    }

    for (let i = 0; i < result.decisions.length; i++) {
      const d = result.decisions[i];
      L.log(
        `[cycle ${id}] action ${i + 1}/${result.decisions.length}: deploy workloadId=${d.workloadId} provider=${d.provider}`
      );
      try {
        if (getPlacementByWorkloadId(d.workloadId)) {
          L.dim(`[cycle ${id}] workloadId=${d.workloadId} already deployed (tracked by the status poller) -> skip`);
          continue;
        }
        const deployOk = await deployToProvider(d);
        if (!deployOk) {
          L.error(`[cycle ${id}] deployToProvider failed for workloadId=${d.workloadId}`);
          continue;
        }
        L.success(`[cycle ${id}] deploy SUCCESS workloadId=${d.workloadId}`);
        
        // Register workload for status polling
        registerWorkloadForPolling(d.workloadId, d.instanceId, d.provider, d.endpoint, d.deviceId, d.ownerAddress);
        L.log(`[cycle ${id}] Registered workload ${d.workloadId}/${d.instanceId} for status polling`);
        
        const manifestInfo = await getWorkloadManifestByWorkloadId(d.workloadId);
        if (manifestInfo) {
          const name = manifestInfo.manifest.name ?? manifestInfo.manifest.summary ?? (manifestInfo.manifest.services ? "(deploy)" : manifestInfo.cid.slice(0, 12) + "...");
          L.log(`[cycle ${id}] workloadId=${d.workloadId} manifest from IPFS: cid=${manifestInfo.cid} name=${name}`);
        } else {
          L.dim(`[cycle ${id}] workloadId=${d.workloadId} manifest not available from IPFS`);
        }
      } catch (e) {
        L.error(
          `[cycle ${id}] placement FAILED workloadId=${d.workloadId} provider=${d.provider}:`,
          e instanceof Error ? e.message : e
        );
      }
    }
    L.info(`[cycle ${id}] END (${result.decisions.length} decisions processed)`);
  } catch (e) {
    L.error(`[cycle ${id}] placement cycle ERROR:`, e instanceof Error ? e.message : e);
  }
}

/**
 * Start the orchestrator loop: run placement cycle every ORCHESTRATOR_POLL_INTERVAL_MS ms.
 * Runs one cycle immediately, then on interval.
 */
export function startOrchestratorLoop(): void {
  if (intervalId != null) {
    L.warn("already running, skip start");
    return;
  }
  const pollIntervalMs = getOrchestratorPollIntervalMs();
  L.success(`STARTING poll (interval ${pollIntervalMs}ms)`);
  void runPlacementCycle();
  intervalId = setInterval(runPlacementCycle, pollIntervalMs);
  L.log(`first cycle scheduled; next every ${pollIntervalMs}ms`);
}

/**
 * Stop the orchestrator loop.
 */
export function stopOrchestratorLoop(): void {
  if (intervalId != null) {
    clearInterval(intervalId);
    intervalId = null;
    L.warn("STOPPED");
  }
}
