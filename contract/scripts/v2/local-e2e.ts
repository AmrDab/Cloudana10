/**
 * LOCAL ONLY end-to-end for v2: deploy -> escrow -> postEpoch -> veto window -> finalize -> claim lane A ->
 * vest -> claim lane B. Uses evm_increaseTime, so it needs the hardhat node (or the in-process hardhat network).
 *   npx hardhat node                                              # terminal 1
 *   npx hardhat run scripts/v2/local-e2e.ts --network localhost   # terminal 2  (or --network hardhat)
 * Env: EPOCH_SECONDS (default 60), VETO_DELAY (60), VEST_B (60).
 * Writes a "v2" section into shared/addresses.local.json when run against localhost (other keys kept).
 */
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { deployV2, SHARED } from "./deploy";

const CLD = 10n ** 18n;
const log = (s: string) => console.log(`${new Date().toISOString()} ${s}`);

async function travel(seconds: number) {
  await network.provider.send("evm_increaseTime", [seconds]);
  await network.provider.send("evm_mine", []);
}

async function main() {
  const { chainId } = await ethers.provider.getNetwork();
  if (chainId !== 1337n && chainId !== 31337n) throw new Error(`refusing: chainId ${chainId} is not a local chain`);
  const [deployer, treasury, admin, user, provA, provB, poster, guardian] = await ethers.getSigners();
  const epochSeconds = Number(process.env.EPOCH_SECONDS ?? 60);
  const vetoDelaySeconds = Number(process.env.VETO_DELAY ?? 60);
  const vestBSeconds = Number(process.env.VEST_B ?? 60);
  const genesisTimestamp = (await ethers.provider.getBlock("latest"))!.timestamp;

  const r = await deployV2(deployer, {
    treasury: treasury.address, guardian: guardian.address, admin: admin.address, poster: poster.address,
    epochSeconds, vetoDelaySeconds, vestBSeconds, initialSupplyWei: 1_000_000n * CLD, maxMintBpsPerYear: 1000, genesisTimestamp,
  }, log);
  const token = await ethers.getContractAt("CLDTokenV2", r.token);
  const settlement = await ethers.getContractAt("CloudanaSettlementV2", r.settlement);

  // User escrows 100 CLD.
  await (await token.connect(treasury).transfer(user.address, 100n * CLD)).wait();
  await (await token.connect(user).approve(r.settlement, 100n * CLD)).wait();
  await (await settlement.connect(user).deposit(100n * CLD)).wait();
  log(`escrow: ${ethers.formatEther(await settlement.totalEscrow())} CLD`);

  // One epoch: fees 10 CLD -> lane A 9.5, treasury 0.3, 0.2 net burn; lane B = half the allowance.
  const epoch = BigInt(r.genesisEpoch);
  await travel(2 * epochSeconds);
  const fees = 10n * CLD;
  const laneA = (fees * 950n) / 1000n, treasuryAmt = (fees * 30n) / 1000n;
  const laneB = (await settlement.allowance(epoch)) / 2n;
  const leaves: [bigint, string, bigint, bigint][] = [
    [epoch, provA.address, (laneA * 6n) / 10n, laneB],
    [epoch, provB.address, laneA - (laneA * 6n) / 10n, 0n],
  ];
  const tree = StandardMerkleTree.of(leaves, ["uint256", "address", "uint256", "uint256"]);
  const supply0 = await token.totalSupply();

  let tx = await settlement.connect(poster).postEpoch(epoch, tree.root, laneA, laneB, treasuryAmt, fees);
  await tx.wait();
  log(`epoch ${epoch}: posted root=${tree.root} tx=${tx.hash}`);

  await travel(vetoDelaySeconds);
  tx = await settlement.finalize(epoch);
  await tx.wait();
  log(`epoch ${epoch}: finalized (burned ${ethers.formatEther(fees)}, treasury +${ethers.formatEther(treasuryAmt)}) tx=${tx.hash}`);

  const args = (ix: number[]) => ({
    accounts: ix.map((i) => leaves[i][1]), as: ix.map((i) => leaves[i][2]), bs: ix.map((i) => leaves[i][3]),
    proofs: ix.map((i) => tree.getProof(i)),
  });
  let a = args([0, 1]);
  tx = await settlement.claimFor(epoch, a.accounts, a.as, a.bs, a.proofs);
  await tx.wait();
  log(`epoch ${epoch}: lane A claimed: provA=${ethers.formatEther(await token.balanceOf(provA.address))} provB=${ethers.formatEther(await token.balanceOf(provB.address))}`);

  await travel(vestBSeconds);
  a = args([0]);
  tx = await settlement.claimFor(epoch, a.accounts, a.as, a.bs, a.proofs);
  await tx.wait();
  log(`epoch ${epoch}: lane B claimed: provA=${ethers.formatEther(await token.balanceOf(provA.address))}`);

  const supply1 = await token.totalSupply();
  const expected = supply0 - fees + laneA + treasuryAmt + laneB;
  if (supply1 !== expected) throw new Error(`supply mismatch: ${supply1} != ${expected}`);
  log(`supply ${ethers.formatEther(supply0)} -> ${ethers.formatEther(supply1)} CLD (= -fees + laneA + treasury + laneB). OK`);

  if (network.name === "localhost") {
    const file = path.join(SHARED, "addresses.local.json");
    const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { chainId: 1337, rpc: "http://127.0.0.1:8545" };
    existing.v2 = {
      CLDTokenV2: r.token, CloudanaSettlementV2: r.settlement, treasury: treasury.address, admin: admin.address,
      poster: poster.address, guardian: guardian.address, epochSeconds, vetoDelaySeconds, vestBSeconds, genesisTimestamp,
      genesisEpoch: r.genesisEpoch,
    };
    fs.writeFileSync(file, JSON.stringify(existing, null, 2) + "\n");
    log(`wrote v2 section to shared/addresses.local.json`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
