import * as fs from "fs";
import * as path from "path";

async function exportWorkloadRegistryABI() {
  const artifactsPath = path.join(__dirname, "../../artifacts/contracts");
  const sharedAbiPath = path.join(__dirname, "../../../shared/abi");
  
  // Ensure shared/abi directory exists
  if (!fs.existsSync(sharedAbiPath)) {
    fs.mkdirSync(sharedAbiPath, { recursive: true });
  }
  
  // Export WorkloadRegistry ABI
  const workloadRegistryArtifactPath = path.join(
    artifactsPath,
    "WorkloadRegistry.sol/WorkloadRegistry.json"
  );
  
  if (fs.existsSync(workloadRegistryArtifactPath)) {
    const artifact = JSON.parse(fs.readFileSync(workloadRegistryArtifactPath, "utf8"));
    const abiPath = path.join(sharedAbiPath, "WorkloadRegistry.json");
    fs.writeFileSync(abiPath, JSON.stringify(artifact.abi, null, 2));
    console.log(`✓ Exported WorkloadRegistry ABI to ${abiPath}`);
  } else {
    console.error(`✗ WorkloadRegistry artifact not found at ${workloadRegistryArtifactPath}`);
    console.error("  Please run 'npm run compile' first");
    process.exit(1);
  }
  
  console.log("✓ WorkloadRegistry ABI export complete!");
}

exportWorkloadRegistryABI()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
