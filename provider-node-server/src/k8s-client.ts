/**
 * Kubernetes client wrapper for Cloudana provider node.
 * Applies K8s resources (Namespace, Deployment, Service, PVC, ConfigMap).
 * 
 * DEPLOYMENT ARCHITECTURE - EXTERNAL ONLY:
 * =========================================
 * Provider nodes MUST run OUTSIDE of Kubernetes (similar to Akash providers).
 * 
 * This is NOT auto-detected - it is ENFORCED by design.
 * 
 * Why external only?
 * - Security isolation: Provider control plane separate from tenant workloads
 * - Multi-cluster support: One provider node can manage multiple K8s clusters
 * - Provider sovereignty: Runs in provider's trusted infrastructure
 * - Economic model: Provider owns the compute, node manages their business logic
 * - Trust boundary: Clear separation between provider and tenant compute
 * 
 * PRODUCTION DEPLOYMENT:
 * - Provider node runs on management server with kubectl access
 * - Uses ~/.kube/config or KUBECONFIG env var
 * - Can manage multiple K8s clusters for different workload tiers
 * - Can manage K8s, Docker, VMs, bare metal from one service
 * 
 * SETUP:
 * 1. Configure kubectl: kubectl config view
 * 2. Verify access: kubectl get nodes
 * 3. Run provider node: npm run dev
 * 4. Provider node uses external kubeconfig automatically
 * 
 * DO NOT run inside Kubernetes pods - this defeats the security model.
 */
import * as k8s from "@kubernetes/client-node";
import { loggers, logK8sResource } from "./logger.js";
import { getCachedPublicIp as _getCachedPublicIp } from "./ip-detection.js";

// Re-export for use in other modules
export { getCachedPublicIp } from "./ip-detection.js";

let _k8sApi: k8s.CoreV1Api | null = null;
let _k8sAppsApi: k8s.AppsV1Api | null = null;
let _kc: k8s.KubeConfig | null = null;
let _initialized = false;

/**
 * Get Kubernetes configuration - EXTERNAL MODE ONLY.
 * 
 * IMPORTANT: Provider nodes must run OUTSIDE Kubernetes clusters.
 * 
 * This enforces external deployment by:
 * - Using kubeconfig file (~/.kube/config or KUBECONFIG env var)
 * - Supporting multiple cluster contexts
 * - Enabling provider sovereignty over infrastructure
 * - Following Akash's proven architecture
 * 
 * Authentication sources (in order):
 * 1. KUBECONFIG environment variable
 * 2. ~/.kube/config file
 * 3. Error if neither exists
 * 
 * Why external only?
 * - Security isolation: Provider control plane separate from tenant workloads
 * - Multi-cluster support: Manage multiple K8s clusters from one provider node
 * - Economic model: Provider owns infrastructure, node manages business logic
 * - Flexibility: Can manage K8s, Docker, VMs, bare metal from one service
 */
function getKubeConfig(): k8s.KubeConfig {
  // Warn if running inside a Kubernetes cluster (not recommended)
  if (process.env.KUBERNETES_SERVICE_HOST && process.env.KUBERNETES_SERVICE_PORT) {
    loggers.k8s.warn(
      {
        detectedInCluster: true,
        KUBERNETES_SERVICE_HOST: process.env.KUBERNETES_SERVICE_HOST,
        KUBERNETES_SERVICE_PORT: process.env.KUBERNETES_SERVICE_PORT,
      },
      "⚠️  WARNING: Detected in-cluster environment variables. " +
      "Provider nodes should run OUTSIDE Kubernetes for security isolation. " +
      "Ignoring in-cluster config and using external kubeconfig."
    );
  }

  // ALWAYS use external kubeconfig (production architecture)
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();
  
  return kc;
}

