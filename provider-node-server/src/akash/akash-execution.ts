/**
 * Akash execution mode for the Cloudana provider node.
 *
 * Triggered when a deploy request manifest specifies:
 *   - `executionMode: "akash"`, OR
 *   - The provider node environment has AKASH_EXECUTION_MODE=true set
 *
 * Full Akash deployment lifecycle:
 *   1. Validate & convert manifest → SDL
 *   2. Create deployment on-chain
 *   3. Wait for provider bids
 *   4. Accept best bid → create lease
 *   5. Send manifest to provider
 *   6. Return lease info + endpoints
 *
 * The result is stored alongside the instance for subsequent status/endpoint polling.
 */

import { loggers } from "../logger.js";
import {
  createAkashClientFromEnv,
  type AkashLeaseInfo,
  type AkashDeploymentId,
  type AkashBid,
  type AkashEndpoint,
} from "./akash-client.js";
import {
  convertToSDL,
  validateWorkload,
  type CloudanaWorkload,
} from "./sdl-converter.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Resolved from an incoming Cloudana deploy manifest */
export interface CloudanaManifest {
  /** Explicit execution mode */
  executionMode?: string;
  /** Docker image (used for non-akash modes too) */
  image?: string;
  /** Workload name */
  name?: string;
  /** CPU requirements (units / millicores) */
  cpu?: { units?: number };
  /** Memory requirements */
  memory?: { size?: string };
  /** Storage requirements */
  storage?: Array<{ size?: string; class?: string; mount?: string }>;
  /** GPU requirements */
  gpu?: { units?: number; vendor?: "nvidia" | "amd"; model?: string };
  /** Port exposures */
  ports?: Array<{ port: number; as?: number; global?: boolean; proto?: string }>;
  /** Environment variables */
  env?: Record<string, string>;
  /** Command override */
  command?: string[];
  /** Additional args */
  args?: string[];
  /** Number of replicas */
  replicas?: number;
  /** Provider placement preferences */
  placement?: {
    name?: string;
    attributes?: Record<string, string>;
    signedBy?: string[];
  };
  /** Maximum price per block in uakt */
  maxPriceUakt?: number;
  [key: string]: unknown;
}

export interface AkashExecutionResult {
  success: boolean;
  executionMode: "akash";
  workloadId: string;
  instanceId: string;
  /** Populated on success */
  deploymentId?: AkashDeploymentId;
  lease?: AkashLeaseInfo;
  endpoints?: AkashEndpoint[];
  sdlYaml?: string;
  /** Populated on failure */
  error?: string;
  /** Duration of the deployment process in ms */
  durationMs: number;
}

/** State stored per Akash-deployed instance for status polling */
export interface AkashInstanceState {
  deploymentId: AkashDeploymentId;
  lease: AkashLeaseInfo;
  sdlYaml: string;
  endpoints: AkashEndpoint[];
  deployedAt: number;
  status: "pending" | "active" | "closed" | "failed";
}

// ─── Detection ────────────────────────────────────────────────────────────────

/**
 * Detect whether a manifest should be executed via Akash.
 *
 * Returns true if:
 * - manifest.executionMode === "akash"
 * - OR provider env AKASH_EXECUTION_MODE=true is set AND manifest has an image
 */
export function isAkashManifest(manifest: unknown): boolean {
  if (!manifest || typeof manifest !== "object") return false;
  const m = manifest as CloudanaManifest;

  if (m.executionMode === "akash") return true;

  if (process.env.AKASH_EXECUTION_MODE === "true" && m.image) {
    loggers.server.debug(
      { image: m.image },
      "AKASH_EXECUTION_MODE=true — routing workload to Akash"
    );
    return true;
  }

  return false;
}

// ─── Conversion ───────────────────────────────────────────────────────────────

/**
 * Adapt a raw CloudanaManifest to a CloudanaWorkload (SDL converter input).
 * Fills in defaults for missing fields.
 */
