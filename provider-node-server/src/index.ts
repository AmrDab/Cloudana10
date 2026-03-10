/**
 * Cloudana Provider Node — runs on each provider node.
 * Only this service executes workloads (K8s, Docker, or script) and reports status.
 *
 * Execution is controlled by the orchestrator:
 * - POST /deploy — orchestrator sends workloadId, instanceId, manifest; this node executes it.
 * - GET /status — orchestrator polls to check instance status.
 * - GET /device-info — provides hardware specs for provider registration.
 */
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { spawn, exec, execSync } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { hostname, cpus, totalmem, freemem, platform } from "node:os";
import {
  loggers,
  logWorkloadStart,
  logWorkloadSuccess,
  logWorkloadError,
  logDockerOperation,
  logDeviceInfo,
  logStartup,
} from "./logger.js";
import { loggingMiddleware, errorMiddleware, getRequestId } from "./middleware.js";
import { getLogEntries, getLogStats } from "./log-buffer.js";
import { rateLimiter, deployRateLimiter } from "./middleware/rate-limiter.js";
import { securityHeaders, requestSizeLimit, requireApiKey, isValidId } from "./middleware/security.js";
import { withK8sRetry } from "./lib/retry.js";
import {
  recordWorkloadStart,
  recordWorkloadComplete,
  handleHealthCheck,
  handleMetrics,
  startMetricsLogging,
} from "./health.js";
import { runPreStartValidation } from "./prestart-check.js";

const execAsync = promisify(exec);

/** Unique device id (bytes32) derived from machine-id + hostname. Used for on-chain provider registration. */
function getDeviceId(): string {
  let machineId = "";
  try {
    if (existsSync("/etc/machine-id")) {
      machineId = readFileSync("/etc/machine-id", "utf8").trim();
    } else if (existsSync("/var/lib/dbus/machine-id")) {
      machineId = readFileSync("/var/lib/dbus/machine-id", "utf8").trim();
    }
  } catch {
    // ignore
  }
  const raw = `${machineId || "unknown"}-${hostname()}-cloudana`;
  const hash = createHash("sha256").update(raw, "utf8").digest("hex");
  return `0x${hash}`;
}

const DEVICE_ID = getDeviceId();

// Run pre-start validation (enforces external deployment)
await runPreStartValidation();

const app = new Hono();
app.use("*", securityHeaders);
app.use("*", rateLimiter());
app.use("*", requestSizeLimit(10 * 1024 * 1024));
app.use("*", cors({ origin: "*" }));
app.use("*", errorMiddleware);
app.use("*", loggingMiddleware);

type InstanceStatus = "pending" | "running" | "failed" | "terminated";
interface InstanceData {
  workloadId: string;
  instanceId: string;
  status: InstanceStatus;
  manifest?: unknown;
  namespace?: string;
  deployedAt?: number;
}
const instances = new Map<string, InstanceData>();

/**
 * Execute workload on this provider node.
 * 
 * DEPLOYMENT ARCHITECTURE:
 * This function runs in the provider node process (external to K8s), not inside K8s pods.
 * The provider node manages one or more K8s clusters via kubectl/API, similar to how
 * Akash providers work. This provides:
 * - Security isolation between provider control plane and tenant workloads
 * - Multi-cluster management capability
 * - Clear trust boundaries
 * 
 * Execution modes (in order of preference):
 * 1. Kubernetes API: Applies K8s manifests via client-node library (requires K8s access)
 * 2. kubectl CLI: Executes raw YAML via kubectl command (fallback for complex manifests)
 * 3. Docker: Runs containers via docker run (for non-K8s providers)
 * 4. Placeholder: Dummy execution for MVP testing
 */
