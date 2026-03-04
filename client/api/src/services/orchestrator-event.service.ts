/**
 * Event-driven orchestrator: react to WorkloadRegistry and ProviderRegistry events
 * by running placement. Listens to:
 * - WorkloadRegistry: WorkloadRegistered, WorkloadDeregistered, WorkloadActivated
 * - ProviderRegistry: ProviderRegistered, ProviderActivated, ProviderDeregistered
 * Handles both many-providers and many-workloads cases; debounces and
 * serializes placement cycles for scalability.
 */
import { 
  watchWorkloadRegistryEvents, 
  watchProviderRegistryEvents,
  recordPlacement, 
  readWorkload,
  getWorkloadRegistryAddress,
  getProviderRegistryAddress
} from "./chain-client.js";
import { findPlacements } from "./placement.service.js";
import { getWorkloadManifestByWorkloadId } from "./ipfs.service.js";
import { deployToProvider } from "./deploy-to-provider.service.js";
import { registerWorkloadForPolling, getPlacementByWorkloadId, unregisterWorkloadFromPolling } from "./workload-status-poller.service.js";
import { terminateWorkloadOnProvider } from "./terminate-workload-on-provider.service.js";
import { log } from "../lib/logger.js";
import { chainId, rpcUrl, rpcTransportMode, wssUrl } from "../config/contracts.js";

const DEBOUNCE_MS = Number(process.env.ORCHESTRATOR_EVENT_DEBOUNCE_MS ?? 2_000);
const L = log.orchestratorEvent;
let unsubscribeWorkload: (() => void) | null = null;
let unsubscribeProvider: (() => void) | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let pendingRun = false;
let cycleId = 0;

