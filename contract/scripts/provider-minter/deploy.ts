import { ethers } from "hardhat";
import { deployWithRetry, waitForPendingTransactions, delay, saveContractInfo, sendTransactionWithRetry } from "../utils/deploy-utils";

async function main() {
  const [deployer] = await ethers.getSigners();

  // Addresses from shared/addresses.baseSepolia.json
  const CLD_TOKEN = process.env.CLD_TOKEN_ADDRESS || "0xcfd19DF5a3f963Dabf52aC7B46d4780Cc0E599e2";
  const PROVIDER_REGISTRY = process.env.PROVIDER_REGISTRY_ADDRESS || "0x1e7b0039bdC27cB6B1e83d96D5Ad839fD15Af94a";

  console.log("Deploying ProviderMinter with account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());
  console.log("CLDToken:", CLD_TOKEN);
  console.log("ProviderRegistry:", PROVIDER_REGISTRY);

  await waitForPendingTransactions(deployer);
  await delay(1000);

  // Deploy ProviderMinter
  const ProviderMinter = await ethers.getContractFactory("ProviderMinter");
  const minter = await deployWithRetry(
    ProviderMinter,
    [CLD_TOKEN, PROVIDER_REGISTRY],
    "ProviderMinter",
    deployer
  );
  const minterAddress = await minter.getAddress();
  console.log("ProviderMinter deployed to:", minterAddress);

  // Grant MINTER_ROLE on CLDToken to ProviderMinter
  console.log("\nGranting MINTER_ROLE to ProviderMinter...");
  const cldToken = await ethers.getContractAt("CLDToken", CLD_TOKEN);
  const MINTER_ROLE = await cldToken.MINTER_ROLE();
  await sendTransactionWithRetry(cldToken, "grantRole", [MINTER_ROLE, minterAddress], deployer);
  console.log("MINTER_ROLE granted to ProviderMinter");

  // Get network info
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const networkName = network.name === "unknown" ? "baseSepolia" : network.name;

  // Save contract info
  await saveContractInfo("ProviderMinter", minterAddress, networkName, chainId);

  console.log("\n=== ProviderMinter Deployment Summary ===");
  console.log("ProviderMinter:", minterAddress);
  console.log("CLDToken:", CLD_TOKEN);
  console.log("ProviderRegistry:", PROVIDER_REGISTRY);
  console.log("MINTER_ROLE granted: yes");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
