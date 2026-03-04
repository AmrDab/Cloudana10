/**
 * Placement: match pending workloads to active providers by capability/capacity.
 * Optimized: batch-read pending workloads with requirements (no N×readWorkload);
 * cache provider capacity from IPFS per cycle (P fetches instead of W×P).
 */
import type { Address } from "viem";
import type { DeviceId } from "./chain-client.js";
import {
  getActiveProviders,
  getProviderByDevice,
  readPendingWorkloadsWithRequirements,
  type WorkloadRequirementsReq,
} from "./chain-client.js";
import type { ProviderCapacityAndEndpoint } from "./provider-metadata.service.js";
import { fetchProviderCapacityAndEndpointFromIpfsUrl } from "./provider-metadata.service.js";
import { log } from "../lib/logger.js";

const L = log.placement;

export interface PlacementDecision {
  workloadId: bigint;
  provider: Address;
  deviceId: DeviceId;
  instanceId: bigint;
  /** Provider node base URL for POST /deploy. Required so orchestrator can confirm execution before recording on-chain. */
  endpoint: string;
  /** Workload owner address (for status polling registration). */
  ownerAddress: Address;
}

export type PlacementSummaryReason =
  | "ok"
  | "no_workloads"
  | "no_providers"
  | "no_capacity";

export interface PlacementSummary {
  pendingWorkloadCount: number;
  activeProviderCount: number;
  placedCount: number;
  unplacedCount: number;
  reason: PlacementSummaryReason;
}

export interface PlacementResult {
  decisions: PlacementDecision[];
  summary: PlacementSummary;
}

const instanceIdCounter = new Map<string, number>();
function nextInstanceId(workloadId: bigint): bigint {
  const key = workloadId.toString();
  const n = (instanceIdCounter.get(key) ?? 0) + 1;
  instanceIdCounter.set(key, n);
  return BigInt(n);
}

type ChainProvider = {
  status: number;
  providerAddr: Address;
  metadataUri?: string;
  endpoint?: string;
};

/** Build capacity + endpoint cache: one IPFS fetch per provider per cycle. Only entries with endpoint are used for placement. */
async function buildProviderCapacityCache(
  deviceIds: DeviceId[],
  getProviderByDeviceFn: (deviceId: DeviceId) => Promise<unknown>
): Promise<Map<string, { providerAddr: Address; capacity: ProviderCapacityAndEndpoint }>> {
  L.info(`🔨 Building provider capacity cache for ${deviceIds.length} device(s)...`);
  const cache = new Map<string, { providerAddr: Address; capacity: ProviderCapacityAndEndpoint }>();
  let processedCount = 0;
  let activeCount = 0;
  let withEndpointCount = 0;
  let noMetadataCount = 0;
  let fetchErrorCount = 0;
  
  await Promise.all(
    deviceIds.map(async (deviceId, index) => {
      const deviceIdShort = `${deviceId.slice(0, 10)}...${deviceId.slice(-8)}`;
      L.dim(`  [${index + 1}/${deviceIds.length}] Processing device: ${deviceIdShort}`);
      
      try {
        const p = await getProviderByDeviceFn(deviceId);
        processedCount++;
        
        if (!p) {
          L.dim(`    ❌ Device ${deviceIdShort}: Not found on-chain`);
          return;
        }
        
        const prov = p as ChainProvider;
        L.dim(`    ℹ️  Device ${deviceIdShort}: Status=${prov.status} (0=Inactive, 1=Active)`);
        
        if (prov.status !== 1) {
          L.dim(`    ⚠️  Device ${deviceIdShort}: Skipping (status is not Active)`);
          return;
        }
        
        activeCount++;
        const metadataUri = prov.metadataUri ?? prov.endpoint;
        
        if (!metadataUri || typeof metadataUri !== "string") {
          L.warn(`    ❌ Device ${deviceIdShort}: No metadata URI or endpoint`);
          noMetadataCount++;
          return;
        }
        
        L.dim(`    📄 Device ${deviceIdShort}: Fetching capacity from ${metadataUri.slice(0, 50)}...`);
        const cap = await fetchProviderCapacityAndEndpointFromIpfsUrl(metadataUri);
        
        if (!cap) {
          L.warn(`    ❌ Device ${deviceIdShort}: Failed to fetch capacity from IPFS`);
          fetchErrorCount++;
          return;
        }
        
        if (!cap.endpoint) {
          L.warn(`    ❌ Device ${deviceIdShort}: No endpoint URL in metadata (required for deployment)`);
          return;
        }
        
        withEndpointCount++;
        L.success(
          `    ✅ Device ${deviceIdShort}: Cached! ` +
          `Provider=${prov.providerAddr.slice(0, 10)}... ` +
          `Endpoint=${cap.endpoint.slice(0, 30)}... ` +
          `CPU=${cap.cpu} RAM=${cap.memoryBytes} Storage=${cap.storageBytes} GPU=${cap.gpuCount}`
        );
        
        cache.set(deviceId.toLowerCase(), { providerAddr: prov.providerAddr, capacity: cap });
      } catch (error: any) {
        L.error(`    💥 Device ${deviceIdShort}: Error - ${error.message}`);
        fetchErrorCount++;
      }
    })
  );
  
  L.success(
    `✅ Cache built: ${cache.size}/${deviceIds.length} providers ready for placement ` +
    `(Active=${activeCount}, WithEndpoint=${withEndpointCount}, NoMetadata=${noMetadataCount}, FetchErrors=${fetchErrorCount})`
  );
  
  return cache;
}

