import { ethers } from "hardhat";
import { verifyContract, loadAddresses, getNetworkName } from "../utils/verify-utils";

async function main() {
  const networkName = await getNetworkName();
  const addresses = loadAddresses(networkName);

  console.log("Verifying RewardContract on", networkName, "...");
  console.log("RewardContract Address:", addresses.contracts.RewardContract);

  if (!addresses.contracts.RewardContract) {
    throw new Error("RewardContract address not found in addresses file");
  }

  // Get deployed contract instance to read constructor arguments
  const rewardContract = await ethers.getContractAt(
    "RewardContract",
    addresses.contracts.RewardContract
  );
  const settlementToken = await rewardContract.settlementToken();

  console.log("\nConstructor Arguments:");
  console.log("SettlementToken (CLD):", settlementToken);

  // Verify RewardContract
  // Constructor: constructor(address _settlementToken)
  await verifyContract(
    "RewardContract",
    addresses.contracts.RewardContract,
    [settlementToken],
    networkName
  );

  console.log("\n=== RewardContract Verification Complete ===");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
