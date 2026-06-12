import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const E18 = 10n ** 18n;
const YEAR = 365n * 86400n;
const EPOCH = 86400n;

describe("Tokenomics v2", () => {
  async function deployEmission() {
    const [admin, pool, outsider] = await ethers.getSigners();
    const cld = await (await ethers.getContractFactory("MockCLD")).deploy();
    await cld.mint(admin.address, 1_000_000n * E18); // genesis supply 1M
    const ec = await (
      await ethers.getContractFactory("EmissionController")
    ).deploy(await cld.getAddress(), pool.address);
    return { admin, pool, outsider, cld, ec };
  }

  describe("EmissionController", () => {
    it("starts at the 8.00% genesis rate", async () => {
      const { ec } = await deployEmission();
      expect(await ec.currentRateBps()).to.equal(800n);
    });

    it("refuses to emit before an epoch has elapsed", async () => {
      const { ec } = await deployEmission();
      await expect(ec.emit_()).to.be.revertedWith("no epoch elapsed");
    });

    it("mints exactly the scheduled budget into the reward pool after one epoch", async () => {
      const { ec, cld, pool } = await deployEmission();
      await time.increase(Number(EPOCH));
      const supply: bigint = await cld.totalSupply();
      const expected = (((supply * 800n) / 10_000n) * EPOCH) / YEAR; // supply*8% pro-rated to 1 day
      await ec.emit_();
      expect(await cld.balanceOf(pool.address)).to.equal(expected);
      expect(await ec.totalEmitted()).to.equal(expected);
      // immediately calling again must revert — no double emission
      await expect(ec.emit_()).to.be.revertedWith("no epoch elapsed");
    });

    it("rate decays 15%/yr with integer math (year 5 = 354 bps)", async () => {
      const { ec } = await deployEmission();
      await time.increase(Number(5n * YEAR));
      // 800 -> 680 -> 578 -> 491 -> 417 -> 354
      expect(await ec.currentRateBps()).to.equal(354n);
    });

    it("never decays below the 1.50% permanent tail", async () => {
      const { ec } = await deployEmission();
      await time.increase(Number(12n * YEAR));
      expect(await ec.currentRateBps()).to.equal(150n);
      await time.increase(Number(20n * YEAR));
      expect(await ec.currentRateBps()).to.equal(150n); // forever
    });

    it("emission is permissionless to trigger but schedule-bounded (no caller discretion)", async () => {
      const { ec, cld, pool, outsider } = await deployEmission();
      await time.increase(Number(EPOCH));
      const supply: bigint = await cld.totalSupply();
      const expected = (((supply * 800n) / 10_000n) * EPOCH) / YEAR;
      await ec.connect(outsider).emit_(); // anyone may advance the clock…
      expect(await cld.balanceOf(pool.address)).to.equal(expected); // …but mints only the schedule
    });

    it("only admin can repoint the reward pool", async () => {
      const { ec, outsider } = await deployEmission();
      await expect(ec.connect(outsider).setRewardPool(outsider.address)).to.be
        .reverted;
    });
  });

  describe("RewardContract v2 burn split", () => {
    async function deployReward() {
      const [user, treasury] = await ethers.getSigners();
      const cld = await (await ethers.getContractFactory("MockCLD")).deploy();
      await cld.mint(user.address, 100_000n * E18);
      const rw = await (
        await ethers.getContractFactory("RewardV2Harness")
      ).deploy(await cld.getAddress(), treasury.address);
      await cld.approve(await rw.getAddress(), 100_000n * E18);
      return { user, treasury, cld, rw };
    }

    it("splits a payment 2% burn / 0.5% treasury / 97.5% escrow — and supply actually shrinks", async () => {
      const { cld, rw, treasury } = await deployReward();
      const amount = 10_000n * E18;
      const supplyBefore: bigint = await cld.totalSupply();
      await rw.fundWorkload(1, amount);
      const burned = (amount * 200n) / 10_000n;   // 200 CLD
      const toTreas = (amount * 50n) / 10_000n;   //  50 CLD
      expect(await cld.totalSupply()).to.equal(supplyBefore - burned); // deflationary sink is real
      expect(await cld.balanceOf(treasury.address)).to.equal(toTreas);
      expect(await rw.workloadDeposits(1)).to.equal(amount - burned - toTreas); // 9,750 escrowed
      expect(await rw.totalBurned()).to.equal(burned);
      expect(await rw.totalToTreasury()).to.equal(toTreas);
    });

    it("accumulates burn across payments", async () => {
      const { rw } = await deployReward();
      await rw.fundWorkload(1, 10_000n * E18);
      await rw.fundWorkload(2, 5_000n * E18);
      expect(await rw.totalBurned()).to.equal((15_000n * E18 * 200n) / 10_000n);
    });

    it("rejects zero-amount funding", async () => {
      const { rw } = await deployReward();
      await expect(rw.fundWorkload(1, 0)).to.be.revertedWith("Amount must be > 0");
    });
  });

  describe("Soft-cap equilibrium property", () => {
    it("at the tail, annual emission equals supply * 1.5% — the usage burn sets the ceiling", async () => {
      const { ec, cld } = await deployEmission();
      await time.increase(Number(12n * YEAR)); // deep into tail
      await ec.emit_(); // flush the backlog so lastEmissionAt catches up
      await time.increase(Number(EPOCH));
      const supply: bigint = await cld.totalSupply();
      const [pending] = await ec.pendingEmission();
      const expected = (((supply * 150n) / 10_000n) * EPOCH) / YEAR;
      expect(pending).to.equal(expected);
    });
  });
});