export function initK8sClient(): boolean {
  if (_initialized) return _k8sApi !== null;
  _initialized = true;
  try {
    const kc = getKubeConfig();
    _kc = kc;
    _k8sApi = kc.makeApiClient(k8s.CoreV1Api);
    _k8sAppsApi = kc.makeApiClient(k8s.AppsV1Api);
    
    // Get current context info for logging
    const currentContext = kc.getCurrentContext();
    const currentCluster = kc.getCurrentCluster();
    
    loggers.k8s.info(
      { 
        mode: "external",
        apiAvailable: true,
        currentContext,
        clusterServer: currentCluster?.server || "unknown",
      },
      `Kubernetes client initialized successfully (external mode) - context: ${currentContext}`
    );
    
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    loggers.k8s.warn(
      { error: errorMessage },
      "Kubernetes client init failed - K8s features unavailable. " +
      "Ensure kubectl is configured: kubectl config view"
    );
    _k8sApi = null;
    _k8sAppsApi = null;
    return false;
  }
}

export function isK8sAvailable(): boolean {
  if (!_initialized) initK8sClient();
  return _k8sApi !== null && _k8sAppsApi !== null;
}

export interface K8sResource {
  apiVersion: string;
  kind: string;
  metadata?: { name?: string; namespace?: string; labels?: Record<string, string> };
  spec?: Record<string, unknown>;
  data?: Record<string, string>;
}

export interface K8sManifest {
  namespace: string;
  resources: K8sResource[];
}

/**
 * Apply K8s manifest: create namespace then create all resources.
 */