function manifestToWorkload(manifest: CloudanaManifest): CloudanaWorkload {
  if (!manifest.image) {
    throw new Error("Manifest must include an 'image' field for Akash execution");
  }

  const workload: CloudanaWorkload = {
    name: manifest.name,
    image: manifest.image,
    command: manifest.command,
    args: manifest.args,
    env: manifest.env,
    replicas: manifest.replicas,
    maxPriceUakt: manifest.maxPriceUakt,
  };

  if (manifest.cpu?.units !== undefined) {
    workload.cpu = { units: manifest.cpu.units };
  }

  if (manifest.memory?.size) {
    workload.memory = { size: manifest.memory.size };
  }

  if (manifest.storage?.length) {
    workload.storage = manifest.storage.map((s) => ({
      size: s.size ?? "1Gi",
      class: (s.class as "default" | "beta1" | "beta2" | "beta3" | undefined),
      mount: s.mount,
    }));
  }

  if (manifest.gpu?.units !== undefined && manifest.gpu.units > 0) {
    workload.gpu = {
      units: manifest.gpu.units,
      vendor: manifest.gpu.vendor,
      model: manifest.gpu.model,
    };
  }

  if (manifest.ports?.length) {
    workload.ports = manifest.ports.map((p) => ({
      port: p.port,
      as: p.as,
      global: p.global,
      proto: p.proto as "TCP" | "UDP" | "http" | "https" | undefined,
    }));
  }

  if (manifest.placement) {
    workload.placement = {
      name: manifest.placement.name,
      attributes: manifest.placement.attributes,
      signedBy: manifest.placement.signedBy,
    };
  }

  return workload;
}

// ─── Main Execution ───────────────────────────────────────────────────────────

/**
 * Execute a Cloudana workload on the Akash Network.
 *
 * This is the main entry point called by the provider node's deploy handler
 * when `isAkashManifest()` returns true.
 *
 * @param workloadId - Cloudana workload ID
 * @param instanceId - Cloudana instance ID
 * @param manifest   - The deploy manifest from the orchestrator
 * @returns Execution result with lease info and endpoints
 */
