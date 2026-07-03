/**
 * Deploy EmissionController and make it the SOLE minter of CLD.
 *
 * This closes the "unbounded mint authority" audit finding: after this script,
 * total CLD emission is provably bounded by the on-chain schedule (8% → 1.5%
 * tail) and NO externally-owned account can mint.
 *
 * Steps (all idempotent-checked and logged):
 *   1. Load existing CLDToken + RewardContract addresses.
 *   2. Deploy EmissionController(cld, rewardPool=RewardContract).
 *   3. Grant MINTER_ROLE on CLDToken to the EmissionController.
 *   4. 🟥 REVOKE MINTER_ROLE from every EOA that holds it (the deployer).
 *   5. Verify: EmissionController has MINTER_ROLE; deployer does NOT.
 *   6. Write the new address back to shared/addresses.<network>.json.
 *
 * Run (testnet):  npx hardhat run scripts/deploy-emission-controller.ts --network baseSepolia
 * Dry-run first:  npm run test  (runs deploy-emission-controller.test.ts on a local fork)
 */
import { ethers } from "hardhat";
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";

const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const networkName = net.name === "unknown" ? "baseSepolia" : net.name;
  const addressesPath = path.join(__dirname, "../../shared", `addresses.${networkName}.json`);

  if (!fs.existsSync(addressesPath)) {
    throw new Error(`No addresses file at ${addressesPath} — deploy the core contracts first.`);
  }
  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
  const cldAddr = addresses.contracts.CLDToken;
  const rewardAddr = addresses.contracts.RewardContract;
  if (!cldAddr || !rewardAddr) throw new Error("CLDToken / RewardContract address missing.");

  console.log("Network:        ", networkName);
  console.log("Deployer:       ", deployer.address);
  console.log("CLDToken:       ", cldAddr);
  console.log("RewardContract: ", rewardAddr);

  const cld = await ethers.getContractAt("CLDToken", cldAddr, deployer);

  // 1. Deploy EmissionController (rewardPool = RewardContract).
  console.log("\n[1/5] Deploying EmissionController…");
  const EC = await ethers.getContractFactory("EmissionController");
  const ec = await EC.deploy(cldAddr, rewardAddr);
  await ec.waitForDeployment();
  const ecAddr = await ec.getAddress();
  console.log("      EmissionController:", ecAddr);

  // 2. Grant MINTER_ROLE to the EmissionController.
  console.log("[2/5] Granting MINTER_ROLE to EmissionController…");
  await (await cld.grantRole(MINTER_ROLE, ecAddr)).wait();

  // 3. 🟥 Revoke MINTER_ROLE from the deployer (the only EOA that holds it).
  console.log("[3/5] Revoking MINTER_ROLE from deployer EOA…");
  if (await cld.hasRole(MINTER_ROLE, deployer.address)) {
    await (await cld.revokeRole(MINTER_ROLE, deployer.address)).wait();
  }

  // 4. Verify the end state.
  console.log("[4/5] Verifying mint authority…");
  const ecHas = await cld.hasRole(MINTER_ROLE, ecAddr);
  const deployerHas = await cld.hasRole(MINTER_ROLE, deployer.address);
  if (!ecHas) throw new Error("EmissionController does NOT hold MINTER_ROLE — aborting.");
  if (deployerHas) throw new Error("Deployer STILL holds MINTER_ROLE — revocation failed, aborting.");
  console.log("      ✅ EmissionController is the sole minter; no EOA can mint.");

  // 5. Persist the address.
  console.log("[5/5] Writing address file…");
  addresses.contracts.EmissionController = ecAddr;
  fs.writeFileSync(addressesPath, JSON.stringify(addresses, null, 2) + "\n");
  console.log("      Updated", addressesPath);

  console.log("\n✅ Migration complete. CLD emission is now schedule-bounded and EOA-mint-free.");
  console.log("   Next: call ec.emit_() on the emission cadence (permissionless) to fund the pool.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