export async function applyK8sManifest(manifest: K8sManifest): Promise<{ success: boolean; error?: string; failedResources?: any[] }> {
  if (!_initialized) initK8sClient();
  if (!_k8sApi || !_k8sAppsApi) {
    return { success: false, error: "Kubernetes client not available" };
  }

  const { namespace, resources } = manifest;
  
  loggers.k8s.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  loggers.k8s.info(`🔨 APPLYING KUBERNETES MANIFEST`);
  loggers.k8s.info(`   Namespace: ${namespace}`);
  loggers.k8s.info(`   Total Resources: ${resources.length}`);
  loggers.k8s.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  
  const manifestStartTime = Date.now();

  try {
    // 1. Create namespace
    loggers.k8s.info(`📦 Step 1/5: Creating namespace "${namespace}"...`);
    try {
      await _k8sApi.createNamespace({
        body: {
          metadata: {
            name: namespace,
            labels: { "app.kubernetes.io/managed-by": "cloudana" },
          },
        },
      });
      loggers.k8s.success(`   ✅ Namespace created successfully`);
      logK8sResource({
        action: "create",
        resource: "Namespace",
        namespace,
        success: true,
      });
    } catch (error: unknown) {
      const k8sError = error as { body?: { code?: number }; statusCode?: number };
      if (k8sError.body?.code !== 409 && k8sError.statusCode !== 409) {
        throw error;
      }
      loggers.k8s.info(`   ℹ️  Namespace already exists (reusing)`);
    }

    // 2. Create resources in order
    loggers.k8s.info(`📊 Step 2/5: Analyzing resources...`);
    const persistentVolumeClaims = resources.filter((resource) => resource.kind === "PersistentVolumeClaim");
    const deployments = resources.filter((resource) => resource.kind === "Deployment");
    const services = resources.filter((resource) => resource.kind === "Service");
    const configMaps = resources.filter((resource) => resource.kind === "ConfigMap");
    
    loggers.k8s.info(`   ConfigMaps: ${configMaps.length}`);
    loggers.k8s.info(`   PVCs: ${persistentVolumeClaims.length}`);
    loggers.k8s.info(`   Deployments: ${deployments.length}`);
    loggers.k8s.info(`   Services: ${services.length}`);

    if (configMaps.length > 0) {
      loggers.k8s.info(`🗂️  Step 3a/5: Creating ConfigMaps (${configMaps.length})...`);
      for (const configMap of configMaps) {
        const configMapName = configMap.metadata?.name || "unnamed";
        loggers.k8s.info(`   Creating ConfigMap: ${configMapName}`);
        const configMapBody = { ...configMap, metadata: { ...configMap.metadata, namespace } } as unknown as k8s.V1ConfigMap;
        await _k8sApi.createNamespacedConfigMap({ namespace, body: configMapBody });
        loggers.k8s.success(`   ✅ ConfigMap "${configMapName}" created`);
        logK8sResource({
          action: "create",
          resource: "ConfigMap",
          namespace,
          name: configMapName,
          success: true,
        });
      }
    }

    if (persistentVolumeClaims.length > 0) {
      loggers.k8s.info(`💾 Step 3b/5: Creating PersistentVolumeClaims (${persistentVolumeClaims.length})...`);
      for (const pvc of persistentVolumeClaims) {
        const pvcName = pvc.metadata?.name || "unnamed";
        const pvcSize = (pvc.spec as any)?.resources?.requests?.storage || "unknown";
        loggers.k8s.info(`   Creating PVC: ${pvcName} (${pvcSize})`);
        const pvcBody = { ...pvc, metadata: { ...pvc.metadata, namespace } } as unknown as k8s.V1PersistentVolumeClaim;
        await _k8sApi.createNamespacedPersistentVolumeClaim({ namespace, body: pvcBody });
        loggers.k8s.success(`   ✅ PVC "${pvcName}" created`);
        logK8sResource({
          action: "create",
          resource: "PersistentVolumeClaim",
          namespace,
          name: pvcName,
          success: true,
        });
      }
    }

    if (deployments.length > 0) {
      loggers.k8s.info(`🚀 Step 4/5: Creating Deployments (${deployments.length})...`);
      for (const deployment of deployments) {
        const deploymentName = deployment.metadata?.name || "unnamed";
        const deploymentContainers = (deployment.spec as any)?.template?.spec?.containers || [];
        const containerImage = deploymentContainers[0]?.image || "unknown";
        const containerResources = deploymentContainers[0]?.resources;
        const requestedCpu = containerResources?.requests?.cpu || "unknown";
        const requestedMemory = containerResources?.requests?.memory || "unknown";
        
        loggers.k8s.info(`   Creating Deployment: ${deploymentName}`);
        loggers.k8s.info(`     Image: ${containerImage}`);
        loggers.k8s.info(`     CPU: ${requestedCpu}, Memory: ${requestedMemory}`);
        
        const deploymentBody = { ...deployment, metadata: { ...deployment.metadata, namespace } } as unknown as k8s.V1Deployment;
        await _k8sAppsApi.createNamespacedDeployment({ namespace, body: deploymentBody });
        loggers.k8s.success(`   ✅ Deployment "${deploymentName}" created`);
        loggers.k8s.info(`     ⏳ Kubernetes will now pull image and start containers...`);
        logK8sResource({
          action: "create",
          resource: "Deployment",
          namespace,
          name: deploymentName,
          success: true,
        });
      }
    }

    if (services.length > 0) {
      loggers.k8s.info(`🌐 Step 5/5: Creating Services (${services.length})...`);
      for (const service of services) {
        const serviceName = service.metadata?.name || "unnamed";
        const serviceType = (service.spec as any)?.type || "ClusterIP";
        const servicePorts = (service.spec as any)?.ports || [];
        const portMapping = servicePorts.map((port: any) => `${port.port}:${port.targetPort || port.port}`).join(", ");
        
        loggers.k8s.info(`   Creating Service: ${serviceName} (${serviceType})`);
        if (portMapping) {
          loggers.k8s.info(`     Ports: ${portMapping}`);
        }
        
        const serviceBody = { ...service, metadata: { ...service.metadata, namespace } } as unknown as k8s.V1Service;
        await _k8sApi.createNamespacedService({ namespace, body: serviceBody });
        loggers.k8s.success(`   ✅ Service "${serviceName}" created`);
        logK8sResource({
          action: "create",
          resource: "Service",
          namespace,
          name: serviceName,
          success: true,
        });
      }
    }

    const applyDuration = Date.now() - manifestStartTime;
    
    loggers.k8s.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    loggers.k8s.success(`✅ KUBERNETES MANIFEST APPLIED SUCCESSFULLY!`);
    loggers.k8s.info(`   Namespace: ${namespace}`);
    loggers.k8s.info(`   Resources Created: ${resources.length}`);
    loggers.k8s.info(`     ConfigMaps: ${configMaps.length}`);
    loggers.k8s.info(`     PVCs: ${persistentVolumeClaims.length}`);
    loggers.k8s.info(`     Deployments: ${deployments.length}`);
    loggers.k8s.info(`     Services: ${services.length}`);
    loggers.k8s.info(`   Time Taken: ${applyDuration}ms`);
    loggers.k8s.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    loggers.k8s.info(`📊 NEXT STEPS:`);
    loggers.k8s.info(`   1. Kubernetes will now schedule pods`);
    loggers.k8s.info(`   2. Container images will be pulled from registry`);
    loggers.k8s.info(`   3. Pods will start and containers will run`);
    loggers.k8s.info(`   4. Monitor with: kubectl get all -n ${namespace}`);
    loggers.k8s.info(`   5. Check logs: kubectl logs -n ${namespace} -l app.kubernetes.io/managed-by=cloudana`);
    loggers.k8s.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    
    return { success: true };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    loggers.k8s.error(
      {
        namespace,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      },
      `Failed to apply K8s manifest in namespace ${namespace}`
    );
    return { success: false, error: errorMessage };
  }
}

