import { expect } from "chai";
import { ethers } from "hardhat";

const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));

/**
 * Dress rehearsal for scripts/deploy-emission-controller.ts, run against a fresh
 * in-memory chain. Proves the migration end-state on every `npm test`, so the
 * real testnet run is a formality — not a leap of faith with money attached.
 */
describe("EmissionController migration (dress rehearsal)", () => {
  async function freshDeploy() {
    const [deployer, pool, provider] = await ethers.getSigners();
    const CLD = await ethers.getContractFactory("CLDToken");
    // CLDToken(treasuryWallet, teamWallet); constructor grants deployer DEFAULT_ADMIN + MINTER.
    const cld = await CLD.deploy(deployer.address, deployer.address);
    return { deployer, pool, provider, cld };
  }

  it("makes EmissionController the sole minter and revokes the deployer EOA", async () => {
    const { deployer, pool, cld } = await freshDeploy();

    // precondition: deployer can mint today (the risk we're closing)
    expect(await cld.hasRole(MINTER_ROLE, deployer.address)).to.equal(true);

    // run the migration steps
    const EC = await ethers.getContractFactory("EmissionController");
    const ec = await EC.deploy(await cld.getAddress(), pool.address);
    await ec.waitForDeployment();
    await (await cld.grantRole(MINTER_ROLE, await ec.getAddress())).wait();
    await (await cld.revokeRole(MINTER_ROLE, deployer.address)).wait();

    // end state
    expect(await cld.hasRole(MINTER_ROLE, await ec.getAddress())).to.equal(true);
    expect(await cld.hasRole(MINTER_ROLE, deployer.address)).to.equal(false);
  });

  it("after migration, the deployer EOA can no longer mint", async () => {
    const { deployer, pool, provider, cld } = await freshDeploy();
    const EC = await ethers.getContractFactory("EmissionController");
    const ec = await EC.deploy(await cld.getAddress(), pool.address);
    await (await cld.grantRole(MINTER_ROLE, await ec.getAddress())).wait();
    await (await cld.revokeRole(MINTER_ROLE, deployer.address)).wait();

    await expect(cld.mint(provider.address, ethers.parseUnits("1", 18))).to.be.reverted;
  });

  it("EmissionController mints only the scheduled budget into the reward pool", async () => {
    const { deployer, pool, cld } = await freshDeploy();
    // seed a genesis supply so the % emission has a base
    await (await cld.mint(deployer.address, ethers.parseUnits("1000000", 18))).wait();

    const EC = await ethers.getContractFactory("EmissionController");
    const ec = await EC.deploy(await cld.getAddress(), pool.address);
    await (await cld.grantRole(MINTER_ROLE, await ec.getAddress())).wait();
    await (await cld.revokeRole(MINTER_ROLE, deployer.address)).wait();

    // advance one emission epoch (1 day) and emit
    await ethers.provider.send("evm_increaseTime", [86400]);
    await ethers.provider.send("evm_mine", []);

    const before = await cld.balanceOf(pool.address);
    const supply = await cld.totalSupply(); // whatever the real supply is at emit time
    await (await ec.emit_()).wait();
    const minted = (await cld.balanceOf(pool.address)) - before;

    // scheduled budget = supply * 8% * (1 epoch of 1 day / 365 days)
    const expected = (supply * 800n * 86400n) / (10_000n * 365n * 86400n);
    expect(minted).to.equal(expected);
  });
});
