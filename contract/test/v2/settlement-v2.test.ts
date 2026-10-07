import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { CLD, YEAR, claimArgs, setup, split, tree } from "./helpers";

describe("CloudanaSettlementV2", () => {
  describe("happy path", () => {
    it("post -> finalize (burn fees, mint treasury) -> lane A claims -> vest -> lane B claims", async () => {
      const { token, settlement, sAddr, poster, treasury, provA, provB, epoch, vetoDelay, vestB } = await setup();
      const fees = 10n * CLD;
      const { laneA, treasury: tAmt } = split(fees);
      const laneB = (await settlement.allowance(epoch)) / 2n;
      const aA = (laneA * 6n) / 10n, aB = laneA - aA;
      const t = tree(epoch, [[provA.address, aA, laneB], [provB.address, aB, 0n]]);
      const supply0 = await token.totalSupply();
      const tBal0 = await token.balanceOf(treasury.address);

      await expect(settlement.connect(poster).postEpoch(epoch, t.root, laneA, laneB, tAmt, fees))
        .to.emit(settlement, "EpochPosted").withArgs(epoch, t.root, laneA, laneB, tAmt, fees);
      expect(await settlement.pendingBurn()).to.equal(fees);
      expect(await settlement.totalSubsidyCommitted()).to.equal(laneB);

      await time.increase(vetoDelay);
      await expect(settlement.finalize(epoch)).to.emit(settlement, "EpochFinalized").withArgs(epoch, fees, tAmt);
      expect(await settlement.totalEscrow()).to.equal(90n * CLD);
      expect(await settlement.pendingBurn()).to.equal(0n);
      expect(await token.balanceOf(treasury.address)).to.equal(tBal0 + tAmt);
      expect(await token.balanceOf(sAddr)).to.equal(90n * CLD);
      expect(await token.totalSupply()).to.equal(supply0 - fees + tAmt);
      const e = await settlement.epochs(epoch);
      expect(e.status).to.equal(3n);
      expect(e.finalizedAt).to.equal(BigInt(await time.latest()));
      expect(await settlement.laneBVestsAt(epoch)).to.equal(BigInt(await time.latest()) + vestB);

      // Lane A for both; lane B not yet vested, so provA gets only A.
      const a = claimArgs(t);
      await expect(settlement.claimFor(epoch, a.accounts, a.laneAs, a.laneBs, a.proofs))
        .to.emit(settlement, "Claimed").withArgs(epoch, provA.address, aA, 0n)
        .and.to.emit(settlement, "Claimed").withArgs(epoch, provB.address, aB, 0n);
      expect(await token.balanceOf(provA.address)).to.equal(aA);
      expect(await token.balanceOf(provB.address)).to.equal(aB);
      expect(await settlement.laneFlags(epoch, provA.address)).to.equal(1n);
      expect(await settlement.laneFlags(epoch, provB.address)).to.equal(1n);
      expect((await settlement.epochs(epoch)).mintedA).to.equal(laneA);

      // Lane B after vest: provA only (provB has laneB=0 and A claimed -> NothingToClaim).
      await time.increase(vestB);
      await expect(settlement.claim(epoch, provB.address, aB, 0n, t.getProof(1)))
        .to.be.revertedWithCustomError(settlement, "NothingToClaim");
      await expect(settlement.claim(epoch, provA.address, aA, laneB, t.getProof(0)))
        .to.emit(settlement, "Claimed").withArgs(epoch, provA.address, 0n, laneB);
      expect(await token.balanceOf(provA.address)).to.equal(aA + laneB);
      expect(await settlement.laneFlags(epoch, provA.address)).to.equal(3n);
      expect((await settlement.epochs(epoch)).mintedB).to.equal(laneB);
      expect(await token.totalSupply()).to.equal(supply0 - fees + tAmt + laneA + laneB);
    });

    it("a claim after vest mints both lanes in one call", async () => {
      const { token, settlement, poster, provA, epoch, vetoDelay, vestB } = await setup();
      const laneB = await settlement.allowance(epoch);
      const t = tree(epoch, [[provA.address, 2n * CLD, laneB]]);
      await settlement.connect(poster).postEpoch(epoch, t.root, 2n * CLD, laneB, CLD, 10n * CLD);
      await time.increase(vetoDelay);
      await settlement.finalize(epoch);
      await time.increase(vestB);
      await expect(settlement.connect(provA).claim(epoch, provA.address, 2n * CLD, laneB, t.getProof(0)))
        .to.emit(settlement, "Claimed").withArgs(epoch, provA.address, 2n * CLD, laneB);
      expect(await token.balanceOf(provA.address)).to.equal(2n * CLD + laneB);
    });

    it("leafOf matches the OZ StandardMerkleTree leaf hash", async () => {
      const { settlement, provA, epoch } = await setup();
      const t = tree(epoch, [[provA.address, 7n, 9n], [provA.address, 1n, 1n]]);
      for (const [i, v] of t.entries()) {
        expect(await settlement.leafOf(v[0], v[1], v[2], v[3])).to.equal(t.leafHash(v));
      }
    });
  });

  describe("escrow", () => {
    it("deposit / depositFor track escrow and emit Deposited(from, user, amount)", async () => {
      const { token, settlement, sAddr, treasury, user, provA } = await setup();
      await token.connect(treasury).approve(sAddr, 5n * CLD);
      await expect(settlement.connect(treasury).depositFor(provA.address, 5n * CLD))
        .to.emit(settlement, "Deposited").withArgs(treasury.address, provA.address, 5n * CLD);
      expect(await settlement.escrowOf(provA.address)).to.equal(5n * CLD);
      expect(await settlement.escrowOf(user.address)).to.equal(100n * CLD);
      expect(await settlement.totalEscrow()).to.equal(105n * CLD);
      expect(await token.balanceOf(sAddr)).to.equal(105n * CLD);
    });

    it("rejects a zero deposit and an unfunded deposit", async () => {
      const { token, settlement, stranger } = await setup();
      await expect(settlement.connect(stranger).deposit(0)).to.be.revertedWithCustomError(settlement, "ZeroAmount");
      await expect(settlement.connect(stranger).deposit(1)).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    });
  });

  describe("postEpoch reverts", () => {
    it("only POSTER_ROLE", async () => {
      const { settlement, admin, guardian, stranger, epoch } = await setup();
      for (const s of [admin, guardian, stranger]) {
        await expect(settlement.connect(s).postEpoch(epoch, ethers.ZeroHash, 0, 0, 0, 0))
          .to.be.revertedWithCustomError(settlement, "AccessControlUnauthorizedAccount");
      }
    });

    it("epoch before genesis / not yet elapsed", async () => {
      const { settlement, poster, epoch, epochSeconds } = await setup();
      await expect(settlement.connect(poster).postEpoch(epoch - 1n, ethers.ZeroHash, 0, 0, 0, 0))
        .to.be.revertedWithCustomError(settlement, "EpochBeforeGenesis");
      const current = BigInt(await time.latest()) / epochSeconds;
      await expect(settlement.connect(poster).postEpoch(current, ethers.ZeroHash, 0, 0, 0, 0))
        .to.be.revertedWithCustomError(settlement, "EpochNotElapsed");
      await expect(settlement.connect(poster).postEpoch(current - 1n, ethers.ZeroHash, 0, 0, 0, 0)).to.not.be.reverted;
    });

    it("treasury below 3% of fees", async () => {
      const { settlement, poster, epoch } = await setup();
      const fees = 10n * CLD;
      const min = (fees * 300n) / 10_000n;
      await expect(settlement.connect(poster).postEpoch(epoch, ethers.ZeroHash, 0, 0, min - 1n, fees))
        .to.be.revertedWithCustomError(settlement, "TreasuryBelowMin").withArgs(min - 1n, fees);
      await expect(settlement.connect(poster).postEpoch(epoch, ethers.ZeroHash, 0, 0, min, fees)).to.not.be.reverted;
    });

    it("treasury min uses ceil semantics on odd fees (floor(F*30/1000) can be below the bound)", async () => {
      const { settlement, poster, epoch } = await setup();
      const fees = 10n * CLD + 1n; // F*300/10000 is fractional: floor(F*3%) * 10000 < F*300
      const floorT = (fees * 30n) / 1000n;
      await expect(settlement.connect(poster).postEpoch(epoch, ethers.ZeroHash, 0, 0, floorT, fees))
        .to.be.revertedWithCustomError(settlement, "TreasuryBelowMin");
      await expect(settlement.connect(poster).postEpoch(epoch, ethers.ZeroHash, 0, 0, floorT + 1n, fees)).to.not.be.reverted;
    });

    it("lane A + treasury over 98% of fees", async () => {
      const { settlement, poster, epoch } = await setup();
      const fees = 10n * CLD;
      const max = (fees * 9800n) / 10_000n;
      const tAmt = (fees * 300n) / 10_000n;
      await expect(settlement.connect(poster).postEpoch(epoch, ethers.ZeroHash, max - tAmt + 1n, 0, tAmt, fees))
        .to.be.revertedWithCustomError(settlement, "LaneAExceedsFees").withArgs(max + 1n, fees);
      // treasury alone can also exceed 98%
      await expect(settlement.connect(poster).postEpoch(epoch, ethers.ZeroHash, 0, 0, max + 1n, fees))
        .to.be.revertedWithCustomError(settlement, "LaneAExceedsFees");
      await expect(settlement.connect(poster).postEpoch(epoch, ethers.ZeroHash, max - tAmt, 0, tAmt, fees)).to.not.be.reverted;
    });

    it("zero fees allow zero lane A / treasury but nothing more", async () => {
      const { settlement, poster, epoch } = await setup();
      await expect(settlement.connect(poster).postEpoch(epoch, ethers.ZeroHash, 1, 0, 0, 0))
        .to.be.revertedWithCustomError(settlement, "LaneAExceedsFees");
      await expect(settlement.connect(poster).postEpoch(epoch, ethers.ZeroHash, 0, 0, 0, 0)).to.not.be.reverted;
    });

    it("lane B over allowance", async () => {
      const { settlement, poster, epoch } = await setup();
      const cap = await settlement.allowance(epoch);
      expect(cap).to.be.gt(0n);
      await expect(settlement.connect(poster).postEpoch(epoch, ethers.ZeroHash, 0, cap + 1n, 0, 0))
        .to.be.revertedWithCustomError(settlement, "LaneBExceedsAllowance").withArgs(cap + 1n, cap);
      await expect(settlement.connect(poster).postEpoch(epoch, ethers.ZeroHash, 0, cap, 0, 0)).to.not.be.reverted;
    });

    it("fees over free escrow (pending burns are reserved)", async () => {
      const { settlement, poster, epoch } = await setup();
      await expect(settlement.connect(poster).postEpoch(epoch, ethers.ZeroHash, 0, 0, 4n * CLD, 101n * CLD))
        .to.be.revertedWithCustomError(settlement, "FeesExceedEscrow").withArgs(101n * CLD, 100n * CLD);
      await settlement.connect(poster).postEpoch(epoch, ethers.ZeroHash, 0, 0, 2n * CLD, 60n * CLD);
      await expect(settlement.connect(poster).postEpoch(epoch + 1n, ethers.ZeroHash, 0, 0, 2n * CLD, 41n * CLD))
        .to.be.revertedWithCustomError(settlement, "FeesExceedEscrow").withArgs(41n * CLD, 40n * CLD);
      await expect(settlement.connect(poster).postEpoch(epoch + 1n, ethers.ZeroHash, 0, 0, 2n * CLD, 40n * CLD)).to.not.be.reverted;
    });

    it("double post (posted and finalized)", async () => {
      const { settlement, poster, epoch, vetoDelay } = await setup();
      await settlement.connect(poster).postEpoch(epoch, ethers.ZeroHash, 0, 0, 0, 0);
      await expect(settlement.connect(poster).postEpoch(epoch, ethers.ZeroHash, 0, 0, 0, 0))
        .to.be.revertedWithCustomError(settlement, "AlreadyPosted");
      await time.increase(vetoDelay);
      await settlement.finalize(epoch);
      await expect(settlement.connect(poster).postEpoch(epoch, ethers.ZeroHash, 0, 0, 0, 0))
        .to.be.revertedWithCustomError(settlement, "AlreadyPosted");
    });
  });

  describe("veto / re-post", () => {
    it("guardian vetoes inside the window; commitments released; corrected re-post works; old leaves invalid", async () => {
      const { token, settlement, poster, guardian, stranger, provA, provB, epoch, vetoDelay } = await setup();
      const fees = 10n * CLD;
      const { laneA, treasury: tAmt } = split(fees);
      const laneB = await settlement.allowance(epoch);
      const bad = tree(epoch, [[stranger.address, laneA, laneB]]);
      await settlement.connect(poster).postEpoch(epoch, bad.root, laneA, laneB, tAmt, fees);
      expect(await settlement.subsidyByYear(await settlement.yearOf(epoch))).to.equal(laneB);

      await expect(settlement.connect(stranger).veto(epoch)).to.be.revertedWithCustomError(settlement, "AccessControlUnauthorizedAccount");
      await expect(settlement.connect(guardian).veto(epoch)).to.emit(settlement, "EpochVetoed").withArgs(epoch, guardian.address);
      expect((await settlement.epochs(epoch)).status).to.equal(2n);
      expect(await settlement.pendingBurn()).to.equal(0n);
      expect(await settlement.totalSubsidyCommitted()).to.equal(0n);
      expect(await settlement.subsidyByYear(await settlement.yearOf(epoch))).to.equal(0n); // released

      await expect(settlement.connect(guardian).veto(epoch)).to.be.revertedWithCustomError(settlement, "NotPosted");
      await expect(settlement.finalize(epoch)).to.be.revertedWithCustomError(settlement, "NotPosted");

      const good = tree(epoch, [[provA.address, laneA, laneB], [provB.address, 0n, 0n]]);
      await expect(settlement.connect(poster).postEpoch(epoch, good.root, laneA, laneB, tAmt, fees)).to.emit(settlement, "EpochPosted");
      await time.increase(vetoDelay);
      await settlement.finalize(epoch);
      await expect(settlement.claim(epoch, stranger.address, laneA, laneB, bad.getProof(0)))
        .to.be.revertedWithCustomError(settlement, "InvalidProof");
      await settlement.claim(epoch, provA.address, laneA, laneB, good.getProof(0));
      expect(await token.balanceOf(provA.address)).to.equal(laneA);
      // a leaf with both lanes zero has nothing to claim
      await expect(settlement.claim(epoch, provB.address, 0n, 0n, good.getProof(1)))
        .to.be.revertedWithCustomError(settlement, "NothingToClaim");
    });

    it("veto after the window and finalize inside it both revert", async () => {
      const { settlement, poster, guardian, epoch, vetoDelay } = await setup();
      await settlement.connect(poster).postEpoch(epoch, ethers.ZeroHash, 0, 0, 0, 0);
      await expect(settlement.finalize(epoch)).to.be.revertedWithCustomError(settlement, "VetoWindowOpen");
      const postedAt = (await settlement.epochs(epoch)).postedAt;
      await time.setNextBlockTimestamp(postedAt + vetoDelay - 1n);
      await expect(settlement.finalize(epoch)).to.be.revertedWithCustomError(settlement, "VetoWindowOpen");
      await time.setNextBlockTimestamp(postedAt + vetoDelay); // window closes exactly at postedAt + vetoDelay
      await expect(settlement.connect(guardian).veto(epoch)).to.be.revertedWithCustomError(settlement, "VetoWindowClosed");
      await expect(settlement.finalize(epoch)).to.not.be.reverted;
      await expect(settlement.connect(guardian).veto(epoch)).to.be.revertedWithCustomError(settlement, "NotPosted");
      await expect(settlement.finalize(epoch)).to.be.revertedWithCustomError(settlement, "NotPosted");
    });

    it("anyone may finalize", async () => {
      const { settlement, poster, stranger, epoch, vetoDelay } = await setup();
      await settlement.connect(poster).postEpoch(epoch, ethers.ZeroHash, 0, 0, 0, 0);
      await time.increase(vetoDelay);
      await expect(settlement.connect(stranger).finalize(epoch)).to.emit(settlement, "EpochFinalized");
    });
  });

  describe("claims", () => {
    async function finalized() {
      const s = await setup();
      const fees = 10n * CLD;
      const { laneA, treasury: tAmt } = split(fees);
      const laneB = await s.settlement.allowance(s.epoch);
      const aA = laneA / 2n, aB = laneA - aA, bA = laneB / 3n, bB = laneB - bA;
      const t = tree(s.epoch, [[s.provA.address, aA, bA], [s.provB.address, aB, bB]]);
      await s.settlement.connect(s.poster).postEpoch(s.epoch, t.root, laneA, laneB, tAmt, fees);
      await time.increase(s.vetoDelay);
      await s.settlement.finalize(s.epoch);
      return { ...s, t, aA, aB, bA, bB, laneA, laneB };
    }

    it("claim before finalize reverts (posted, vetoed, unknown epoch)", async () => {
      const { settlement, poster, guardian, provA, epoch } = await setup();
      const t = tree(epoch, [[provA.address, CLD, 0n]]);
      await expect(settlement.claim(epoch + 5n, provA.address, CLD, 0n, t.getProof(0))).to.be.revertedWithCustomError(settlement, "NotFinalized");
      await settlement.connect(poster).postEpoch(epoch, t.root, CLD, 0, CLD, 10n * CLD);
      await expect(settlement.claim(epoch, provA.address, CLD, 0n, t.getProof(0))).to.be.revertedWithCustomError(settlement, "NotFinalized");
      await settlement.connect(guardian).veto(epoch);
      await expect(settlement.claim(epoch, provA.address, CLD, 0n, t.getProof(0))).to.be.revertedWithCustomError(settlement, "NotFinalized");
    });

    it("bad proof / wrong amounts / wrong epoch / replay to another epoch", async () => {
      const f = await finalized();
      const { settlement, poster, provA, epoch, t, aA, bA, vetoDelay } = f;
      await expect(settlement.claim(epoch, provA.address, aA + 1n, bA, t.getProof(0))).to.be.revertedWithCustomError(settlement, "InvalidProof");
      await expect(settlement.claim(epoch, provA.address, aA, bA + 1n, t.getProof(0))).to.be.revertedWithCustomError(settlement, "InvalidProof");
      await expect(settlement.claim(epoch, provA.address, aA, bA, t.getProof(1))).to.be.revertedWithCustomError(settlement, "InvalidProof");
      // same leaves posted under epoch+1: proofs from `epoch` do not verify there (the leaf includes the epoch)
      const t2 = tree(epoch + 1n, [[provA.address, aA, bA]]);
      await settlement.connect(poster).postEpoch(epoch + 1n, t2.root, aA, 0, CLD, 10n * CLD);
      await time.increase(vetoDelay);
      await settlement.finalize(epoch + 1n);
      await expect(settlement.claim(epoch + 1n, provA.address, aA, bA, t.getProof(0))).to.be.revertedWithCustomError(settlement, "InvalidProof");
    });

    it("double lane-A claim reverts with NothingToClaim; lane B waits for the vest boundary exactly", async () => {
      const f = await finalized();
      const { token, settlement, provA, epoch, t, aA, bA, vestB } = f;
      await settlement.claim(epoch, provA.address, aA, bA, t.getProof(0));
      await expect(settlement.claim(epoch, provA.address, aA, bA, t.getProof(0))).to.be.revertedWithCustomError(settlement, "NothingToClaim");
      const vestsAt = await settlement.laneBVestsAt(epoch);
      await time.setNextBlockTimestamp(vestsAt - 1n);
      await expect(settlement.claim(epoch, provA.address, aA, bA, t.getProof(0))).to.be.revertedWithCustomError(settlement, "NothingToClaim");
      await time.setNextBlockTimestamp(vestsAt); // vests exactly at finalizedAt + vestBSeconds
      await expect(settlement.claim(epoch, provA.address, aA, bA, t.getProof(0))).to.emit(settlement, "Claimed").withArgs(epoch, provA.address, 0n, bA);
      expect(await token.balanceOf(provA.address)).to.equal(aA + bA);
      await expect(settlement.claim(epoch, provA.address, aA, bA, t.getProof(0))).to.be.revertedWithCustomError(settlement, "NothingToClaim");
      void vestB;
    });

    it("claimFor: length mismatch, one bad entry reverts the batch, mixed lanes after vest", async () => {
      const f = await finalized();
      const { token, settlement, provA, provB, epoch, t, aA, aB, bA, bB, vestB } = f;
      const a = claimArgs(t);
      await expect(settlement.claimFor(epoch, a.accounts, a.laneAs.slice(1), a.laneBs, a.proofs)).to.be.revertedWithCustomError(settlement, "LengthMismatch");
      await expect(settlement.claimFor(epoch, a.accounts, a.laneAs, a.laneBs.slice(1), a.proofs)).to.be.revertedWithCustomError(settlement, "LengthMismatch");
      await expect(settlement.claimFor(epoch, a.accounts, a.laneAs, a.laneBs, a.proofs.slice(1))).to.be.revertedWithCustomError(settlement, "LengthMismatch");
      // provA claims A alone; then a batch containing provA (nothing claimable yet) reverts entirely
      await settlement.claim(epoch, provA.address, aA, bA, t.getProof(0));
      await expect(settlement.claimFor(epoch, a.accounts, a.laneAs, a.laneBs, a.proofs)).to.be.revertedWithCustomError(settlement, "NothingToClaim");
      expect(await token.balanceOf(provB.address)).to.equal(0n);
      // after vest, one batch pays provA lane B and provB both lanes
      await time.increase(vestB);
      await expect(settlement.claimFor(epoch, a.accounts, a.laneAs, a.laneBs, a.proofs))
        .to.emit(settlement, "Claimed").withArgs(epoch, provA.address, 0n, bA)
        .and.to.emit(settlement, "Claimed").withArgs(epoch, provB.address, aB, bB);
      expect(await token.balanceOf(provA.address)).to.equal(aA + bA);
      expect(await token.balanceOf(provB.address)).to.equal(aB + bB);
      const e = await settlement.epochs(epoch);
      expect(e.mintedA).to.equal(f.laneA);
      expect(e.mintedB).to.equal(f.laneB);
    });

    it("per-lane mint caps hold even if the root over-promises", async () => {
      const { settlement, poster, provA, provB, epoch, vetoDelay, vestB } = await setup();
      const laneB = await settlement.allowance(epoch);
      // root sums to 2 CLD lane A / 2*laneB lane B; caps are 1 CLD / laneB
      const t = tree(epoch, [[provA.address, CLD, laneB], [provB.address, CLD, laneB]]);
      await settlement.connect(poster).postEpoch(epoch, t.root, CLD, laneB, CLD, 10n * CLD);
      await time.increase(vetoDelay + vestB);
      await settlement.finalize(epoch);
      await time.increase(vestB);
      await settlement.claim(epoch, provA.address, CLD, laneB, t.getProof(0));
      await expect(settlement.claim(epoch, provB.address, CLD, laneB, t.getProof(1))).to.be.revertedWithCustomError(settlement, "MintCapExceeded");
    });

    it("per-lane cap for lane B alone (lane A within cap)", async () => {
      const { settlement, poster, provA, provB, epoch, vetoDelay, vestB } = await setup();
      const laneB = await settlement.allowance(epoch);
      const t = tree(epoch, [[provA.address, CLD, laneB], [provB.address, CLD, 1n]]);
      await settlement.connect(poster).postEpoch(epoch, t.root, 2n * CLD, laneB, CLD, 10n * CLD);
      await time.increase(vetoDelay);
      await settlement.finalize(epoch);
      await time.increase(vestB);
      await settlement.claim(epoch, provA.address, CLD, laneB, t.getProof(0));
      await expect(settlement.claim(epoch, provB.address, CLD, 1n, t.getProof(1))).to.be.revertedWithCustomError(settlement, "MintCapExceeded");
    });
  });

  describe("clawLaneB", () => {
    async function finalized() {
      const s = await setup();
      const laneB = await s.settlement.allowance(s.epoch);
      const t = tree(s.epoch, [[s.provA.address, CLD, laneB], [s.provB.address, CLD, 0n]]);
      await s.settlement.connect(s.poster).postEpoch(s.epoch, t.root, 2n * CLD, laneB, CLD, 10n * CLD);
      return { ...s, t, laneB };
    }

    it("guardian voids lane B before vest; lane A still claimable; lane B never minted", async () => {
      const f = await finalized();
      const { token, settlement, guardian, provA, epoch, t, laneB, vetoDelay, vestB } = f;
      await time.increase(vetoDelay);
      await settlement.finalize(epoch);
      await expect(settlement.connect(guardian).clawLaneB(epoch, provA.address, CLD, laneB, t.getProof(0)))
        .to.emit(settlement, "LaneBClawed").withArgs(epoch, provA.address, laneB, guardian.address);
      expect(await settlement.laneFlags(epoch, provA.address)).to.equal(4n);
      await expect(settlement.connect(guardian).clawLaneB(epoch, provA.address, CLD, laneB, t.getProof(0)))
        .to.be.revertedWithCustomError(settlement, "LaneBAlreadySettled");
      await time.increase(vestB);
      await expect(settlement.claim(epoch, provA.address, CLD, laneB, t.getProof(0)))
        .to.emit(settlement, "Claimed").withArgs(epoch, provA.address, CLD, 0n);
      expect(await token.balanceOf(provA.address)).to.equal(CLD);
      expect(await settlement.laneFlags(epoch, provA.address)).to.equal(5n);
      await expect(settlement.claim(epoch, provA.address, CLD, laneB, t.getProof(0))).to.be.revertedWithCustomError(settlement, "NothingToClaim");
      expect((await settlement.epochs(epoch)).mintedB).to.equal(0n);
    });

    it("claw after lane A was claimed still voids lane B", async () => {
      const f = await finalized();
      const { token, settlement, guardian, provA, epoch, t, laneB, vetoDelay, vestB } = f;
      await time.increase(vetoDelay);
      await settlement.finalize(epoch);
      await settlement.claim(epoch, provA.address, CLD, laneB, t.getProof(0));
      await settlement.connect(guardian).clawLaneB(epoch, provA.address, CLD, laneB, t.getProof(0));
      expect(await settlement.laneFlags(epoch, provA.address)).to.equal(5n);
      await time.increase(vestB);
      await expect(settlement.claim(epoch, provA.address, CLD, laneB, t.getProof(0))).to.be.revertedWithCustomError(settlement, "NothingToClaim");
      expect(await token.balanceOf(provA.address)).to.equal(CLD);
    });

    it("reverts: not guardian, not finalized, bad proof, already vested, already claimed", async () => {
      const f = await finalized();
      const { settlement, guardian, stranger, provA, epoch, t, laneB, vetoDelay, vestB } = f;
      await expect(settlement.connect(stranger).clawLaneB(epoch, provA.address, CLD, laneB, t.getProof(0)))
        .to.be.revertedWithCustomError(settlement, "AccessControlUnauthorizedAccount");
      await expect(settlement.connect(guardian).clawLaneB(epoch, provA.address, CLD, laneB, t.getProof(0)))
        .to.be.revertedWithCustomError(settlement, "NotFinalized");
      await time.increase(vetoDelay);
      await settlement.finalize(epoch);
      await expect(settlement.connect(guardian).clawLaneB(epoch, provA.address, CLD, laneB + 1n, t.getProof(0)))
        .to.be.revertedWithCustomError(settlement, "InvalidProof");
      const vestsAt = await settlement.laneBVestsAt(epoch);
      await time.increaseTo(vestsAt - 1n);
      await expect(settlement.connect(guardian).clawLaneB(epoch, provA.address, CLD, laneB, t.getProof(0)))
        .to.be.revertedWithCustomError(settlement, "LaneBVested");
      await settlement.claim(epoch, provA.address, CLD, laneB, t.getProof(0)); // both lanes minted
      await expect(settlement.connect(guardian).clawLaneB(epoch, provA.address, CLD, laneB, t.getProof(0)))
        .to.be.revertedWithCustomError(settlement, "LaneBVested");
      void vestB;
    });
  });

  describe("allowance schedule", () => {
    it("rateBpsAt: 8% -> x0.85 per year -> 1.5% floor", async () => {
      const { settlement, genesis } = await setup();
      expect(await settlement.rateBpsAt(genesis)).to.equal(800n);
      expect(await settlement.rateBpsAt(genesis + YEAR - 1n)).to.equal(800n);
      expect(await settlement.rateBpsAt(genesis + YEAR)).to.equal(680n);
      expect(await settlement.rateBpsAt(genesis + 2n * YEAR)).to.equal(578n);
      expect(await settlement.rateBpsAt(genesis + 30n * YEAR)).to.equal(150n);
      expect(await settlement.rateBpsAt(0n)).to.equal(800n);
    });

    it("per-epoch allowance is pro-rata of the annual cap at current supply", async () => {
      const { settlement, token, epoch, epochSeconds } = await setup();
      const annual = ((await token.totalSupply()) * 800n) / 10_000n;
      expect(await settlement.annualSubsidyCap(epoch)).to.equal(annual);
      expect(await settlement.allowance(epoch)).to.equal((annual * epochSeconds) / YEAR);
    });

    it("the year's cap binds across epochs and resets with the decayed rate in the next year", async () => {
      // 100-day epochs: 4 epochs start inside schedule year 0 -> the 4th gets only what is left of the year.
      const epochSeconds = 100n * 24n * 3600n;
      const { settlement, token, poster, epoch, vetoDelay } = await setup({ epochSeconds, escrow: 0n });
      const annual0 = ((await token.totalSupply()) * 800n) / 10_000n;
      const perEpoch = (annual0 * epochSeconds) / YEAR;
      const y0 = await settlement.yearOf(epoch);
      let used = 0n;
      let e = epoch;
      while ((await settlement.yearOf(e)) === y0) {
        const left = annual0 - used;
        const expected = perEpoch < left ? perEpoch : left;
        expect(await settlement.allowance(e)).to.equal(expected);
        const endsAt = (e + 1n) * epochSeconds + 1n;
        if (endsAt > BigInt(await time.latest())) await time.increaseTo(endsAt);
        if (expected > 0n) {
          await expect(settlement.connect(poster).postEpoch(e, ethers.ZeroHash, 0, expected + 1n, 0, 0))
            .to.be.revertedWithCustomError(settlement, "LaneBExceedsAllowance");
        }
        await settlement.connect(poster).postEpoch(e, ethers.ZeroHash, 0, expected, 0, 0);
        used += expected;
        expect(await settlement.subsidyByYear(y0)).to.equal(used);
        e += 1n;
      }
      expect(used).to.equal(annual0); // the whole year's cap was consumable, and not a wei more
      expect(await settlement.allowance(e - 1n)).to.equal(0n);
      // next schedule year: fresh counter at 680 bps of the (unchanged, nothing claimed) supply
      const annual1 = ((await token.totalSupply()) * 680n) / 10_000n;
      expect(await settlement.yearOf(e)).to.equal(y0 + 1n);
      expect(await settlement.allowance(e)).to.equal((annual1 * epochSeconds) / YEAR);
      void vetoDelay;
    });

    it("a vetoed epoch gives its lane-B share back to the year", async () => {
      const { settlement, poster, guardian, epoch } = await setup();
      const cap = await settlement.allowance(epoch);
      await settlement.connect(poster).postEpoch(epoch, ethers.ZeroHash, 0, cap, 0, 0);
      expect(await settlement.allowance(epoch + 1n)).to.equal(cap); // same year, plenty left
      expect(await settlement.subsidyByYear(await settlement.yearOf(epoch))).to.equal(cap);
      await settlement.connect(guardian).veto(epoch);
      expect(await settlement.subsidyByYear(await settlement.yearOf(epoch))).to.equal(0n);
    });
  });

  describe("reentrancy", () => {
    async function setupMock() {
      const [deployer, admin, poster, guardian, treasury, user, provA] = await ethers.getSigners();
      const mock = await (await ethers.getContractFactory("ReentrantCLDMock")).deploy();
      const genesis = BigInt(await time.latest());
      const settlement = await (await ethers.getContractFactory("CloudanaSettlementV2")).deploy(
        await mock.getAddress(), treasury.address, admin.address, poster.address, guardian.address, 3600n, 3600n, 3600n, genesis,
      );
      const sAddr = await settlement.getAddress();
      await mock.fund(user.address, 100n * CLD);
      await mock.connect(user).approve(sAddr, 100n * CLD);
      const epoch = genesis / 3600n;
      await time.increaseTo((epoch + 2n) * 3600n);
      return { mock, settlement, sAddr, poster, user, provA, epoch, deployer };
    }

    it("depositFor: re-entry during transferFrom is blocked", async () => {
      const { mock, settlement, sAddr, user } = await setupMock();
      const data = settlement.interface.encodeFunctionData("depositFor", [user.address, 1n]);
      await mock.setAttack(sAddr, data);
      await settlement.connect(user).deposit(10n * CLD);
      expect(await mock.attacked()).to.equal(true);
      expect(await mock.reentrySucceeded()).to.equal(false);
      expect(settlement.interface.parseError(await mock.reentryError())?.name).to.equal("ReentrancyGuardReentrantCall");
      expect(await settlement.totalEscrow()).to.equal(10n * CLD);
    });

    it("finalize: re-entry during burn is blocked; state is already updated when the token is called", async () => {
      const { mock, settlement, sAddr, user, poster, epoch } = await setupMock();
      await settlement.connect(user).deposit(10n * CLD);
      await settlement.connect(poster).postEpoch(epoch, ethers.ZeroHash, 0, 0, CLD, 10n * CLD);
      await time.increase(3600n);
      await mock.setAttack(sAddr, settlement.interface.encodeFunctionData("finalize", [epoch]));
      await settlement.finalize(epoch);
      expect(await mock.reentrySucceeded()).to.equal(false);
      expect(settlement.interface.parseError(await mock.reentryError())?.name).to.equal("ReentrancyGuardReentrantCall");
      expect(await settlement.totalEscrow()).to.equal(0n);
      expect(await mock.totalSupply()).to.equal(100n * CLD - 10n * CLD + CLD);
    });

    it("claim: re-entry during mint is blocked and the leaf stays single-paid", async () => {
      const { mock, settlement, sAddr, user, poster, provA, epoch } = await setupMock();
      await settlement.connect(user).deposit(10n * CLD);
      const t = tree(epoch, [[provA.address, CLD, 0n]]);
      await settlement.connect(poster).postEpoch(epoch, t.root, CLD, 0, CLD, 10n * CLD);
      await time.increase(3600n);
      await settlement.finalize(epoch);
      await mock.setAttack(sAddr, settlement.interface.encodeFunctionData("claim", [epoch, provA.address, CLD, 0n, t.getProof(0)]));
      await settlement.claim(epoch, provA.address, CLD, 0n, t.getProof(0));
      expect(await mock.attacked()).to.equal(true);
      expect(await mock.reentrySucceeded()).to.equal(false);
      expect(settlement.interface.parseError(await mock.reentryError())?.name).to.equal("ReentrancyGuardReentrantCall");
      expect(await mock.balanceOf(provA.address)).to.equal(CLD);
    });
  });
});
