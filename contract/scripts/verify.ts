import { run } from "hardhat";
import { ethers } from "hardhat";

async function main() {
  const addresses = require("../../shared/addresses.baseSepolia.json");
  const network = await ethers.provider.getNetwork();

  console.log("Verifying contracts on", network.name, "...");

  // Get deployed contract instances to read constructor arguments
  const cldToken = await ethers.getContractAt("CLDToken", addresses.contracts.CLDToken);
  const ProviderRegistry = await ethers.getContractAt("ProviderRegistry", addresses.contracts.ProviderRegistry);

  // Read constructor arguments from deployed contracts
  const treasuryWallet = await cldToken.treasuryWallet();
  const teamWallet = await cldToken.teamWallet();

  console.log("\nConstructor Arguments:");
  console.log("Treasury Wallet:", treasuryWallet);
  console.log("Team Wallet:", teamWallet);
  console.log("CLDToken Address:", addresses.contracts.CLDToken);
  console.log("ProviderRegistry Address:", addresses.contracts.ProviderRegistry);
  console.log("JobEscrow Address:", addresses.contracts.JobEscrow);

  // Verify CLDToken
  // Constructor: constructor(address _treasuryWallet, address _teamWallet)
  // try {
  //   console.log("\nVerifying CLDToken...");
  //   await run("verify:verify", {
  //     address: addresses.contracts.CLDToken,
  //     constructorArguments: [treasuryWallet, teamWallet],
  //   });
  //   console.log("✅ CLDToken verified");
  // } catch (error: any) {
  //   if (error.message.includes("Already Verified")) {
  //     console.log("✅ CLDToken already verified");
  //   } else {
  //     console.error("❌ CLDToken verification error:", error.message);
  //   }
  // }

  // Verify ProviderRegistry
  // Constructor: constructor(address _cldToken, address _teamWallet, address _treasuryWallet)
  try {
    console.log("\nVerifying ProviderRegistry...");
    await run("verify:verify", {
      address: addresses.contracts.ProviderRegistry,
      constructorArguments: [addresses.contracts.CLDToken, teamWallet, treasuryWallet],
    });
    console.log("✅ ProviderRegistry verified");
  } catch (error: any) {
    if (error.message.includes("Already Verified")) {
      console.log("✅ ProviderRegistry already verified");
    } else {
      console.error("❌ ProviderRegistry verification error:", error.message);
    }
  }

  // Verify JobEscrow
  // Constructor: constructor(address _cldToken, address _providerRegistry)
  // try {
  //   console.log("\nVerifying JobEscrow...");
  //   await run("verify:verify", {
  //     address: addresses.contracts.JobEscrow,
  //     constructorArguments: [addresses.contracts.CLDToken, addresses.contracts.ProviderRegistry],
  //   });
  //   console.log("✅ JobEscrow verified");
  // } catch (error: any) {
  //   if (error.message.includes("Already Verified")) {
  //     console.log("✅ JobEscrow already verified");
  //   } else {
  //     console.error("❌ JobEscrow verification error:", error.message);
  //   }
  // }

  console.log("\n=== Verification Summary ===");
  console.log("All contracts have been processed for verification");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

