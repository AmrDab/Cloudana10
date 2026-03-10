/**
 * Provider node configuration
 * Centralizes all environment variable reading and validation
 */
import { loggers } from "./logger.js";
import { detectPublicIp, setPublicIp } from "./ip-detection.js";

export interface ProviderConfig {
  port: number;
  logLevel: string;
  nodeEnv: string;
  kubeConfig?: string;
  deployTimeoutMs: number;
  metricsIntervalMs: number;
  healthCheckIntervalMs: number;
  publicHostname?: string; // Public IP/hostname for service URLs
}

/**
 * Load and validate configuration from environment
 * Note: publicHostname is loaded asynchronously via initializePublicHostname()
 */
export function loadConfig(): ProviderConfig {
  const config: ProviderConfig = {
    port: Number(process.env.PROVIDER_NODE_PORT ?? 4040),
    logLevel: process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug"),
    nodeEnv: process.env.NODE_ENV || "development",
    kubeConfig: process.env.KUBECONFIG,
    deployTimeoutMs: Number(process.env.DEPLOY_TIMEOUT_MS ?? 30000),
    metricsIntervalMs: Number(process.env.METRICS_INTERVAL_MS ?? 300000), // 5 min
    healthCheckIntervalMs: Number(process.env.HEALTH_CHECK_INTERVAL_MS ?? 60000), // 1 min
    // publicHostname will be set by initializePublicHostname()
  };

  // Validate port
  if (isNaN(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error(`Invalid PROVIDER_NODE_PORT: ${process.env.PROVIDER_NODE_PORT}. Must be 1-65535.`);
  }

  // Warn about in-cluster detection
  if (process.env.KUBERNETES_SERVICE_HOST) {
    loggers.server.warn(
      {
        KUBERNETES_SERVICE_HOST: process.env.KUBERNETES_SERVICE_HOST,
        KUBERNETES_SERVICE_PORT: process.env.KUBERNETES_SERVICE_PORT,
      },
      "⚠️  CRITICAL WARNING: Kubernetes in-cluster variables detected! " +
      "Provider nodes should run OUTSIDE Kubernetes for security. " +
      "External mode enforced - using kubeconfig instead."
    );
  }

  // Log final config (without sensitive data)
  loggers.server.debug(
    {
      port: config.port,
      logLevel: config.logLevel,
      nodeEnv: config.nodeEnv,
      kubeConfigPath: config.kubeConfig || "~/.kube/config (default)",
      deployTimeoutMs: config.deployTimeoutMs,
      metricsIntervalMs: config.metricsIntervalMs,
    },
    "Configuration loaded"
  );

  return config;
}

/**
 * Initialize public hostname detection
 * Call this during server startup to detect and cache the public IP
 * 
 * Priority:
 * 1. Manual override via PUBLIC_HOSTNAME env var (for testing/custom domains)
 * 2. Dynamic detection via external services
 * 3. Local network IP fallback
 */
export async function initializePublicHostname(config: ProviderConfig): Promise<void> {
  // Check for manual override first (useful for custom domains or testing)
  const manualHostname = process.env.PUBLIC_HOSTNAME;
  if (manualHostname) {
    config.publicHostname = manualHostname;
    setPublicIp(manualHostname);
    loggers.server.info(
      { publicHostname: manualHostname },
      "Using manually configured PUBLIC_HOSTNAME (override)"
    );
    return;
  }

  // Dynamically detect public IP
  const detectedIp = await detectPublicIp();
  if (detectedIp) {
    config.publicHostname = detectedIp;
    loggers.server.info(
      { publicHostname: detectedIp },
      "✓ Public hostname initialized (auto-detected)"
    );
  } else {
    loggers.server.warn(
      "Could not detect public IP - NodePort service URLs will use localhost"
    );
  }
}

/**
 * Validate kubectl is available and configured
 */
export async function validateKubectlAccess(): Promise<{
  available: boolean;
  context?: string;
  cluster?: string;
  error?: string;
}> {
  try {
    const { execSync } = await import("node:child_process");
    
    // Check kubectl is installed
    try {
      execSync("kubectl version --client --output=json 2>/dev/null", { encoding: "utf8" });
    } catch (e) {
      return {
        available: false,
        error: "kubectl command not found - install kubectl for K8s support",
      };
    }

    // Get current context
    const contextOutput = execSync("kubectl config current-context 2>/dev/null", {
      encoding: "utf8",
    }).trim();
    
    // Get cluster info
    const clusterOutput = execSync(
      `kubectl config view -o jsonpath='{.contexts[?(@.name=="${contextOutput}")].context.cluster}' 2>/dev/null`,
      { encoding: "utf8" }
    ).trim();

    loggers.k8s.info(
      { context: contextOutput, cluster: clusterOutput },
      `kubectl configured - context: ${contextOutput}, cluster: ${clusterOutput}`
    );

    return {
      available: true,
      context: contextOutput,
      cluster: clusterOutput,
    };
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    loggers.k8s.warn(
      { error: errorMessage },
      "kubectl access validation failed - K8s features may be unavailable"
    );
    return {
      available: false,
      error: errorMessage,
    };
  }
}

/**
 * Print configuration summary to console
 */
export function printConfigSummary(config: ProviderConfig, k8sInfo: { available: boolean; context?: string }) {
  console.log("\n  Configuration:");
  console.log(`  • Port:              ${config.port}`);
  console.log(`  • Environment:       ${config.nodeEnv}`);
  console.log(`  • Log Level:         ${config.logLevel}`);
  console.log(`  • Kubeconfig:        ${config.kubeConfig || "~/.kube/config (default)"}`);
  console.log(`  • kubectl Available: ${k8sInfo.available ? "✓ Yes" : "✗ No"}`);
  if (k8sInfo.available && k8sInfo.context) {
    console.log(`  • K8s Context:       ${k8sInfo.context}`);
  }
  console.log(`  • Deploy Timeout:    ${config.deployTimeoutMs}ms`);
  console.log(`  • Metrics Interval:  ${config.metricsIntervalMs}ms`);
}
