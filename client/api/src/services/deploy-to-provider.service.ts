/**
 * Deploy workload to provider node (POST /deploy) before recording placement on-chain.
 * Orchestrator confirms the provider accepted and started execution before broadcasting recordPlacement.
 * Supports SDL templates (builds K8s manifest) and legacy manifest format.
 */
import type { PlacementDecision } from "./placement.service.js";
import { getWorkloadManifestByWorkloadId } from "./ipfs.service.js";
import { parseSDLFromMetadata, parseSDL } from "./sdl-parser.service.js";
import { buildK8sManifest } from "./k8s-builder.service.js";
import { log } from "../lib/logger.js";

const DEPLOY_TIMEOUT_MS = Number(process.env.ORCHESTRATOR_DEPLOY_TIMEOUT_MS ?? 15_000);
const L = log.orchestratorEvent;

/**
 * POST to provider's /deploy with workloadId, instanceId, manifest or k8sManifest.
 * If manifest is SDL template, builds K8s resources and sends k8sManifest.
 * Returns true only if the provider responds with 2xx (accepted and execution started).
 */
export async function deployToProvider(decision: PlacementDecision): Promise<boolean> {
  L.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  L.info(`🚀 DEPLOYING WORKLOAD TO PROVIDER`);
  L.info(`   Workload ID: ${decision.workloadId}`);
  L.info(`   Instance ID: ${decision.instanceId}`);
  L.info(`   Provider:    ${decision.provider}`);
  L.info(`   Endpoint:    ${decision.endpoint}`);
  L.info(`   Owner:       ${decision.ownerAddress}`);
  L.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  
  L.info(`📥 Step 1/5: Fetching workload manifest from IPFS...`);
  const startTime = Date.now();
  const manifestInfo = await getWorkloadManifestByWorkloadId(decision.workloadId);
  if (!manifestInfo) {
    L.error(`❌ FAILED: No manifest found for workloadId=${decision.workloadId}`);
    return false;
  }
  L.success(`✅ Manifest fetched successfully (${Date.now() - startTime}ms)`);

  const baseUrl = decision.endpoint.replace(/\/+$/, "");
  const deployUrl = `${baseUrl}/deploy`;
  L.info(`🎯 Target URL: ${deployUrl}`);

  L.info(`🔨 Step 2/5: Parsing manifest and building K8s resources...`);
  let body: Record<string, unknown>;

  // Try to parse as SDL and build K8s manifest
  const parsed = parseSDLFromMetadata(manifestInfo.manifest as Record<string, unknown>);
  if (parsed) {
    L.success(`✅ SDL format detected: ${parsed.services.length} service(s)`);
    parsed.services.forEach((svc, idx) => {
      L.info(`   Service ${idx + 1}: ${svc.name}`);
      L.info(`     - Image: ${svc.image}`);
      L.info(`     - CPU: ${svc.resources.cpu.units}m`);
      L.info(`     - Memory: ${svc.resources.memory.size}`);
      L.info(`     - Ports: ${svc.expose.map(e => e.port).join(', ') || 'none'}`);
    });
    
    const namespace = `cloudana-${decision.workloadId}-${decision.instanceId}`;
    L.info(`📦 Building K8s manifest for namespace: ${namespace}`);
    
    const buildStart = Date.now();
    const k8sManifest = buildK8sManifest(parsed, {
      namespace,
      workloadId: decision.workloadId.toString(),
      instanceId: decision.instanceId.toString(),
    });
    L.success(`✅ K8s manifest built: ${k8sManifest.resources.length} resource(s) (${Date.now() - buildStart}ms)`);
    
    k8sManifest.resources.forEach((res, idx) => {
      L.info(`   Resource ${idx + 1}: ${res.kind}/${res.metadata.name}`);
    });
    
    body = {
      workloadId: decision.workloadId.toString(),
      instanceId: decision.instanceId.toString(),
      k8sManifest,
      manifest: manifestInfo.manifest,
    };
  } else {
    // Legacy: check for sdl/manifest string in metadata
    L.warn(`⚠️  SDL parsing from metadata failed, trying legacy format...`);
    const sdlStr = (manifestInfo.manifest as Record<string, unknown>).sdl ?? (manifestInfo.manifest as Record<string, unknown>).manifest;
    L.info(`   SDL string type: ${typeof sdlStr}, length: ${typeof sdlStr === 'string' ? sdlStr.length : 'N/A'}`);
    
    if (typeof sdlStr === "string" && sdlStr.trim()) {
      try {
        L.info(`   Attempting to parse SDL string directly...`);
        const parsedSdl = parseSDL(sdlStr);
        const namespace = `workload-${decision.workloadId}-${decision.instanceId}`;
        
        L.info(`   Building K8s manifest for namespace: ${namespace}`);
        const k8sManifest = buildK8sManifest(parsedSdl, {
          namespace,
          workloadId: decision.workloadId.toString(),
          instanceId: decision.instanceId.toString(),
        });
        body = {
          workloadId: decision.workloadId.toString(),
          instanceId: decision.instanceId.toString(),
          k8sManifest,
          manifest: manifestInfo.manifest,
        };
        L.success(`✅ Parsed sdl string, using K8s manifest (${k8sManifest.resources.length} resources)`);
      } catch (e) {
        L.error(`❌ Failed to parse SDL string: ${e instanceof Error ? e.message : e}`);
        L.warn(`⚠️  Falling back to raw manifest format (may fail on provider)`);
        body = {
          workloadId: decision.workloadId.toString(),
          instanceId: decision.instanceId.toString(),
          manifest: manifestInfo.manifest,
        };
      }
    } else {
      L.warn(`⚠️  No SDL string found in manifest`);
      L.info(`   Manifest keys: ${Object.keys(manifestInfo.manifest as object).join(', ')}`);
      body = {
        workloadId: decision.workloadId.toString(),
        instanceId: decision.instanceId.toString(),
        manifest: manifestInfo.manifest,
      };
    }
  }

  L.info(`📡 Step 3/5: Sending deployment request to provider...`);
  L.info(`   Timeout: ${DEPLOY_TIMEOUT_MS}ms`);
  L.info(`   Payload size: ${JSON.stringify(body).length} bytes`);
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEPLOY_TIMEOUT_MS);
    const requestStart = Date.now();
    
    const res = await fetch(deployUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const requestDuration = Date.now() - requestStart;

    L.info(`📨 Step 4/5: Received response from provider (${requestDuration}ms)`);
    L.info(`   Status: ${res.status} ${res.statusText}`);

    if (!res.ok) {
      const text = await res.text();
      L.error(`❌ DEPLOYMENT FAILED!`);
      L.error(`   HTTP Status: ${res.status}`);
      L.error(`   Response: ${text.slice(0, 500)}`);
      return false;
    }

    const data = (await res.json()) as { status?: string; message?: string };
    L.info(`   Response: ${JSON.stringify(data)}`);
    
    if (data.status !== "success" && data.status !== "ok") {
      L.warn(`⚠️  Unexpected response status: ${data.status}`);
      if (data.message) L.warn(`   Message: ${data.message}`);
    }
    
    L.success(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    L.success(`✅ Step 5/5: DEPLOYMENT SUCCESSFUL!`);
    L.success(`   Workload ${decision.workloadId}/${decision.instanceId} deployed to provider`);
    L.success(`   Total time: ${Date.now() - startTime}ms`);
    L.success(`   Provider will now create K8s resources and start containers...`);
    L.success(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    return true;
  } catch (e) {
    L.error(`❌ DEPLOYMENT ERROR!`);
    L.error(`   Workload: ${decision.workloadId}/${decision.instanceId}`);
    L.error(`   URL: ${deployUrl}`);
    L.error(`   Error: ${e instanceof Error ? e.message : String(e)}`);
    if (e instanceof Error && e.stack) {
      L.error(`   Stack: ${e.stack.split('\n').slice(0, 3).join('\n')}`);
    }
    return false;
  }
}
