import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("CLDFaucet", function () {
  let cldToken: any;
  let faucet: any;
  let owner: any;
  let user1: any;
  let user2: any;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy CLD token
    const CLDToken = await ethers.getContractFactory("CLDToken");
    cldToken = await CLDToken.deploy(owner.address, owner.address);
    await cldToken.waitForDeployment();

    // Deploy faucet
    const CLDFaucet = await ethers.getContractFactory("CLDFaucet");
    faucet = await CLDFaucet.deploy(await cldToken.getAddress());
    await faucet.waitForDeployment();

    // Fund faucet with 100,000 CLD
    const fundAmount = ethers.parseEther("100000");
    await cldToken.transfer(await faucet.getAddress(), fundAmount);
  });

  it("should allow a user to drip", async function () {
    await faucet.connect(user1).drip();
    const balance = await cldToken.balanceOf(user1.address);
    expect(balance).to.equal(ethers.parseEther("1000"));
  });

  it("should emit Drip event", async function () {
    await expect(faucet.connect(user1).drip())
      .to.emit(faucet, "Drip")
      .withArgs(user1.address, ethers.parseEther("1000"));
  });

  it("should enforce cooldown period", async function () {
    await faucet.connect(user1).drip();
    await expect(faucet.connect(user1).drip()).to.be.revertedWith(
      "CLDFaucet: cooldown not elapsed"
    );
  });

  it("should allow drip after cooldown", async function () {
    await faucet.connect(user1).drip();
    await time.increase(24 * 60 * 60); // 24 hours
    await faucet.connect(user1).drip();
    const balance = await cldToken.balanceOf(user1.address);
    expect(balance).to.equal(ethers.parseEther("2000"));
  });

  it("should allow different users to drip simultaneously", async function () {
    await faucet.connect(user1).drip();
    await faucet.connect(user2).drip();
    expect(await cldToken.balanceOf(user1.address)).to.equal(ethers.parseEther("1000"));
    expect(await cldToken.balanceOf(user2.address)).to.equal(ethers.parseEther("1000"));
  });

  it("should report canDrip correctly", async function () {
    expect(await faucet.canDrip(user1.address)).to.be.true;
    await faucet.connect(user1).drip();
    expect(await faucet.canDrip(user1.address)).to.be.false;
  });

  it("should report timeUntilDrip correctly", async function () {
    expect(await faucet.timeUntilDrip(user1.address)).to.equal(0);
    await faucet.connect(user1).drip();
    const remaining = await faucet.timeUntilDrip(user1.address);
    expect(remaining).to.be.gt(0);
  });

  it("should allow owner to update drip amount", async function () {
    await faucet.setDripAmount(ethers.parseEther("500"));
    await faucet.connect(user1).drip();
    expect(await cldToken.balanceOf(user1.address)).to.equal(ethers.parseEther("500"));
  });

  it("should allow owner to update cooldown", async function () {
    await faucet.setCooldown(3600); // 1 hour
    await faucet.connect(user1).drip();
    await time.increase(3600);
    await faucet.connect(user1).drip(); // Should succeed with shorter cooldown
    expect(await cldToken.balanceOf(user1.address)).to.equal(ethers.parseEther("2000"));
  });

  it("should reject drip when faucet is empty", async function () {
    // Drain the faucet
    await faucet.withdraw(ethers.parseEther("100000"));
    await expect(faucet.connect(user1).drip()).to.be.revertedWith(
      "CLDFaucet: insufficient faucet balance"
    );
  });

  it("should allow owner to withdraw", async function () {
    const before = await cldToken.balanceOf(owner.address);
    await faucet.withdraw(ethers.parseEther("50000"));
    const after = await cldToken.balanceOf(owner.address);
    expect(after - before).to.equal(ethers.parseEther("50000"));
  });

  it("should reject non-owner from setting drip amount", async function () {
    await expect(faucet.connect(user1).setDripAmount(1)).to.be.reverted;
  });
});
