import * as fs from "fs";
import * as path from "path";

async function exportCLDTokenABI() {
  const artifactsPath = path.join(__dirname, "../../artifacts/contracts");
  const sharedAbiPath = path.join(__dirname, "../../../shared/abi");
  
  // Ensure shared/abi directory exists
  if (!fs.existsSync(sharedAbiPath)) {
    fs.mkdirSync(sharedAbiPath, { recursive: true });
  }
  
  // Export CLDToken ABI
  const cldTokenArtifactPath = path.join(
    artifactsPath,
    "CLDToken.sol/CLDToken.json"
  );
  
  if (fs.existsSync(cldTokenArtifactPath)) {
    const artifact = JSON.parse(fs.readFileSync(cldTokenArtifactPath, "utf8"));
    const abiPath = path.join(sharedAbiPath, "CLDToken.json");
    fs.writeFileSync(abiPath, JSON.stringify(artifact.abi, null, 2));
    console.log(`✓ Exported CLDToken ABI to ${abiPath}`);
  } else {
    console.error(`✗ CLDToken artifact not found at ${cldTokenArtifactPath}`);
    console.error("  Please run 'npm run compile' first");
    process.exit(1);
  }
  
  console.log("✓ CLDToken ABI export complete!");
}

exportCLDTokenABI()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