async function executeWorkload(
  workloadId: string,
  instanceId: string,
  manifest: unknown,
  k8sManifest?: { namespace: string; resources: unknown[] }
): Promise<"running" | "failed"> {
  const instanceKey = `${workloadId}-${instanceId}`;
  const executionStartTime = Date.now();

  loggers.workload.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  loggers.workload.info(`🚀 PROVIDER RECEIVED WORKLOAD DEPLOYMENT`);
  loggers.workload.info(`   Workload ID: ${workloadId}`);
  loggers.workload.info(`   Instance ID: ${instanceId}`);
  loggers.workload.info(`   Has K8s Manifest: ${!!k8sManifest}`);
  if (k8sManifest) {
    loggers.workload.info(`   Namespace: ${k8sManifest.namespace}`);
    loggers.workload.info(`   Resources: ${k8sManifest.resources?.length || 0}`);
  }
  loggers.workload.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  logWorkloadStart({
    workloadId,
    instanceId,
    manifest,
    k8sManifest,
  });

  // Record metrics
  recordWorkloadStart();

  try {
    // 1. K8s manifest from orchestrator (SDL template)
    if (k8sManifest && k8sManifest.resources && k8sManifest.resources.length > 0) {
      loggers.workload.info(`📦 Phase 1/4: Preparing Kubernetes deployment...`);
      loggers.workload.info(`   Target namespace: ${k8sManifest.namespace}`);
      loggers.workload.info(`   Resources to create: ${k8sManifest.resources.length}`);
      
      const { applyK8sManifest, isK8sAvailable } = await import("./k8s-client.js");
      
      loggers.workload.info(`🔍 Phase 2/4: Checking Kubernetes availability...`);
      if (isK8sAvailable()) {
        loggers.workload.info(`✅ Kubernetes API is available`);
        loggers.workload.info(`🔨 Phase 3/4: Creating Kubernetes resources (with retry logic)...`);
        
        const applyStartTime = Date.now();
        const applyResult = await withK8sRetry(
          async () => {
            return await applyK8sManifest({
              namespace: k8sManifest.namespace,
              resources: k8sManifest.resources as import("./k8s-client.js").K8sResource[],
            });
          },
          { 
            operation: "apply-manifest", 
            resource: `${workloadId}/${instanceId}` 
          }
        );
        const applyDuration = Date.now() - applyStartTime;
        
        if (applyResult.success) {
          loggers.workload.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
          loggers.workload.info(`✅ Phase 4/4: WORKLOAD DEPLOYED SUCCESSFULLY!`);
          loggers.workload.info(`   Resources applied: ${k8sManifest.resources.length}`);
          loggers.workload.info(`   Namespace: ${k8sManifest.namespace}`);
          loggers.workload.info(`   Apply time: ${applyDuration}ms`);
          loggers.workload.info(`   Total time: ${Date.now() - executionStartTime}ms`);
          loggers.workload.info(`   ⏳ Kubernetes will now pull images and start containers...`);
          loggers.workload.info(`   📊 Monitor with: kubectl get all -n ${k8sManifest.namespace}`);
          loggers.workload.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
          
          logWorkloadSuccess({
            workloadId,
            instanceId,
            executionMode: "k8s-api",
            duration: Date.now() - executionStartTime,
            details: `Applied ${k8sManifest.resources.length} resources in namespace ${k8sManifest.namespace}`,
          });
          recordWorkloadComplete(true);
          return "running";
        }
        
        loggers.workload.error(`❌ KUBERNETES DEPLOYMENT FAILED!`);
        loggers.workload.error(`   Error: ${applyResult.error || "Unknown K8s error"}`);
        loggers.workload.error(`   Duration: ${applyDuration}ms`);
        if (applyResult.failedResources && applyResult.failedResources.length > 0) {
          loggers.workload.error(`   Failed resources: ${applyResult.failedResources.length}`);
          applyResult.failedResources.slice(0, 3).forEach((failedResource: any) => {
            loggers.workload.error(`     - ${failedResource.kind}/${failedResource.metadata?.name}: ${failedResource.error}`);
          });
        }
        
        logWorkloadError({
          workloadId,
          instanceId,
          error: applyResult.error || "Unknown K8s error",
          executionMode: "k8s-api",
          phase: "apply",
        });
        recordWorkloadComplete(false);
        return "failed";
      }
      loggers.workload.warn(`⚠️  Kubernetes not available on this provider`);
      loggers.workload.warn("K8s manifest received but K8s not available, falling back to other execution modes");
    }

    // Parse manifest for fallback execution modes
    loggers.workload.info(`🔍 Inspecting manifest for fallback execution modes...`);
    const manifestData = manifest as Record<string, unknown> | undefined;
    const rawYaml = typeof manifestData?.raw === "string" ? manifestData.raw : null;
    const image = typeof manifestData?.image === "string" ? manifestData.image : null;
    const command = Array.isArray(manifestData?.command) ? (manifestData.command as string[]) : null;

    loggers.workload.info(`   Raw YAML: ${rawYaml ? 'Present' : 'Not found'}`);
    loggers.workload.info(`   Docker image: ${image || 'Not found'}`);
    loggers.workload.info(`   Command: ${command ? command.join(' ') : 'Not found'}`);

    // 2. Raw kubectl YAML
    if (rawYaml && rawYaml.includes("kind:") && rawYaml.includes("apiVersion:")) {
      loggers.workload.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      loggers.workload.info(`📜 MODE 2: KUBECTL CLI EXECUTION`);
      loggers.workload.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      
      const { writeFileSync, unlinkSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");
      const tmpFile = join(tmpdir(), `workload-${workloadId}-${instanceId}.yaml`);
      
      const yamlLines = rawYaml.split('\n').length;
      const yamlSize = Buffer.byteLength(rawYaml, 'utf8');
      
      loggers.workload.info(`📝 Step 1/3: Writing YAML to temporary file`);
      loggers.workload.info(`   File path: ${tmpFile}`);
      loggers.workload.info(`   YAML lines: ${yamlLines}`);
      loggers.workload.info(`   YAML size: ${yamlSize} bytes`);
      
      writeFileSync(tmpFile, rawYaml, "utf8");
      loggers.workload.info(`   ✅ File written successfully`);
      
      try {        
        const kubectlCommand = `kubectl apply -f ${tmpFile}`;
        loggers.workload.info(`🔨 Step 2/3: Executing kubectl command`);
        loggers.workload.info(`   Command: ${kubectlCommand}`);
        
        const kubectlStartTime = Date.now();
        const kubectlResult = await execAsync(kubectlCommand);
        const kubectlDuration = Date.now() - kubectlStartTime;
        
        loggers.workload.info(`✅ Step 3/3: kubectl execution successful`);
        loggers.workload.info(`   Duration: ${kubectlDuration}ms`);
        if (kubectlResult.stdout) {
          loggers.workload.info(`   kubectl output:`);
          kubectlResult.stdout.split('\n').forEach(outputLine => {
            if (outputLine.trim()) loggers.workload.info(`     ${outputLine}`);
          });
        }
        
        loggers.workload.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        loggers.workload.info(`✅ WORKLOAD DEPLOYED VIA KUBECTL`);
        loggers.workload.info(`   Total time: ${Date.now() - executionStartTime}ms`);
        loggers.workload.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        
        logWorkloadSuccess({
          workloadId,
          instanceId,
          executionMode: "kubectl",
          duration: Date.now() - executionStartTime,
          details: `Applied YAML via kubectl CLI (${yamlLines} lines)`,
        });
        recordWorkloadComplete(true);
        return "running";
      } catch (error) {
        const kubectlError = error as any;
        loggers.workload.error(`❌ kubectl execution failed`);
        loggers.workload.error(`   Error: ${kubectlError.message || String(error)}`);
        if (kubectlError.stderr) {
          loggers.workload.error(`   kubectl stderr:`);
          kubectlError.stderr.split('\n').forEach((errorLine: string) => {
            if (errorLine.trim()) loggers.workload.error(`     ${errorLine}`);
          });
        }
        
        logWorkloadError({
          workloadId,
          instanceId,
          error: error instanceof Error ? error : String(error),
          executionMode: "kubectl",
          phase: "apply",
        });
        recordWorkloadComplete(false);
        return "failed";
      } finally {
        try {
          unlinkSync(tmpFile);
          loggers.workload.info(`🗑️  Cleaned up temporary YAML file: ${tmpFile}`);
        } catch {
          /* ignore cleanup errors */
        }
      }
    }

    // 3. Docker run
    if (image) {
      loggers.workload.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      loggers.workload.info(`🐳 MODE 3: DOCKER CONTAINER EXECUTION`);
      loggers.workload.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      
      const dockerCommand = command?.length ? command.join(" ") : "";
      const containerName = `workload-${workloadId}-${instanceId}`;
      const dockerRunCommand = `docker run -d --name ${containerName} ${image} ${dockerCommand}`.trim();
      
      loggers.workload.info(`📋 Step 1/4: Preparing Docker container`);
      loggers.workload.info(`   Image: ${image}`);
      loggers.workload.info(`   Container name: ${containerName}`);
      if (dockerCommand) {
        loggers.workload.info(`   Command: ${dockerCommand}`);
      } else {
        loggers.workload.info(`   Command: (using image default)`);
      }
      
      try {
        loggers.workload.info(`🔍 Step 2/4: Checking for image locally`);
        try {
          const imageInspectResult = await execAsync(`docker inspect ${image}`);
          loggers.workload.info(`   ✅ Image found locally`);
        } catch {
          loggers.workload.info(`   ⚠️  Image not found locally, Docker will pull it`);
        }
        
        loggers.workload.info(`🚀 Step 3/4: Starting container`);
        loggers.workload.info(`   Executing: ${dockerRunCommand}`);
        
        const dockerStartTime = Date.now();
        const dockerRunResult = await execAsync(dockerRunCommand);
        const dockerDuration = Date.now() - dockerStartTime;
        const containerId = dockerRunResult.stdout.trim();
        
        loggers.workload.info(`✅ Step 4/4: Container started successfully`);
        loggers.workload.info(`   Container ID: ${containerId}`);
        loggers.workload.info(`   Short ID: ${containerId.slice(0, 12)}`);
        loggers.workload.info(`   Start time: ${dockerDuration}ms`);
        
        // Get container status
        try {
          const containerStatusResult = await execAsync(`docker inspect --format='{{.State.Status}}' ${containerId}`);
          const containerStatus = containerStatusResult.stdout.trim();
          loggers.workload.info(`   Status: ${containerStatus}`);
        } catch {
          // Ignore status check errors
        }
        
        loggers.workload.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        loggers.workload.info(`✅ WORKLOAD DEPLOYED VIA DOCKER`);
        loggers.workload.info(`   Container ID: ${containerId.slice(0, 12)}`);
        loggers.workload.info(`   Total time: ${Date.now() - executionStartTime}ms`);
        loggers.workload.info(`   📊 Monitor: docker logs ${containerId.slice(0, 12)}`);
        loggers.workload.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        
        logDockerOperation({
          action: "run",
          workloadId,
          instanceId,
          image,
          command: dockerCommand,
          containerId,
          success: true,
        });
        logWorkloadSuccess({
          workloadId,
          instanceId,
          executionMode: "docker",
          duration: Date.now() - executionStartTime,
          details: `Started Docker container: ${containerId.slice(0, 12)}`,
        });
        recordWorkloadComplete(true);
        return "running";
      } catch (error) {
        const dockerError = error as any;
        loggers.workload.error(`❌ Docker container start failed`);
        loggers.workload.error(`   Error: ${dockerError.message || String(error)}`);
        if (dockerError.stderr) {
          loggers.workload.error(`   Docker stderr:`);
          dockerError.stderr.split('\n').forEach((errorLine: string) => {
            if (errorLine.trim()) loggers.workload.error(`     ${errorLine}`);
          });
        }
        
        logDockerOperation({
          action: "run",
          workloadId,
          instanceId,
          image,
          command: dockerCommand,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
        logWorkloadError({
          workloadId,
          instanceId,
          error: error instanceof Error ? error : String(error),
          executionMode: "docker",
          phase: "run",
        });
        recordWorkloadComplete(false);
        return "failed";
      }
    }

    // 4. MVP placeholder
    loggers.workload.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    loggers.workload.info(`🧪 MODE 4: PLACEHOLDER EXECUTION (MVP TESTING)`);
    loggers.workload.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    loggers.workload.warn(`⚠️  No K8s manifest, kubectl YAML, or Docker image found`);
    loggers.workload.warn(`⚠️  Using placeholder execution for testing purposes`);
    
    loggers.workload.info(`🎯 Step 1/2: Running placeholder shell command`);
    const shellCmd = process.platform === "win32" 
      ? "echo Cloudana workload executed && exit 0"
      : "echo 'Cloudana workload executed' && sleep 1 && exit 0";
    loggers.workload.info(`   Platform: ${process.platform}`);
    loggers.workload.info(`   Command: ${shellCmd}`);
    
    const placeholderStartTime = Date.now();
    await new Promise<void>((resolve, reject) => {
      const placeholderProcess = spawn(
        process.platform === "win32" ? "cmd" : "sh",
        process.platform === "win32"
          ? ["/c", "echo Cloudana workload executed && exit 0"]
          : ["-c", "echo 'Cloudana workload executed' && sleep 1 && exit 0"],
        { stdio: "pipe" }
      );
      
      let standardOutput = "";
      let standardError = "";
      
      placeholderProcess.stdout?.on('data', (data) => {
        standardOutput += data.toString();
      });
      
      placeholderProcess.stderr?.on('data', (data) => {
        standardError += data.toString();
      });
      
      placeholderProcess.on("error", reject);
      placeholderProcess.on("close", (exitCode) => {
        if (standardOutput) {
          loggers.workload.info(`   Shell output: ${standardOutput.trim()}`);
        }
        if (standardError) {
          loggers.workload.warn(`   Shell stderr: ${standardError.trim()}`);
        }
        exitCode === 0 ? resolve() : reject(new Error(`exit ${exitCode}`));
      });
    });
    const placeholderDuration = Date.now() - placeholderStartTime;
    
    loggers.workload.info(`✅ Step 2/2: Placeholder execution completed`);
    loggers.workload.info(`   Duration: ${placeholderDuration}ms`);
    
    loggers.workload.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    loggers.workload.info(`✅ WORKLOAD "DEPLOYED" VIA PLACEHOLDER`);
    loggers.workload.info(`   Total time: ${Date.now() - executionStartTime}ms`);
    loggers.workload.warn(`   ⚠️  This is for testing only - no actual workload running`);
    loggers.workload.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    
    logWorkloadSuccess({
      workloadId,
      instanceId,
      executionMode: "placeholder",
      duration: Date.now() - executionStartTime,
      details: "Placeholder execution for MVP testing",
    });
    recordWorkloadComplete(true);
    
    return "running";
  } catch (error) {
    logWorkloadError({
      workloadId,
      instanceId,
      error: error instanceof Error ? error : String(error),
    });
    recordWorkloadComplete(false);
    return "failed";
  }
}

// POST /deploy — orchestrator sends deploy request; provider node executes the workload
app.post("/deploy", deployRateLimiter(), async (c) => {
  const requestId = getRequestId(c);
  
  try {
    loggers.http.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    loggers.http.info(`📥 RECEIVED DEPLOY REQUEST FROM ORCHESTRATOR`);
    loggers.http.info(`   Request ID: ${requestId}`);
    
    const deployRequestBody = await c.req.json<{
      workloadId: string;
      instanceId: string;
      manifest?: unknown;
      k8sManifest?: { namespace: string; resources: unknown[] };
    }>();
    const { workloadId, instanceId, manifest, k8sManifest } = deployRequestBody;
    
    loggers.http.info(`   Workload ID: ${workloadId}`);
    loggers.http.info(`   Instance ID: ${instanceId}`);
    
    if (!workloadId || !instanceId) {
      loggers.http.warn(
        { requestId, workloadId, instanceId },
        "Deploy request rejected: missing workloadId or instanceId"
      );
      return c.json({ status: "error", message: "workloadId and instanceId required" }, 400);
    }
    
    // Log manifest details
    loggers.http.info(`📄 Step 1/3: Analyzing received manifest...`);
    if (manifest) {
      const manifestObject = manifest as Record<string, unknown>;
      loggers.http.info(`   Manifest keys: ${Object.keys(manifestObject).join(', ')}`);
      if (manifestObject.name) loggers.http.info(`   Manifest name: ${manifestObject.name}`);
      if (manifestObject.summary) loggers.http.info(`   Summary: ${manifestObject.summary}`);
      if (manifestObject.image) loggers.http.info(`   Image: ${manifestObject.image}`);
      if (Array.isArray(manifestObject.command)) loggers.http.info(`   Command: ${(manifestObject.command as string[]).join(' ')}`);
      if (typeof manifestObject.raw === 'string') {
        const rawYamlLines = (manifestObject.raw as string).split('\n').length;
        loggers.http.info(`   Raw YAML: ${rawYamlLines} lines`);
      }
    } else {
      loggers.http.info(`   No raw manifest provided`);
    }
    
    // Log K8s manifest details
    if (k8sManifest) {
      loggers.http.info(`📦 Step 2/3: Kubernetes manifest received from orchestrator`);
      loggers.http.info(`   Target namespace: ${k8sManifest.namespace}`);
      loggers.http.info(`   Resources count: ${k8sManifest.resources?.length || 0}`);
      
      if (k8sManifest.resources && k8sManifest.resources.length > 0) {
        loggers.http.info(`   Resource types:`);
        k8sManifest.resources.forEach((resource: any, resourceIndex: number) => {
          const resourceKind = resource.kind || 'Unknown';
          const resourceName = resource.metadata?.name || 'unnamed';
          loggers.http.info(`     ${resourceIndex + 1}. ${resourceKind}/${resourceName}`);
          
          // Log resource-specific details
          if (resourceKind === 'Deployment' && resource.spec?.template?.spec?.containers) {
            const deploymentContainers = resource.spec.template.spec.containers;
            deploymentContainers.forEach((container: any) => {
              loggers.http.info(`        - Container: ${container.name}`);
              loggers.http.info(`          Image: ${container.image}`);
              if (container.resources) {
                if (container.resources.requests) {
                  loggers.http.info(`          Requests: CPU=${container.resources.requests.cpu || 'N/A'}, Memory=${container.resources.requests.memory || 'N/A'}`);
                }
                if (container.resources.limits) {
                  loggers.http.info(`          Limits: CPU=${container.resources.limits.cpu || 'N/A'}, Memory=${container.resources.limits.memory || 'N/A'}`);
                }
              }
            });
          } else if (resourceKind === 'Service' && resource.spec?.ports) {
            const servicePorts = resource.spec.ports;
            loggers.http.info(`        - Ports: ${servicePorts.map((port: any) => `${port.port}:${port.targetPort}`).join(', ')}`);
          }
        });
      }
    } else {
      loggers.http.info(`📦 Step 2/3: No K8s manifest (will use raw manifest or Docker)`);
    }
    
    const instanceKey = `${workloadId}-${instanceId}`;
    const workloadNamespace = k8sManifest?.namespace || `workload-${workloadId}-${instanceId}`;
    
    loggers.http.info(`💾 Step 3/3: Storing instance data in memory`);
    instances.set(instanceKey, { 
      workloadId, 
      instanceId, 
      status: "pending", 
      manifest,
      namespace: workloadNamespace,
      deployedAt: Date.now(),
    });
    loggers.http.info(`   Instance key: ${instanceKey}`);
    loggers.http.info(`   Namespace: ${workloadNamespace}`);
    loggers.http.info(`   Status: pending`);

    loggers.http.info(`✅ Deploy request validated and accepted`);
    loggers.http.info(`🚀 Handing off to workload executor...`);
    loggers.http.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // Execute workload on this node (async; update status when done)
    executeWorkload(workloadId, instanceId, manifest ?? {}, k8sManifest).then((executionStatus) => {
      const instanceData = instances.get(instanceKey);
      if (instanceData) {
        instanceData.status = executionStatus;
        loggers.server.info(
          { workloadId, instanceId, status: executionStatus },
          `Workload ${workloadId}/${instanceId} status updated to ${executionStatus}`
        );
      }
    });

    return c.json({
      status: "success",
      message: "Deploy accepted; workload execution started",
      workloadId,
      instanceId,
      instanceStatus: "pending",
      requestId,
    });
  } catch (error) {
    loggers.http.error(
      { requestId, error: error instanceof Error ? error.message : String(error) },
      "Deploy request failed"
    );
    return c.json({ status: "error", message: String(error), requestId }, 500);
  }
});

/** Collect real hardware spec from this node (source of truth for registration). */
function getDeviceSpec(): {
  cpuModel: string;
  cpuCores: number;
  memoryTotalBytes: number;
  memoryFreeBytes: number;
  diskTotalBytes?: number;
  diskFreeBytes?: number;
} {
  const cpuList = cpus();
  const firstCpu = cpuList[0];
  const cpuModel = (firstCpu && firstCpu.model) ? firstCpu.model.trim() : "Unknown";
  const cpuCores = cpuList.length;
  const memoryTotalBytes = totalmem();
  const memoryFreeBytes = freemem();

  let diskTotalBytes: number | undefined;
  let diskFreeBytes: number | undefined;
  if (platform() === "linux") {
    try {
      const out = execSync("df -B1 / 2>/dev/null | tail -1", { encoding: "utf8", maxBuffer: 1024 });
      const parts = out.trim().split(/\s+/);
      if (parts.length >= 4) {
        diskTotalBytes = parseInt(parts[1], 10);
        diskFreeBytes = parseInt(parts[3], 10);
        if (Number.isNaN(diskTotalBytes)) diskTotalBytes = undefined;
        if (Number.isNaN(diskFreeBytes)) diskFreeBytes = undefined;
      }
    } catch {
      // ignore
    }
  }

  return {
    cpuModel,
    cpuCores,
    memoryTotalBytes,
    memoryFreeBytes,
    diskTotalBytes,
    diskFreeBytes,
  };
}

// GET /device-info — unique device identifier + real hardware spec for on-chain provider registration
app.get("/device-info", (c) => {
  const requestId = getRequestId(c);
  const spec = getDeviceSpec();
  
  logDeviceInfo({
    deviceId: DEVICE_ID,
    hostname: hostname(),
    cpuCores: spec.cpuCores,
    memoryTotalGB: Math.round(spec.memoryTotalBytes / (1024 ** 3)),
    requestId,
  });
  
  return c.json({
    deviceId: DEVICE_ID,
    hostname: hostname(),
    spec: {
      cpuModel: spec.cpuModel,
      cpuCores: spec.cpuCores,
      memoryTotalBytes: spec.memoryTotalBytes,
      memoryFreeBytes: spec.memoryFreeBytes,
      diskTotalBytes: spec.diskTotalBytes,
      diskFreeBytes: spec.diskFreeBytes,
    },
    requestId,
  });
});

// ─── Hardware scan helpers ───────────────────────────────────────────────────

interface GPUScanResult {
  index: number;
  vendor: "NVIDIA" | "AMD" | "Unknown";
  name: string;
  vramGB: number;
  driverVersion: string;
  utilizationPct: number;
  tflops: number;
}

// Server-side GPU TFLOPS lookup (mirrors frontend GPU_DATABASE)
const GPU_TFLOPS_DB: Array<{ keywords: string[]; tflops: number }> = [
  { keywords: ["1060", "1070", "2060", "rx 5700", "rx 5600"], tflops: 6.5 },
  { keywords: ["2080", "3060", "4060", "rx 6600", "rx 6700"], tflops: 13.0 },
  { keywords: ["apple m1", "apple m2", "apple m3", "apple m4"], tflops: 10.0 },
  { keywords: ["3070", "3080", "4070", "rx 6800", "rx 7700", "rx 7800"], tflops: 30.0 },
  { keywords: ["3090", "4080", "4090", "rx 7900 xtx", "rx 7900 xt"], tflops: 70.0 },
  { keywords: ["t4"], tflops: 8.1 },
  { keywords: ["a10g"], tflops: 31.2 },
  { keywords: ["a40", "rtx a6000", "rtx 6000"], tflops: 37.4 },
  { keywords: ["l40s", "l40"], tflops: 91.6 },
  { keywords: ["a100-40", "a100 40gb"], tflops: 77.4 },
  { keywords: ["a100"], tflops: 77.4 },
  { keywords: ["mi250", "mi300", "instinct"], tflops: 200.0 },
  { keywords: ["h100 pcie", "h100-pcie"], tflops: 204.0 },
  { keywords: ["h100"], tflops: 267.0 },
  { keywords: ["b100", "b200", "gb200"], tflops: 700.0 },
];

function lookupGPUTFLOPS(name: string): number {
  const lower = name.toLowerCase();
  const sorted = [...GPU_TFLOPS_DB].sort(
    (a, b) => Math.max(...b.keywords.map(k => k.length)) - Math.max(...a.keywords.map(k => k.length))
  );
  for (const entry of sorted) {
    if (entry.keywords.some(k => lower.includes(k))) return entry.tflops;
  }
  return 0;
}

async function detectGPUs(): Promise<GPUScanResult[]> {
  // 1. NVIDIA via nvidia-smi
  try {
    const { stdout } = await execAsync(
      "nvidia-smi --query-gpu=index,name,memory.total,driver_version,utilization.gpu --format=csv,noheader,nounits",
      { timeout: 8000 }
    );
    const lines = stdout.trim().split("\n").filter(Boolean);
    if (lines.length > 0) {
      return lines.map(line => {
        const [idx, name, memMB, driver, util] = line.split(",").map(s => s.trim());
        const vramGB = Math.round((parseInt(memMB, 10) || 0) / 1024);
        return {
          index: parseInt(idx, 10) || 0,
          vendor: "NVIDIA" as const,
          name: name || "Unknown NVIDIA GPU",
          vramGB,
          driverVersion: driver || "unknown",
          utilizationPct: parseInt(util, 10) || 0,
          tflops: lookupGPUTFLOPS(name || ""),
        };
      });
    }
  } catch { /* nvidia-smi not available */ }

  // 2. AMD via rocm-smi
  try {
    const { stdout } = await execAsync("rocm-smi --showproductname --json 2>/dev/null", { timeout: 8000 });
    const data = JSON.parse(stdout);
    const results: GPUScanResult[] = [];
    let idx = 0;
    for (const [key, val] of Object.entries(data)) {
      if (key.startsWith("card")) {
        const card = val as Record<string, string>;
        const name = card["Card series"] || card["Card model"] || "AMD GPU";
        results.push({
          index: idx++,
          vendor: "AMD",
          name,
          vramGB: 0,
          driverVersion: "rocm",
          utilizationPct: 0,
          tflops: lookupGPUTFLOPS(name),
        });
      }
    }
    if (results.length > 0) return results;
  } catch { /* rocm-smi not available */ }

  // 3. Check /dev/dri for any GPU presence (Linux, no vendor tools)
  try {
    const { stdout } = await execAsync("ls /dev/dri/ 2>/dev/null");
    if (stdout.includes("renderD")) {
      return [{
        index: 0,
        vendor: "Unknown",
        name: "GPU detected (install nvidia-smi or rocm-smi for details)",
        vramGB: 0,
        driverVersion: "unknown",
        utilizationPct: 0,
        tflops: 0,
      }];
    }
  } catch { /* not linux */ }

  return [];
}

function computeScanScore(gpus: GPUScanResult[], cpuThreads: number, ramGB: number): number {
  const tflops = gpus.reduce((s, g) => s + g.tflops, 0);
  const vram = gpus.reduce((s, g) => s + g.vramGB, 0);
  return Math.round(tflops * 10 + vram * 2 + cpuThreads * 4 + ramGB * 0.8);
}

function tierFromCS(cs: number): string {
  if (cs < 50) return "T1";
  if (cs < 400) return "T2";
  if (cs < 1000) return "T3";
  if (cs < 3000) return "T4";
  return "T5";
}

// GET /hardware-scan — full hardware inventory (GPU, CPU, RAM) with Compute Score for orchestrator validation
app.get("/hardware-scan", async (c) => {
  const spec = getDeviceSpec();
  const cpuThreads = spec.cpuCores;
  const ramGB = Math.round(spec.memoryTotalBytes / (1024 ** 3));

  const gpus = await detectGPUs();
  const cs = computeScanScore(gpus, cpuThreads, ramGB);
  const tier = tierFromCS(cs);

  // Lightweight tamper-detection signature (sha256 of deviceId + core fields)
  const payload = `${DEVICE_ID}:${cs}:${tier}:${gpus.map(g => g.name).join(",")}`;
  const signature = createHash("sha256").update(payload).digest("hex");

  return c.json({
    deviceId: DEVICE_ID,
    hostname: hostname(),
    scannedAt: Date.now(),
    cpu: { model: spec.cpuModel, threads: cpuThreads },
    ramGB,
    disk: {
      totalGB: spec.diskTotalBytes ? Math.round(spec.diskTotalBytes / (1024 ** 3)) : null,
      freeGB: spec.diskFreeBytes ? Math.round(spec.diskFreeBytes / (1024 ** 3)) : null,
    },
    gpus,
    computeScore: cs,
    tier,
    signature,
  });
});

// GET /status — orchestrator or health check (summary)
app.get("/status", (c) => {
  const requestId = getRequestId(c);
  const instancesList = Array.from(instances.entries()).map(([instanceKey, instanceData]) => ({
    key: instanceKey,
    workloadId: instanceData.workloadId,
    instanceId: instanceData.instanceId,
    status: instanceData.status,
    namespace: instanceData.namespace,
    deployedAt: instanceData.deployedAt,
  }));
  
  loggers.server.debug(
    { requestId, instanceCount: instancesList.length },
    `Status check: ${instancesList.length} active instances`
  );
  
  return c.json({ status: "ok", instances: instancesList, requestId });
});

// GET /workload/:workloadId/:instanceId/status — detailed status with K8s pod info
app.get("/workload/:workloadId/:instanceId/status", async (c) => {
  const requestId = getRequestId(c);
  const { workloadId, instanceId } = c.req.param();
  const instanceKey = `${workloadId}-${instanceId}`;
  const instanceData = instances.get(instanceKey);

  if (!instanceData) {
    loggers.server.warn(
      { requestId, workloadId, instanceId },
      `Workload status request: instance not found`
    );
    return c.json({ status: "error", message: "Instance not found", requestId }, 404);
  }

  let kubernetesStatus = null;
  if (instanceData.namespace) {
    const { getWorkloadStatus, isK8sAvailable } = await import("./k8s-client.js");
    if (isK8sAvailable()) {
      const statusResult = await getWorkloadStatus(instanceData.namespace);
      if (statusResult.success) {
        kubernetesStatus = statusResult.status;
      }
    }
  }

  return c.json({
    status: "success",
    workloadId: instanceData.workloadId,
    instanceId: instanceData.instanceId,
    instanceStatus: instanceData.status,
    namespace: instanceData.namespace,
    deployedAt: instanceData.deployedAt,
    k8sStatus: kubernetesStatus,
    requestId,
  });
});

// GET /workload/:workloadId/:instanceId/logs — fetch pod logs from K8s
app.get("/workload/:workloadId/:instanceId/logs", async (c) => {
  const requestId = getRequestId(c);
  const { workloadId, instanceId } = c.req.param();
  const tailLines = Number(c.req.query("tail") || "100");
  const sinceSeconds = c.req.query("since") ? Number(c.req.query("since")) : undefined;
  
  const instanceKey = `${workloadId}-${instanceId}`;
  const instanceData = instances.get(instanceKey);

  if (!instanceData) {
    loggers.server.warn(
      { requestId, workloadId, instanceId },
      `Logs request: instance not found`
    );
    return c.json({ status: "error", message: "Instance not found", requestId }, 404);
  }

  if (!instanceData.namespace) {
    return c.json({
      status: "error",
      message: "No namespace available for this instance",
      requestId,
    }, 400);
  }

  const { getWorkloadLogs, isK8sAvailable } = await import("./k8s-client.js");
  if (!isK8sAvailable()) {
    return c.json({
      status: "error",
      message: "Kubernetes client not available",
      requestId,
    }, 503);
  }

  const logsResult = await getWorkloadLogs(instanceData.namespace, { tailLines, sinceSeconds });

  if (!logsResult.success) {
    loggers.server.error(
      { requestId, workloadId, instanceId, error: logsResult.error },
      `Failed to fetch logs for workload`
    );
    return c.json({
      status: "error",
      message: logsResult.error || "Failed to fetch logs",
      requestId,
    }, 500);
  }

  return c.json({
    status: "success",
    workloadId: instanceData.workloadId,
    instanceId: instanceData.instanceId,
    namespace: instanceData.namespace,
    logs: logsResult.logs || {},
    requestId,
  });
});

// GET /workload/:workloadId/:instanceId/endpoints — get service endpoints
app.get("/workload/:workloadId/:instanceId/endpoints", async (c) => {
  const requestId = getRequestId(c);
  const { workloadId, instanceId } = c.req.param();
  const instanceKey = `${workloadId}-${instanceId}`;
  const instanceData = instances.get(instanceKey);

  if (!instanceData) {
    loggers.server.warn(
      { requestId, workloadId, instanceId },
      `Endpoints request: instance not found`
    );
    return c.json({ status: "error", message: "Instance not found", requestId }, 404);
  }

  if (!instanceData.namespace) {
    return c.json({
      status: "error",
      message: "No namespace available for this instance",
      requestId,
    }, 400);
  }

  const { getWorkloadEndpoints, isK8sAvailable } = await import("./k8s-client.js");
  if (!isK8sAvailable()) {
    return c.json({
      status: "error",
      message: "Kubernetes client not available",
      requestId,
    }, 503);
  }

  const endpointsResult = await getWorkloadEndpoints(instanceData.namespace);

  if (!endpointsResult.success) {
    loggers.server.error(
      { requestId, workloadId, instanceId, error: endpointsResult.error },
      `Failed to fetch endpoints for workload`
    );
    return c.json({
      status: "error",
      message: endpointsResult.error || "Failed to fetch endpoints",
      requestId,
    }, 500);
  }

  return c.json({
    status: "success",
    workloadId: instanceData.workloadId,
    instanceId: instanceData.instanceId,
    namespace: instanceData.namespace,
    endpoints: endpointsResult.endpoints || [],
    requestId,
  });
});

// GET /workload/:workloadId/:instanceId/manifest — get original deployment manifest
app.get("/workload/:workloadId/:instanceId/manifest", async (c) => {
  const requestId = getRequestId(c);
  const { workloadId, instanceId } = c.req.param();
  const instanceKey = `${workloadId}-${instanceId}`;
  const instanceData = instances.get(instanceKey);

  if (!instanceData) {
    loggers.server.warn(
      { requestId, workloadId, instanceId },
      `Manifest request: instance not found`
    );
    return c.json({ status: "error", message: "Instance not found", requestId }, 404);
  }

  return c.json({
    status: "success",
    workloadId: instanceData.workloadId,
    instanceId: instanceData.instanceId,
    namespace: instanceData.namespace,
    deployedAt: instanceData.deployedAt,
    manifest: instanceData.manifest,
    requestId,
  });
});

// GET /workload/:workloadId/:instanceId/urls — get public access URLs (production endpoint)
app.get("/workload/:workloadId/:instanceId/urls", async (c) => {
  const requestId = getRequestId(c);
  const { workloadId, instanceId } = c.req.param();
  const instanceKey = `${workloadId}-${instanceId}`;
  const instanceData = instances.get(instanceKey);

  if (!instanceData) {
    loggers.server.warn(
      { requestId, workloadId, instanceId },
      `URLs request: instance not found`
    );
    return c.json({ status: "error", message: "Instance not found", requestId }, 404);
  }

  if (!instanceData.namespace) {
    return c.json({
      status: "error",
      message: "No namespace available for this instance",
      requestId,
    }, 400);
  }

  const { getWorkloadServiceUrls, isK8sAvailable, getCachedPublicIp } = await import("./k8s-client.js");
  if (!isK8sAvailable()) {
    return c.json({
      status: "error",
      message: "Kubernetes client not available",
      requestId,
    }, 503);
  }

  const urlsResult = await getWorkloadServiceUrls(instanceData.namespace);

  if (!urlsResult.success) {
    loggers.server.error(
      { requestId, workloadId, instanceId, error: urlsResult.error },
      `Failed to fetch URLs for workload`
    );
    return c.json({
      status: "error",
      message: urlsResult.error || "Failed to fetch URLs",
      requestId,
    }, 500);
  }

  const publicHostname = getCachedPublicIp();

  // If workload is not ready, return empty URLs with ready status
  if (urlsResult.ready === false) {
    loggers.server.debug(
      { requestId, workloadId, instanceId, namespace: instanceData.namespace },
      `Workload not ready yet - returning empty URLs`
    );
    return c.json({
      status: "success",
      workloadId: instanceData.workloadId,
      instanceId: instanceData.instanceId,
      namespace: instanceData.namespace,
      publicHostname,
      ready: false,
      urls: [],
      services: [],
      message: "Workload pods are not ready yet",
      requestId,
    });
  }

  return c.json({
    status: "success",
    workloadId: instanceData.workloadId,
    instanceId: instanceData.instanceId,
    namespace: instanceData.namespace,
    publicHostname,
    ready: true,
    urls: urlsResult.urls || [],
    services: urlsResult.services || [],
    requestId,
  });
});

// DELETE /workload/:workloadId/:instanceId — terminate workload and delete Kubernetes namespace
app.delete("/workload/:workloadId/:instanceId", async (c) => {
  const requestId = getRequestId(c);
  const { workloadId, instanceId } = c.req.param();
  const instanceKey = `${workloadId}-${instanceId}`;
  const instanceData = instances.get(instanceKey);

  if (!instanceData) {
    loggers.server.warn(
      { requestId, workloadId, instanceId },
      `Terminate request: instance not found`
    );
    return c.json({ status: "error", message: "Instance not found", requestId }, 404);
  }

  const namespace = instanceData.namespace;
  if (!namespace) {
    instances.delete(instanceKey);
    loggers.server.info(
      { requestId, workloadId, instanceId },
      "Instance had no namespace; removed from tracking"
    );
    return c.json({
      status: "success",
      message: "Instance removed (no namespace)",
      workloadId: instanceData.workloadId,
      instanceId: instanceData.instanceId,
      requestId,
    });
  }

  const { deleteWorkloadNamespace, isK8sAvailable } = await import("./k8s-client.js");
  if (!isK8sAvailable()) {
    instances.delete(instanceKey);
    loggers.server.warn(
      { requestId, workloadId, instanceId },
      "K8s not available; removed instance from tracking"
    );
    return c.json({
      status: "success",
      message: "Instance removed (K8s unavailable)",
      workloadId: instanceData.workloadId,
      instanceId: instanceData.instanceId,
      requestId,
    });
  }

  const deleteResult = await deleteWorkloadNamespace(namespace);
  instances.delete(instanceKey);

  if (!deleteResult.success) {
    loggers.server.error(
      { requestId, workloadId, instanceId, error: deleteResult.error },
      "Failed to delete namespace on terminate"
    );
    return c.json({
      status: "error",
      message: deleteResult.error || "Failed to delete namespace",
      requestId,
    }, 500);
  }

  loggers.server.info(
    { requestId, workloadId, instanceId, namespace },
    "Workload terminated and namespace deleted"
  );
  return c.json({
    status: "success",
    message: "Workload terminated and namespace deleted",
    workloadId: instanceData.workloadId,
    instanceId: instanceData.instanceId,
    namespace,
    requestId,
  });
});

// GET /health — health check endpoint for monitoring
app.get("/health", async (c) => {
  return handleHealthCheck(c, instances);
});

// GET /metrics — metrics endpoint for monitoring
app.get("/metrics", (c) => {
  return handleMetrics(c);
});

// GET /diagnostics — comprehensive diagnostics for provider owner (requires API key)
app.get("/diagnostics", requireApiKey(), async (c) => {
  const requestId = getRequestId(c);
  const { getHealthStatus, getMetrics } = await import("./health.js");
  const { getLogStats } = await import("./log-buffer.js");
  const { isK8sAvailable } = await import("./k8s-client.js");
  
  try {
    const healthStatus = await getHealthStatus(instances);
    const systemMetrics = getMetrics();
    const logStatistics = getLogStats();
    const isKubernetesAvailable = isK8sAvailable();
    
    // Get instance details
    const instanceDetailsList = Array.from(instances.values()).map((instanceData) => ({
      workloadId: instanceData.workloadId,
      instanceId: instanceData.instanceId,
      status: instanceData.status,
      namespace: instanceData.namespace,
      deployedAt: instanceData.deployedAt,
    }));

    // Uptime info
    const { uptime: processUptime } = process;
    const processUptimeSeconds = Math.floor(processUptime());
    
    return c.json({
      status: "success",
      timestamp: new Date().toISOString(),
      deviceId: DEVICE_ID,
      health: healthStatus,
      metrics: systemMetrics,
      logs: logStatistics,
      kubernetes: {
        available: isKubernetesAvailable,
        enabled: true,
      },
      instances: {
        count: instances.size,
        list: instanceDetailsList,
      },
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        uptimeSeconds: processUptimeSeconds,
        pid: process.pid,
      },
      requestId,
    });
  } catch (error) {
    loggers.server.error(
      { requestId, error: error instanceof Error ? error.message : String(error) },
      "Failed to generate diagnostics"
    );
    return c.json(
      {
        status: "error",
        message: error instanceof Error ? error.message : "Failed to generate diagnostics",
        requestId,
      },
      500
    );
  }
});

// GET /logs — get provider node logs for owner viewing
app.get("/logs", (c) => {
  const requestId = getRequestId(c);
  const limit = Math.min(Number(c.req.query("limit") || "500"), 5000);
  const sinceTimestamp = c.req.query("since") ? Number(c.req.query("since")) : undefined;
  const level = c.req.query("level") as any;
  const category = c.req.query("category");

  try {
    const logs = getLogEntries({
      limit,
      sinceTimestamp,
      level,
      category,
    });

    const stats = getLogStats();

    return c.json({
      status: "success",
      logs,
      stats,
      query: {
        limit,
        sinceTimestamp,
        level,
        category,
      },
      requestId,
    });
  } catch (e) {
    loggers.server.error(
      { requestId, error: e instanceof Error ? e.message : String(e) },
      "Failed to fetch logs"
    );
    return c.json(
      {
        status: "error",
        message: e instanceof Error ? e.message : "Failed to fetch logs",
        requestId,
      },
      500
    );
  }
});

// GET /logs/stream — Server-Sent Events stream for real-time logs
app.get("/logs/stream", (c) => {
  const requestId = getRequestId(c);
  
  loggers.server.info({ requestId }, "Log streaming started");

  // Set SSE headers
  c.header("Content-Type", "text/event-stream");
  c.header("Cache-Control", "no-cache");
  c.header("Connection", "keep-alive");

  // Get initial logs
  const initialLogs = getLogEntries({ limit: 50 });
  let lastTimestamp = initialLogs.length > 0 
    ? initialLogs[initialLogs.length - 1].timestamp 
    : Date.now();

  // Send initial logs
  const stream = new ReadableStream({
    start(controller) {
      // Send initial logs
      for (const log of initialLogs) {
        const data = JSON.stringify(log);
        controller.enqueue(`data: ${data}\n\n`);
      }

      // Poll for new logs every 2 seconds
      const interval = setInterval(() => {
        const newLogs = getLogEntries({ sinceTimestamp: lastTimestamp + 1 });
        
        for (const log of newLogs) {
          const data = JSON.stringify(log);
          controller.enqueue(`data: ${data}\n\n`);
          lastTimestamp = log.timestamp;
        }
      }, 2000);

      // Cleanup on close
      return () => {
        clearInterval(interval);
        loggers.server.info({ requestId }, "Log streaming stopped");
      };
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
});

// POST /report — provider node reports status (Running/Failed) to orchestrator callback URL
// Orchestrator can poll GET /status or provider can POST here to a callback
app.post("/report", async (c) => {
  const requestId = getRequestId(c);
  const statusReportBody = await c.req.json<{ workloadId: string; instanceId: string; status: InstanceStatus }>();
  const { workloadId, instanceId, status } = statusReportBody;
  const instanceKey = `${workloadId}-${instanceId}`;
  const instanceData = instances.get(instanceKey);
  
  if (!instanceData) {
    loggers.server.warn(
      { requestId, workloadId, instanceId },
      `Status report failed: instance ${workloadId}/${instanceId} not found`
    );
    return c.json({ status: "error", message: "Instance not found", requestId }, 404);
  }
  
  const previousStatus = instanceData.status;
  instanceData.status = status;
  
  loggers.server.info(
    { requestId, workloadId, instanceId, oldStatus: previousStatus, newStatus: status },
    `Status report received: ${workloadId}/${instanceId} ${previousStatus} → ${status}`
  );
  
  return c.json({ status: "success", workloadId, instanceId, instanceStatus: status, requestId });
});

// Load and validate configuration
const { loadConfig, validateKubectlAccess, printConfigSummary, initializePublicHostname } = await import("./config.js");
const config = loadConfig();

// Initialize public IP detection (dynamic, not static environment variable)
await initializePublicHostname(config);

// Validate kubectl access
const kubectlInfo = await validateKubectlAccess();

// Initialize K8s client to check availability
const { initK8sClient, isK8sAvailable } = await import("./k8s-client.js");
initK8sClient();
const k8sAvailable = isK8sAvailable();

// Log structured startup information
logStartup({
  port: config.port,
  deviceId: DEVICE_ID,
  hostname: hostname(),
  nodeEnv: config.nodeEnv,
  logLevel: config.logLevel,
  k8sAvailable,
});

// Pretty startup banner for console
console.log("\n═══════════════════════════════════════════════════════════════");
console.log("  Cloudana Provider Node — Workload Execution Server");
console.log("═══════════════════════════════════════════════════════════════");
console.log("\n  Device Identity:");
console.log(`  • Device ID:     ${DEVICE_ID.slice(0, 16)}...${DEVICE_ID.slice(-8)}`);
console.log(`  • Hostname:      ${hostname()}`);
console.log(`  • PID:           ${process.pid}`);

printConfigSummary(config, kubectlInfo);

console.log("\n  Architecture: EXTERNAL MODE ONLY (Enforced)");
console.log("  • Provider node runs OUTSIDE Kubernetes clusters");
console.log("  • Uses kubeconfig for authentication (~/.kube/config)");
console.log("  • Manages K8s cluster(s) via kubectl/API");
console.log("  • Executes workloads from orchestrator");
console.log("  • Structured logging with request tracing");
console.log("  • Similar to Akash provider architecture");
console.log("\n  Endpoints:");
console.log("  • GET  /device-info                                    — Hardware specs");
console.log("  • GET  /hardware-scan                                  — Full hardware scan (GPU, CPU, CS, tier)");
console.log("  • POST /deploy                                         — Accept workload");
console.log("  • GET  /status                                         — List instances");
console.log("  • GET  /workload/:workloadId/:instanceId/status        — Detailed status");
console.log("  • GET  /workload/:workloadId/:instanceId/logs          — Pod logs");
console.log("  • GET  /workload/:workloadId/:instanceId/endpoints     — Service endpoints");
console.log("  • GET  /workload/:workloadId/:instanceId/manifest      — Original manifest");
console.log("  • GET  /workload/:workloadId/:instanceId/urls          — Public access URLs");
console.log("  • DELETE /workload/:workloadId/:instanceId             — Terminate workload");
console.log("  • GET  /workload/:workloadId/:instanceId/download      — Download file");
console.log("  • POST /workload/:workloadId/:instanceId/exec          — Execute command");
console.log("  • POST /report                                         — Status report");
console.log("  • GET  /health                                         — Health check");
console.log("  • GET  /metrics                                        — Metrics");
console.log("  • GET  /logs                                           — Provider logs (for owner)");
console.log("  • GET  /logs/stream                                    — Live log stream (SSE)");
console.log("  • GET  /diagnostics                                    — Comprehensive diagnostics");
console.log("\n  Next steps:");
console.log("  1. Verify: curl http://localhost:" + config.port + "/device-info");
console.log("  2. Register this provider on-chain with the device ID above");
console.log("  3. Orchestrator will send workloads to this endpoint");
console.log("\n  Logging:");
console.log("  • All requests/responses logged with correlation IDs");
console.log("  • Structured JSON logs in production");
console.log("  • Pretty console logs in development");
console.log("═══════════════════════════════════════════════════════════════\n");

// Start periodic metrics logging
startMetricsLogging();

// Final log before starting server
loggers.server.info(
  {
    port: config.port,
    endpoints: [
      "/device-info",
      "/deploy",
      "/status",
      "/workload/:workloadId/:instanceId/status",
      "/workload/:workloadId/:instanceId/logs",
      "/workload/:workloadId/:instanceId/endpoints",
      "/workload/:workloadId/:instanceId/manifest",
      "/workload/:workloadId/:instanceId/urls",
      "/workload/:workloadId/:instanceId (DELETE)",
      "/workload/:workloadId/:instanceId/download",
      "/workload/:workloadId/:instanceId/exec",
      "/report",
      "/health",
      "/metrics",
      "/logs",
      "/logs/stream",
      "/diagnostics"
    ],
  },
  `Starting HTTP server on port ${config.port}`
);

// Graceful shutdown handler
let isShuttingDown = false;

async function gracefulShutdown(shutdownSignal: string) {
  if (isShuttingDown) {
    loggers.server.warn(`Shutdown already in progress, ignoring ${shutdownSignal}`);
    return;
  }
  isShuttingDown = true;

  loggers.server.warn(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  loggers.server.warn(`⚠️  GRACEFUL SHUTDOWN INITIATED (${shutdownSignal})`);
  loggers.server.warn(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  
  try {
    // Stop accepting new requests
    loggers.server.info(`   Step 1/3: Stopping acceptance of new deployments...`);
    
    // Log current workloads
    const activeWorkloadsList = Array.from(instances.values()).filter(instanceData => instanceData.status === "running");
    loggers.server.info(`   Step 2/3: Active workloads: ${activeWorkloadsList.length}`);
    
    if (activeWorkloadsList.length > 0) {
      loggers.server.warn(`   ⚠️  WARNING: ${activeWorkloadsList.length} workload(s) still running!`);
      activeWorkloadsList.forEach(workloadData => {
        loggers.server.warn(`      - Workload ${workloadData.workloadId}/${workloadData.instanceId} (${workloadData.status})`);
      });
      loggers.server.info(`   These workloads will continue running in Kubernetes.`);
      loggers.server.info(`   Restart this node to resume management.`);
    }
    
    loggers.server.info(`   Step 3/3: Cleaning up resources...`);
    // Could add cleanup logic here if needed
    
    loggers.server.success(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    loggers.server.success(`✅ GRACEFUL SHUTDOWN COMPLETE`);
    loggers.server.success(`   Provider node stopped cleanly`);
    loggers.server.success(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    
    process.exit(0);
  } catch (error) {
    loggers.server.error(
      `Shutdown error: ${error instanceof Error ? error.message : error}`
    );
    process.exit(1);
  }
}

// Register shutdown handlers
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

serve({ fetch: app.fetch, port: config.port });

loggers.server.success(`🎉 Provider node is ready and accepting workloads!`);

// Start POUW mining in background (enabled via POUW_ENABLED=true + POUW_PROVIDER_ADDRESS)
import("./pouw-miner.js").then(({ startMining, getMiningStats }) => {
  startMining(DEVICE_ID);
  // Expose mining stats on /pouw/stats
  app.get("/pouw/stats", (c) => c.json(getMiningStats()));
}).catch((err) => {
  loggers.server.warn("POUW miner could not be loaded:", err.message);
});

export default app;
