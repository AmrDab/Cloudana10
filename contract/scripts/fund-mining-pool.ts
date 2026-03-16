/**
 * Fund the POUW mining rewards pool.
 * Mints 1M CLD to orchestrator, then deposits into RewardContract workload ID 999.
 * Run: npx hardhat run scripts/fund-mining-pool.ts --network baseSepolia
 */
import { ethers } from "hardhat";
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const networkName = network.name === "unknown" ? "baseSepolia" : network.name;
  
  const addressesPath = path.join(__dirname, "../../shared", `addresses.${networkName}.json`);
  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
  
  const cldAddr = addresses.contracts.CLDToken;
  const rewardAddr = addresses.contracts.RewardContract;
  const POOL_ID = 999n;
  const AMOUNT = ethers.parseUnits("1000000", 18); // 1M CLD
  
  console.log("Orchestrator:", deployer.address);
  console.log("CLDToken:", cldAddr);
  console.log("RewardContract:", rewardAddr);
  console.log("Pool workload ID:", POOL_ID.toString());
  console.log("Amount: 1,000,000 CLD");

  const cld = await ethers.getContractAt("CLDToken", cldAddr, deployer);
  const reward = await ethers.getContractAt("RewardContract", rewardAddr, deployer);

  // Check current balance
  const bal = await cld.balanceOf(deployer.address);
  console.log("\nCurrent CLD balance:", ethers.formatUnits(bal, 18));

  if (bal < AMOUNT) {
    console.log("Minting 1M CLD...");
    const tx = await cld.mint(deployer.address, AMOUNT);
    await tx.wait();
    console.log("Minted. New balance:", ethers.formatUnits(await cld.balanceOf(deployer.address), 18));
  }

  // Approve
  console.log("Approving RewardContract...");
  const approveTx = await cld.approve(rewardAddr, AMOUNT);
  await approveTx.wait();
  console.log("Approved.");

  // Fund workload pool
  console.log("Funding mining pool (workloadId=999)...");
  const fundTx = await reward.fundWorkload(POOL_ID, AMOUNT);
  await fundTx.wait();
  
  const poolBalance = await reward.workloadDeposits(POOL_ID);
  console.log("\n✅ Mining pool funded!");
  console.log("Pool balance:", ethers.formatUnits(poolBalance, 18), "CLD");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
