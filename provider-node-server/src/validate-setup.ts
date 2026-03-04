/**
 * Provider Node Setup Validator
 * 
 * Validates that the provider node is correctly configured for external deployment.
 * Run this before starting the provider node in production.
 * 
 * Usage: tsx src/validate-setup.ts
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

console.log("\n═══════════════════════════════════════════════════════════════");
console.log("  Cloudana Provider Node — Setup Validation");
console.log("═══════════════════════════════════════════════════════════════\n");

let errors = 0;
let warnings = 0;

// Check 1: Verify NOT running inside Kubernetes
console.log("✓ Check 1: Deployment Architecture");
if (process.env.KUBERNETES_SERVICE_HOST) {
  console.log("  ✗ FAIL: Running inside Kubernetes (KUBERNETES_SERVICE_HOST detected)");
  console.log(`    Value: ${process.env.KUBERNETES_SERVICE_HOST}:${process.env.KUBERNETES_SERVICE_PORT}`);
  console.log("    ⚠️  Provider nodes MUST run OUTSIDE Kubernetes!");
  console.log("    Deploy this service on an external management server.");
  errors++;
} else {
  console.log("  ✓ PASS: Running in external mode (no in-cluster variables)");
}

// Check 2: kubectl installed
console.log("\n✓ Check 2: kubectl Installation");
try {
  const kubectlVersion = execSync("kubectl version --client --output=json 2>/dev/null", {
    encoding: "utf8",
  });
  const versionData = JSON.parse(kubectlVersion);
  const version = versionData.clientVersion?.gitVersion || "unknown";
  console.log(`  ✓ PASS: kubectl installed (${version})`);
} catch (e) {
  console.log("  ✗ FAIL: kubectl not found");
  console.log("    Install kubectl: https://kubernetes.io/docs/tasks/tools/");
  errors++;
}

// Check 3: kubeconfig exists
console.log("\n✓ Check 3: Kubeconfig File");
const kubeconfigPath = process.env.KUBECONFIG || join(homedir(), ".kube", "config");
if (existsSync(kubeconfigPath)) {
  console.log(`  ✓ PASS: Kubeconfig found at ${kubeconfigPath}`);
  
  // Check if it's valid
  try {
    const config = readFileSync(kubeconfigPath, "utf8");
    if (config.includes("clusters:") && config.includes("users:")) {
      console.log("  ✓ Valid kubeconfig structure");
    } else {
      console.log("  ⚠  Warning: Kubeconfig may be malformed");
      warnings++;
    }
  } catch (e) {
    console.log("  ⚠  Warning: Cannot read kubeconfig");
    warnings++;
  }
} else {
  console.log(`  ✗ FAIL: Kubeconfig not found at ${kubeconfigPath}`);
  console.log("    Configure kubectl: kubectl config view");
  errors++;
}

// Check 4: kubectl can access cluster
console.log("\n✓ Check 4: Kubernetes Cluster Access");
try {
  const currentContext = execSync("kubectl config current-context 2>/dev/null", {
    encoding: "utf8",
  }).trim();
  console.log(`  ✓ PASS: Current context: ${currentContext}`);
  
  // Try to access cluster
  try {
    execSync("kubectl get nodes 2>/dev/null", { encoding: "utf8" });
    console.log("  ✓ PASS: Can access Kubernetes cluster");
  } catch (e) {
    console.log("  ⚠  Warning: Cannot access cluster (kubectl get nodes failed)");
    console.log("    Check cluster connectivity and credentials");
    warnings++;
  }
} catch (e) {
  console.log("  ✗ FAIL: No kubectl context configured");
  console.log("    Configure kubectl: kubectl config use-context <context-name>");
  errors++;
}

// Check 5: Node.js version
console.log("\n✓ Check 5: Node.js Version");
const nodeVersion = process.version;
const major = parseInt(nodeVersion.slice(1).split(".")[0]);
if (major >= 18) {
  console.log(`  ✓ PASS: Node.js ${nodeVersion} (>= 18)`);
} else {
  console.log(`  ✗ FAIL: Node.js ${nodeVersion} (< 18)`);
  console.log("    Upgrade to Node.js 18 or higher");
  errors++;
}

// Check 6: Required npm packages
console.log("\n✓ Check 6: Dependencies");
try {
  const packageJson = JSON.parse(
    readFileSync(join(process.cwd(), "package.json"), "utf8")
  );
  const required = ["@kubernetes/client-node", "hono", "pino"];
  let allInstalled = true;
  
  for (const pkg of required) {
    if (packageJson.dependencies?.[pkg]) {
      console.log(`  ✓ ${pkg}`);
    } else {
      console.log(`  ✗ ${pkg} missing`);
      allInstalled = false;
    }
  }
  
  if (allInstalled) {
    console.log("  ✓ PASS: All required dependencies declared");
  } else {
    console.log("  ⚠  Warning: Some dependencies missing");
    warnings++;
  }
} catch (e) {
  console.log("  ⚠  Warning: Cannot read package.json");
  warnings++;
}

// Check 7: Port availability
console.log("\n✓ Check 7: Port Availability");
const port = Number(process.env.PROVIDER_NODE_PORT ?? 4040);
try {
  const netstat = execSync(`netstat -tuln 2>/dev/null | grep :${port} || true`, {
    encoding: "utf8",
  });
  if (netstat.trim()) {
    console.log(`  ⚠  Warning: Port ${port} may already be in use`);
    console.log(`    ${netstat.trim()}`);
    warnings++;
  } else {
    console.log(`  ✓ PASS: Port ${port} appears available`);
  }
} catch (e) {
  console.log(`  ⚠  Info: Cannot check port (netstat not available)`);
}

// Summary
console.log("\n═══════════════════════════════════════════════════════════════");
console.log("  Validation Summary");
console.log("═══════════════════════════════════════════════════════════════");

if (errors === 0 && warnings === 0) {
  console.log("  ✓ ALL CHECKS PASSED");
  console.log("\n  ✓ Ready to start provider node:");
  console.log("    npm run dev        # Development");
  console.log("    npm start          # Production");
  console.log("    npm run start:pm2  # Production with PM2");
  console.log("\n═══════════════════════════════════════════════════════════════\n");
  process.exit(0);
} else {
  console.log(`  ${errors} error(s), ${warnings} warning(s)`);
  
  if (errors > 0) {
    console.log("\n  ✗ Fix errors before starting provider node");
    console.log("\n═══════════════════════════════════════════════════════════════\n");
    process.exit(1);
  } else {
    console.log("\n  ⚠  Warnings detected but provider can start");
    console.log("    Review warnings above before production deployment");
    console.log("\n═══════════════════════════════════════════════════════════════\n");
    process.exit(0);
  }
}
