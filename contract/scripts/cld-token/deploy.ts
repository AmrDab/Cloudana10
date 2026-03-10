import { ethers } from "hardhat";
import { deployWithRetry, waitForPendingTransactions, delay, saveContractInfo } from "../utils/deploy-utils";

async function main() {
  const [deployer] = await ethers.getSigners();
  
  const TEAM_WALLET = process.env.TEAM_WALLET || deployer.address;
  const TREASURY_WALLET = process.env.TREASURY_WALLET || deployer.address;

  console.log("Deploying CLDToken with account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());
  console.log("Team Wallet:", TEAM_WALLET);
  console.log("Treasury Wallet:", TREASURY_WALLET);
  
  await waitForPendingTransactions(deployer);
  await delay(1000);

  // Deploy CLDToken
  const CLDToken = await ethers.getContractFactory("CLDToken");
  const cldToken = await deployWithRetry(
    CLDToken,
    [TREASURY_WALLET, TEAM_WALLET],
    "CLDToken",
    deployer
  );
  const cldTokenAddress = await cldToken.getAddress();
  console.log("CLDToken deployed to:", cldTokenAddress);

  // Get network info
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const networkName = network.name === "unknown" ? "baseSepolia" : network.name;

  // Save contract info
  await saveContractInfo("CLDToken", cldTokenAddress, networkName, chainId);

  console.log("\n=== CLDToken Deployment Summary ===");
  console.log("CLDToken:", cldTokenAddress);
  console.log("Team Wallet:", TEAM_WALLET);
  console.log("Treasury Wallet:", TREASURY_WALLET);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
