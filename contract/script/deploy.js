const hre = require("hardhat");

async function main() {
  const ONE_YEAR_IN_SECS = 365 * 24 * 60 * 60;
  const ONE_GWEI = 1_000_000_000;

  const lockedAmount = ONE_GWEI;
  const unlockTime = Math.floor(Date.now() / 1000) + ONE_YEAR_IN_SECS;

  // Get signers
  const [owner] = await hre.ethers.getSigners();
  console.log("Deploying contracts with account:", owner.address);

  // Deploy Lock contract
  const Lock = await hre.ethers.getContractFactory("Lock");
  console.log("Deploying Lock contract...");
  const lock = await Lock.deploy(unlockTime, { value: lockedAmount });

  await lock.waitForDeployment();
  const lockAddress = await lock.getAddress();

  console.log("Lock contract deployed to:", lockAddress);
  console.log("Unlock time:", unlockTime);
  console.log("Locked amount:", lockedAmount.toString());

  // Verify contract if not on local network
  if (hre.network.name !== "hardhat" && hre.network.name !== "localhost") {
    console.log("Waiting for block confirmations...");
    await lock.deploymentTransaction()?.wait(5);

    console.log("Verifying contract on explorer...");
    try {
      await hre.run("verify:verify", {
        address: lockAddress,
        constructorArguments: [unlockTime],
      });
      console.log("Contract verified successfully!");
    } catch (error) {
      if (error.message.includes("Already Verified")) {
        console.log("Contract is already verified!");
      } else {
        console.error("Verification failed:", error.message);
        // Don't throw - deployment was successful even if verification fails
      }
    }
  } else {
    console.log("Skipping verification on local network");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
