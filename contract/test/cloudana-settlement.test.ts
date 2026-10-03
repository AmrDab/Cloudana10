import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

const EPOCH_SECONDS = 120n;
const VETO_DELAY = 30n;
const YEAR = 365n * 24n * 3600n;
const CLD = 10n ** 18n;
const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));

describe("CloudanaSettlement", () => {
  async function setup() {
    const [admin, treasury, team, guardian, user, provA, provB, stranger] = await ethers.getSigners();
    const token = await (await ethers.getContractFactory("CLDToken")).deploy(treasury.address, team.address);
    const genesis = BigInt(await time.latest());
    const settlement = await (await ethers.getContractFactory("CloudanaSettlement")).deploy(
      await token.getAddress(), admin.address, admin.address, guardian.address,
      EPOCH_SECONDS, VETO_DELAY, genesis,
    );
    const sAddr = await settlement.getAddress();
    await token.grantRole(MINTER_ROLE, sAddr);
    await token.revokeRole(MINTER_ROLE, admin.address);
    // user escrows 100 CLD (funded by treasury)
    await token.connect(treasury).transfer(user.address, 100n * CLD);
    await token.connect(user).approve(sAddr, 100n * CLD);
    await settlement.connect(user).deposit(100n * CLD);
    const epoch = genesis / EPOCH_SECONDS; // == genesisEpoch
    await time.increaseTo((epoch + 2n) * EPOCH_SECONDS); // epochs `epoch` and `epoch + 1` have fully elapsed
    return { token, settlement, admin, treasury, guardian, user, provA, provB, stranger, genesis, epoch };
  }

  function tree(epoch: bigint, leaves: [string, bigint][]) {
    return StandardMerkleTree.of(
      leaves.map(([a, amt]) => [epoch, a, amt]),
      ["uint256", "address", "uint256"],
    );
  }

  function claimArgs(t: StandardMerkleTree<any[]>) {
    const accounts: string[] = [], amounts: bigint[] = [], proofs: string[][] = [];
    for (const [i, v] of t.entries()) {
      accounts.push(v[1]); amounts.push(BigInt(v[2])); proofs.push(t.getProof(i));
    }
    return { accounts, amounts, proofs };
  }

  it("happy path: post -> finalize -> claimFor mints exact amounts and burns fees", async () => {
    const { token, settlement, provA, provB, treasury, epoch } = await setup();
    const fees = 10n * CLD;
    const a1 = (fees * 975n) / 1000n, t1 = (fees * 5n) / 1000n; // lane A + treasury = 98%
    const b1 = (await settlement.allowance(epoch)) / 2n;
    const t = tree(epoch, [[provA.address, a1], [treasury.address, t1], [provB.address, b1]]);
    const supply0 = await token.totalSupply();
    const tBal0 = await token.balanceOf(treasury.address);

    await expect(settlement.postEpoch(epoch, t.root, a1 + t1, b1, fees)).to.emit(settlement, "EpochPosted");
    await time.increase(VETO_DELAY);
    await expect(settlement.finalize(epoch)).to.emit(settlement, "EpochFinalized").withArgs(epoch, fees);
    expect(await settlement.totalEscrow()).to.equal(90n * CLD);
    expect(await settlement.pendingBurn()).to.equal(0n);

    const { accounts, amounts, proofs } = claimArgs(t);
    await settlement.claimFor(epoch, accounts, amounts, proofs);
    expect(await token.balanceOf(provA.address)).to.equal(a1);
    expect(await token.balanceOf(provB.address)).to.equal(b1);
    expect(await token.balanceOf(treasury.address)).to.equal(tBal0 + t1);
    expect(await token.balanceOf(await settlement.getAddress())).to.equal(90n * CLD);
    expect(await token.totalSupply()).to.equal(supply0 - fees + a1 + t1 + b1);
    expect((await settlement.epochs(epoch)).minted).to.equal(a1 + t1 + b1);
  });

  it("single claim works for the account itself", async () => {
    const { settlement, token, provA, epoch } = await setup();
    const t = tree(epoch, [[provA.address, 5n * CLD]]);
    await settlement.postEpoch(epoch, t.root, 5n * CLD, 0, 10n * CLD);
    await time.increase(VETO_DELAY);
    await settlement.finalize(epoch);
    await expect(settlement.connect(provA).claim(epoch, provA.address, 5n * CLD, t.getProof(0)))
      .to.emit(settlement, "Claimed").withArgs(epoch, provA.address, 5n * CLD);
    expect(await token.balanceOf(provA.address)).to.equal(5n * CLD);
  });

  describe("invariants", () => {
    it("rejects mintA over 98% of fees", async () => {
      const { settlement, epoch } = await setup();
      await expect(settlement.postEpoch(epoch, ethers.ZeroHash, 9_800_000_000_000_000_001n, 0, 10n * CLD))
        .to.be.revertedWithCustomError(settlement, "LaneAExceedsFees");
      await expect(settlement.postEpoch(epoch, ethers.ZeroHash, (10n * CLD * 98n) / 100n, 0, 10n * CLD)).to.not.be.reverted;
    });

    it("rejects mintB over allowance", async () => {
      const { settlement, epoch } = await setup();
      const cap = await settlement.allowance(epoch);
      await expect(settlement.postEpoch(epoch, ethers.ZeroHash, 0, cap + 1n, 0))
        .to.be.revertedWithCustomError(settlement, "LaneBExceedsAllowance");
      await expect(settlement.postEpoch(epoch, ethers.ZeroHash, 0, cap, 0)).to.not.be.reverted;
    });

    it("rejects fees over unreserved escrow", async () => {
      const { settlement, epoch } = await setup();
      await expect(settlement.postEpoch(epoch, ethers.ZeroHash, 0, 0, 101n * CLD))
        .to.be.revertedWithCustomError(settlement, "FeesExceedEscrow");
      await settlement.postEpoch(epoch, ethers.ZeroHash, 0, 0, 60n * CLD);
      // 60 already reserved by a pending epoch -> only 40 left
      await expect(settlement.postEpoch(epoch + 1n, ethers.ZeroHash, 0, 0, 41n * CLD))
        .to.be.revertedWithCustomError(settlement, "FeesExceedEscrow");
    });

    it("rejects a double post", async () => {
      const { settlement, epoch } = await setup();
      await settlement.postEpoch(epoch, ethers.ZeroHash, 0, 0, 0);
      await expect(settlement.postEpoch(epoch, ethers.ZeroHash, 0, 0, 0))
        .to.be.revertedWithCustomError(settlement, "AlreadyPosted");
    });

    it("rejects early finalize", async () => {
      const { settlement, epoch } = await setup();
      await settlement.postEpoch(epoch, ethers.ZeroHash, 0, 0, CLD);
      await expect(settlement.finalize(epoch)).to.be.revertedWithCustomError(settlement, "VetoWindowOpen");
    });

    it("rejects claim before finalize", async () => {
      const { settlement, provA, epoch } = await setup();
      const t = tree(epoch, [[provA.address, CLD]]);
      await settlement.postEpoch(epoch, t.root, CLD, 0, 10n * CLD);
      await expect(settlement.claim(epoch, provA.address, CLD, t.getProof(0)))
        .to.be.revertedWithCustomError(settlement, "NotFinalized");
    });

    it("rejects double claim and bad proof", async () => {
      const { settlement, provA, provB, epoch } = await setup();
      const t = tree(epoch, [[provA.address, CLD], [provB.address, 2n * CLD]]);
      await settlement.postEpoch(epoch, t.root, 3n * CLD, 0, 10n * CLD);
      await time.increase(VETO_DELAY);
      await settlement.finalize(epoch);
      const proofA = t.getProof(0);
      await expect(settlement.claim(epoch, provA.address, 2n * CLD, proofA))
        .to.be.revertedWithCustomError(settlement, "InvalidProof");
      await settlement.claim(epoch, provA.address, CLD, proofA);
      await expect(settlement.claim(epoch, provA.address, CLD, proofA))
        .to.be.revertedWithCustomError(settlement, "AlreadyClaimed");
    });

    it("caps total minted at mintA + mintB even if the root over-promises", async () => {
      const { settlement, provA, provB, epoch } = await setup();
      const t = tree(epoch, [[provA.address, CLD], [provB.address, CLD]]);
      await settlement.postEpoch(epoch, t.root, CLD, 0, 10n * CLD); // root sums to 2, cap is 1
      await time.increase(VETO_DELAY);
      await settlement.finalize(epoch);
      const { accounts, amounts, proofs } = claimArgs(t);
      await expect(settlement.claimFor(epoch, accounts, amounts, proofs))
        .to.be.revertedWithCustomError(settlement, "MintCapExceeded");
    });

    it("veto blocks finalize and releases the reserved escrow", async () => {
      const { settlement, guardian, epoch } = await setup();
      await settlement.postEpoch(epoch, ethers.ZeroHash, 0, 0, 50n * CLD);
      await expect(settlement.connect(guardian).veto(epoch)).to.emit(settlement, "EpochVetoed");
      expect(await settlement.pendingBurn()).to.equal(0n);
      await time.increase(VETO_DELAY);
      await expect(settlement.finalize(epoch)).to.be.revertedWithCustomError(settlement, "NotPosted");
    });

    it("a vetoed epoch can be re-posted with a corrected root (poster only), then settles normally", async () => {
      const { settlement, token, guardian, provA, stranger, epoch } = await setup();
      const bad = tree(epoch, [[stranger.address, 5n * CLD]]);
      await settlement.postEpoch(epoch, bad.root, 5n * CLD, 0, 10n * CLD);
      await settlement.connect(guardian).veto(epoch);
      // only the poster may re-post
      const good = tree(epoch, [[provA.address, 5n * CLD]]);
      await expect(settlement.connect(stranger).postEpoch(epoch, good.root, 5n * CLD, 0, 10n * CLD))
        .to.be.revertedWithCustomError(settlement, "AccessControlUnauthorizedAccount");
      await expect(settlement.postEpoch(epoch, good.root, 5n * CLD, 0, 10n * CLD))
        .to.emit(settlement, "EpochPosted").withArgs(epoch, good.root, 5n * CLD, 0, 10n * CLD);
      expect(await settlement.pendingBurn()).to.equal(10n * CLD);
      // the re-post gets a fresh veto window and can itself be vetoed and re-posted again
      await settlement.connect(guardian).veto(epoch);
      await settlement.postEpoch(epoch, good.root, 5n * CLD, 0, 10n * CLD);
      // a live (Posted) epoch still cannot be overwritten
      await expect(settlement.postEpoch(epoch, bad.root, 5n * CLD, 0, 10n * CLD))
        .to.be.revertedWithCustomError(settlement, "AlreadyPosted");
      await time.increase(VETO_DELAY);
      await settlement.finalize(epoch);
      // a finalized epoch cannot be re-posted
      await expect(settlement.postEpoch(epoch, bad.root, 5n * CLD, 0, 10n * CLD))
        .to.be.revertedWithCustomError(settlement, "AlreadyPosted");
      // the vetoed root's leaf is dead; the corrected one claims
      await expect(settlement.claim(epoch, stranger.address, 5n * CLD, bad.getProof(0)))
        .to.be.revertedWithCustomError(settlement, "InvalidProof");
      await settlement.claim(epoch, provA.address, 5n * CLD, good.getProof(0));
      expect(await token.balanceOf(provA.address)).to.equal(5n * CLD);
      expect(await settlement.totalEscrow()).to.equal(90n * CLD);
    });

    it("rejects epochs before genesis and epochs that have not fully elapsed", async () => {
      const { settlement, epoch } = await setup();
      expect(await settlement.genesisEpoch()).to.equal(epoch);
      await expect(settlement.postEpoch(epoch - 1n, ethers.ZeroHash, 0, 0, 0))
        .to.be.revertedWithCustomError(settlement, "EpochBeforeGenesis").withArgs(epoch - 1n, epoch);
      await expect(settlement.postEpoch(0, ethers.ZeroHash, 0, 0, 0))
        .to.be.revertedWithCustomError(settlement, "EpochBeforeGenesis");
      const current = BigInt(await time.latest()) / EPOCH_SECONDS;
      await expect(settlement.postEpoch(current, ethers.ZeroHash, 0, 0, 0))
        .to.be.revertedWithCustomError(settlement, "EpochNotElapsed").withArgs(current, (current + 1n) * EPOCH_SECONDS);
      await expect(settlement.postEpoch(current + 1000n, ethers.ZeroHash, 0, 0, 0))
        .to.be.revertedWithCustomError(settlement, "EpochNotElapsed");
      await expect(settlement.postEpoch(current - 1n, ethers.ZeroHash, 0, 0, 0)).to.not.be.reverted;
      await expect(settlement.postEpoch(epoch, ethers.ZeroHash, 0, 0, 0)).to.not.be.reverted;
    });

    it("rejects veto after the window", async () => {
      const { settlement, guardian, epoch } = await setup();
      await settlement.postEpoch(epoch, ethers.ZeroHash, 0, 0, 0);
      await time.increase(VETO_DELAY);
      await expect(settlement.connect(guardian).veto(epoch))
        .to.be.revertedWithCustomError(settlement, "VetoWindowClosed");
    });

    it("rejects non-poster post and non-guardian veto", async () => {
      const { settlement, stranger, epoch } = await setup();
      await expect(settlement.connect(stranger).postEpoch(epoch, ethers.ZeroHash, 0, 0, 0))
        .to.be.revertedWithCustomError(settlement, "AccessControlUnauthorizedAccount");
      await settlement.postEpoch(epoch, ethers.ZeroHash, 0, 0, 0);
      await expect(settlement.connect(stranger).veto(epoch))
        .to.be.revertedWithCustomError(settlement, "AccessControlUnauthorizedAccount");
    });
  });

  describe("cumulative lane-B ceiling", () => {
    it("caps a year's lane B at the schedule's annual total, however many epochs are posted; veto releases it", async () => {
      // 30-day epochs: ~12.2 epochs per year, so posting every year-0 epoch at its per-epoch share overshoots the year.
      const E = 30n * 24n * 3600n;
      const [admin, treasury, team, guardian] = await ethers.getSigners();
      const token = await (await ethers.getContractFactory("CLDToken")).deploy(treasury.address, team.address);
      const genesis = BigInt(await time.latest());
      const s = await (await ethers.getContractFactory("CloudanaSettlement")).deploy(
        await token.getAddress(), admin.address, admin.address, guardian.address, E, VETO_DELAY, genesis,
      );
      await time.increase(2n * YEAR); // every year-0 epoch has elapsed
      const g = await s.genesisEpoch();
      const annual = await s.annualSubsidyCap(g);
      const perEpoch = (annual * E) / YEAR;
      let ep = g, sum = 0n, truncated = false;
      while ((await s.yearOf(ep)) === 0n) {
        const cap = await s.allowance(ep);
        if (cap < perEpoch) truncated = true;
        await s.postEpoch(ep, ethers.ZeroHash, 0, cap, 0);
        sum += cap;
        ep++;
      }
      expect(truncated).to.equal(true);
      expect(sum).to.equal(annual);
      expect(await s.subsidyByYear(0)).to.equal(annual);
      expect(await s.totalSubsidyMinted()).to.equal(annual);
      // year 0 is exhausted: re-posting a vetoed year-0 epoch can only reclaim what the veto released
      const last = ep - 1n;
      const lastMintB = (await s.epochs(last)).mintB;
      await s.connect(guardian).veto(last);
      expect(await s.subsidyByYear(0)).to.equal(annual - lastMintB);
      expect(await s.totalSubsidyMinted()).to.equal(annual - lastMintB);
      expect(await s.allowance(last)).to.equal(lastMintB);
      await expect(s.postEpoch(last, ethers.ZeroHash, 0, lastMintB + 1n, 0))
        .to.be.revertedWithCustomError(s, "LaneBExceedsAllowance");
      await s.postEpoch(last, ethers.ZeroHash, 0, lastMintB, 0);
      expect(await s.allowance(last)).to.equal(0n);
      // year 1 has its own (decayed) budget
      expect(await s.yearOf(ep)).to.equal(1n);
      expect(await s.allowance(ep)).to.equal(((await s.annualSubsidyCap(ep)) * E) / YEAR);
      expect(await s.annualSubsidyCap(ep)).to.equal(((await token.totalSupply()) * 680n) / 10_000n);
    });
  });

  describe("allowance schedule", () => {
    function expected(supply: bigint, rate: bigint) {
      return ((supply * rate) / 10_000n * EPOCH_SECONDS) / YEAR;
    }

    it("year 0: 8% of supply prorated to one epoch", async () => {
      const { settlement, token, epoch } = await setup();
      const supply = await token.totalSupply();
      expect(await settlement.allowance(epoch)).to.equal(expected(supply, 800n));
    });

    it("decays x0.85 per full year and floors at 1.5%", async () => {
      const { settlement, token, genesis } = await setup();
      const supply = await token.totalSupply();
      const epochAtYear = (y: bigint) => (genesis + y * YEAR + EPOCH_SECONDS) / EPOCH_SECONDS;
      expect(await settlement.allowance(epochAtYear(1n))).to.equal(expected(supply, 680n));
      expect(await settlement.allowance(epochAtYear(2n))).to.equal(expected(supply, 578n));
      expect(await settlement.allowance(epochAtYear(10n))).to.equal(expected(supply, 155n));
      expect(await settlement.allowance(epochAtYear(11n))).to.equal(expected(supply, 150n));
      expect(await settlement.allowance(epochAtYear(30n))).to.equal(expected(supply, 150n));
    });

    it("after time travel, a post at the year-2 allowance succeeds and one wei more fails", async () => {
      const { settlement, token, genesis } = await setup();
      await time.increaseTo(genesis + 2n * YEAR + 2n * EPOCH_SECONDS + 5n);
      const epoch = BigInt(await time.latest()) / EPOCH_SECONDS - 1n; // last elapsed epoch; starts past the anniversary
      const cap = await settlement.allowance(epoch);
      expect(cap).to.equal(expected(await token.totalSupply(), 578n));
      await expect(settlement.postEpoch(epoch, ethers.ZeroHash, 0, cap + 1n, 0))
        .to.be.revertedWithCustomError(settlement, "LaneBExceedsAllowance");
      await expect(settlement.postEpoch(epoch, ethers.ZeroHash, 0, cap, 0)).to.not.be.reverted;
    });
  });
});