export async function executeAkashWorkload(
  workloadId: string,
  instanceId: string,
  manifest: unknown
): Promise<AkashExecutionResult> {
  const startTime = Date.now();

  loggers.server.info(
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  );
  loggers.server.info(`🌐 AKASH DEPLOYMENT STARTED`);
  loggers.server.info(`   Workload ID: ${workloadId}`);
  loggers.server.info(`   Instance ID: ${instanceId}`);

  const baseResult: Omit<AkashExecutionResult, "durationMs"> = {
    success: false,
    executionMode: "akash",
    workloadId,
    instanceId,
  };

  try {
    // ── Step 1: Validate & convert manifest ────────────────────────────────

    loggers.server.info("📋 Step 1/6: Validating & converting manifest to SDL...");

    const cloudanaManifest = manifest as CloudanaManifest;
    const workload = manifestToWorkload(cloudanaManifest);

    const validationErrors = validateWorkload(workload);
    if (validationErrors.length > 0) {
      throw new Error(`Manifest validation failed: ${validationErrors.join("; ")}`);
    }

    const { sdlYaml, serviceName, summary } = convertToSDL(workload);

    loggers.server.info(`   ✅ SDL generated (service: ${serviceName})`);
    loggers.server.info(`   Image: ${summary.image}`);
    loggers.server.info(`   CPU: ${summary.cpu}, Memory: ${summary.memory}, Storage: ${summary.storage}`);
    if (summary.gpu) loggers.server.info(`   GPU: ${summary.gpu}`);
    loggers.server.info(`   Ports: ${summary.ports.join(", ") || "none"}`);
    loggers.server.info(`   Max price: ${summary.estimatedPriceUakt} uakt/block`);

    // ── Step 2: Initialize Akash client ───────────────────────────────────

    loggers.server.info("🔑 Step 2/6: Initializing Akash client...");
    const client = await createAkashClientFromEnv();
    loggers.server.info(`   ✅ Wallet address: ${client.address}`);

    // ── Step 3: Create deployment ─────────────────────────────────────────

    loggers.server.info("📤 Step 3/6: Creating deployment on Akash Network...");
    const deploymentId = await client.createDeployment(sdlYaml);
    loggers.server.info(`   ✅ Deployment created (dseq: ${deploymentId.dseq})`);
    loggers.server.info(`   Owner: ${deploymentId.owner}`);

    // ── Step 4: Wait for bids ─────────────────────────────────────────────

    loggers.server.info("⏳ Step 4/6: Waiting for provider bids...");
    const bids = await client.waitForBids(deploymentId);
    loggers.server.info(`   ✅ Received ${bids.length} bid(s)`);

    bids.forEach((bid, i) => {
      loggers.server.info(
        `   Bid ${i + 1}: provider=${bid.id.provider.slice(0, 16)}... price=${bid.price.amount} ${bid.price.denom}`
      );
    });

    // ── Step 5: Accept best bid (create lease) ────────────────────────────

    loggers.server.info("🤝 Step 5/6: Accepting best bid & creating lease...");
    const bestBid = client.selectBestBid(bids);
    loggers.server.info(
      `   Best bid: ${bestBid.id.provider.slice(0, 16)}... @ ${bestBid.price.amount} uakt/block`
    );

    const lease = await client.acceptBid(bestBid);
    loggers.server.info(`   ✅ Lease created`);
    loggers.server.info(`   Provider: ${lease.leaseId.provider}`);
    loggers.server.info(`   Provider URL: ${lease.providerUrl}`);

    // ── Step 6: Send manifest ─────────────────────────────────────────────

    loggers.server.info("📦 Step 6/6: Sending manifest to provider...");
    await client.sendManifest(lease, sdlYaml);
    loggers.server.info("   ✅ Manifest delivered to provider");

    // ── Fetch initial endpoints ────────────────────────────────────────────

    const endpoints = await client.getLeaseEndpoints(lease);
    if (endpoints.length > 0) {
      loggers.server.info(`   Endpoints:`);
      endpoints.forEach((ep) => {
        loggers.server.info(`     ${ep.name}: ${ep.host}:${ep.externalPort} (${ep.proto})`);
      });
    } else {
      loggers.server.info("   (No forwarded ports — workload may use internal networking only)");
    }

    const durationMs = Date.now() - startTime;

    loggers.server.info(
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    );
    loggers.server.info(`✅ AKASH DEPLOYMENT COMPLETE`);
    loggers.server.info(`   Workload: ${workloadId}/${instanceId}`);
    loggers.server.info(`   dseq: ${deploymentId.dseq}`);
    loggers.server.info(`   Provider: ${lease.leaseId.provider}`);
    loggers.server.info(`   Duration: ${durationMs}ms`);
    loggers.server.info(
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    );

    return {
      ...baseResult,
      success: true,
      deploymentId,
      lease,
      endpoints,
      sdlYaml,
      durationMs,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const durationMs = Date.now() - startTime;

    loggers.server.error(
      { workloadId, instanceId, error: errorMessage, durationMs },
      "Akash deployment failed"
    );
    loggers.server.info(
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    );
    loggers.server.error(`❌ AKASH DEPLOYMENT FAILED`);
    loggers.server.error(`   Workload: ${workloadId}/${instanceId}`);
    loggers.server.error(`   Error: ${errorMessage}`);
    loggers.server.error(`   Duration: ${durationMs}ms`);
    loggers.server.info(
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    );

    return {
      ...baseResult,
      success: false,
      error: errorMessage,
      durationMs,
    };
  }
}

// ─── Lifecycle Helpers ────────────────────────────────────────────────────────

/**
 * Poll the status of an Akash deployment and update endpoints.
 * Called periodically by the provider node to refresh deployment state.
 *
 * @param state - Stored Akash instance state
 * @returns Updated state
 */
export async function refreshAkashInstanceState(
  state: AkashInstanceState
): Promise<AkashInstanceState> {
  try {
    const client = await createAkashClientFromEnv();
    const [status, endpoints] = await Promise.all([
      client.getDeploymentStatus(state.deploymentId),
      client.getLeaseEndpoints(state.lease),
    ]);

    const akashState = status.state;
    let instanceStatus: AkashInstanceState["status"] = state.status;

    if (akashState === "active") instanceStatus = "active";
    else if (akashState === "closed") instanceStatus = "closed";
    else if (akashState === "failed" || akashState === "insufficient_funds") instanceStatus = "failed";

    return {
      ...state,
      endpoints: endpoints.length > 0 ? endpoints : state.endpoints,
      status: instanceStatus,
    };
  } catch (err) {
    loggers.server.warn(
      { dseq: state.deploymentId.dseq, error: String(err) },
      "Failed to refresh Akash instance state"
    );
    return state;
  }
}

/**
 * Terminate an Akash deployment, releasing resources and reclaiming escrow.
 *
 * @param state - Stored Akash instance state
 */
export async function terminateAkashDeployment(
  state: AkashInstanceState
): Promise<{ success: boolean; error?: string }> {
  try {
    const client = await createAkashClientFromEnv();
    await client.closeDeployment(state.deploymentId);

    loggers.server.info(
      { dseq: state.deploymentId.dseq },
      "Akash deployment terminated"
    );

    return { success: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    loggers.server.error(
      { dseq: state.deploymentId.dseq, error },
      "Failed to terminate Akash deployment"
    );
    return { success: false, error };
  }
}

// ─── Index re-exports ─────────────────────────────────────────────────────────

export type { CloudanaWorkload } from "./sdl-converter.js";
export { convertToSDL, validateWorkload, buildWebServiceSDL, buildGpuWorkloadSDL } from "./sdl-converter.js";
export { AkashClient, createAkashClientFromEnv } from "./akash-client.js";
