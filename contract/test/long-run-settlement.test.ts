/**
 * 20-year soak of CloudanaSettlement: 1040 weekly epochs, 60 providers + treasury.
 * Per epoch: escrow F -> post root -> (every 50th: veto + re-post corrected root) -> wait veto window -> finalize.
 * Every CLAIM_EVERY epochs the keeper claims the finished epochs (claimFor per epoch; every SINGLE_EVERY-th
 * epoch is instead claimed leaf-by-leaf with claim() to measure single-claim gas).
 * Invariants are asserted continuously. Gas medians are printed at the end (copied into LONG_RUN.md).
 *   LONG_RUN_EPOCHS=520 npx hardhat test test/long-run-settlement.test.ts   (shorter run)
 */
import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

const N_EPOCHS = Number(process.env.LONG_RUN_EPOCHS ?? 1040);
const N_PROVIDERS = 60;
const EPOCH_SECONDS = 7n * 24n * 3600n;
const VETO_DELAY = 24n * 3600n;
const CLAIM_EVERY = 4;
const VETO_EVERY = 50;
const SINGLE_EVERY = 20;
const CLD = 10n ** 18n;
const UCLD = 10n ** 12n;
const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));

// Deterministic PRNG (mulberry32) so the run is reproducible.
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261001);
const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
const median = (xs: bigint[]) => {
  if (!xs.length) return 0n;
  const s = [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return s[Math.floor(s.length / 2)];
};

/** Split `total` across `addrs` proportionally to random weights; exact (remainder to the first). */
function split(total: bigint, addrs: string[]): Map<string, bigint> {
  const w = addrs.map(() => BigInt(1 + Math.floor(rand() * 1_000_000)));
  const W = w.reduce((a, b) => a + b, 0n);
  const out = new Map<string, bigint>();
  let given = 0n;
  addrs.forEach((a, i) => { const v = (total * w[i]) / W; out.set(a, v); given += v; });
  out.set(addrs[0], out.get(addrs[0])! + total - given);
  return out;
}
function pick(addrs: string[], min: number): string[] {
  const n = min + Math.floor(rand() * (addrs.length - min + 1));
  return [...addrs].sort(() => rand() - 0.5).slice(0, n);
}

type Ep = {
  id: bigint; fees: bigint; treasuryShare: bigint; mintA: bigint; mintB: bigint;
  tree: StandardMerkleTree<any[]>; claimed: boolean;
};

describe("CloudanaSettlement — 20-year long run", function () {
  this.timeout(0);

  it(`settles ${N_EPOCHS} weekly epochs with ${N_PROVIDERS} providers and holds every invariant`, async () => {
    const t0 = Date.now();
    const [admin, treasury, team, guardian, user, keeper] = await ethers.getSigners();
    const providers = Array.from({ length: N_PROVIDERS }, () => ethers.Wallet.createRandom().address);

    const token: any = await (await ethers.getContractFactory("CLDToken")).deploy(treasury.address, team.address);
    const genesis = BigInt(await time.latest());
    const settlement: any = await (await ethers.getContractFactory("CloudanaSettlement")).deploy(
      await token.getAddress(), admin.address, admin.address, guardian.address, EPOCH_SECONDS, VETO_DELAY, genesis,
    );
    const sAddr = await settlement.getAddress();
    await token.grantRole(MINTER_ROLE, sAddr);
    await token.revokeRole(MINTER_ROLE, admin.address);
    // The fee payer: 700k from treasury + all 200k from team, approved once.
    await token.connect(treasury).transfer(user.address, 700_000n * CLD);
    await token.connect(team).transfer(user.address, 200_000n * CLD);
    await token.connect(user).approve(sAddr, ethers.MaxUint256);

    const initialSupply: bigint = await token.totalSupply();
    const treasury0: bigint = await token.balanceOf(treasury.address);
    let sumMinted = 0n, sumBurned = 0n, sumTreasury = 0n, sumFees = 0n, sumLaneB = 0n;
    let leavesClaimed = 0, vetoes = 0, laneBCapped = 0, invariantChecks = 0;
    const gas: Record<string, bigint[]> = {
      deposit: [], postEpoch: [], rePostAfterVeto: [], veto: [], finalize: [],
      claimSingle: [], claimForTx: [], claimForPerLeaf: [],
    };
    const gasOf = async (txp: Promise<any>, key: string) => {
      const r = await (await txp).wait();
      gas[key].push(r.gasUsed);
      return r.gasUsed as bigint;
    };
    let cumulativeGas = 0n;
    const track = async (txp: Promise<any>, key: string) => { const g = await gasOf(txp, key); cumulativeGas += g; return g; };

    async function checkGlobal() {
      invariantChecks++;
      const [supply, escrow, pending, bal] = await Promise.all([
        token.totalSupply(), settlement.totalEscrow(), settlement.pendingBurn(), token.balanceOf(sAddr),
      ]);
      expect(supply).to.equal(initialSupply + sumMinted - sumBurned, "supply == initial + minted - burned");
      expect(bal).to.equal(escrow, "escrow balance == totalEscrow");
      expect(escrow >= pending).to.equal(true, "totalEscrow >= pendingBurn");
      expect(await settlement.totalSubsidyMinted()).to.equal(sumLaneB, "totalSubsidyMinted == sum lane B posted");
    }

    const e0 = BigInt(await time.latest()) / EPOCH_SECONDS + 1n;
    const g = await settlement.genesisEpoch();
    await expect(settlement.postEpoch(g - 1n, ethers.ZeroHash, 0, 0, 0))
      .to.be.revertedWithCustomError(settlement, "EpochBeforeGenesis");
    await expect(settlement.postEpoch(e0, ethers.ZeroHash, 0, 0, 0))
      .to.be.revertedWithCustomError(settlement, "EpochNotElapsed");
    const yearTotals = new Map<bigint, bigint>();
    const pending: Ep[] = [];
    const finished: Ep[] = [];

    for (let i = 0; i < N_EPOCHS; i++) {
      const id = e0 + BigInt(i);
      // The epoch has ended; the keeper closes and posts it.
      await time.increaseTo((id + 1n) * EPOCH_SECONDS);
      const year = i / 52;

      // Fees: log-normal, median 50 CLD/week growing 15%/yr, sigma 0.6.
      const feeCld = Math.max(1, 50 * Math.pow(1.15, year) * Math.exp(0.6 * gauss()));
      const fees = BigInt(Math.round(feeCld * 1e6)) * UCLD;
      const laneA = (fees * 975n) / 1000n;
      const treasuryShare = (fees * 5n) / 1000n;
      const rho = Math.min(1, 0.25 + 0.05 * Math.floor(year)); // rho <= 1 always
      const allowance: bigint = await settlement.allowance(id);
      const wantB = (fees * BigInt(Math.round(rho * 1000))) / 1000n;
      const laneB = wantB < allowance ? wantB : allowance;
      if (wantB > allowance) laneBCapped++;

      const recipientsA = pick(providers, 5);
      const amounts = split(laneA, recipientsA);
      if (laneB > 0n) {
        for (const [a, v] of split(laneB, pick(recipientsA, 1))) amounts.set(a, (amounts.get(a) ?? 0n) + v);
      }
      amounts.set(treasury.address, (amounts.get(treasury.address) ?? 0n) + treasuryShare);
      const leaves = [...amounts].map(([a, v]) => [id, a, v]);
      const tree = StandardMerkleTree.of(leaves, ["uint256", "address", "uint256"]);
      const mintA = laneA + treasuryShare, mintB = laneB;
      expect(leaves.reduce((s, l) => s + (l[2] as bigint), 0n)).to.equal(mintA + mintB, "root total == mintA + mintB");
      expect(mintA * 10_000n <= fees * 9800n).to.equal(true);

      await track(settlement.connect(user).deposit(fees), "deposit");

      if ((i + 1) % VETO_EVERY === 0) {
        // A bad root (one attacker leaf for the whole mint) gets vetoed, then the corrected root is re-posted.
        const attacker = keeper.address;
        const bad = StandardMerkleTree.of([[id, attacker, mintA + mintB]], ["uint256", "address", "uint256"]);
        await track(settlement.postEpoch(id, bad.root, mintA, mintB, fees), "postEpoch");
        const pb = await settlement.pendingBurn();
        await track(settlement.connect(guardian).veto(id), "veto");
        vetoes++;
        expect(await settlement.pendingBurn()).to.equal(pb - fees, "veto releases the reservation");
        expect((await settlement.epochs(id)).status).to.equal(2n);
        await expect(settlement.finalize(id)).to.be.revertedWithCustomError(settlement, "NotPosted");
        await expect(settlement.claim.staticCall(id, attacker, mintA + mintB, bad.getProof(0)))
          .to.be.revertedWithCustomError(settlement, "NotFinalized");
        await track(settlement.postEpoch(id, tree.root, mintA, mintB, fees), "rePostAfterVeto");
        await time.increase(VETO_DELAY);
        await track(settlement.finalize(id), "finalize");
        // the vetoed root is dead after finalize
        await expect(settlement.claim.staticCall(id, attacker, mintA + mintB, bad.getProof(0)))
          .to.be.revertedWithCustomError(settlement, "InvalidProof");
      } else {
        await track(settlement.postEpoch(id, tree.root, mintA, mintB, fees), "postEpoch");
        // nothing claimable before finalize
        const [, a0, v0] = tree.at(0)!;
        await expect(settlement.claim.staticCall(id, a0, v0, tree.getProof(0)))
          .to.be.revertedWithCustomError(settlement, "NotFinalized");
        await expect(settlement.finalize(id)).to.be.revertedWithCustomError(settlement, "VetoWindowOpen");
        await time.increase(VETO_DELAY);
        await track(settlement.finalize(id), "finalize");
      }
      sumBurned += fees; sumFees += fees; sumLaneB += laneB;
      const y: bigint = await settlement.yearOf(id);
      yearTotals.set(y, (yearTotals.get(y) ?? 0n) + laneB);
      const usedY: bigint = await settlement.subsidyByYear(y);
      expect(usedY).to.equal(yearTotals.get(y), "subsidyByYear tracks posted lane B");
      expect(usedY <= (await settlement.annualSubsidyCap(id))).to.equal(true, "year lane B <= annual schedule");
      expect(await settlement.pendingBurn()).to.equal(0n);
      pending.push({ id, fees, treasuryShare, mintA, mintB, tree, claimed: false });

      // Claim round: every CLAIM_EVERY epochs, each provider's leaves for the finished epochs.
      if ((i + 1) % CLAIM_EVERY === 0 || i === N_EPOCHS - 1) {
        for (const ep of pending.splice(0)) {
          const tBefore: bigint = await token.balanceOf(treasury.address);
          const entries = [...ep.tree.entries()];
          if (Number(ep.id - e0) % SINGLE_EVERY === 0) {
            for (const [k, v] of entries) {
              await track(settlement.connect(keeper).claim(ep.id, v[1], v[2], ep.tree.getProof(k)), "claimSingle");
            }
          } else {
            const g = await track(settlement.connect(keeper).claimFor(
              ep.id, entries.map(([, v]) => v[1]), entries.map(([, v]) => v[2]), entries.map(([k]) => ep.tree.getProof(k)),
            ), "claimForTx");
            gas.claimForPerLeaf.push(g / BigInt(entries.length));
          }
          leavesClaimed += entries.length;
          sumMinted += ep.mintA + ep.mintB;
          sumTreasury += ep.treasuryShare;
          const onchain = await settlement.epochs(ep.id);
          expect(onchain.minted).to.equal(ep.mintA + ep.mintB, "claims sum == root total");
          expect(onchain.minted <= onchain.mintA + onchain.mintB).to.equal(true, "claims <= cap");
          // treasury receives exactly 0.005F for this epoch
          expect((await token.balanceOf(treasury.address)) - tBefore).to.equal(ep.treasuryShare);
          expect(ep.treasuryShare * 1000n).to.equal(ep.fees * 5n);
          // second claim of the same leaf reverts
          const [, a0, v0] = ep.tree.at(0)!;
          await expect(settlement.claim.staticCall(ep.id, a0, v0, ep.tree.getProof(0)))
            .to.be.revertedWithCustomError(settlement, "AlreadyClaimed");
          // a leaf + proof from this epoch replayed against another finalized epoch reverts
          const other = finished.length ? finished[Math.floor(rand() * finished.length)] : null;
          if (other) {
            await expect(settlement.claim.staticCall(other.id, a0, v0, ep.tree.getProof(0)))
              .to.be.revertedWithCustomError(settlement, "InvalidProof");
          }
          ep.claimed = true;
          finished.push(ep);
        }
        expect((await token.balanceOf(treasury.address)) - treasury0).to.equal(sumTreasury, "treasury == sum 0.005F");
      }
      await checkGlobal();
    }

    const elapsed = (Date.now() - t0) / 1000;
    const row = (k: string) => ({
      op: k, samples: gas[k].length, median: Number(median(gas[k])),
      min: gas[k].length ? Number(gas[k].reduce((a, b) => (a < b ? a : b))) : 0,
      max: gas[k].length ? Number(gas[k].reduce((a, b) => (a > b ? a : b))) : 0,
    });
    console.log(`\n  long run: ${N_EPOCHS} epochs (${(N_EPOCHS / 52).toFixed(1)} y), ${N_PROVIDERS} providers, ${vetoes} vetoes+re-posts, ` +
      `${leavesClaimed} leaves claimed, ${invariantChecks} global invariant checks, ${elapsed.toFixed(1)} s`);
    console.table(Object.keys(gas).map(row));
    const avgLeaves = leavesClaimed / N_EPOCHS;
    console.log(`  cumulative gas: ${cumulativeGas}  (${(Number(cumulativeGas) / N_EPOCHS).toFixed(0)} / epoch)`);
    console.log(`  avg leaves/epoch: ${avgLeaves.toFixed(1)}  -> new storage/epoch ~ ${(6 + avgLeaves).toFixed(1)} slots ` +
      `(${((6 + avgLeaves) * 32).toFixed(0)} B): 6 Epoch-struct slots + 1 claimed[leaf] slot per leaf`);
    console.log(`  fees burned ${ethers.formatEther(sumFees)} CLD, lane B minted ${ethers.formatEther(sumLaneB)} CLD ` +
      `(capped by allowance in ${laneBCapped} epochs), supply ${ethers.formatEther(initialSupply)} -> ${ethers.formatEther(await token.totalSupply())}`);
  });
});
