import * as fs from "fs";
import * as path from "path";

async function main() {
  const artifactsPath = path.join(__dirname, "../../artifacts/contracts");
  const sharedAbiPath = path.join(__dirname, "../../../shared/abi");
  const artifactPath = path.join(artifactsPath, "ProviderRegistry.sol/ProviderRegistry.json");

  if (!fs.existsSync(sharedAbiPath)) {
    fs.mkdirSync(sharedAbiPath, { recursive: true });
  }
  if (!fs.existsSync(artifactPath)) {
    console.error("ProviderRegistry artifact not found. Run 'npm run compile' first.");
    process.exit(1);
  }
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  fs.writeFileSync(
    path.join(sharedAbiPath, "ProviderRegistry.json"),
    JSON.stringify(artifact.abi, null, 2)
  );
  console.log("Exported ProviderRegistry ABI to shared/abi/ProviderRegistry.json");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
