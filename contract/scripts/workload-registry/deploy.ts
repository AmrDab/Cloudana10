import { ethers } from "hardhat";
import { deployWithRetry, waitForPendingTransactions, delay, saveContractInfo } from "../utils/deploy-utils";

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying WorkloadRegistry with account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());
  
  await waitForPendingTransactions(deployer);
  await delay(1000);

  // Deploy WorkloadRegistry
  const WorkloadRegistry = await ethers.getContractFactory("WorkloadRegistry");
  const workloadRegistry = await deployWithRetry(
    WorkloadRegistry,
    [],
    "WorkloadRegistry",
    deployer
  );
  const workloadRegistryAddress = await workloadRegistry.getAddress();
  console.log("WorkloadRegistry deployed to:", workloadRegistryAddress);

  // Get network info
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const networkName = network.name === "unknown" ? "baseSepolia" : network.name;

  // Save contract info
  await saveContractInfo("WorkloadRegistry", workloadRegistryAddress, networkName, chainId);

  console.log("\n=== WorkloadRegistry Deployment Summary ===");
  console.log("WorkloadRegistry:", workloadRegistryAddress);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
