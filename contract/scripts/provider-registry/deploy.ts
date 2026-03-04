import { ethers } from "hardhat";
import { deployWithRetry, waitForPendingTransactions, delay, saveContractInfo } from "../utils/deploy-utils";

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying ProviderRegistry with account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  await waitForPendingTransactions(deployer);
  await delay(1000);

  const ProviderRegistry = await ethers.getContractFactory("ProviderRegistry");
  const providerRegistry = await deployWithRetry(
    ProviderRegistry,
    [],
    "ProviderRegistry",
    deployer
  );
  const address = await providerRegistry.getAddress();
  console.log("ProviderRegistry deployed to:", address);

  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const networkName = network.name === "unknown" ? "baseSepolia" : network.name;

  await saveContractInfo("ProviderRegistry", address, networkName, chainId);

  console.log("\n=== ProviderRegistry Deployment Summary ===");
  console.log("ProviderRegistry:", address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
