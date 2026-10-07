/**
 * Gas report for the keeper's hot path (postEpoch / veto / re-post / finalize / claimFor per leaf / single claim)
 * with a 300-leaf epoch, and the shared Merkle vector for the keeper's tree builder
 * (written to keeper/test/fixtures/tree-vector.json; deterministic, so the file is stable in git).
 */
import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import * as fs from "fs";
import * as path from "path";
import { CLD, claimArgs, setup, split, tree, Leaf } from "./helpers";

const UCLD = 10n ** 12n;
const VECTOR_FILE = path.join(__dirname, "../../../keeper/test/fixtures/tree-vector.json");

const addr = (tag: string) => ethers.getAddress("0x" + ethers.keccak256(ethers.toUtf8Bytes(tag)).slice(26));
const gasOf = async (tx: Promise<any>) => (await (await tx).wait())!.gasUsed as bigint;

describe("CloudanaSettlementV2 gas report + keeper Merkle vector", function () {
  this.timeout(0);

  // EIP-7825 (Osaka, hardhat's default hardfork) caps a single tx at 2^24 gas; at ~61k per cold lane-A leaf that is
  // ~270 leaves, so the keeper chunks claimFor at 250 (spec: <= 300).
  const TX_GAS_CAP = 16_777_216n;

  it("250-leaf epoch: gas per operation", async () => {
    const { token, settlement, sAddr, poster, guardian, treasury, user, epoch, vetoDelay, vestB } = await setup({ escrow: 0n });
    const N = 250;
    const fees = 1000n * CLD;
    await token.connect(treasury).approve(sAddr, fees * 3n);
    await settlement.connect(treasury).depositFor(user.address, fees * 3n);
    const { laneA, treasury: tAmt } = split(fees);
    const laneB = await settlement.allowance(epoch);
    const perA = laneA / BigInt(N), perB = laneB / BigInt(N);
    const leaves: Leaf[] = Array.from({ length: N }, (_, i) => [addr(`gas-${i}`), perA, perB]);
    const t = tree(epoch, leaves);
    const bad = tree(epoch, [[addr("attacker"), laneA, laneB]]);

    const g: Record<string, bigint> = {};
    g["postEpoch (first post, fresh year slot)"] = await gasOf(settlement.connect(poster).postEpoch(epoch, bad.root, laneA, laneB, tAmt, fees));
    g["veto"] = await gasOf(settlement.connect(guardian).veto(epoch));
    g["postEpoch (re-post after veto)"] = await gasOf(settlement.connect(poster).postEpoch(epoch, t.root, laneA, laneB, tAmt, fees));
    g["postEpoch (second epoch, same year)"] = await gasOf(settlement.connect(poster).postEpoch(epoch + 1n, bad.root, laneA, 0, tAmt, fees));
    await time.increase(vetoDelay);
    g["finalize (burn + treasury mint)"] = await gasOf(settlement.finalize(epoch));
    g["finalize (second epoch)"] = await gasOf(settlement.finalize(epoch + 1n));

    const a = claimArgs(t);
    const claimA = await gasOf(settlement.claimFor(epoch, a.accounts, a.laneAs, a.laneBs, a.proofs));
    g[`claimFor lane A, ${N} leaves (total)`] = claimA;
    g["claimFor lane A, per leaf"] = claimA / BigInt(N);
    expect((await settlement.epochs(epoch)).mintedA).to.equal(perA * BigInt(N));

    await time.increase(vestB);
    const idx = Array.from({ length: N - 1 }, (_, i) => i + 1); // keep leaf 0 for the single claim
    const b = claimArgs(t, idx);
    const claimB = await gasOf(settlement.claimFor(epoch, b.accounts, b.laneAs, b.laneBs, b.proofs));
    g[`claimFor lane B, ${N - 1} leaves (total)`] = claimB;
    g["claimFor lane B, per leaf"] = claimB / BigInt(N - 1);
    g["claim (single, lane B only, own tx)"] = await gasOf(settlement.claim(epoch, leaves[0][0], perA, perB, t.getProof(0)));
    expect((await settlement.epochs(epoch)).mintedB).to.equal(perB * BigInt(N));

    // a fresh epoch claimed once after vest: both lanes per leaf
    const leaves2: Leaf[] = Array.from({ length: N }, (_, i) => [addr(`gas2-${i}`), perA, 0n]);
    const t2 = tree(epoch + 2n, leaves2);
    const ends2 = (epoch + 3n) * 3600n + 1n;
    if (ends2 > BigInt(await time.latest())) await time.increaseTo(ends2);
    await settlement.connect(poster).postEpoch(epoch + 2n, t2.root, laneA, 0, tAmt, fees);
    await time.increase(vetoDelay);
    await settlement.finalize(epoch + 2n);
    const a2 = claimArgs(t2);
    const both = await gasOf(settlement.claimFor(epoch + 2n, a2.accounts, a2.laneAs, a2.laneBs, a2.proofs));
    g[`claimFor lane A only leaves (laneB=0), ${N} leaves, per leaf`] = both / BigInt(N);

    g["max cold lane-A leaves per tx under the 2^24 cap"] = TX_GAS_CAP / (claimA / BigInt(N));
    console.log(`\n      gas (${N}-leaf epoch, solc 0.8.20, optimizer 200 runs, hardfork osaka):`);
    for (const [k, v] of Object.entries(g)) console.log(`        ${k.padEnd(56)} ${v.toLocaleString("en-US").padStart(12)}`);
    expect(claimA).to.be.lt(TX_GAS_CAP); // one keeper chunk fits a single tx
    expect(claimB).to.be.lt(TX_GAS_CAP);
    expect(claimA / BigInt(N)).to.be.lt(70_000n);
  });

  it("writes the keeper Merkle vector and checks leafOf + proofs on-chain", async () => {
    const { settlement, poster, epoch, vetoDelay } = await setup();
    const leavesUcld = Array.from({ length: 7 }, (_, i) => ({
      account: addr(`vec-${i}`),
      laneAUcld: String(1_000_000 * (i + 1) + 123 * i),
      laneBUcld: String(i % 3 === 0 ? 0 : 250_000 * i + 7),
    }));
    const leaves: Leaf[] = leavesUcld.map((l) => [l.account, BigInt(l.laneAUcld) * UCLD, BigInt(l.laneBUcld) * UCLD]);
    // The vector uses a fixed epoch so the file is byte-stable; leafOf is pure, so it can be checked for any epoch.
    const VECTOR_EPOCH = 497_000n;
    const tv = tree(VECTOR_EPOCH, leaves);
    const leafHashes: string[] = [];
    const proofs: string[][] = [];
    for (const [i, v] of tv.entries()) {
      const onChain = await settlement.leafOf(v[0], v[1], v[2], v[3]);
      expect(onChain).to.equal(tv.leafHash(v));
      leafHashes.push(onChain);
      proofs.push(tv.getProof(i));
    }
    // And the same leaves under the live epoch go through post -> finalize -> claimFor on-chain.
    const t = tree(epoch, leaves);
    for (const [, v] of t.entries()) expect(await settlement.leafOf(v[0], v[1], v[2], v[3])).to.equal(t.leafHash(v));
    const totalA = leaves.reduce((s, l) => s + l[1], 0n), totalB = leaves.reduce((s, l) => s + l[2], 0n);
    expect(totalB).to.be.lte(await settlement.allowance(epoch));
    const fees = (totalA * 1000n) / 950n + 1n;
    const tAmt = (fees * 30n) / 1000n + 1n;
    await settlement.connect(poster).postEpoch(epoch, t.root, totalA, totalB, tAmt, fees);
    await time.increase(vetoDelay);
    await settlement.finalize(epoch);
    const a = claimArgs(t);
    await settlement.claimFor(epoch, a.accounts, a.laneAs, a.laneBs, a.proofs);
    expect((await settlement.epochs(epoch)).mintedA).to.equal(totalA);

    const vector = {
      note: "Generated by contract/test/v2/gas-and-vector.test.ts. leaf = keccak256(bytes.concat(keccak256(abi.encode(epoch, account, laneAWei, laneBWei)))), wei = ucld * 1e12; OZ StandardMerkleTree (sorted leaves, sorted pairs).",
      epoch: VECTOR_EPOCH.toString(),
      leaves: leavesUcld,
      leafHashes,
      root: tv.root,
      proofs,
      totalLaneAUcld: (totalA / UCLD).toString(),
      totalLaneBUcld: (totalB / UCLD).toString(),
    };
    fs.mkdirSync(path.dirname(VECTOR_FILE), { recursive: true });
    fs.writeFileSync(VECTOR_FILE, JSON.stringify(vector, null, 2) + "\n");
  });
});