/**
 * Get pod logs for a workload namespace.
 * Returns logs from all pods in the namespace with cloudana labels.
 */
export async function getWorkloadLogs(
  namespace: string,
  options: { tailLines?: number; sinceSeconds?: number } = {}
): Promise<{ success: boolean; logs?: Record<string, string>; error?: string }> {
  if (!_initialized) initK8sClient();
  if (!_k8sApi) {
    return { success: false, error: "Kubernetes client not available" };
  }

  try {
    const { tailLines = 100, sinceSeconds } = options;

    // List all pods in namespace with cloudana labels
    const podsResponse = await _k8sApi.listNamespacedPod({
      namespace,
      labelSelector: "app.kubernetes.io/managed-by=cloudana",
    });

    const pods = (podsResponse as any).body?.items || (podsResponse as any).items || [];
    if (pods.length === 0) {
      return { success: true, logs: {} };
    }

    const logsMap: Record<string, string> = {};

    for (const pod of pods) {
      const podName = pod.metadata?.name;
      if (!podName) continue;

      try {
        const logResponse = await _k8sApi.readNamespacedPodLog({
          name: podName,
          namespace,
          tailLines,
          ...(sinceSeconds && { sinceSeconds }),
        });

        const logText = (logResponse as any).body || (logResponse as string) || "";
        logsMap[podName] = logText;

        loggers.k8s.debug(
          { namespace, podName, logLines: logText.split("\n").length },
          `Fetched logs for pod ${podName}`
        );
      } catch (e: unknown) {
        const err = e as { statusCode?: number; body?: { message?: string } };
        if (err.statusCode === 400 && err.body?.message?.includes("waiting to start")) {
          logsMap[podName] = "[Pod is still starting, logs not available yet]";
        } else {
          logsMap[podName] = `[Error fetching logs: ${e instanceof Error ? e.message : String(e)}]`;
        }
      }
    }

    return { success: true, logs: logsMap };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    loggers.k8s.error({ namespace, error: msg }, `Failed to fetch workload logs for namespace ${namespace}`);
    return { success: false, error: msg };
  }
}

/**
 * Get service endpoints (NodePort access URLs) for a workload namespace.
 */
