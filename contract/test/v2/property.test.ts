/**
 * Property-style soak: random weekly epochs over ~3 simulated years (PROP_EPOCHS=160 by default).
 * Random fees, random lane splits, random lane-B asks, periodic veto + re-post, periodic claw, and random
 * over-limit posts that must revert. After every epoch:
 *   total minted (lane A + treasury + lane B)  <=  sum(fees) * 0.98 + sum(allowance at post time)
 *   totalSupply == initial - sum(fees burned) + total minted
 *   balanceOf(settlement) == totalEscrow, pendingBurn == 0, per-epoch minted == sum of claimed leaves
 */
import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { CLD, claimArgs, setup, split, tree, Leaf } from "./helpers";

const N_EPOCHS = Number(process.env.PROP_EPOCHS ?? 160);
const N_PROVIDERS = 12;
const EPOCH_SECONDS = 7n * 24n * 3600n;
const VETO = 24n * 3600n;
const VEST = 24n * 3600n;

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261005);
const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
const randBig = (max: bigint) => (max === 0n ? 0n : (BigInt(Math.floor(rand() * 1e9)) * max) / 1_000_000_000n);

/** Split `total` across `addrs` with random weights; exact. */
function splitRandom(total: bigint, addrs: string[]): Map<string, bigint> {
  const w = addrs.map(() => BigInt(1 + Math.floor(rand() * 1_000_000)));
  const W = w.reduce((a, b) => a + b, 0n);
  const out = new Map<string, bigint>();
  let given = 0n;
  addrs.forEach((a, i) => { const v = (total * w[i]) / W; out.set(a, v); given += v; });
  out.set(addrs[0], out.get(addrs[0])! + total - given);
  return out;
}