/**
 * Match one workload to a provider that has remaining capacity and endpoint.
 * Uses remaining capacity map which is updated after each successful placement.
 */
function matchOne(
  workloadId: bigint,
  ownerAddress: Address,
  req: WorkloadRequirementsReq,
  remainingCapacityMap: Map<string, { providerAddr: Address; capacity: ProviderCapacityAndEndpoint }>,
  deviceIds: DeviceId[],
  deviceIdMap?: Map<string, DeviceId>
): PlacementDecision | null {
  L.info(`🎯 Matching workload ${workloadId}...`);
  L.log(
    `  Requirements: CPU=${req.cpu}, RAM=${req.memoryBytes}, ` +
    `Storage=${req.storageBytes}, GPU=${req.gpuCount}`
  );
  
  let checkedProviders = 0;
  let notInCacheCount = 0;
  const failReasons: string[] = [];
  
  for (const deviceId of deviceIds) {
    const deviceIdShort = `${deviceId.slice(0, 10)}...${deviceId.slice(-8)}`;
    const entry = remainingCapacityMap.get(deviceId.toLowerCase());
    
    if (!entry) {
      notInCacheCount++;
      L.dim(`  [${checkedProviders + 1}] Device ${deviceIdShort}: Not in cache (skipped)`);
      continue;
    }
    
    checkedProviders++;
    const { providerAddr, capacity: cap } = entry;
    const providerShort = `${providerAddr.slice(0, 8)}...${providerAddr.slice(-6)}`;
    
    L.dim(
      `  [${checkedProviders}] Checking provider ${providerShort} (device: ${deviceIdShort}):`
    );
    L.dim(
      `      Available: CPU=${cap.cpu}, RAM=${cap.memoryBytes}, ` +
      `Storage=${cap.storageBytes}, GPU=${cap.gpuCount}`
    );
    
    // Check endpoint
    if (!cap.endpoint) {
      const reason = `${providerShort}: No endpoint`;
      failReasons.push(reason);
      L.warn(`      ❌ No endpoint URL`);
      continue;
    }
    
    // Check CPU
    if (cap.cpu < req.cpu) {
      const reason = `${providerShort}: CPU insufficient (has ${cap.cpu}, needs ${req.cpu})`;
      failReasons.push(reason);
      L.warn(`      ❌ CPU insufficient: has ${cap.cpu}, needs ${req.cpu}`);
      continue;
    }
    
    // Check memory
    if (cap.memoryBytes < req.memoryBytes) {
      const reason = `${providerShort}: RAM insufficient (has ${cap.memoryBytes}, needs ${req.memoryBytes})`;
      failReasons.push(reason);
      L.warn(`      ❌ RAM insufficient: has ${cap.memoryBytes}, needs ${req.memoryBytes}`);
      continue;
    }
    
    // Check storage
    if (cap.storageBytes < req.storageBytes) {
      const reason = `${providerShort}: Storage insufficient (has ${cap.storageBytes}, needs ${req.storageBytes})`;
      failReasons.push(reason);
      L.warn(`      ❌ Storage insufficient: has ${cap.storageBytes}, needs ${req.storageBytes}`);
      continue;
    }
    
    // Check GPU
    if (cap.gpuCount < req.gpuCount) {
      const reason = `${providerShort}: GPU insufficient (has ${cap.gpuCount}, needs ${req.gpuCount})`;
      failReasons.push(reason);
      L.warn(`      ❌ GPU insufficient: has ${cap.gpuCount}, needs ${req.gpuCount}`);
      continue;
    }
    
    // Match found!
    const baseUrl = cap.endpoint.replace(/\/+$/, "");
    const instanceId = nextInstanceId(workloadId);
    
    L.success(`      ✅ MATCH FOUND!`);
    L.success(
      `  🎉 Workload ${workloadId} → Provider ${providerShort} ` +
      `(instance ${instanceId}) at ${baseUrl.slice(0, 40)}...`
    );
    
    return {
      workloadId,
      provider: providerAddr,
      deviceId,
      instanceId,
      endpoint: baseUrl,
      ownerAddress,
    };
  }
  
  // No match found
  L.warn(`  ❌ NO MATCH: Checked ${checkedProviders} provider(s) in cache, ${notInCacheCount} not in cache`);
  if (failReasons.length > 0 && failReasons.length <= 5) {
    L.warn(`  Reasons: ${failReasons.join('; ')}`);
  } else if (failReasons.length > 5) {
    L.warn(`  First 5 reasons: ${failReasons.slice(0, 5).join('; ')}... (+${failReasons.length - 5} more)`);
  }
  
  return null;
}