export async function getWorkloadEndpoints(
  namespace: string
): Promise<{ success: boolean; endpoints?: Array<{ name: string; type: string; ports: Array<{ port: number; nodePort?: number; protocol: string }> }>; error?: string }> {
  if (!_initialized) initK8sClient();
  if (!_k8sApi) {
    return { success: false, error: "Kubernetes client not available" };
  }

  try {
    // List all services in namespace with cloudana labels
    const servicesResponse = await _k8sApi.listNamespacedService({
      namespace,
      labelSelector: "app.kubernetes.io/managed-by=cloudana",
    });

    const services = (servicesResponse as any).body?.items || (servicesResponse as any).items || [];
    const endpoints = services.map((svc: any) => {
      const name = svc.metadata?.name || "unknown";
      const type = svc.spec?.type || "ClusterIP";
      const ports = (svc.spec?.ports || []).map((p: any) => ({
        port: p.port,
        nodePort: p.nodePort,
        protocol: p.protocol || "TCP",
      }));

      return { name, type, ports };
    });

    loggers.k8s.debug(
      { namespace, serviceCount: services.length },
      `Fetched ${services.length} service endpoint(s) for namespace ${namespace}`
    );

    return { success: true, endpoints };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    loggers.k8s.error({ namespace, error: msg }, `Failed to fetch workload endpoints for namespace ${namespace}`);
    return { success: false, error: msg };
  }
}

/**
 * Get detailed workload status including pod phase and deployment readiness.
 */
