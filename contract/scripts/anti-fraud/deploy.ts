import { ethers } from "hardhat";
import { deployWithRetry, waitForPendingTransactions, delay, saveContractInfo } from "../utils/deploy-utils";
import * as fs from "fs";
import * as path from "path";

/**
 * Deploy anti-fraud contracts:
 *   StakingManager — CLD staking/slashing (MVP mode: no minimum stake)
 *
 * MVP mode is enabled by default on both StakingManager and ProviderRegistry:
 *   - No minimum stake required to register as provider
 *   - Hardware fingerprint not required (Sybil protection deferred post-launch)
 *   - Call disableMvpMode() on each contract when ready to enforce requirements
 */
async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("\n🛡️  Deploying Cloudana Anti-Fraud Contracts");
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");
  console.log("Network: Base Sepolia (84532)");
  console.log("MVP Mode: ON (no bond required, fingerprint optional)\n");

  await waitForPendingTransactions(deployer);

  // Load existing addresses
  const sharedDir = path.join(__dirname, "../../../shared");
  const addressesFile = path.join(sharedDir, "addresses.baseSepolia.json");
  const addresses = JSON.parse(fs.readFileSync(addressesFile, "utf8"));
  const cldTokenAddress = addresses.contracts.CLDToken;

  console.log("Using CLDToken at:", cldTokenAddress);

  // ── 1. StakingManager ────────────────────────────────────────────────────────
  await delay(2000);
  const StakingManager = await ethers.getContractFactory("StakingManager");
  const stakingManager = await deployWithRetry(
    StakingManager,
    [cldTokenAddress],
    "StakingManager",
    deployer
  );
  const stakingManagerAddress = await stakingManager.getAddress();

  await saveContractInfo("StakingManager", stakingManagerAddress, "baseSepolia", 84532);

  // ── 2. Summary ───────────────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  Anti-Fraud Deployment Summary");
  console.log("═══════════════════════════════════════════════════");
  console.log("  StakingManager:   ", stakingManagerAddress);
  console.log("───────────────────────────────────────────────────");
  console.log("  MVP Mode: ON");
  console.log("  → No minimum stake required");
  console.log("  → Hardware fingerprint optional");
  console.log("  → Run disableMvpMode() on each contract at launch");
  console.log("═══════════════════════════════════════════════════\n");

  // Verify on Basescan
  console.log("To verify on Basescan:");
  console.log(`  npx hardhat verify --network baseSepolia ${stakingManagerAddress} "${cldTokenAddress}"`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
