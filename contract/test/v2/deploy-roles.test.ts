import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { deployV2 } from "../../scripts/v2/deploy";
import { CLD, MINTER_ROLE } from "./helpers";

describe("scripts/v2/deploy.ts deployV2", () => {
  it("wires roles to the Safes/poster and leaves the deployer with no role on either contract", async () => {
    const [deployer, treasury, guardian, admin, poster, stranger] = await ethers.getSigners();
    const genesisTimestamp = await time.latest();
    const r = await deployV2(deployer, {
      treasury: treasury.address, guardian: guardian.address, admin: admin.address, poster: poster.address,
      epochSeconds: 3600, vetoDelaySeconds: 3600, vestBSeconds: 3600, initialSupplyWei: 1_000_000n * CLD,
      maxMintBpsPerYear: 1000, genesisTimestamp,
    });
    const token = await ethers.getContractAt("CLDTokenV2", r.token);
    const settlement = await ethers.getContractAt("CloudanaSettlementV2", r.settlement);
    const ADMIN = ethers.ZeroHash;
    const POSTER = await settlement.POSTER_ROLE();
    const GUARDIAN = await settlement.GUARDIAN_ROLE();

    // token
    expect(await token.hasRole(MINTER_ROLE, r.settlement)).to.equal(true);
    expect(await token.hasRole(ADMIN, admin.address)).to.equal(true);
    for (const role of [ADMIN, MINTER_ROLE]) {
      expect(await token.hasRole(role, deployer.address), `deployer token role ${role}`).to.equal(false);
    }
    expect(await token.balanceOf(treasury.address)).to.equal(1_000_000n * CLD);
    expect(await token.totalSupply()).to.equal(1_000_000n * CLD);

    // settlement
    expect(await settlement.hasRole(ADMIN, admin.address)).to.equal(true);
    expect(await settlement.hasRole(POSTER, poster.address)).to.equal(true);
    expect(await settlement.hasRole(GUARDIAN, guardian.address)).to.equal(true);
    for (const role of [ADMIN, POSTER, GUARDIAN]) {
      expect(await settlement.hasRole(role, deployer.address), `deployer settlement role ${role}`).to.equal(false);
      expect(await settlement.hasRole(role, stranger.address)).to.equal(false);
    }
    expect(await settlement.treasury()).to.equal(treasury.address);
    expect(await settlement.cld()).to.equal(r.token);
    expect(await settlement.epochSeconds()).to.equal(3600n);
    expect(await settlement.vetoDelaySeconds()).to.equal(3600n);
    expect(await settlement.vestBSeconds()).to.equal(3600n);
    expect(await settlement.genesisTimestamp()).to.equal(BigInt(genesisTimestamp));
    expect(r.genesisEpoch).to.equal(Math.floor(genesisTimestamp / 3600));

    // the deployer can no longer administer either contract
    await expect(token.connect(deployer).grantRole(MINTER_ROLE, deployer.address)).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
    await expect(settlement.connect(deployer).grantRole(POSTER, deployer.address)).to.be.revertedWithCustomError(settlement, "AccessControlUnauthorizedAccount");
    // the admin Safe can (e.g. rotate the poster)
    await settlement.connect(admin).grantRole(POSTER, stranger.address);
    expect(await settlement.hasRole(POSTER, stranger.address)).to.equal(true);

    // constructor args returned for verification match the deployment
    expect(r.tokenArgs).to.deep.equal([treasury.address, 1_000_000n * CLD, 1000, deployer.address]);
    expect(r.settlementArgs).to.deep.equal([r.token, treasury.address, admin.address, poster.address, guardian.address, 3600, 3600, 3600, genesisTimestamp]);
  });
});
