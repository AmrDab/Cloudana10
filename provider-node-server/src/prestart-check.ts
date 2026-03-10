/**
 * Pre-start validation that runs before the server starts
 * Ensures provider node is correctly configured for external deployment
 */
import { loggers } from "./logger.js";

/**
 * Validate external deployment mode
 * Exits process if critical errors found
 */
export function validateExternalDeployment(): void {
  // Critical check: Not running inside Kubernetes
  if (process.env.KUBERNETES_SERVICE_HOST && process.env.KUBERNETES_SERVICE_PORT) {
    loggers.server.fatal(
      {
        KUBERNETES_SERVICE_HOST: process.env.KUBERNETES_SERVICE_HOST,
        KUBERNETES_SERVICE_PORT: process.env.KUBERNETES_SERVICE_PORT,
        exitCode: 1,
      },
      "🚨 FATAL: Provider node detected inside Kubernetes cluster! " +
      "Provider nodes MUST run OUTSIDE Kubernetes for security isolation. " +
      "Deploy this service on an external management server. " +
      "Exiting to prevent insecure deployment."
    );
    
    console.error("\n╔═══════════════════════════════════════════════════════════════╗");
    console.error("║  🚨 FATAL DEPLOYMENT ERROR                                    ║");
    console.error("╚═══════════════════════════════════════════════════════════════╝");
    console.error("");
    console.error("  Provider node is running inside a Kubernetes cluster!");
    console.error("  This violates the security architecture.");
    console.error("");
    console.error("  WHY THIS IS CRITICAL:");
    console.error("  • Provider control plane must be isolated from tenant workloads");
    console.error("  • Provider manages earnings and business logic");
    console.error("  • Security boundary prevents tenant access to provider internals");
    console.error("");
    console.error("  SOLUTION:");
    console.error("  Deploy provider node on an EXTERNAL management server:");
    console.error("  1. Set up a VM or bare metal server");
    console.error("  2. Install kubectl and configure access to K8s");
    console.error("  3. Run provider node there: npm run start:pm2");
    console.error("");
    console.error("  See: provider-node-server/README.md for deployment guide");
    console.error("");
    console.error("╚═══════════════════════════════════════════════════════════════╝\n");
    
    process.exit(1);
  }
  
  loggers.server.info("✓ External deployment validated - not running inside Kubernetes");
}

/**
 * Validate required environment
 */
export function validateEnvironment(): void {
  // Check Node.js version
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1).split(".")[0]);
  
  if (major < 18) {
    loggers.server.fatal(
      { nodeVersion, requiredVersion: ">=18", exitCode: 1 },
      "Node.js version too old. Required: >=18"
    );
    console.error("\n🚨 ERROR: Node.js version too old");
    console.error(`  Current: ${nodeVersion}`);
    console.error(`  Required: >=18`);
    console.error("\n  Install Node.js 18+: https://nodejs.org/\n");
    process.exit(1);
  }
  
  loggers.server.debug({ nodeVersion }, `Node.js version check passed: ${nodeVersion}`);
}

/**
 * Check kubeconfig availability (warning only)
 */
export async function checkKubeconfigAvailability(): Promise<void> {
  const kubeconfigPath = process.env.KUBECONFIG || `${process.env.HOME}/.kube/config`;
  
  try {
    const { existsSync } = await import("node:fs");
    if (!existsSync(kubeconfigPath)) {
      loggers.k8s.warn(
        { kubeconfigPath },
        "Kubeconfig not found - K8s features will be unavailable. " +
        "Docker fallback will be used for workload execution."
      );
      console.log("\n⚠️  Warning: Kubeconfig not found");
      console.log(`    Path: ${kubeconfigPath}`);
      console.log("    K8s workloads will fail - Docker fallback available");
      console.log("    Configure kubectl: kubectl config view\n");
    } else {
      loggers.k8s.info({ kubeconfigPath }, "Kubeconfig found");
    }
  } catch (e) {
    loggers.k8s.debug("Cannot check kubeconfig existence");
  }
}

/**
 * Run all pre-start validations
 */
export async function runPreStartValidation(): Promise<void> {
  loggers.server.info("Running pre-start validation checks...");
  
  try {
    validateExternalDeployment();
    validateEnvironment();
    await checkKubeconfigAvailability();
    
    loggers.server.info("✓ All pre-start validation checks passed");
  } catch (e) {
    loggers.server.fatal(
      { error: e instanceof Error ? e.message : String(e) },
      "Pre-start validation failed"
    );
    throw e;
  }
}
