/**
 * LOCAL ONLY. Deploy CLDToken + CloudanaSettlement to a `npx hardhat node` (chainId 1337).
 *   npx hardhat run scripts/local/deploy.ts --network localhost
 * Env: EPOCH_SECONDS (default 120, must match the API), VETO_DELAY_SECONDS (default 30).
 */
import { ethers, artifacts, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const SHARED = path.join(__dirname, "../../../shared");

async function main() {
  const { chainId } = await ethers.provider.getNetwork();
  if (chainId !== 1337n) throw new Error(`refusing to deploy: chainId ${chainId} is not the local 1337 chain`);

  const [deployer, treasury, team] = await ethers.getSigners();
  const epochSeconds = Number(process.env.EPOCH_SECONDS ?? 120);
  const vetoDelaySeconds = Number(process.env.VETO_DELAY_SECONDS ?? 30);
  const genesis = (await ethers.provider.getBlock("latest"))!.timestamp;

  const token = await (await ethers.getContractFactory("CLDToken")).deploy(treasury.address, team.address);
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  console.log(`CLDToken            ${tokenAddr}`);

  const settlement = await (await ethers.getContractFactory("CloudanaSettlement")).deploy(
    tokenAddr, deployer.address, deployer.address, deployer.address, epochSeconds, vetoDelaySeconds, genesis,
  );
  await settlement.waitForDeployment();
  const settlementAddr = await settlement.getAddress();
  // genesisEpoch = floor(genesis / epochSeconds), fixed in the constructor: epochs before it, or not yet elapsed, can't be posted.
  const genesisEpoch = Number(await settlement.genesisEpoch());
  console.log(`CloudanaSettlement  ${settlementAddr}  (genesisEpoch ${genesisEpoch})`);

  const MINTER_ROLE = await token.MINTER_ROLE();
  await (await token.grantRole(MINTER_ROLE, settlementAddr)).wait();
  await (await token.revokeRole(MINTER_ROLE, deployer.address)).wait();
  console.log(`MINTER_ROLE: settlement=${await token.hasRole(MINTER_ROLE, settlementAddr)} deployer=${await token.hasRole(MINTER_ROLE, deployer.address)}`);

  const addresses = {
    chainId: 1337,
    rpc: "http://127.0.0.1:8545",
    CLDToken: tokenAddr,
    CloudanaSettlement: settlementAddr,
    treasury: treasury.address,
    deployer: deployer.address,
    epochSeconds,
    vetoDelaySeconds,
    genesisEpoch,
  };
  fs.mkdirSync(path.join(SHARED, "abi"), { recursive: true });
  fs.writeFileSync(path.join(SHARED, "addresses.local.json"), JSON.stringify(addresses, null, 2) + "\n");
  for (const name of ["CloudanaSettlement", "CLDToken"]) {
    const file = path.join(SHARED, "abi", `${name}.json`);
    if (name === "CLDToken" && fs.existsSync(file)) continue; // already exported
    fs.writeFileSync(file, JSON.stringify((await artifacts.readArtifact(name)).abi, null, 2) + "\n");
  }
  console.log(`wrote shared/addresses.local.json + ABIs (network=${network.name}, epoch=${epochSeconds}s, veto=${vetoDelaySeconds}s)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