describe(`CloudanaSettlementV2 property soak (${N_EPOCHS} weekly epochs)`, function () {
  this.timeout(0);

  it("never mints more than fees*0.98 + allowance; supply accounting exact; caps enforced", async () => {
    const s = await setup({ epochSeconds: EPOCH_SECONDS, vetoDelay: VETO, vestB: VEST, escrow: 0n });
    const { token, settlement, sAddr, poster, guardian, treasury, user, stranger } = s;
    const providers = Array.from({ length: N_PROVIDERS }, (_, i) =>
      ethers.getAddress("0x" + ethers.keccak256(ethers.toUtf8Bytes(`prov-${i}`)).slice(26)));
    await token.connect(treasury).approve(sAddr, ethers.MaxUint256);
    const initialSupply = await token.totalSupply();

    let sumFees = 0n, sumAllowance = 0n, sumMinted = 0n, sumClawed = 0n;
    let vetoes = 0, rejected = 0, claws = 0, leavesClaimed = 0;
    type Pending = { epoch: bigint; t: ReturnType<typeof tree>; leaves: Leaf[]; clawed: Set<string> };
    let prev: Pending | null = null;

    for (let k = 0; k < N_EPOCHS; k++) {
      const epoch = s.epoch + BigInt(k);
      const endsAt = (epoch + 1n) * EPOCH_SECONDS + 1n;
      if (endsAt > BigInt(await time.latest())) await time.increaseTo(endsAt);

      // fees: log-normal, median 50 CLD, growing ~15%/yr; escrowed by the treasury on the user's behalf
      const growth = Math.pow(1.15, k / 52);
      const fees = BigInt(Math.floor(50 * Math.exp(0.6 * gauss()) * growth * 1e6)) * (CLD / 1_000_000n);
      await settlement.connect(treasury).depositFor(user.address, fees);

      const { laneA, treasury: tMin } = split(fees);
      const maxAT = (fees * 9800n) / 10_000n;
      // sometimes give the treasury more than 3% (lane A + treasury must stay <= 98%)
      const tAmt = rand() < 0.2 ? tMin + randBig(maxAT - laneA - tMin) : tMin;
      const cap = await settlement.allowance(epoch);
      const laneB = rand() < 0.3 ? cap : randBig(cap);

      // random over-limit posts must revert and leave no state behind
      const before = { pb: await settlement.pendingBurn(), sub: await settlement.totalSubsidyCommitted() };
      const r = rand();
      if (r < 0.1) {
        await expect(settlement.connect(poster).postEpoch(epoch, ethers.ZeroHash, laneA, cap + 1n, tAmt, fees))
          .to.be.revertedWithCustomError(settlement, "LaneBExceedsAllowance");
        rejected++;
      } else if (r < 0.2) {
        await expect(settlement.connect(poster).postEpoch(epoch, ethers.ZeroHash, maxAT - tAmt + 1n, laneB, tAmt, fees))
          .to.be.revertedWithCustomError(settlement, "LaneAExceedsFees");
        rejected++;
      } else if (r < 0.3) {
        await expect(settlement.connect(poster).postEpoch(epoch, ethers.ZeroHash, laneA, laneB, (fees * 300n) / 10_000n - 1n, fees))
          .to.be.revertedWithCustomError(settlement, "TreasuryBelowMin");
        rejected++;
      } else if (r < 0.35) {
        await expect(settlement.connect(poster).postEpoch(epoch, ethers.ZeroHash, 0, laneB, fees / 10n, fees + 1n))
          .to.be.revertedWithCustomError(settlement, "FeesExceedEscrow");
        rejected++;
      }
      expect(await settlement.pendingBurn()).to.equal(before.pb);
      expect(await settlement.totalSubsidyCommitted()).to.equal(before.sub);

      // build the epoch's leaves
      const recipients = [...providers].sort(() => rand() - 0.5).slice(0, 2 + Math.floor(rand() * (N_PROVIDERS - 2)));
      const aSplit = splitRandom(laneA, recipients);
      const bRecipients = recipients.slice(0, 1 + Math.floor(rand() * recipients.length));
      const bSplit = laneB > 0n ? splitRandom(laneB, bRecipients) : new Map<string, bigint>();
      const leaves: Leaf[] = recipients.map((a) => [a, aSplit.get(a) ?? 0n, bSplit.get(a) ?? 0n]);
      const t = tree(epoch, leaves);

      // every 10th epoch: bad root -> veto -> re-post
      if (k % 10 === 9) {
        const bad = tree(epoch, [[stranger.address, laneA, laneB]]);
        await settlement.connect(poster).postEpoch(epoch, bad.root, laneA, laneB, tAmt, fees);
        await expect(settlement.connect(poster).postEpoch(epoch, t.root, laneA, laneB, tAmt, fees)).to.be.revertedWithCustomError(settlement, "AlreadyPosted");
        await settlement.connect(guardian).veto(epoch);
        expect(await settlement.pendingBurn()).to.equal(before.pb);
        expect(await settlement.totalSubsidyCommitted()).to.equal(before.sub);
        vetoes++;
      }
      const capAtPost = await settlement.allowance(epoch);
      expect(capAtPost).to.equal(cap); // released by the veto / untouched by rejected posts
      await settlement.connect(poster).postEpoch(epoch, t.root, laneA, laneB, tAmt, fees);
      sumFees += fees;
      sumAllowance += capAtPost;

      await time.increase(VETO);
      await settlement.finalize(epoch);
      sumMinted += tAmt;
      expect(await settlement.pendingBurn()).to.equal(0n);

      // lane A for this epoch (all leaves with laneA > 0; every leaf has A here since the split gives >= 0 ... skip zeros)
      const idxA = leaves.map((l, i) => (l[1] > 0n ? i : -1)).filter((i) => i >= 0);
      if (idxA.length) {
        const a = claimArgs(t, idxA);
        await settlement.claimFor(epoch, a.accounts, a.laneAs, a.laneBs, a.proofs);
        leavesClaimed += idxA.length;
      }
      const eNow = await settlement.epochs(epoch);
      expect(eNow.mintedA).to.equal(laneA);
      expect(eNow.mintedB).to.equal(0n);
      sumMinted += laneA;

      // every 7th epoch: guardian claws one lane-B leaf before it vests
      const clawed = new Set<string>();
      if (k % 7 === 3) {
        const i = leaves.findIndex((l) => l[2] > 0n);
        if (i >= 0) {
          await settlement.connect(guardian).clawLaneB(epoch, leaves[i][0], leaves[i][1], leaves[i][2], t.getProof(i));
          clawed.add(leaves[i][0]);
          sumClawed += leaves[i][2];
          claws++;
        }
      }

      // previous epoch's lane B has vested by now (7 d > 1 d): claim it for all non-clawed B leaves
      if (prev) {
        expect(BigInt(await time.latest())).to.be.gte(await settlement.laneBVestsAt(prev.epoch));
        const idxB = prev.leaves.map((l, i) => (l[2] > 0n && !prev!.clawed.has(l[0]) ? i : -1)).filter((i) => i >= 0);
        if (idxB.length) {
          const a = claimArgs(prev.t, idxB);
          await settlement.claimFor(prev.epoch, a.accounts, a.laneAs, a.laneBs, a.proofs);
          leavesClaimed += idxB.length;
        }
        const ePrev = await settlement.epochs(prev.epoch);
        const expectedB = prev.leaves.reduce((acc, l) => acc + (prev!.clawed.has(l[0]) ? 0n : l[2]), 0n);
        expect(ePrev.mintedB).to.equal(expectedB);
        expect(ePrev.mintedB).to.be.lte(ePrev.totalLaneB);
        sumMinted += expectedB;
        // a clawed leaf can never claim lane B, and all its lanes are now settled
        for (const addr of prev.clawed) {
          const i = prev.leaves.findIndex((l) => l[0] === addr);
          await expect(settlement.claim(prev.epoch, addr, prev.leaves[i][1], prev.leaves[i][2], prev.t.getProof(i)))
            .to.be.revertedWithCustomError(settlement, "NothingToClaim");
        }
      }
      prev = { epoch, t, leaves, clawed };

      // global invariants
      const supply = await token.totalSupply();
      expect(supply).to.equal(initialSupply - sumFees + sumMinted);
      expect(sumMinted).to.be.lte((sumFees * 9800n) / 10_000n + sumAllowance);
      expect(await token.balanceOf(sAddr)).to.equal(await settlement.totalEscrow());
    }

    console.log(
      `      soak: ${N_EPOCHS} epochs, ${vetoes} vetoes, ${rejected} rejected posts, ${claws} claws, ${leavesClaimed} leaves claimed; ` +
      `fees ${ethers.formatEther(sumFees)} CLD, minted ${ethers.formatEther(sumMinted)} CLD (bound ${ethers.formatEther((sumFees * 9800n) / 10_000n + sumAllowance)}), ` +
      `clawed ${ethers.formatEther(sumClawed)} CLD never minted`,
    );
    expect(vetoes).to.be.gt(0);
    expect(rejected).to.be.gt(0);
    expect(claws).to.be.gt(0);
  });
});
