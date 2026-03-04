import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { deployWithRetry, waitForPendingTransactions, delay, saveContractInfo } from "../utils/deploy-utils";
import "dotenv/config";

const ORCHESTRATOR_ADDRESS = process.env.ORCHESTRATOR_ADDRESS;

if (!ORCHESTRATOR_ADDRESS) {
  throw new Error("ORCHESTRATOR_ADDRESS is not set");
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const networkName = network.name === "unknown" ? "baseSepolia" : network.name;

  const addressesPath = path.join(__dirname, "../../../shared", `addresses.${networkName}.json`);
  if (!fs.existsSync(addressesPath)) {
    throw new Error(`Addresses file not found: ${addressesPath}. Deploy CLDToken first.`);
  }
  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
  const cldTokenAddress = addresses.contracts?.CLDToken;
  if (!cldTokenAddress) {
    throw new Error("CLDToken address not found in shared addresses. Deploy CLDToken first.");
  }

  console.log("Deploying RewardContract with account:", deployer.address);
  console.log("CLDToken (settlement):", cldTokenAddress);

  await waitForPendingTransactions(deployer);
  await delay(1000);

  const RewardContract = await ethers.getContractFactory("RewardContract");
  const rewardContract = await deployWithRetry(
    RewardContract,
    [cldTokenAddress],
    "RewardContract",
    deployer
  );
  const address = await rewardContract.getAddress();
  console.log("RewardContract deployed to:", address);

  await saveContractInfo("RewardContract", address, networkName, chainId);

  // Grant ORCHESTRATOR_ROLE to ORCHESTRATOR_ADDRESS if provided
  // Use locally computed role id (keccak256("ORCHESTRATOR_ROLE")) to avoid dependency on contract getter ABI
  if (ORCHESTRATOR_ADDRESS) {
    const ORCHESTRATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORCHESTRATOR_ROLE"));
    const tx = await rewardContract.grantRole(ORCHESTRATOR_ROLE, ethers.getAddress(ORCHESTRATOR_ADDRESS));
    await tx.wait();
    console.log("Granted ORCHESTRATOR_ROLE to:", ORCHESTRATOR_ADDRESS);
  } else {
    console.log("To grant ORCHESTRATOR_ROLE to your orchestrator backend, set ORCHESTRATOR_ADDRESS and re-run, or run:");
    console.log("  rewardContract.grantRole(await rewardContract.ORCHESTRATOR_ROLE(), ORCHESTRATOR_ADDRESS)");
  }

  console.log("\n=== RewardContract Deployment Summary ===");
  console.log("RewardContract:", address);
  console.log("SettlementToken (CLD):", cldTokenAddress);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
