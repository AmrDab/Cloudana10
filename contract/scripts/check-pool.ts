import { ethers } from "hardhat";
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const addressesPath = path.join(__dirname, "../../shared", "addresses.baseSepolia.json");
  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
  const reward = await ethers.getContractAt("RewardContract", addresses.contracts.RewardContract, deployer);
  const cld = await ethers.getContractAt("CLDToken", addresses.contracts.CLDToken, deployer);
  
  const pool999 = await reward.workloadDeposits(999n);
  const pool0 = await reward.workloadDeposits(0n);
  const rewardBalance = await cld.balanceOf(addresses.contracts.RewardContract);
  const deployerBalance = await cld.balanceOf(deployer.address);
  
  console.log("RewardContract CLD balance:", ethers.formatUnits(rewardBalance, 18));
  console.log("Pool ID 999 deposit:", pool999.toString(), "raw /", ethers.formatUnits(pool999, 18), "CLD");
  console.log("Pool ID 0 deposit:", pool0.toString());
  console.log("Deployer CLD balance:", ethers.formatUnits(deployerBalance, 18));
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
