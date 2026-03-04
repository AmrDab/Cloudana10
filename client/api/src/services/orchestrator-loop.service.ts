/**
 * Orchestrator loop: periodically find placement decisions, deploy to provider first, then record on-chain.
 * Confirms provider accepted workload before broadcasting recordPlacement.
 */
import { findPlacements } from "./placement.service.js";
import { recordPlacement } from "./chain-client.js";
import { getWorkloadManifestByWorkloadId } from "./ipfs.service.js";
import { deployToProvider } from "./deploy-to-provider.service.js";
import { registerWorkloadForPolling } from "./workload-status-poller.service.js";
import { log } from "../lib/logger.js";

const POLL_INTERVAL_MS = Number(process.env.ORCHESTRATOR_POLL_INTERVAL_MS ?? 60_000); // default 1 min
const L = log.orchestratorLoop;
let intervalId: ReturnType<typeof setInterval> | null = null;
let cycleId = 0;

export function getOrchestratorPollIntervalMs(): number {
  return POLL_INTERVAL_MS;
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
        `[cycle ${id}] action ${i + 1}/${result.decisions.length}: deploy first then recordPlacement workloadId=${d.workloadId} provider=${d.provider}`
      );
      try {
        const deployOk = await deployToProvider(d);
        if (!deployOk) {
          L.error(`[cycle ${id}] deployToProvider failed for workloadId=${d.workloadId} -> skip recordPlacement`);
          continue;
        }
        const receipt = await recordPlacement(d.workloadId, d.provider, d.instanceId);
        L.success(`[cycle ${id}] recordPlacement SUCCESS workloadId=${d.workloadId} tx=${receipt.transactionHash}`);
        
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
          `[cycle ${id}] recordPlacement FAILED workloadId=${d.workloadId} provider=${d.provider}:`,
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
  L.success(`STARTING poll (interval ${POLL_INTERVAL_MS}ms)`);
  void runPlacementCycle();
  intervalId = setInterval(runPlacementCycle, POLL_INTERVAL_MS);
  L.log(`first cycle scheduled; next every ${POLL_INTERVAL_MS}ms`);
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
