import { ethers } from "hardhat";
import { verifyContract, loadAddresses, getNetworkName } from "../utils/verify-utils";

async function main() {
  const networkName = await getNetworkName();
  const addresses = loadAddresses(networkName);

  console.log("Verifying ProviderRegistry on", networkName, "...");
  console.log("ProviderRegistry Address:", addresses.contracts.ProviderRegistry);

  if (!addresses.contracts.ProviderRegistry) {
    throw new Error("ProviderRegistry address not found in addresses file");
  }

  console.log("\nConstructor Arguments:");
  console.log("No constructor arguments (empty constructor)");

  // Verify ProviderRegistry
  // Constructor: constructor() - no arguments
  await verifyContract(
    "ProviderRegistry",
    addresses.contracts.ProviderRegistry,
    [],
    networkName
  );

  console.log("\n=== ProviderRegistry Verification Complete ===");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