async function runPlacementCycle(): Promise<void> {
  if (running) {
    pendingRun = true;
    L.info("[cycle] placement cycle already running -> will re-run after current cycle");
    return;
  }
  running = true;
  pendingRun = false;
  const id = ++cycleId;
  
  L.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  L.info(`🔄 PLACEMENT CYCLE #${id} STARTED`);
  L.info(`   Checking for pending workloads and available providers...`);
  L.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  
  const cycleStart = Date.now();
  
  try {
    const result = await findPlacements();
    const placementDuration = Date.now() - cycleStart;
    
    L.info(`📊 Placement Analysis Complete (${placementDuration}ms):`);
    L.info(`   Pending Workloads: ${result.summary.pendingWorkloadCount}`);
    L.info(`   Active Providers: ${result.summary.activeProviderCount}`);
    L.info(`   Placement Decisions: ${result.decisions.length}`);
    L.info(`   Successfully Placed: ${result.summary.placedCount}`);
    L.info(`   Unplaced: ${result.summary.unplacedCount}`);
    L.info(`   Reason: ${result.summary.reason}`);
    
    if (result.decisions.length === 0) {
      if (result.summary.reason !== "no_workloads") {
        L.warn(`⚠️  No placements made: ${result.summary.reason}`);
      } else {
        L.dim(`   No pending workloads found`);
      }
      L.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      L.dim(`   Cycle #${id} complete (no decisions)`);
      L.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      return;
    }

    L.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    L.success(`✅ Found ${result.decisions.length} placement(s) - Starting deployment...`);
    
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < result.decisions.length; i++) {
      const d = result.decisions[i];
      L.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      L.info(`🎯 PLACEMENT ${i + 1}/${result.decisions.length}`);
      L.info(`   Workload ID: ${d.workloadId}`);
      L.info(`   Instance ID: ${d.instanceId}`);
      L.info(`   Provider: ${d.provider}`);
      L.info(`   Endpoint: ${d.endpoint}`);
      L.info(`   Owner: ${d.ownerAddress}`);
      L.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      
      const placementStart = Date.now();
      
      try {
        // Step 1: Deploy to provider
        L.info(`📤 Step 1/2: Deploying workload to provider...`);
        const deployOk = await deployToProvider(d);
        
        if (!deployOk) {
          L.error(`❌ Provider deployment FAILED - Skipping blockchain recording`);
          L.error(`   Workload ${d.workloadId} will remain unplaced on-chain`);
          failCount++;
          continue;
        }
        
        L.success(`✅ Provider accepted deployment`);
        
        // Step 2: Record on blockchain
        L.info(`📝 Step 2/2: Recording placement on blockchain...`);
        const txStart = Date.now();
        const receipt = await recordPlacement(d.workloadId, d.provider, d.instanceId);
        const txDuration = Date.now() - txStart;
        
        // Step 3: Register workload for status polling
        registerWorkloadForPolling(d.workloadId, d.instanceId, d.provider, d.endpoint, d.deviceId, d.ownerAddress);
        L.info(`📊 Registered workload ${d.workloadId}/${d.instanceId} for status polling`);
        
        L.success(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        L.success(`✅ PLACEMENT SUCCESSFUL!`);
        L.success(`   Workload: ${d.workloadId}/${d.instanceId}`);
        L.success(`   Provider: ${d.provider.slice(0, 10)}...`);
        L.success(`   TX Hash: ${receipt.transactionHash}`);
        L.success(`   Block: ${receipt.blockNumber}`);
        L.success(`   Gas Used: ${receipt.gasUsed}`);
        L.success(`   TX Time: ${txDuration}ms`);
        L.success(`   Total Time: ${Date.now() - placementStart}ms`);
        
        // Show manifest info
        const manifestInfo = await getWorkloadManifestByWorkloadId(d.workloadId);
        if (manifestInfo) {
          const name = manifestInfo.manifest.name ?? manifestInfo.manifest.summary ?? "(unnamed)";
          L.info(`   Manifest: ${name} (CID: ${manifestInfo.cid.slice(0, 16)}...)`);
        }
        
        L.success(`   🎉 Workload is now deploying on provider's Kubernetes cluster!`);
        L.success(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        
        successCount++;
      } catch (e) {
        L.error(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        L.error(`❌ PLACEMENT FAILED!`);
        L.error(`   Workload: ${d.workloadId}/${d.instanceId}`);
        L.error(`   Provider: ${d.provider}`);
        L.error(`   Error: ${e instanceof Error ? e.message : String(e)}`);
        if (e instanceof Error && e.stack) {
          L.error(`   Stack: ${e.stack.split('\n').slice(0, 2).join('\n')}`);
        }
        L.error(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        failCount++;
      }
    }
    
    const cycleDuration = Date.now() - cycleStart;
    
    L.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    L.success(`✅ PLACEMENT CYCLE #${id} COMPLETE`);
    L.info(`   Total Time: ${cycleDuration}ms`);
    L.info(`   Decisions: ${result.decisions.length}`);
    L.info(`   Success: ${successCount}`);
    L.info(`   Failed: ${failCount}`);
    L.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    
  } catch (e) {
    L.error(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    L.error(`❌ PLACEMENT CYCLE #${id} ERROR`);
    L.error(`   Error: ${e instanceof Error ? e.message : String(e)}`);
    if (e instanceof Error && e.stack) {
      L.error(`   Stack: ${e.stack.split('\n').slice(0, 3).join('\n')}`);
    }
    L.error(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  } finally {
    running = false;
    if (pendingRun) {
      pendingRun = false;
      L.info("━━━ Re-running placement cycle (was pending) ━━━");
      void runPlacementCycle();
    }
  }
}

function scheduleRun(): void {
  if (debounceTimer != null) {
    clearTimeout(debounceTimer);
    L.dim(`debounce timer reset (${DEBOUNCE_MS}ms)`);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    L.log("debounce fired -> running placement cycle");
    void runPlacementCycle();
  }, DEBOUNCE_MS);
}

/**
 * Start the event-driven orchestrator: subscribe to WorkloadRegistry and ProviderRegistry events,
 * run placement when workloads are registered or providers join/activate, with debouncing.
 */
export function startOrchestratorEventDriven(): void {
  if (unsubscribeWorkload != null || unsubscribeProvider != null) {
    L.warn("already running, skip start");
    return;
  }
  
  let workloadRegistryAddress: string;
  let providerRegistryAddress: string;
  
  try {
    workloadRegistryAddress = getWorkloadRegistryAddress();
  } catch {
    workloadRegistryAddress = "(not set)";
  }
  
  try {
    providerRegistryAddress = getProviderRegistryAddress();
  } catch {
    providerRegistryAddress = "(not set)";
  }
  
  L.success(`STARTING event-driven orchestrator (debounce=${DEBOUNCE_MS}ms)`);
  L.log(`WorkloadRegistry=${workloadRegistryAddress}`);
  L.log(`ProviderRegistry=${providerRegistryAddress}`);
  L.log(`chainId=${chainId}`);
  L.log(`RPC Transport: ${rpcTransportMode.toUpperCase()}`);
  if (rpcTransportMode === 'http') {
    L.log(`  HTTP: ${rpcUrl?.slice(0, 60)}...`);
  } else if (rpcTransportMode === 'websocket') {
    L.log(`  WebSocket: ${wssUrl?.slice(0, 60)}...`);
  } else if (rpcTransportMode === 'hybrid') {
    L.log(`  Primary (WSS): ${wssUrl?.slice(0, 60)}...`);
    L.log(`  Fallback (HTTP): ${rpcUrl?.slice(0, 60)}...`);
  }
  
  const zeroAddress = "0x0000000000000000000000000000000000000000" as const;

  // Subscribe to WorkloadRegistry events
  unsubscribeWorkload = watchWorkloadRegistryEvents({
    onWorkloadRegistered: (workloadId) => {
      L.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      L.success(`🔔 BLOCKCHAIN EVENT: WorkloadRegistered`);
      L.info(`   Workload ID: ${workloadId}`);
      L.info(`   Action: Scheduling placement cycle...`);
      L.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      scheduleRun();
    },
    onWorkloadDeregistered: (workloadId) => {
      L.info(`[WorkloadRegistry] EVENT WorkloadDeregistered workloadId=${workloadId} -> terminate on provider (if placed), then schedule placement`);
      void (async () => {
        try {
          const w = await readWorkload(workloadId) as { placementProvider?: string; placementInstanceId?: bigint } | null;
          const provider = w?.placementProvider;
          const instanceId = w?.placementInstanceId;
          if (provider && String(provider).toLowerCase() !== zeroAddress.toLowerCase() && instanceId != null) {
            L.info(`[WorkloadRegistry] Terminating workload ${workloadId}/${instanceId} on provider ${String(provider).slice(0, 10)}...`);
            const ok = await terminateWorkloadOnProvider(workloadId, instanceId, provider as `0x${string}`);
            if (ok) {
              unregisterWorkloadFromPolling(workloadId, instanceId);
              L.success(`[WorkloadRegistry] Workload ${workloadId}/${instanceId} terminated and unregistered from polling`);
            } else {
              L.warn(`[WorkloadRegistry] Terminate failed for ${workloadId}/${instanceId}, unregistering from polling anyway`);
              unregisterWorkloadFromPolling(workloadId, instanceId);
            }
          }
        } catch (e) {
          L.error(`[WorkloadRegistry] Error handling WorkloadDeregistered ${workloadId}: ${e instanceof Error ? e.message : String(e)}`);
        }
        scheduleRun();
      })();
    },
    onWorkloadDeleted: (workloadId) => {
      L.info(`[WorkloadRegistry] EVENT WorkloadDeleted workloadId=${workloadId} -> terminate on provider (from cache)`);
      void (async () => {
        const placement = getPlacementByWorkloadId(workloadId);
        if (placement) {
          L.info(`[WorkloadRegistry] Terminating workload ${workloadId}/${placement.instanceId} on provider ${placement.providerAddress.slice(0, 10)}...`);
          const ok = await terminateWorkloadOnProvider(workloadId, placement.instanceId, placement.providerAddress as `0x${string}`);
          if (ok) {
            unregisterWorkloadFromPolling(workloadId, placement.instanceId);
            L.success(`[WorkloadRegistry] Workload ${workloadId}/${placement.instanceId} terminated and unregistered from polling`);
          } else {
            L.warn(`[WorkloadRegistry] Terminate failed for ${workloadId}/${placement.instanceId}, unregistering from polling anyway`);
            unregisterWorkloadFromPolling(workloadId, placement.instanceId);
          }
        } else {
          L.dim(`[WorkloadRegistry] No placement in cache for deleted workload ${workloadId} (may already be unregistered)`);
        }
      })();
    },
    onCapacityFreed: () => {
      L.info("[WorkloadRegistry] EVENT onCapacityFreed -> schedule placement");
      scheduleRun();
    },
  });
  
  // Subscribe to ProviderRegistry events
  unsubscribeProvider = watchProviderRegistryEvents({
    onProviderRegistered: (deviceId, owner) => {
      L.info(`[ProviderRegistry] EVENT ProviderRegistered deviceId=${deviceId} owner=${owner} -> schedule placement`);
      scheduleRun();
    },
    onProviderActivated: (deviceId, owner) => {
      L.info(`[ProviderRegistry] EVENT ProviderActivated deviceId=${deviceId} owner=${owner} -> schedule placement`);
      scheduleRun();
    },
    onProviderDeregistered: (deviceId, owner) => {
      L.info(`[ProviderRegistry] EVENT ProviderDeregistered deviceId=${deviceId} owner=${owner}`);
      // No placement needed when provider goes offline
    },
    onNewCapacityAvailable: () => {
      L.info("[ProviderRegistry] EVENT onNewCapacityAvailable -> schedule placement");
      scheduleRun();
    },
  });
  
  L.success("Subscribed to WorkloadRegistry and ProviderRegistry events");
  L.log("Running initial catch-up placement cycle...");
  void runPlacementCycle();
}

/**
 * Stop the event-driven orchestrator and clear debounce timer.
 */
export function stopOrchestratorEventDriven(): void {
  if (debounceTimer != null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
    L.dim("debounce timer cleared");
  }
  if (unsubscribeWorkload != null) {
    unsubscribeWorkload();
    unsubscribeWorkload = null;
    L.log("Unsubscribed from WorkloadRegistry events");
  }
  if (unsubscribeProvider != null) {
    unsubscribeProvider();
    unsubscribeProvider = null;
    L.log("Unsubscribed from ProviderRegistry events");
  }
  if (unsubscribeWorkload === null && unsubscribeProvider === null) {
    L.warn("STOPPED (unsubscribed from all events)");
  }
}
