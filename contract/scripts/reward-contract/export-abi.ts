import * as fs from "fs";
import * as path from "path";

async function main() {
  const artifactsPath = path.join(__dirname, "../../artifacts/contracts");
  const sharedAbiPath = path.join(__dirname, "../../../shared/abi");
  const artifactPath = path.join(artifactsPath, "RewardContract.sol/RewardContract.json");

  if (!fs.existsSync(sharedAbiPath)) {
    fs.mkdirSync(sharedAbiPath, { recursive: true });
  }
  if (!fs.existsSync(artifactPath)) {
    console.error("RewardContract artifact not found. Run 'npm run compile' first.");
    process.exit(1);
  }
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  fs.writeFileSync(
    path.join(sharedAbiPath, "RewardContract.json"),
    JSON.stringify(artifact.abi, null, 2)
  );
  console.log("Exported RewardContract ABI to shared/abi/RewardContract.json");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
