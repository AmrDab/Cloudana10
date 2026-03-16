import { ethers } from "hardhat";
import { verifyContract, loadAddresses, getNetworkName } from "../utils/verify-utils";

async function main() {
  const networkName = await getNetworkName();
  const addresses = loadAddresses(networkName);

  console.log("Verifying CLDToken on", networkName, "...");
  console.log("CLDToken Address:", addresses.contracts.CLDToken);

  if (!addresses.contracts.CLDToken) {
    throw new Error("CLDToken address not found in addresses file");
  }

  // Get deployed contract instance to read constructor arguments
  const cldToken = await ethers.getContractAt("CLDToken", addresses.contracts.CLDToken);
  
  // Read constructor arguments from deployed contract
  const treasuryWallet = await cldToken.treasuryWallet();
  const teamWallet = await cldToken.teamWallet();

  console.log("\nConstructor Arguments:");
  console.log("Treasury Wallet:", treasuryWallet);
  console.log("Team Wallet:", teamWallet);

  // Verify CLDToken
  // Constructor: constructor(address _treasuryWallet, address _teamWallet)
  await verifyContract(
    "CLDToken",
    addresses.contracts.CLDToken,
    [treasuryWallet, teamWallet],
    networkName
  );

  console.log("\n=== CLDToken Verification Complete ===");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
