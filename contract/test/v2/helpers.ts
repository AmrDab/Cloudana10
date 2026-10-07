import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

export const CLD = 10n ** 18n;
export const YEAR = 365n * 24n * 3600n;
export const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
export const LEAF_TYPES = ["uint256", "address", "uint256", "uint256"];

export type Leaf = [string, bigint, bigint]; // account, laneA, laneB

export type SetupOpts = {
  epochSeconds?: bigint;
  vetoDelay?: bigint;
  vestB?: bigint;
  initialSupply?: bigint;
  maxMintBps?: bigint;
  escrow?: bigint;
};

/** Deploy token + settlement with distinct admin/poster/guardian/treasury signers; user escrows `escrow` CLD. */
export async function setup(o: SetupOpts = {}) {
  const epochSeconds = o.epochSeconds ?? 3600n;
  const vetoDelay = o.vetoDelay ?? 3600n;
  const vestB = o.vestB ?? 3600n;
  const initialSupply = o.initialSupply ?? 1_000_000n * CLD;
  const escrow = o.escrow ?? 100n * CLD;
  const [deployer, admin, poster, guardian, treasury, user, provA, provB, stranger] = await ethers.getSigners();
  const token = await (await ethers.getContractFactory("CLDTokenV2")).deploy(
    treasury.address, initialSupply, o.maxMintBps ?? 1000n, deployer.address,
  );
  const genesis = BigInt(await time.latest());
  const settlement = await (await ethers.getContractFactory("CloudanaSettlementV2")).deploy(
    await token.getAddress(), treasury.address, admin.address, poster.address, guardian.address,
    epochSeconds, vetoDelay, vestB, genesis,
  );
  const sAddr = await settlement.getAddress();
  await token.grantRole(MINTER_ROLE, sAddr);
  await token.grantRole(await token.DEFAULT_ADMIN_ROLE(), admin.address);
  await token.renounceRole(await token.DEFAULT_ADMIN_ROLE(), deployer.address);
  if (escrow > 0n) {
    await token.connect(treasury).transfer(user.address, escrow);
    await token.connect(user).approve(sAddr, escrow);
    await settlement.connect(user).deposit(escrow);
  }
  const epoch = genesis / epochSeconds; // == genesisEpoch
  await time.increaseTo((epoch + 2n) * epochSeconds); // `epoch` and `epoch + 1` have fully elapsed
  return {
    token, settlement, sAddr, deployer, admin, poster, guardian, treasury, user, provA, provB, stranger,
    genesis, epoch, epochSeconds, vetoDelay, vestB,
  };
}

export function tree(epoch: bigint, leaves: Leaf[]) {
  return StandardMerkleTree.of(leaves.map(([a, la, lb]) => [epoch, a, la, lb]), LEAF_TYPES);
}

/** claimFor args for the given leaf indices (all leaves when omitted). */
export function claimArgs(t: StandardMerkleTree<any[]>, indices?: number[]) {
  const accounts: string[] = [], laneAs: bigint[] = [], laneBs: bigint[] = [], proofs: string[][] = [];
  for (const [i, v] of t.entries()) {
    if (indices && !indices.includes(i)) continue;
    accounts.push(v[1]); laneAs.push(BigInt(v[2])); laneBs.push(BigInt(v[3])); proofs.push(t.getProof(i));
  }
  return { accounts, laneAs, laneBs, proofs };
}

/** Spec fee split: provider floor(F*950/1000), treasury floor(F*30/1000). */
export function split(fees: bigint) {
  return { laneA: (fees * 950n) / 1000n, treasury: (fees * 30n) / 1000n };
}