/**
 * Find placement decisions: batch-read pending workloads, cache provider capacities, then match.
 * RPC: 1–2 (getWorkloadCount + getWorkloadsBatch). IPFS: one fetch per provider per cycle.
 */
export async function findPlacements(): Promise<PlacementResult> {
  L.info("═══════════════════════════════════════════════════");
  L.info("🚀 Starting placement cycle...");
  L.info("═══════════════════════════════════════════════════");
  
  L.log("📊 Step 1: Fetching pending workloads and active providers from blockchain...");
  const [pendingWorkloads, deviceIds] = await Promise.all([
    readPendingWorkloadsWithRequirements(),
    getActiveProviders(),
  ]);

  L.success(`✅ Found ${pendingWorkloads.length} pending workload(s) and ${deviceIds.length} active device(s)`);

  if (pendingWorkloads.length === 0) {
    L.warn("⚠️  No pending workloads - placement cycle complete (nothing to do)");
    return {
      decisions: [],
      summary: {
        pendingWorkloadCount: 0,
        activeProviderCount: deviceIds.length,
        placedCount: 0,
        unplacedCount: 0,
        reason: "no_workloads",
      },
    };
  }

  if (deviceIds.length === 0) {
    L.error("❌ No active providers available - cannot place workloads!");
    return {
      decisions: [],
      summary: {
        pendingWorkloadCount: pendingWorkloads.length,
        activeProviderCount: 0,
        placedCount: 0,
        unplacedCount: pendingWorkloads.length,
        reason: "no_providers",
      },
    };
  }

  L.log("\n📦 Step 2: Building provider capacity cache from IPFS metadata...");
  const capacityCache = await buildProviderCapacityCache(deviceIds, getProviderByDevice);
  
  if (capacityCache.size === 0) {
    L.error("❌ No providers with valid capacity and endpoint - cannot place workloads!");
    return {
      decisions: [],
      summary: {
        pendingWorkloadCount: pendingWorkloads.length,
        activeProviderCount: deviceIds.length,
        placedCount: 0,
        unplacedCount: pendingWorkloads.length,
        reason: "no_capacity",
      },
    };
  }
  
  L.log(`\n🎯 Step 3: Matching ${pendingWorkloads.length} workload(s) to ${capacityCache.size} provider(s)...`);
  L.log("─────────────────────────────────────────────────────");
  L.info("📊 Capacity tracking enabled: Providers can handle multiple workloads");
  
  // Create a copy of capacity cache for tracking remaining capacity
  // This allows one provider to be matched to multiple workloads
  const remainingCapacityMap = new Map<string, { providerAddr: Address; capacity: ProviderCapacityAndEndpoint }>();
  capacityCache.forEach((value, key) => {
    remainingCapacityMap.set(key, {
      providerAddr: value.providerAddr,
      capacity: { ...value.capacity }, // Deep copy of capacity
    });
  });
  
  const decisions: PlacementDecision[] = [];
  const providerWorkloadCount = new Map<string, number>(); // Track how many workloads per provider
  
  for (let i = 0; i < pendingWorkloads.length; i++) {
    const { workloadId, ownerAddress, requirements } = pendingWorkloads[i];
    L.log(`\n[Workload ${i + 1}/${pendingWorkloads.length}]`);
    const decision = matchOne(workloadId, ownerAddress, requirements, remainingCapacityMap, deviceIds);
    
    if (decision) {
      decisions.push(decision);
      
      // Find the deviceId for this provider
      let matchedDeviceId: string | null = null;
      for (const [deviceId, entry] of remainingCapacityMap.entries()) {
        if (entry.providerAddr.toLowerCase() === decision.provider.toLowerCase()) {
          matchedDeviceId = deviceId;
          break;
        }
      }
      
      if (matchedDeviceId) {
        const entry = remainingCapacityMap.get(matchedDeviceId)!;
        const providerShort = `${decision.provider.slice(0, 8)}...${decision.provider.slice(-6)}`;
        
        // Deduct workload requirements from provider's remaining capacity
        const beforeCpu = entry.capacity.cpu;
        const beforeRam = entry.capacity.memoryBytes;
        const beforeStorage = entry.capacity.storageBytes;
        const beforeGpu = entry.capacity.gpuCount;
        
        entry.capacity.cpu -= requirements.cpu;
        entry.capacity.memoryBytes -= requirements.memoryBytes;
        entry.capacity.storageBytes -= requirements.storageBytes;
        entry.capacity.gpuCount -= requirements.gpuCount;
        
        // Track workload count for this provider
        const currentCount = providerWorkloadCount.get(decision.provider.toLowerCase()) || 0;
        providerWorkloadCount.set(decision.provider.toLowerCase(), currentCount + 1);
        
        L.success(`  📉 Capacity deducted from provider ${providerShort}:`);
        L.log(`     CPU: ${beforeCpu} → ${entry.capacity.cpu} (used: ${requirements.cpu})`);
        L.log(`     RAM: ${beforeRam} → ${entry.capacity.memoryBytes} (used: ${requirements.memoryBytes})`);
        L.log(`     Storage: ${beforeStorage} → ${entry.capacity.storageBytes} (used: ${requirements.storageBytes})`);
        if (requirements.gpuCount > BigInt(0)) {
          L.log(`     GPU: ${beforeGpu} → ${entry.capacity.gpuCount} (used: ${requirements.gpuCount})`);
        }
        L.success(`     Total workloads on this provider: ${currentCount + 1}`);
        
        // Check if provider is now exhausted (for informational purposes)
        if (entry.capacity.cpu <= BigInt(0) || entry.capacity.memoryBytes <= BigInt(0) || entry.capacity.storageBytes <= BigInt(0)) {
          L.warn(`     ⚠️  Provider ${providerShort} is now at or near capacity limit`);
        }
      }
    }
  }

  const placedCount = decisions.length;
  const unplacedCount = pendingWorkloads.length - placedCount;
  const reason: PlacementSummaryReason =
    placedCount === 0 && pendingWorkloads.length > 0 ? "no_capacity" : "ok";

  L.log("\n═══════════════════════════════════════════════════");
  L.info("📈 PLACEMENT SUMMARY");
  L.log("═══════════════════════════════════════════════════");
  L.log(`  Pending workloads:   ${pendingWorkloads.length}`);
  L.log(`  Active providers:    ${deviceIds.length} devices (${capacityCache.size} with endpoint)`);
  L.log(`  Unique providers used: ${providerWorkloadCount.size}`);
  L.success(`  ✅ Placed:           ${placedCount}`);
  
  if (unplacedCount > 0) {
    L.warn(`  ⚠️  Unplaced:         ${unplacedCount}`);
  } else {
    L.log(`  Unplaced:            ${unplacedCount}`);
  }
  
  L.log(`  Reason:              ${reason}`);
  
  if (placedCount > 0) {
    L.success(`\n🎉 SUCCESS: ${placedCount} workload(s) matched to ${providerWorkloadCount.size} provider(s)!`);
    
    // Group by provider to show workload distribution
    const providerGroups = new Map<string, PlacementDecision[]>();
    decisions.forEach(d => {
      const key = d.provider.toLowerCase();
      if (!providerGroups.has(key)) providerGroups.set(key, []);
      providerGroups.get(key)!.push(d);
    });
    
    L.log(`\n📊 Workload Distribution per Provider:`);
    Array.from(providerGroups.entries()).forEach(([provider, workloads]) => {
      const providerShort = `${provider.slice(0, 8)}...${provider.slice(-6)}`;
      L.success(`  Provider ${providerShort}: ${workloads.length} workload(s)`);
      workloads.forEach((d, idx) => {
        const endpointShort = d.endpoint.slice(0, 40);
        L.log(`    ${idx + 1}. Workload ${d.workloadId} (instance ${d.instanceId}) @ ${endpointShort}...`);
      });
    });
    
    L.log(`\n📋 All Placements:`);
    decisions.forEach((d, idx) => {
      const providerShort = `${d.provider.slice(0, 8)}...${d.provider.slice(-6)}`;
      const endpointShort = d.endpoint.slice(0, 40);
      L.log(`  ${idx + 1}. Workload ${d.workloadId} → Provider ${providerShort} (instance ${d.instanceId})`);
    });
  } else if (pendingWorkloads.length > 0) {
    L.error(`\n❌ FAILED: No suitable providers found for any workload`);
    if (reason === "no_capacity") {
      L.warn("  Possible reasons:");
      L.warn("    - Providers don't have enough CPU/RAM/Storage/GPU");
      L.warn("    - Providers missing endpoint URL in metadata");
      L.warn("    - No providers currently active");
      L.warn("    - Provider capacity already exhausted by previous workloads in this cycle");
    }
  }
  
  L.log("═══════════════════════════════════════════════════\n");

  return {
    decisions,
    summary: {
      pendingWorkloadCount: pendingWorkloads.length,
      activeProviderCount: deviceIds.length,
      placedCount,
      unplacedCount,
      reason,
    },
  };
}

