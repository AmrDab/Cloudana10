import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { CLD, MINTER_ROLE, YEAR } from "./helpers";

describe("CLDTokenV2", () => {
  async function deploy(initial = 1_000_000n * CLD, bps = 1000n) {
    const [deployer, admin, minter, treasury, other] = await ethers.getSigners();
    const token = await (await ethers.getContractFactory("CLDTokenV2")).deploy(treasury.address, initial, bps, admin.address);
    await token.connect(admin).grantRole(MINTER_ROLE, minter.address);
    return { token, deployer, admin, minter, treasury, other };
  }

  it("mints the initial supply to the treasury; name/symbol; admin is the given admin, not the deployer", async () => {
    const { token, deployer, admin, treasury } = await deploy();
    expect(await token.totalSupply()).to.equal(1_000_000n * CLD);
    expect(await token.balanceOf(treasury.address)).to.equal(1_000_000n * CLD);
    expect(await token.name()).to.equal("Cloudana Token");
    expect(await token.symbol()).to.equal("CLD");
    const ADMIN = await token.DEFAULT_ADMIN_ROLE();
    expect(await token.hasRole(ADMIN, admin.address)).to.equal(true);
    expect(await token.hasRole(ADMIN, deployer.address)).to.equal(false);
    expect(await token.hasRole(MINTER_ROLE, deployer.address)).to.equal(false);
    expect(await token.supplyAtYearStart()).to.equal(1_000_000n * CLD);
    expect(await token.maxMintBpsPerYear()).to.equal(1000n);
  });

  it("rejects zero treasury / admin", async () => {
    const [a] = await ethers.getSigners();
    const f = await ethers.getContractFactory("CLDTokenV2");
    await expect(f.deploy(ethers.ZeroAddress, 1n, 1000n, a.address)).to.be.revertedWithCustomError(f, "ZeroAddress");
    await expect(f.deploy(a.address, 1n, 1000n, ethers.ZeroAddress)).to.be.revertedWithCustomError(f, "ZeroAddress");
  });

  it("only MINTER_ROLE mints", async () => {
    const { token, admin, other, minter } = await deploy();
    for (const s of [admin, other]) {
      await expect(token.connect(s).mint(other.address, 1n)).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
    }
    await expect(token.connect(minter).mint(other.address, 5n)).to.emit(token, "Transfer").withArgs(ethers.ZeroAddress, other.address, 5n);
  });

  it("burn / burnFrom", async () => {
    const { token, treasury, other } = await deploy();
    await token.connect(treasury).burn(CLD);
    expect(await token.totalSupply()).to.equal(999_999n * CLD);
    await expect(token.connect(other).burnFrom(treasury.address, CLD)).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    await token.connect(treasury).approve(other.address, CLD);
    await token.connect(other).burnFrom(treasury.address, CLD);
    expect(await token.totalSupply()).to.equal(999_998n * CLD);
  });

  describe("annual mint ceiling", () => {
    it("year 0: up to 10% of the initial supply net of burns, then AnnualMintCeilingExceeded", async () => {
      const { token, minter, other } = await deploy();
      const cap = 100_000n * CLD;
      expect(await token.mintRemainingThisYear()).to.equal(cap);
      await token.connect(minter).mint(other.address, cap - 1n);
      expect(await token.mintRemainingThisYear()).to.equal(1n);
      await expect(token.connect(minter).mint(other.address, 2n))
        .to.be.revertedWithCustomError(token, "AnnualMintCeilingExceeded").withArgs(2n, 1n);
      await token.connect(minter).mint(other.address, 1n);
      await expect(token.connect(minter).mint(other.address, 1n))
        .to.be.revertedWithCustomError(token, "AnnualMintCeilingExceeded").withArgs(1n, 0n);
      expect(await token.mintedThisYear()).to.equal(cap);
    });

    it("burns credit the net ceiling back", async () => {
      const { token, minter, other } = await deploy();
      const cap = 100_000n * CLD;
      await token.connect(minter).mint(other.address, cap);
      await expect(token.connect(minter).mint(other.address, 1n)).to.be.revertedWithCustomError(token, "AnnualMintCeilingExceeded");
      await token.connect(other).burn(5n * CLD);
      expect(await token.burnedThisYear()).to.equal(5n * CLD);
      expect(await token.mintRemainingThisYear()).to.equal(5n * CLD);
      await token.connect(minter).mint(other.address, 5n * CLD);
      await expect(token.connect(minter).mint(other.address, 1n)).to.be.revertedWithCustomError(token, "AnnualMintCeilingExceeded");
    });

    it("burn-and-remint at 98% of fees never hits the ceiling, whatever the fee volume", async () => {
      const { token, minter, other } = await deploy();
      const fee = 200_000n * CLD; // 2× the yearly cap per epoch, 5 epochs = 10× the cap in gross mints
      await token.connect(minter).mint(other.address, 100_000n * CLD); // fill the net ceiling first
      for (let i = 0; i < 5; i++) {
        await token.connect(minter).mint(other.address, 0n); // keep the counters warm
        await token.connect(other).burn(fee > (await token.balanceOf(other.address)) ? await token.balanceOf(other.address) : fee);
        const burned = await token.burnedThisYear();
        const remint = (burned * 98n) / 100n - ((await token.mintedThisYear()) - 100_000n * CLD);
        if (remint > 0n) await token.connect(minter).mint(other.address, remint);
      }
      expect(await token.mintedThisYear()).to.be.greaterThan(100_000n * CLD);
    });

    it("a new year re-snapshots the supply at its first mint and resets the counter", async () => {
      const { token, minter, treasury, other } = await deploy();
      await token.connect(minter).mint(other.address, 100_000n * CLD); // year 0 exhausted
      await time.increase(YEAR);
      expect(await token.currentMintYear()).to.equal(1n);
      // supply now 1.1M; the year's first burn snapshots it (cap 110k) and credits 100k back
      await token.connect(treasury).burn(100_000n * CLD);
      expect(await token.ceilingYear()).to.equal(1n);
      expect(await token.supplyAtYearStart()).to.equal(1_100_000n * CLD);
      expect(await token.mintRemainingThisYear()).to.equal(210_000n * CLD);
      await token.connect(minter).mint(other.address, 1n);
      expect(await token.mintedThisYear()).to.equal(1n);
      await expect(token.connect(minter).mint(other.address, 210_000n * CLD)).to.be.revertedWithCustomError(token, "AnnualMintCeilingExceeded");
      await token.connect(minter).mint(other.address, 210_000n * CLD - 1n);
      // skipping a year entirely is fine: year 3 snapshots again
      await time.increase(2n * YEAR);
      expect(await token.currentMintYear()).to.equal(3n);
      await token.connect(minter).mint(other.address, 1n);
      expect(await token.ceilingYear()).to.equal(3n);
      expect(await token.supplyAtYearStart()).to.equal(1_210_000n * CLD); // 1.1M − 100k burned + 210k minted in year 1
    });

    it("ceiling parameter is honoured (0 bps => no minting at all; 10000 bps => up to the whole supply)", async () => {
      const a = await deploy(1000n, 0n);
      await expect(a.token.connect(a.minter).mint(a.other.address, 1n)).to.be.revertedWithCustomError(a.token, "AnnualMintCeilingExceeded");
      const b = await deploy(1000n, 10_000n);
      await b.token.connect(b.minter).mint(b.other.address, 1000n);
      await expect(b.token.connect(b.minter).mint(b.other.address, 1n)).to.be.revertedWithCustomError(b.token, "AnnualMintCeilingExceeded");
    });
  });
});
