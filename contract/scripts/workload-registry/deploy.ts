import { ethers } from "hardhat";
import { deployWithRetry, waitForPendingTransactions, delay, saveContractInfo } from "../utils/deploy-utils";
import "dotenv/config";

const ORCHESTRATOR_ADDRESS = process.env.ORCHESTRATOR_ADDRESS;

if (!ORCHESTRATOR_ADDRESS) {
  throw new Error("ORCHESTRATOR_ADDRESS is not set");
}

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

  // Grant ORCHESTRATOR_ROLE to orchestrator address if provided
  // Use locally computed role id (keccak256("ORCHESTRATOR_ROLE")) to avoid dependency on contract getter ABI
  if (ORCHESTRATOR_ADDRESS) {
    const ORCHESTRATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORCHESTRATOR_ROLE"));
    const tx = await workloadRegistry.grantRole(ORCHESTRATOR_ROLE, ethers.getAddress(ORCHESTRATOR_ADDRESS));
    await tx.wait();
    console.log("Granted ORCHESTRATOR_ROLE to:", ORCHESTRATOR_ADDRESS);
  } else {
    console.log("To grant ORCHESTRATOR_ROLE to your orchestrator backend, set ORCHESTRATOR_ADDRESS and re-run, or run:");
    console.log("  workloadRegistry.grantRole(await workloadRegistry.ORCHESTRATOR_ROLE(), orchestratorAddress)");
  }

  console.log("\n=== WorkloadRegistry Deployment Summary ===");
  console.log("WorkloadRegistry:", workloadRegistryAddress);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