/**
 * Find placements for specific workload IDs (e.g. from events). Uses same batch + cache pattern.
 */
export async function findPlacementsForWorkloadIds(
  workloadIds: bigint[]
): Promise<PlacementResult> {
  L.info("═══════════════════════════════════════════════════");
  L.info(`🚀 Starting targeted placement for ${workloadIds.length} specific workload(s)...`);
  L.info("═══════════════════════════════════════════════════");
  
  if (workloadIds.length === 0) {
    L.warn("⚠️  No workload IDs provided - nothing to place");
    const deviceIds = await getActiveProviders();
    return {
      decisions: [],
      summary: {
        pendingWorkloadCount: 0,
        activeProviderCount: deviceIds.length,
        placedCount: 0,
        unplacedCount: 0,
        reason: "no_workloads",
      },
    };
  }
  
  L.log(`📊 Step 1: Fetching requirements for workload IDs: ${workloadIds.slice(0, 5).map(id => id.toString()).join(', ')}${workloadIds.length > 5 ? '...' : ''}`);
  const [allPending, deviceIds] = await Promise.all([
    readPendingWorkloadsWithRequirements(),
    getActiveProviders(),
  ]);
  
  const idSet = new Set(workloadIds.map((id) => id.toString()));
  const filtered = allPending.filter((p) => idSet.has(p.workloadId.toString()));
  
  L.success(`✅ Found ${filtered.length}/${workloadIds.length} pending workload(s) and ${deviceIds.length} active device(s)`);
  
  if (filtered.length === 0) {
    L.warn("⚠️  None of the specified workloads are pending (may already be placed or inactive)");
    return {
      decisions: [],
      summary: {
        pendingWorkloadCount: workloadIds.length,
        activeProviderCount: deviceIds.length,
        placedCount: 0,
        unplacedCount: workloadIds.length,
        reason: "no_workloads",
      },
    };
  }
  
  if (deviceIds.length === 0) {
    L.error("❌ No active providers available - cannot place workloads!");
    return {
      decisions: [],
      summary: {
        pendingWorkloadCount: filtered.length,
        activeProviderCount: 0,
        placedCount: 0,
        unplacedCount: filtered.length,
        reason: "no_providers",
      },
    };
  }
  
  L.log("\n📦 Step 2: Building provider capacity cache from IPFS metadata...");
  const capacityCache = await buildProviderCapacityCache(deviceIds, getProviderByDevice);
  
  if (capacityCache.size === 0) {
    L.error("❌ No providers with valid capacity and endpoint - cannot place workloads!");
    return {
      decisions: [],
      summary: {
        pendingWorkloadCount: filtered.length,
        activeProviderCount: deviceIds.length,
        placedCount: 0,
        unplacedCount: filtered.length,
        reason: "no_capacity",
      },
    };
  }
  
  L.log(`\n🎯 Step 3: Matching ${filtered.length} workload(s) to ${capacityCache.size} provider(s)...`);
  L.log("─────────────────────────────────────────────────────");
  L.info("📊 Capacity tracking enabled: Providers can handle multiple workloads");
  
  // Create a copy of capacity cache for tracking remaining capacity
  const remainingCapacityMap = new Map<string, { providerAddr: Address; capacity: ProviderCapacityAndEndpoint }>();
  capacityCache.forEach((value, key) => {
    remainingCapacityMap.set(key, {
      providerAddr: value.providerAddr,
      capacity: { ...value.capacity }, // Deep copy of capacity
    });
  });
  
  const decisions: PlacementDecision[] = [];
  const providerWorkloadCount = new Map<string, number>();
  
  for (let i = 0; i < filtered.length; i++) {
    const { workloadId, ownerAddress, requirements } = filtered[i];
    L.log(`\n[Workload ${i + 1}/${filtered.length}]`);
    const decision = matchOne(workloadId, ownerAddress, requirements, remainingCapacityMap, deviceIds);
    
    if (decision) {
      decisions.push(decision);
      
      // Find the deviceId for this provider
      let matchedDeviceId: string | null = null;
      for (const [deviceId, entry] of remainingCapacityMap.entries()) {
        if (entry.providerAddr.toLowerCase() === decision.provider.toLowerCase()) {
          matchedDeviceId = deviceId;
          break;
        }
      }
      
      if (matchedDeviceId) {
        const entry = remainingCapacityMap.get(matchedDeviceId)!;
        const providerShort = `${decision.provider.slice(0, 8)}...${decision.provider.slice(-6)}`;
        
        // Deduct workload requirements from provider's remaining capacity
        const beforeCpu = entry.capacity.cpu;
        const beforeRam = entry.capacity.memoryBytes;
        const beforeStorage = entry.capacity.storageBytes;
        const beforeGpu = entry.capacity.gpuCount;
        
        entry.capacity.cpu -= requirements.cpu;
        entry.capacity.memoryBytes -= requirements.memoryBytes;
        entry.capacity.storageBytes -= requirements.storageBytes;
        entry.capacity.gpuCount -= requirements.gpuCount;
        
        // Track workload count for this provider
        const currentCount = providerWorkloadCount.get(decision.provider.toLowerCase()) || 0;
        providerWorkloadCount.set(decision.provider.toLowerCase(), currentCount + 1);
        
        L.success(`  📉 Capacity deducted from provider ${providerShort}:`);
        L.log(`     CPU: ${beforeCpu} → ${entry.capacity.cpu} (used: ${requirements.cpu})`);
        L.log(`     RAM: ${beforeRam} → ${entry.capacity.memoryBytes} (used: ${requirements.memoryBytes})`);
        L.log(`     Storage: ${beforeStorage} → ${entry.capacity.storageBytes} (used: ${requirements.storageBytes})`);
        if (requirements.gpuCount > BigInt(0)) {
          L.log(`     GPU: ${beforeGpu} → ${entry.capacity.gpuCount} (used: ${requirements.gpuCount})`);
        }
        L.success(`     Total workloads on this provider: ${currentCount + 1}`);
        
        // Check if provider is now exhausted
        if (entry.capacity.cpu <= BigInt(0) || entry.capacity.memoryBytes <= BigInt(0) || entry.capacity.storageBytes <= BigInt(0)) {
          L.warn(`     ⚠️  Provider ${providerShort} is now at or near capacity limit`);
        }
      }
    }
  }
  
  const placedCount = decisions.length;
  const unplacedCount = filtered.length - placedCount;
  const reason: PlacementSummaryReason =
    placedCount === 0 && filtered.length > 0 ? "no_capacity" : "ok";
  
  L.log("\n═══════════════════════════════════════════════════");
  L.info("📈 PLACEMENT SUMMARY");
  L.log("═══════════════════════════════════════════════════");
  L.log(`  Requested workloads: ${workloadIds.length}`);
  L.log(`  Pending workloads:   ${filtered.length}`);
  L.log(`  Active providers:    ${deviceIds.length} devices (${capacityCache.size} with endpoint)`);
  L.log(`  Unique providers used: ${providerWorkloadCount.size}`);
  L.success(`  ✅ Placed:           ${placedCount}`);
  
  if (unplacedCount > 0) {
    L.warn(`  ⚠️  Unplaced:         ${unplacedCount}`);
  } else {
    L.log(`  Unplaced:            ${unplacedCount}`);
  }
  
  L.log(`  Reason:              ${reason}`);
  
  if (placedCount > 0) {
    L.success(`\n🎉 SUCCESS: ${placedCount} workload(s) matched to ${providerWorkloadCount.size} provider(s)!`);
    
    // Group by provider to show workload distribution
    const providerGroups = new Map<string, PlacementDecision[]>();
    decisions.forEach(d => {
      const key = d.provider.toLowerCase();
      if (!providerGroups.has(key)) providerGroups.set(key, []);
      providerGroups.get(key)!.push(d);
    });
    
    L.log(`\n📊 Workload Distribution per Provider:`);
    Array.from(providerGroups.entries()).forEach(([provider, workloads]) => {
      const providerShort = `${provider.slice(0, 8)}...${provider.slice(-6)}`;
      L.success(`  Provider ${providerShort}: ${workloads.length} workload(s)`);
      workloads.forEach((d, idx) => {
        const endpointShort = d.endpoint.slice(0, 40);
        L.log(`    ${idx + 1}. Workload ${d.workloadId} (instance ${d.instanceId}) @ ${endpointShort}...`);
      });
    });
    
    L.log(`\n📋 All Placements:`);
    decisions.forEach((d, idx) => {
      const providerShort = `${d.provider.slice(0, 8)}...${d.provider.slice(-6)}`;
      const endpointShort = d.endpoint.slice(0, 40);
      L.log(`  ${idx + 1}. Workload ${d.workloadId} → Provider ${providerShort} (instance ${d.instanceId})`);
    });
  } else if (filtered.length > 0) {
    L.error(`\n❌ FAILED: No suitable providers found for any workload`);
    if (reason === "no_capacity") {
      L.warn("  Possible reasons:");
      L.warn("    - Providers don't have enough CPU/RAM/Storage/GPU");
      L.warn("    - Providers missing endpoint URL in metadata");
      L.warn("    - No providers currently active");
      L.warn("    - Provider capacity already exhausted by previous workloads in this cycle");
    }
  }
  
  L.log("═══════════════════════════════════════════════════\n");
  
  return {
    decisions,
    summary: {
      pendingWorkloadCount: filtered.length,
      activeProviderCount: deviceIds.length,
      placedCount,
      unplacedCount,
      reason,
    },
  };
}
