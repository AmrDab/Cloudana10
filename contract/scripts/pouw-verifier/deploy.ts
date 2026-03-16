/**
 * Deploy POUWVerifier contract.
 *
 * Usage:
 *   npx hardhat run scripts/pouw-verifier/deploy.ts --network baseSepolia
 *
 * Env:
 *   ORCHESTRATOR_ADDRESS — wallet address to grant ORCHESTRATOR_ROLE.
 */
import { ethers } from "hardhat";
import { deployWithRetry, waitForPendingTransactions, delay, saveContractInfo } from "../utils/deploy-utils";
import "dotenv/config";

const ORCHESTRATOR_ADDRESS = process.env.ORCHESTRATOR_ADDRESS;

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const networkName = network.name === "unknown" ? "baseSepolia" : network.name;

  console.log("Deploying POUWVerifier with account:", deployer.address);
  console.log("Network:", networkName, `(chainId: ${chainId})`);

  await waitForPendingTransactions(deployer);
  await delay(1000);

  const POUWVerifier = await ethers.getContractFactory("POUWVerifier");
  const verifier = await deployWithRetry(POUWVerifier, [], "POUWVerifier", deployer);
  const address = await verifier.getAddress();
  console.log("POUWVerifier deployed to:", address);

  await saveContractInfo("POUWVerifier", address, networkName, chainId);

  // Grant ORCHESTRATOR_ROLE
  if (ORCHESTRATOR_ADDRESS) {
    const ORCHESTRATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORCHESTRATOR_ROLE"));
    const tx = await verifier.grantRole(ORCHESTRATOR_ROLE, ethers.getAddress(ORCHESTRATOR_ADDRESS));
    await tx.wait();
    console.log("Granted ORCHESTRATOR_ROLE to:", ORCHESTRATOR_ADDRESS);
  } else {
    console.log("No ORCHESTRATOR_ADDRESS set — grant ORCHESTRATOR_ROLE manually before use.");
  }

  console.log("\n=== POUWVerifier Deployment Summary ===");
  console.log("POUWVerifier:", address);
  console.log("\nAdd to .env:");
  console.log(`  POUW_VERIFIER_CONTRACT_ADDRESS=${address}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
