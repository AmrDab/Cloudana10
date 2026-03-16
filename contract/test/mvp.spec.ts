import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {
  CLDToken,
  ProviderRegistry,
  WorkloadRegistry,
  RewardContract,
  POUWVerifier,
} from "../typechain-types";

/**
 * Cloudana MVP Integration Tests
 *
 * End-to-end tests exercising the full contract stack:
 *   CLDToken → ProviderRegistry → WorkloadRegistry → RewardContract → POUWVerifier
 */
describe("Cloudana MVP", function () {
  async function deployContracts() {
    const [deployer, orchestrator, user, providerOwner, treasury, team, other] =
      await ethers.getSigners();

    // Deploy CLDToken
    const CLDTokenFactory = await ethers.getContractFactory("CLDToken");
    const cldToken = await CLDTokenFactory.deploy(treasury.address, team.address);
    await cldToken.waitForDeployment();

    // Deploy ProviderRegistry (no constructor args)
    const ProviderRegistryFactory = await ethers.getContractFactory("ProviderRegistry");
    const providerRegistry = await ProviderRegistryFactory.deploy();
    await providerRegistry.waitForDeployment();

    // Deploy WorkloadRegistry (no constructor args)
    const WorkloadRegistryFactory = await ethers.getContractFactory("WorkloadRegistry");
    const workloadRegistry = await WorkloadRegistryFactory.deploy();
    await workloadRegistry.waitForDeployment();

    // Deploy RewardContract (takes settlement token address)
    const RewardContractFactory = await ethers.getContractFactory("RewardContract");
    const rewardContract = await RewardContractFactory.deploy(await cldToken.getAddress());
    await rewardContract.waitForDeployment();

    // Deploy POUWVerifier (no constructor args)
    const POUWVerifierFactory = await ethers.getContractFactory("POUWVerifier");
    const pouwVerifier = await POUWVerifierFactory.deploy();
    await pouwVerifier.waitForDeployment();

    // Grant MINTER_ROLE to deployer for test token distribution
    const MINTER_ROLE = await cldToken.MINTER_ROLE();
    await cldToken.grantRole(MINTER_ROLE, deployer.address);

    // Grant ORCHESTRATOR_ROLE on WorkloadRegistry
    const WR_ORCH_ROLE = await workloadRegistry.ORCHESTRATOR_ROLE();
    await workloadRegistry.grantRole(WR_ORCH_ROLE, orchestrator.address);

    // Grant ORCHESTRATOR_ROLE on RewardContract
    const RC_ORCH_ROLE = await rewardContract.ORCHESTRATOR_ROLE();
    await rewardContract.grantRole(RC_ORCH_ROLE, orchestrator.address);

    // Grant ORCHESTRATOR_ROLE on POUWVerifier
    const PV_ORCH_ROLE = await pouwVerifier.ORCHESTRATOR_ROLE();
    await pouwVerifier.grantRole(PV_ORCH_ROLE, orchestrator.address);

    return {
      cldToken,
      providerRegistry,
      workloadRegistry,
      rewardContract,
      pouwVerifier,
      deployer,
      orchestrator,
      user,
      providerOwner,
      treasury,
      team,
      other,
    };
  }

  // ─── CLDToken ──────────────────────────────────────────────────────────────

  describe("CLDToken", function () {
    it("Should deploy with correct initial supply distribution", async function () {
      const { cldToken, treasury, team } = await loadFixture(deployContracts);
      const INITIAL_SUPPLY = await cldToken.INITIAL_SUPPLY();
      const expectedTreasury = (INITIAL_SUPPLY * 80n) / 100n;
      const expectedTeam = (INITIAL_SUPPLY * 20n) / 100n;

      expect(await cldToken.balanceOf(treasury.address)).to.equal(expectedTreasury);
      expect(await cldToken.balanceOf(team.address)).to.equal(expectedTeam);
      expect(await cldToken.totalSupply()).to.equal(INITIAL_SUPPLY);
    });

    it("Should have correct name and symbol", async function () {
      const { cldToken } = await loadFixture(deployContracts);
      expect(await cldToken.name()).to.equal("Cloudana Token");
      expect(await cldToken.symbol()).to.equal("CLD");
    });

    it("Should mint tokens with MINTER_ROLE", async function () {
      const { cldToken, user } = await loadFixture(deployContracts);
      const amount = ethers.parseEther("1000");
      await cldToken.mint(user.address, amount);
      expect(await cldToken.balanceOf(user.address)).to.equal(amount);
    });

    it("Should reject minting without MINTER_ROLE", async function () {
      const { cldToken, user, other } = await loadFixture(deployContracts);
      await expect(
        cldToken.connect(other).mint(user.address, ethers.parseEther("1000"))
      ).to.be.revertedWithCustomError(cldToken, "AccessControlUnauthorizedAccount");
    });

    it("Should burn tokens from sender", async function () {
      const { cldToken, user } = await loadFixture(deployContracts);
      const mintAmount = ethers.parseEther("1000");
      const burnAmount = ethers.parseEther("300");

      await cldToken.mint(user.address, mintAmount);
      await cldToken.connect(user).burn(burnAmount);
      expect(await cldToken.balanceOf(user.address)).to.equal(mintAmount - burnAmount);
    });

    it("Should burn from with allowance", async function () {
      const { cldToken, user, other } = await loadFixture(deployContracts);
      const mintAmount = ethers.parseEther("1000");
      const burnAmount = ethers.parseEther("200");

      await cldToken.mint(user.address, mintAmount);
      await cldToken.connect(user).approve(other.address, burnAmount);
      await cldToken.connect(other).burnFrom(user.address, burnAmount);
      expect(await cldToken.balanceOf(user.address)).to.equal(mintAmount - burnAmount);
    });

    it("Should reject burnFrom with insufficient allowance", async function () {
      const { cldToken, user, other } = await loadFixture(deployContracts);
      await cldToken.mint(user.address, ethers.parseEther("1000"));
      await cldToken.connect(user).approve(other.address, ethers.parseEther("100"));
      await expect(
        cldToken.connect(other).burnFrom(user.address, ethers.parseEther("200"))
      ).to.be.revertedWithCustomError(cldToken, "InsufficientAllowance");
    });
  });

  // ─── ProviderRegistry ─────────────────────────────────────────────────────

  describe("ProviderRegistry", function () {
    const deviceId = ethers.id("test-device-1");
    const metadataUri = "ipfs://QmTestProvider123";

    it("Should register a provider", async function () {
      const { providerRegistry, providerOwner } = await loadFixture(deployContracts);

      await expect(
        providerRegistry.connect(providerOwner).registerProvider(deviceId, metadataUri)
      ).to.emit(providerRegistry, "ProviderRegistered");

      const provider = await providerRegistry.getProviderByDevice(deviceId);
      expect(provider.providerAddr).to.equal(providerOwner.address);
      expect(provider.deviceId).to.equal(deviceId);
      expect(provider.metadataUri).to.equal(metadataUri);
      expect(provider.status).to.equal(1); // Active
    });

    it("Should reject duplicate device registration", async function () {
      const { providerRegistry, providerOwner } = await loadFixture(deployContracts);
      await providerRegistry.connect(providerOwner).registerProvider(deviceId, metadataUri);

      await expect(
        providerRegistry.connect(providerOwner).registerProvider(deviceId, metadataUri)
      ).to.be.revertedWith("Device already registered");
    });

    it("Should reject registration with empty metadata", async function () {
      const { providerRegistry, providerOwner } = await loadFixture(deployContracts);
      await expect(
        providerRegistry.connect(providerOwner).registerProvider(deviceId, "")
      ).to.be.revertedWith("Metadata URI required");
    });

    it("Should update provider metadata", async function () {
      const { providerRegistry, providerOwner } = await loadFixture(deployContracts);
      await providerRegistry.connect(providerOwner).registerProvider(deviceId, metadataUri);

      const newUri = "ipfs://QmUpdated456";
      await providerRegistry.connect(providerOwner).updateProvider(deviceId, newUri);

      const provider = await providerRegistry.getProviderByDevice(deviceId);
      expect(provider.metadataUri).to.equal(newUri);
    });

    it("Should reject update from non-owner", async function () {
      const { providerRegistry, providerOwner, other } = await loadFixture(deployContracts);
      await providerRegistry.connect(providerOwner).registerProvider(deviceId, metadataUri);

      await expect(
        providerRegistry.connect(other).updateProvider(deviceId, "ipfs://QmHack")
      ).to.be.revertedWith("Not device owner");
    });

    it("Should deregister and reactivate provider", async function () {
      const { providerRegistry, providerOwner } = await loadFixture(deployContracts);
      await providerRegistry.connect(providerOwner).registerProvider(deviceId, metadataUri);

      // Deregister → Inactive
      await providerRegistry.connect(providerOwner).deregisterProvider(deviceId);
      let provider = await providerRegistry.getProviderByDevice(deviceId);
      expect(provider.status).to.equal(2); // Inactive

      // Activate → Active
      await providerRegistry.connect(providerOwner).activateProvider(deviceId);
      provider = await providerRegistry.getProviderByDevice(deviceId);
      expect(provider.status).to.equal(1); // Active
    });

    it("Should list devices by owner", async function () {
      const { providerRegistry, providerOwner } = await loadFixture(deployContracts);
      const device1 = ethers.id("device-1");
      const device2 = ethers.id("device-2");

      await providerRegistry.connect(providerOwner).registerProvider(device1, metadataUri);
      await providerRegistry.connect(providerOwner).registerProvider(device2, metadataUri);

      const devices = await providerRegistry.getProvidersByOwner(providerOwner.address);
      expect(devices.length).to.equal(2);
      expect(devices[0]).to.equal(device1);
      expect(devices[1]).to.equal(device2);
    });

    it("Should return active providers", async function () {
      const { providerRegistry, providerOwner, other } = await loadFixture(deployContracts);
      const device1 = ethers.id("device-a");
      const device2 = ethers.id("device-b");

      await providerRegistry.connect(providerOwner).registerProvider(device1, metadataUri);
      await providerRegistry.connect(other).registerProvider(device2, metadataUri);

      // Deregister device1
      await providerRegistry.connect(providerOwner).deregisterProvider(device1);

      const active = await providerRegistry.getActiveProviders();
      expect(active.length).to.equal(1);
      expect(active[0]).to.equal(device2);
    });
  });

  // ─── WorkloadRegistry ─────────────────────────────────────────────────────

  describe("WorkloadRegistry", function () {
    const metadataUri = "ipfs://QmWorkload123";

    it("Should register a workload", async function () {
      const { workloadRegistry, user } = await loadFixture(deployContracts);

      await expect(
        workloadRegistry.connect(user).registerWorkload(metadataUri)
      ).to.emit(workloadRegistry, "WorkloadRegistered");

      const workload = await workloadRegistry.getWorkload(0);
      expect(workload.owner).to.equal(user.address);
      expect(workload.metadataUri).to.equal(metadataUri);
      expect(workload.status).to.equal(1); // Active
    });

    it("Should reject empty metadata URI", async function () {
      const { workloadRegistry, user } = await loadFixture(deployContracts);
      await expect(
        workloadRegistry.connect(user).registerWorkload("")
      ).to.be.revertedWith("Metadata URI required");
    });

    it("Should update workload metadata", async function () {
      const { workloadRegistry, user } = await loadFixture(deployContracts);
      await workloadRegistry.connect(user).registerWorkload(metadataUri);

      const newUri = "ipfs://QmUpdatedWorkload";
      await workloadRegistry.connect(user).updateWorkload(0, newUri);

      const workload = await workloadRegistry.getWorkload(0);
      expect(workload.metadataUri).to.equal(newUri);
    });

    it("Should deregister and reactivate workload", async function () {
      const { workloadRegistry, user } = await loadFixture(deployContracts);
      await workloadRegistry.connect(user).registerWorkload(metadataUri);

      await workloadRegistry.connect(user).deregisterWorkload(0);
      let workload = await workloadRegistry.getWorkload(0);
      expect(workload.status).to.equal(0); // Inactive

      await workloadRegistry.connect(user).activateWorkload(0);
      workload = await workloadRegistry.getWorkload(0);
      expect(workload.status).to.equal(1); // Active
    });

    it("Should delete inactive workload", async function () {
      const { workloadRegistry, user } = await loadFixture(deployContracts);
      await workloadRegistry.connect(user).registerWorkload(metadataUri);

      await workloadRegistry.connect(user).deregisterWorkload(0);
      await workloadRegistry.connect(user).deleteWorkload(0);

      const workload = await workloadRegistry.getWorkload(0);
      expect(workload.owner).to.equal(ethers.ZeroAddress);
    });

    it("Should reject delete of active workload", async function () {
      const { workloadRegistry, user } = await loadFixture(deployContracts);
      await workloadRegistry.connect(user).registerWorkload(metadataUri);

      await expect(
        workloadRegistry.connect(user).deleteWorkload(0)
      ).to.be.revertedWith("Workload must be inactive to delete");
    });

    it("Should record placement via orchestrator", async function () {
      const { workloadRegistry, orchestrator, user, providerOwner } =
        await loadFixture(deployContracts);

      await workloadRegistry.connect(user).registerWorkload(metadataUri);

      await expect(
        workloadRegistry.connect(orchestrator).recordPlacement(0, providerOwner.address, 42)
      ).to.emit(workloadRegistry, "WorkloadPlaced");

      const workload = await workloadRegistry.getWorkload(0);
      expect(workload.placementProvider).to.equal(providerOwner.address);
      expect(workload.placementInstanceId).to.equal(42);
    });

    it("Should reject placement from non-orchestrator", async function () {
      const { workloadRegistry, user, other } = await loadFixture(deployContracts);
      await workloadRegistry.connect(user).registerWorkload(metadataUri);

      await expect(
        workloadRegistry.connect(other).recordPlacement(0, other.address, 1)
      ).to.be.revertedWithCustomError(workloadRegistry, "AccessControlUnauthorizedAccount");
    });

    it("Should track workloads by owner", async function () {
      const { workloadRegistry, user } = await loadFixture(deployContracts);

      await workloadRegistry.connect(user).registerWorkload("ipfs://QmA");
      await workloadRegistry.connect(user).registerWorkload("ipfs://QmB");

      const ids = await workloadRegistry.getWorkloadsByOwner(user.address);
      expect(ids.length).to.equal(2);
      expect(ids[0]).to.equal(0);
      expect(ids[1]).to.equal(1);
    });
  });

  // ─── RewardContract ────────────────────────────────────────────────────────

  describe("RewardContract", function () {
    it("Should fund a workload", async function () {
      const { rewardContract, cldToken, user } = await loadFixture(deployContracts);
      const amount = ethers.parseEther("500");

      await cldToken.mint(user.address, amount);
      await cldToken.connect(user).approve(await rewardContract.getAddress(), amount);

      await expect(
        rewardContract.connect(user).fundWorkload(1, amount)
      ).to.emit(rewardContract, "WorkloadFunded");

      expect(await rewardContract.workloadDeposits(1)).to.equal(amount);
    });

    it("Should reject funding with zero amount", async function () {
      const { rewardContract, user } = await loadFixture(deployContracts);
      await expect(
        rewardContract.connect(user).fundWorkload(1, 0)
      ).to.be.revertedWith("Amount must be > 0");
    });

    it("Should reward provider from workload deposit", async function () {
      const { rewardContract, cldToken, orchestrator, user, providerOwner } =
        await loadFixture(deployContracts);
      const deposit = ethers.parseEther("500");
      const reward = ethers.parseEther("200");

      // User funds workload
      await cldToken.mint(user.address, deposit);
      await cldToken.connect(user).approve(await rewardContract.getAddress(), deposit);
      await rewardContract.connect(user).fundWorkload(1, deposit);

      // Orchestrator rewards provider
      await expect(
        rewardContract.connect(orchestrator).rewardProvider(providerOwner.address, 1, reward)
      ).to.emit(rewardContract, "ProviderRewarded");

      expect(await rewardContract.providerPendingRewards(providerOwner.address)).to.equal(reward);
      expect(await rewardContract.workloadDeposits(1)).to.equal(deposit - reward);
    });

    it("Should reject reward from non-orchestrator", async function () {
      const { rewardContract, cldToken, user, providerOwner } =
        await loadFixture(deployContracts);
      const deposit = ethers.parseEther("500");

      await cldToken.mint(user.address, deposit);
      await cldToken.connect(user).approve(await rewardContract.getAddress(), deposit);
      await rewardContract.connect(user).fundWorkload(1, deposit);

      await expect(
        rewardContract.connect(user).rewardProvider(providerOwner.address, 1, deposit)
      ).to.be.revertedWithCustomError(rewardContract, "AccessControlUnauthorizedAccount");
    });

    it("Should allow provider to withdraw earnings", async function () {
      const { rewardContract, cldToken, orchestrator, user, providerOwner } =
        await loadFixture(deployContracts);
      const deposit = ethers.parseEther("500");
      const reward = ethers.parseEther("200");

      await cldToken.mint(user.address, deposit);
      await cldToken.connect(user).approve(await rewardContract.getAddress(), deposit);
      await rewardContract.connect(user).fundWorkload(1, deposit);
      await rewardContract.connect(orchestrator).rewardProvider(providerOwner.address, 1, reward);

      const balBefore = await cldToken.balanceOf(providerOwner.address);
      await rewardContract.connect(providerOwner).withdrawEarnings();
      const balAfter = await cldToken.balanceOf(providerOwner.address);

      expect(balAfter - balBefore).to.equal(reward);
      expect(await rewardContract.providerPendingRewards(providerOwner.address)).to.equal(0);
    });

    it("Should reject withdrawal with no pending rewards", async function () {
      const { rewardContract, providerOwner } = await loadFixture(deployContracts);
      await expect(
        rewardContract.connect(providerOwner).withdrawEarnings()
      ).to.be.revertedWith("No pending rewards");
    });

    it("Should batch reward providers", async function () {
      const { rewardContract, cldToken, orchestrator, user, providerOwner, other } =
        await loadFixture(deployContracts);
      const deposit = ethers.parseEther("1000");

      await cldToken.mint(user.address, deposit);
      await cldToken.connect(user).approve(await rewardContract.getAddress(), deposit);
      await rewardContract.connect(user).fundWorkload(1, deposit);

      const r1 = ethers.parseEther("300");
      const r2 = ethers.parseEther("200");

      await rewardContract
        .connect(orchestrator)
        .batchRewardProviders(
          [providerOwner.address, other.address],
          [1, 1],
          [r1, r2]
        );

      expect(await rewardContract.providerPendingRewards(providerOwner.address)).to.equal(r1);
      expect(await rewardContract.providerPendingRewards(other.address)).to.equal(r2);
      expect(await rewardContract.workloadDeposits(1)).to.equal(deposit - r1 - r2);
    });

    it("Should refund remaining workload deposit", async function () {
      const { rewardContract, cldToken, orchestrator, user } =
        await loadFixture(deployContracts);
      const deposit = ethers.parseEther("500");

      await cldToken.mint(user.address, deposit);
      await cldToken.connect(user).approve(await rewardContract.getAddress(), deposit);
      await rewardContract.connect(user).fundWorkload(1, deposit);

      const balBefore = await cldToken.balanceOf(user.address);
      await rewardContract.connect(orchestrator).refundWorkload(1, user.address);
      const balAfter = await cldToken.balanceOf(user.address);

      expect(balAfter - balBefore).to.equal(deposit);
      expect(await rewardContract.workloadDeposits(1)).to.equal(0);
    });
  });

  // ─── POUWVerifier ──────────────────────────────────────────────────────────

  describe("POUWVerifier", function () {
    const deviceId = ethers.id("miner-device-1");
    const matrixSize = 64;
    const difficulty = 10;
    const transcriptHash = ethers.id("transcript-hash-abc");
    const z = ethers.id("proof-z-value-1");

    it("Should record a certificate", async function () {
      const { pouwVerifier, orchestrator, providerOwner } = await loadFixture(deployContracts);

      await expect(
        pouwVerifier
          .connect(orchestrator)
          .recordCertificate(
            providerOwner.address,
            deviceId,
            matrixSize,
            difficulty,
            transcriptHash,
            z,
            Date.now()
          )
      ).to.emit(pouwVerifier, "CertificateRecorded");

      expect(await pouwVerifier.certificateCount()).to.equal(1);
      expect(await pouwVerifier.isZUsed(z)).to.be.true;
    });

    it("Should reject duplicate z (replay protection)", async function () {
      const { pouwVerifier, orchestrator, providerOwner } = await loadFixture(deployContracts);
      const ts = Date.now();

      await pouwVerifier
        .connect(orchestrator)
        .recordCertificate(providerOwner.address, deviceId, matrixSize, difficulty, transcriptHash, z, ts);

      await expect(
        pouwVerifier
          .connect(orchestrator)
          .recordCertificate(providerOwner.address, deviceId, matrixSize, difficulty, transcriptHash, z, ts)
      ).to.be.revertedWith("Certificate z already recorded (replay)");
    });

    it("Should reject from non-orchestrator", async function () {
      const { pouwVerifier, user, providerOwner } = await loadFixture(deployContracts);

      await expect(
        pouwVerifier
          .connect(user)
          .recordCertificate(providerOwner.address, deviceId, matrixSize, difficulty, transcriptHash, z, Date.now())
      ).to.be.revertedWithCustomError(pouwVerifier, "AccessControlUnauthorizedAccount");
    });

    it("Should track per-provider stats", async function () {
      const { pouwVerifier, orchestrator, providerOwner } = await loadFixture(deployContracts);

      await pouwVerifier
        .connect(orchestrator)
        .recordCertificate(providerOwner.address, deviceId, matrixSize, difficulty, transcriptHash, z, Date.now());

      const z2 = ethers.id("proof-z-value-2");
      await pouwVerifier
        .connect(orchestrator)
        .recordCertificate(providerOwner.address, deviceId, matrixSize, 15, ethers.id("tx2"), z2, Date.now());

      const [totalCerts, totalDiff] = await pouwVerifier.getMinerStats(providerOwner.address);
      expect(totalCerts).to.equal(2);
      expect(totalDiff).to.equal(difficulty + 15);
      expect(await pouwVerifier.minerCount()).to.equal(1);
    });
  });

  // ─── End-to-End Integration ────────────────────────────────────────────────

  describe("End-to-End Flow", function () {
    it("Should complete full provider→workload→reward→withdraw cycle", async function () {
      const {
        cldToken,
        providerRegistry,
        workloadRegistry,
        rewardContract,
        pouwVerifier,
        orchestrator,
        user,
        providerOwner,
      } = await loadFixture(deployContracts);

      const deviceId = ethers.id("e2e-device");
      const deposit = ethers.parseEther("1000");
      const reward = ethers.parseEther("600");

      // 1. Provider registers
      await providerRegistry
        .connect(providerOwner)
        .registerProvider(deviceId, "ipfs://QmProviderSpec");

      // 2. User registers workload
      await workloadRegistry
        .connect(user)
        .registerWorkload("ipfs://QmWorkloadManifest");

      // 3. Orchestrator places workload on provider
      await workloadRegistry
        .connect(orchestrator)
        .recordPlacement(0, providerOwner.address, 1);

      // 4. User funds workload
      await cldToken.mint(user.address, deposit);
      await cldToken.connect(user).approve(await rewardContract.getAddress(), deposit);
      await rewardContract.connect(user).fundWorkload(0, deposit);

      // 5. Provider submits POUW certificate
      const z = ethers.id("e2e-proof");
      await pouwVerifier
        .connect(orchestrator)
        .recordCertificate(
          providerOwner.address,
          deviceId,
          64,
          12,
          ethers.id("e2e-transcript"),
          z,
          Date.now()
        );

      // 6. Orchestrator rewards provider
      await rewardContract
        .connect(orchestrator)
        .rewardProvider(providerOwner.address, 0, reward);

      // 7. Provider withdraws earnings
      const balBefore = await cldToken.balanceOf(providerOwner.address);
      await rewardContract.connect(providerOwner).withdrawEarnings();
      const balAfter = await cldToken.balanceOf(providerOwner.address);
      expect(balAfter - balBefore).to.equal(reward);

      // 8. Remaining deposit refunded to user
      const remaining = deposit - reward;
      const userBalBefore = await cldToken.balanceOf(user.address);
      await rewardContract.connect(orchestrator).refundWorkload(0, user.address);
      const userBalAfter = await cldToken.balanceOf(user.address);
      expect(userBalAfter - userBalBefore).to.equal(remaining);

      // Verify final state
      expect(await rewardContract.workloadDeposits(0)).to.equal(0);
      expect(await rewardContract.providerPendingRewards(providerOwner.address)).to.equal(0);
      expect(await pouwVerifier.certificateCount()).to.equal(1);

      const workload = await workloadRegistry.getWorkload(0);
      expect(workload.placementProvider).to.equal(providerOwner.address);
    });
  });
});