export async function getWorkloadStatus(
  namespace: string
): Promise<{ success: boolean; status?: { phase: string; ready: boolean; podCount: number; readyPods: number; details: string; services?: Array<{ name: string; type: string; ports: Array<{ port: number; nodePort?: number; protocol: string }>; urls?: string[] }> }; error?: string }> {
  if (!_initialized) initK8sClient();
  if (!_k8sApi || !_k8sAppsApi) {
    return { success: false, error: "Kubernetes client not available" };
  }

  try {
    // Get all pods in namespace
    const podsResponse = await _k8sApi.listNamespacedPod({
      namespace,
      labelSelector: "app.kubernetes.io/managed-by=cloudana",
    });

    const pods = (podsResponse as any).body?.items || (podsResponse as any).items || [];
    const podCount = pods.length;
    
    // Check pod readiness first
    const runningPods = pods.filter((p: any) => p.status?.phase === "Running");
    const readyPods = pods.filter((p: any) => {
      const conditions = p.status?.conditions || [];
      return conditions.some((c: any) => c.type === "Ready" && c.status === "True");
    });
    
    const isWorkloadReady = podCount > 0 && readyPods.length > 0;
    
    // Get all services in namespace
    const servicesResponse = await _k8sApi.listNamespacedService({ namespace });
    const services = (servicesResponse as any).body?.items || (servicesResponse as any).items || [];
    
    // Extract service information and generate URLs ONLY if workload is ready
    const serviceInfo = services.map((svc: any) => {
      const svcName = svc.metadata?.name || "unknown";
      const svcType = svc.spec?.type || "ClusterIP";
      const ports = (svc.spec?.ports || []).map((port: any) => ({
        port: port.port,
        nodePort: port.nodePort,
        protocol: port.protocol || "TCP",
      }));
      
      // Generate URLs for NodePort services ONLY if workload is ready
      const urls: string[] = [];
      if (svcType === "NodePort" && isWorkloadReady) {
        for (const port of ports) {
          if (port.nodePort) {
            // Use dynamically detected public IP
            const publicHostname = _getCachedPublicIp();
            
            if (publicHostname) {
              urls.push(`http://${publicHostname}:${port.nodePort}`);
            } else {
              // Don't add localhost URLs - wait for proper public IP detection
              loggers.k8s.debug(
                { namespace, service: svcName },
                `Public IP not available - skipping URL generation`
              );
            }
          }
        }
      }
      
      return {
        name: svcName,
        type: svcType,
        ports,
        urls: urls.length > 0 ? urls : undefined,
      };
    });
    
    if (podCount === 0) {
      return {
        success: true,
        status: {
          phase: "Pending",
          ready: false,
          podCount: 0,
          readyPods: 0,
          details: "No pods found yet",
          services: serviceInfo.length > 0 ? serviceInfo : undefined,
        },
      };
    }

    const phases = pods.map((p: any) => p.status?.phase || "Unknown");
    const allRunning = runningPods.length === podCount;
    const allReady = readyPods.length === podCount;
    
    let phase = "Pending";
    let details = `${readyPods.length}/${podCount} pods ready`;
    
    if (allReady) {
      phase = "Running";
      details = "All pods running and ready";
    } else if (runningPods.length > 0) {
      phase = "Starting";
      details = `${runningPods.length}/${podCount} pods running, ${readyPods.length} ready`;
    } else if (phases.includes("Failed") || phases.includes("CrashLoopBackOff")) {
      phase = "Failed";
      details = "One or more pods failed";
    }

    return {
      success: true,
      status: {
        phase,
        ready: allReady,
        podCount,
        readyPods: readyPods.length,
        details,
        services: serviceInfo.length > 0 ? serviceInfo : undefined,
      },
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    loggers.k8s.error({ namespace, error: msg }, `Failed to get workload status for namespace ${namespace}`);
    return { success: false, error: msg };
  }
}

/**
 * Get service URLs for a workload namespace.
 * Returns array of accessible URLs for all NodePort services.
 * IMPORTANT: Only returns URLs if workload pods are running and ready.
 */
export async function getWorkloadServiceUrls(
  namespace: string
): Promise<{ success: boolean; urls?: string[]; services?: Array<{ name: string; urls: string[] }>; error?: string; ready?: boolean }> {
  if (!_initialized) initK8sClient();
  if (!_k8sApi) {
    return { success: false, error: "Kubernetes client not available" };
  }

  try {
    // First, check if workload pods are running and ready
    const podsResponse = await _k8sApi.listNamespacedPod({
      namespace,
      labelSelector: "app.kubernetes.io/managed-by=cloudana",
    });
    
    const pods = (podsResponse as any).body?.items || (podsResponse as any).items || [];
    const podCount = pods.length;
    
    // Check if at least one pod is running and ready
    const readyPods = pods.filter((p: any) => {
      const isRunning = p.status?.phase === "Running";
      const conditions = p.status?.conditions || [];
      const isReady = conditions.some((c: any) => c.type === "Ready" && c.status === "True");
      return isRunning && isReady;
    });
    
    const isWorkloadReady = podCount > 0 && readyPods.length > 0;
    
    loggers.k8s.debug(
      { namespace, podCount, readyPods: readyPods.length, isWorkloadReady },
      `Workload readiness check: ${readyPods.length}/${podCount} pods ready`
    );
    
    // If no pods are ready, return success but with empty URLs
    if (!isWorkloadReady) {
      loggers.k8s.debug(
        { namespace, podCount, readyPods: readyPods.length },
        `Workload not ready yet - not returning URLs`
      );
      return {
        success: true,
        ready: false,
        urls: undefined,
        services: undefined,
      };
    }
    
    // Pods are ready - now get service URLs
    const servicesResponse = await _k8sApi.listNamespacedService({ namespace });
    const services = (servicesResponse as any).body?.items || (servicesResponse as any).items || [];
    
    const allUrls: string[] = [];
    const serviceUrls: Array<{ name: string; urls: string[] }> = [];
    
    for (const svc of services) {
      const svcName = svc.metadata?.name || "unknown";
      const svcType = svc.spec?.type || "ClusterIP";
      const ports = svc.spec?.ports || [];
      
      if (svcType === "NodePort") {
        const urls: string[] = [];
        // Use dynamically detected public IP
        const publicHostname = _getCachedPublicIp();
        
        if (!publicHostname) {
          loggers.k8s.warn(
            { namespace, service: svcName },
            `Public IP not detected - cannot generate URLs for service ${svcName}`
          );
          continue;
        }
        
        for (const port of ports) {
          if (port.nodePort) {
            const url = `http://${publicHostname}:${port.nodePort}`;
            urls.push(url);
            allUrls.push(url);
            
            loggers.k8s.debug(
              { namespace, service: svcName, nodePort: port.nodePort, url },
              `Generated URL for NodePort service: ${url}`
            );
          }
        }
        
        if (urls.length > 0) {
          serviceUrls.push({ name: svcName, urls });
        }
      }
    }
    
    return {
      success: true,
      ready: true,
      urls: allUrls.length > 0 ? allUrls : undefined,
      services: serviceUrls.length > 0 ? serviceUrls : undefined,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    loggers.k8s.error({ namespace, error: msg }, `Failed to get service URLs for namespace ${namespace}`);
    return { success: false, error: msg };
  }
}

/**
 * Delete all resources in a workload namespace (cleanup).
 */
export async function deleteWorkloadNamespace(
  namespace: string
): Promise<{ success: boolean; error?: string }> {
  if (!_initialized) initK8sClient();
  if (!_k8sApi) {
    return { success: false, error: "Kubernetes client not available" };
  }

  try {
    loggers.k8s.info({ namespace }, `Deleting workload namespace: ${namespace}`);
    
    // Delete namespace - this cascades to all resources inside
    await _k8sApi.deleteNamespace({ name: namespace });
    
    loggers.k8s.success({ namespace }, `Namespace ${namespace} deleted successfully (resources cascading)`);
    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    loggers.k8s.error({ namespace, error: msg }, `Failed to delete namespace ${namespace}`);
    return { success: false, error: msg };
  }
}

/**
 * Execute command in a pod container (for web terminal support).
 */
export async function execInPod(
  namespace: string,
  podName: string,
  containerName: string,
  command: string[]
): Promise<{ success: boolean; output?: string; error?: string }> {
  if (!_initialized) initK8sClient();
  if (!_k8sApi) {
    return { success: false, error: "Kubernetes client not available" };
  }

  try {
    const exec = new k8s.Exec(_kc!);
    let output = "";
    let errorOutput = "";

    await exec.exec(
      namespace,
      podName,
      containerName,
      command,
      process.stdout,
      process.stderr,
      process.stdin,
      false,
      (status) => {
        loggers.k8s.debug({ namespace, podName, status }, `Exec command completed with status ${status.status}`);
      }
    );

    return { success: true, output };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    loggers.k8s.error({ namespace, podName, error: msg }, `Failed to exec in pod ${podName}`);
    return { success: false, error: msg };
  }
}

/**
 * Download file from pod (for file download support).
 */
export async function downloadFileFromPod(
  namespace: string,
  podName: string,
  containerName: string,
  filePath: string
): Promise<{ success: boolean; content?: Buffer; error?: string }> {
  if (!_initialized) initK8sClient();
  if (!_k8sApi) {
    return { success: false, error: "Kubernetes client not available" };
  }

  try {
    // Use kubectl cp equivalent - exec cat command
    const exec = new k8s.Exec(_kc!);
    const chunks: Buffer[] = [];

    await exec.exec(
      namespace,
      podName,
      containerName,
      ["cat", filePath],
      {
        write: (data: string | Buffer) => {
          chunks.push(Buffer.from(data));
        },
      } as any,
      process.stderr,
      process.stdin,
      false
    );

    const content = Buffer.concat(chunks);
    loggers.k8s.success({ namespace, podName, filePath, size: content.length }, `Downloaded file from pod`);
    return { success: true, content };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    loggers.k8s.error({ namespace, podName, filePath, error: msg }, `Failed to download file from pod`);
    return { success: false, error: msg };
  }
}
