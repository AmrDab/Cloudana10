import { ethers } from "hardhat";
import { verifyContract, loadAddresses, getNetworkName } from "../utils/verify-utils";

async function main() {
  const networkName = await getNetworkName();
  const addresses = loadAddresses(networkName);

  console.log("Verifying WorkloadRegistry on", networkName, "...");
  console.log("WorkloadRegistry Address:", addresses.contracts.WorkloadRegistry);

  if (!addresses.contracts.WorkloadRegistry) {
    throw new Error("WorkloadRegistry address not found in addresses file");
  }

  console.log("\nConstructor Arguments:");
  console.log("No constructor arguments (empty constructor)");

  // Verify WorkloadRegistry
  // Constructor: constructor() - no arguments
  await verifyContract(
    "WorkloadRegistry",
    addresses.contracts.WorkloadRegistry,
    [],
    networkName
  );

  console.log("\n=== WorkloadRegistry Verification Complete ===");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
