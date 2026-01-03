import { run } from "hardhat";
import { ethers } from "hardhat";

async function main() {
  const addresses = require("../../shared/addresses.baseSepolia.json");
  const network = await ethers.provider.getNetwork();

  console.log("Verifying contracts on", network.name, "...");

  // Verify CLDToken
  try {
    await run("verify:verify", {
      address: addresses.contracts.CLDToken,
      constructorArguments: [],
    });
    console.log("CLDToken verified");
  } catch (error: any) {
    if (error.message.includes("Already Verified")) {
      console.log("CLDToken already verified");
    } else {
      console.error("CLDToken verification error:", error.message);
    }
  }

  // Verify ProviderRegistry
  try {
    await run("verify:verify", {
      address: addresses.contracts.ProviderRegistry,
      constructorArguments: [addresses.contracts.CLDToken],
    });
    console.log("ProviderRegistry verified");
  } catch (error: any) {
    if (error.message.includes("Already Verified")) {
      console.log("ProviderRegistry already verified");
    } else {
      console.error("ProviderRegistry verification error:", error.message);
    }
  }

  // Verify JobEscrow
  try {
    await run("verify:verify", {
      address: addresses.contracts.JobEscrow,
      constructorArguments: [addresses.contracts.CLDToken, addresses.contracts.ProviderRegistry],
    });
    console.log("JobEscrow verified");
  } catch (error: any) {
    if (error.message.includes("Already Verified")) {
      console.log("JobEscrow already verified");
    } else {
      console.error("JobEscrow verification error:", error.message);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

