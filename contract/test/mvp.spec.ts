import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { CLDToken, ProviderRegistry, JobEscrow } from "../typechain-types";

describe("Cloudana MVP", function () {
  async function deployContracts() {
    const [deployer, validator, user, providerOwner, treasury, team, other] = await ethers.getSigners();

    // Deploy CLDToken
    const CLDTokenFactory = await ethers.getContractFactory("CLDToken");
    const cldToken = await CLDTokenFactory.deploy(treasury.address, team.address);
    await cldToken.waitForDeployment();

    // Deploy ProviderRegistry
    const ProviderRegistryFactory = await ethers.getContractFactory("ProviderRegistry");
    const providerRegistry = await ProviderRegistryFactory.deploy(
      await cldToken.getAddress(),
      team.address,
      treasury.address
    );
    await providerRegistry.waitForDeployment();

    // Deploy JobEscrow
    const JobEscrowFactory = await ethers.getContractFactory("JobEscrow");
    const jobEscrow = await JobEscrowFactory.deploy(
      await cldToken.getAddress(),
      await providerRegistry.getAddress()
    );
    await jobEscrow.waitForDeployment();

    // Grant roles
    const MINTER_ROLE = await cldToken.MINTER_ROLE();
    await cldToken.grantRole(MINTER_ROLE, deployer.address);

    const VALIDATOR_ROLE = await jobEscrow.VALIDATOR_ROLE();
    await jobEscrow.grantRole(VALIDATOR_ROLE, validator.address);

    return {
      cldToken,
      providerRegistry,
      jobEscrow,
      deployer,
      validator,
      user,
      providerOwner,
      treasury,
      team,
      other,
    };
  }

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
      const { cldToken, deployer, user } = await loadFixture(deployContracts);
      const amount = ethers.parseEther("1000");

      await cldToken.mint(user.address, amount);
      expect(await cldToken.balanceOf(user.address)).to.equal(amount);
    });

    it("Should reject minting without MINTER_ROLE", async function () {
      const { cldToken, user, other } = await loadFixture(deployContracts);
      const amount = ethers.parseEther("1000");

      await expect(
        cldToken.connect(other).mint(user.address, amount)
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
      const mintAmount = ethers.parseEther("1000");
      const burnAmount = ethers.parseEther("200");
      const insufficientAllowance = ethers.parseEther("100");

      await cldToken.mint(user.address, mintAmount);
      await cldToken.connect(user).approve(other.address, insufficientAllowance);
      await expect(
        cldToken.connect(other).burnFrom(user.address, burnAmount)
      ).to.be.revertedWithCustomError(cldToken, "InsufficientAllowance");
    });
  });

  describe("ProviderRegistry", function () {
    const STATIC_BOND = ethers.parseEther("1000");
    const providerkey = ethers.id("test-provider-key-1");
    const region = "Helsinki";
    const hardwareTier = 1; // GPU-T1
    const capacity = 5;

    it("Should register provider with static bond", async function () {
      const { cldToken, providerRegistry, providerOwner, team, treasury } = await loadFixture(
        deployContracts
      );

      // Setup: mint tokens and approve
      await cldToken.mint(providerOwner.address, STATIC_BOND);
      await cldToken.connect(providerOwner).approve(await providerRegistry.getAddress(), STATIC_BOND);

      // Register provider
      const tx = await providerRegistry
        .connect(providerOwner)
        .registerProvider(providerkey, region, hardwareTier, capacity);
      const receipt = await tx.wait();

      // Check event
      const event = receipt?.logs.find((log: any) => {
        try {
          const parsed = providerRegistry.interface.parseLog(log);
          return parsed?.name === "ProviderRegistered";
        } catch {
          return false;
        }
      });
      expect(event).to.not.be.undefined;

      // Check provider info
      const providerInfo = await providerRegistry.getProvider(providerkey);
      expect(providerInfo.owner).to.equal(providerOwner.address);
      expect(providerInfo.providerkey).to.equal(providerkey);
      expect(providerInfo.region).to.equal(region);
      expect(providerInfo.hardwareTier).to.equal(hardwareTier);
      expect(providerInfo.capacity).to.equal(capacity);
      expect(providerInfo.bondAmount).to.equal(STATIC_BOND);
      expect(providerInfo.status).to.equal(0); // Registered

      // Check fee split (80% treasury, 20% team)
      const expectedTreasury = (STATIC_BOND * 8000n) / 10000n;
      const expectedTeam = (STATIC_BOND * 2000n) / 10000n;
      expect(await cldToken.balanceOf(treasury.address)).to.be.gte(expectedTreasury);
      expect(await cldToken.balanceOf(team.address)).to.be.gte(expectedTeam);
    });

    it("Should reject registration with insufficient balance", async function () {
      const { cldToken, providerRegistry, providerOwner } = await loadFixture(deployContracts);

      const insufficientAmount = STATIC_BOND - ethers.parseEther("1");
      await cldToken.mint(providerOwner.address, insufficientAmount);
      await cldToken.connect(providerOwner).approve(await providerRegistry.getAddress(), insufficientAmount);

      await expect(
        providerRegistry
          .connect(providerOwner)
          .registerProvider(providerkey, region, hardwareTier, capacity)
      ).to.be.revertedWithCustomError(providerRegistry, "InsufficientBalance");
    });

    it("Should reject registration with insufficient allowance", async function () {
      const { cldToken, providerRegistry, providerOwner } = await loadFixture(deployContracts);

      await cldToken.mint(providerOwner.address, STATIC_BOND);
      const insufficientAllowance = STATIC_BOND - ethers.parseEther("1");
      await cldToken.connect(providerOwner).approve(await providerRegistry.getAddress(), insufficientAllowance);

      await expect(
        providerRegistry
          .connect(providerOwner)
          .registerProvider(providerkey, region, hardwareTier, capacity)
      ).to.be.revertedWithCustomError(providerRegistry, "InsufficientAllowance");
    });

    it("Should reject registration with zero providerkey", async function () {
      const { cldToken, providerRegistry, providerOwner } = await loadFixture(deployContracts);

      await cldToken.mint(providerOwner.address, STATIC_BOND);
      await cldToken.connect(providerOwner).approve(await providerRegistry.getAddress(), STATIC_BOND);

      await expect(
        providerRegistry
          .connect(providerOwner)
          .registerProvider(ethers.ZeroHash, region, hardwareTier, capacity)
      ).to.be.revertedWithCustomError(providerRegistry, "Invalidproviderkey");
    });

    it("Should reject registration with empty region", async function () {
      const { cldToken, providerRegistry, providerOwner } = await loadFixture(deployContracts);

      await cldToken.mint(providerOwner.address, STATIC_BOND);
      await cldToken.connect(providerOwner).approve(await providerRegistry.getAddress(), STATIC_BOND);

      await expect(
        providerRegistry
          .connect(providerOwner)
          .registerProvider(providerkey, "", hardwareTier, capacity)
      ).to.be.revertedWithCustomError(providerRegistry, "InvalidRegion");
    });

    it("Should reject registration with invalid hardware tier", async function () {
      const { cldToken, providerRegistry, providerOwner } = await loadFixture(deployContracts);

      await cldToken.mint(providerOwner.address, STATIC_BOND);
      await cldToken.connect(providerOwner).approve(await providerRegistry.getAddress(), STATIC_BOND);

      await expect(
        providerRegistry
          .connect(providerOwner)
          .registerProvider(providerkey, region, 3, capacity)
      ).to.be.revertedWithCustomError(providerRegistry, "InvalidHardwareTier");
    });

    it("Should reject registration with invalid capacity (0)", async function () {
      const { cldToken, providerRegistry, providerOwner } = await loadFixture(deployContracts);

      await cldToken.mint(providerOwner.address, STATIC_BOND);
      await cldToken.connect(providerOwner).approve(await providerRegistry.getAddress(), STATIC_BOND);

      await expect(
        providerRegistry
          .connect(providerOwner)
          .registerProvider(providerkey, region, hardwareTier, 0)
      ).to.be.revertedWithCustomError(providerRegistry, "InvalidCapacity");
    });

    it("Should reject registration with invalid capacity (>10)", async function () {
      const { cldToken, providerRegistry, providerOwner } = await loadFixture(deployContracts);

      await cldToken.mint(providerOwner.address, STATIC_BOND);
      await cldToken.connect(providerOwner).approve(await providerRegistry.getAddress(), STATIC_BOND);

      await expect(
        providerRegistry
          .connect(providerOwner)
          .registerProvider(providerkey, region, hardwareTier, 11)
      ).to.be.revertedWithCustomError(providerRegistry, "InvalidCapacity");
    });

    it("Should reject duplicate provider registration", async function () {
      const { cldToken, providerRegistry, providerOwner } = await loadFixture(deployContracts);

      await cldToken.mint(providerOwner.address, STATIC_BOND * 2n);
      await cldToken.connect(providerOwner).approve(await providerRegistry.getAddress(), STATIC_BOND * 2n);

      await providerRegistry
        .connect(providerOwner)
        .registerProvider(providerkey, region, hardwareTier, capacity);

      await expect(
        providerRegistry
          .connect(providerOwner)
          .registerProvider(providerkey, region, hardwareTier, capacity)
      ).to.be.revertedWithCustomError(providerRegistry, "ProviderAlreadyExists");
    });

    it("Should enforce max providers per owner", async function () {
      const { cldToken, providerRegistry, providerOwner } = await loadFixture(deployContracts);

      const MAX_PROVIDERS = await providerRegistry.MAX_PROVIDERS_PER_OWNER();
      const totalBond = STATIC_BOND * (BigInt(MAX_PROVIDERS) + 1n);

      await cldToken.mint(providerOwner.address, totalBond);
      await cldToken.connect(providerOwner).approve(await providerRegistry.getAddress(), totalBond);

      // Register max providers
      for (let i = 0; i < Number(MAX_PROVIDERS); i++) {
        const key = ethers.id(`provider-${i}`);
        await providerRegistry
          .connect(providerOwner)
          .registerProvider(key, region, hardwareTier, capacity);
      }

      // Try to register one more
      const extraKey = ethers.id("extra-provider");
      await expect(
        providerRegistry
          .connect(providerOwner)
          .registerProvider(extraKey, region, hardwareTier, capacity)
      ).to.be.revertedWithCustomError(providerRegistry, "MaxProvidersReached");
    });

    it("Should update provider status to Active", async function () {
      const { cldToken, providerRegistry, providerOwner } = await loadFixture(deployContracts);

      await cldToken.mint(providerOwner.address, STATIC_BOND);
      await cldToken.connect(providerOwner).approve(await providerRegistry.getAddress(), STATIC_BOND);

      await providerRegistry
        .connect(providerOwner)
        .registerProvider(providerkey, region, hardwareTier, capacity);

      await providerRegistry
        .connect(providerOwner)
        .updateProviderStatus(providerkey, 1); // Active

      const providerInfo = await providerRegistry.getProvider(providerkey);
      expect(providerInfo.status).to.equal(1); // Active
    });

    it("Should update provider status to Inactive", async function () {
      const { cldToken, providerRegistry, providerOwner } = await loadFixture(deployContracts);

      await cldToken.mint(providerOwner.address, STATIC_BOND);
      await cldToken.connect(providerOwner).approve(await providerRegistry.getAddress(), STATIC_BOND);

      await providerRegistry
        .connect(providerOwner)
        .registerProvider(providerkey, region, hardwareTier, capacity);

      await providerRegistry
        .connect(providerOwner)
        .updateProviderStatus(providerkey, 2); // Inactive

      const providerInfo = await providerRegistry.getProvider(providerkey);
      expect(providerInfo.status).to.equal(2); // Inactive
    });

    it("Should reject status update from non-owner", async function () {
      const { cldToken, providerRegistry, providerOwner, other } = await loadFixture(deployContracts);

      await cldToken.mint(providerOwner.address, STATIC_BOND);
      await cldToken.connect(providerOwner).approve(await providerRegistry.getAddress(), STATIC_BOND);

      await providerRegistry
        .connect(providerOwner)
        .registerProvider(providerkey, region, hardwareTier, capacity);

      await expect(
        providerRegistry.connect(other).updateProviderStatus(providerkey, 1)
      ).to.be.revertedWithCustomError(providerRegistry, "NotProviderOwner");
    });

    it("Should allow admin to update provider status", async function () {
      const { cldToken, providerRegistry, providerOwner, deployer } = await loadFixture(deployContracts);

      await cldToken.mint(providerOwner.address, STATIC_BOND);
      await cldToken.connect(providerOwner).approve(await providerRegistry.getAddress(), STATIC_BOND);

      await providerRegistry
        .connect(providerOwner)
        .registerProvider(providerkey, region, hardwareTier, capacity);

      await providerRegistry.connect(deployer).updateProviderStatus(providerkey, 1); // Active

      const providerInfo = await providerRegistry.getProvider(providerkey);
      expect(providerInfo.status).to.equal(1);
    });

    it("Should get all providers for an owner", async function () {
      const { cldToken, providerRegistry, providerOwner } = await loadFixture(deployContracts);

      await cldToken.mint(providerOwner.address, STATIC_BOND * 3n);
      await cldToken.connect(providerOwner).approve(await providerRegistry.getAddress(), STATIC_BOND * 3n);

      const key1 = ethers.id("provider-1");
      const key2 = ethers.id("provider-2");
      const key3 = ethers.id("provider-3");

      await providerRegistry
        .connect(providerOwner)
        .registerProvider(key1, region, hardwareTier, capacity);
      await providerRegistry
        .connect(providerOwner)
        .registerProvider(key2, region, hardwareTier, capacity);
      await providerRegistry
        .connect(providerOwner)
        .registerProvider(key3, region, hardwareTier, capacity);

      const providers = await providerRegistry.getMyProviders(providerOwner.address);
      expect(providers.length).to.equal(3);
      expect(providers[0]).to.equal(key1);
      expect(providers[1]).to.equal(key2);
      expect(providers[2]).to.equal(key3);
    });

    it("Should reject getProvider for non-existent provider", async function () {
      const { providerRegistry } = await loadFixture(deployContracts);
      const nonExistentKey = ethers.id("non-existent");

      await expect(
        providerRegistry.getProvider(nonExistentKey)
      ).to.be.revertedWithCustomError(providerRegistry, "ProviderNotFound");
    });
  });

  describe("JobEscrow", function () {
    const STATIC_BOND = ethers.parseEther("1000");
    const providerkey = ethers.id("test-provider-key");
    const region = "Helsinki";
    const hardwareTier = 1;
    const capacity = 5;

    async function setupProviderAndContracts() {
      const contracts = await loadFixture(deployContracts);
      const { cldToken, providerRegistry, providerOwner } = contracts;

      await cldToken.mint(providerOwner.address, STATIC_BOND);
      await cldToken.connect(providerOwner).approve(await providerRegistry.getAddress(), STATIC_BOND);

      await providerRegistry
        .connect(providerOwner)
        .registerProvider(providerkey, region, hardwareTier, capacity);

      // Set provider to Active
      await providerRegistry
        .connect(providerOwner)
        .updateProviderStatus(providerkey, 1); // Active

      return { ...contracts, cldToken, providerRegistry, providerOwner };
    }

    it("Should create job with active provider", async function () {
      const { jobEscrow, user, cldToken } = await setupProviderAndContracts();

      const budget = ethers.parseEther("1000");
      await cldToken.mint(user.address, budget);
      await cldToken.connect(user).approve(await jobEscrow.getAddress(), budget);

      const tx = await jobEscrow.connect(user).createJob(providerkey, budget);
      const receipt = await tx.wait();

      // Check event
      const event = receipt?.logs.find((log: any) => {
        try {
          const parsed = jobEscrow.interface.parseLog(log);
          return parsed?.name === "JobCreated";
        } catch {
          return false;
        }
      });
      expect(event).to.not.be.undefined;

      // Check job state
      const job = await jobEscrow.jobs(0);
      expect(job.user).to.equal(user.address);
      expect(job.providerkey).to.equal(providerkey);
      expect(job.deposited).to.equal(budget);
      expect(job.spent).to.equal(0);
      expect(job.nonce).to.equal(0);
      expect(job.status).to.equal(0); // OPEN
    });

    it("Should create job with zero budget", async function () {
      const { jobEscrow, user } = await setupProviderAndContracts();

      const tx = await jobEscrow.connect(user).createJob(providerkey, 0);
      const receipt = await tx.wait();

      const job = await jobEscrow.jobs(0);
      expect(job.deposited).to.equal(0);
      expect(job.status).to.equal(0); // OPEN
    });

    it("Should reject job creation with non-existent provider", async function () {
      const { jobEscrow, user, providerRegistry } = await loadFixture(deployContracts);
      const nonExistentKey = ethers.id("non-existent");

      // getProvider will revert with ProviderNotFound from ProviderRegistry
      // This error bubbles up through JobEscrow.createJob
      await expect(
        jobEscrow.connect(user).createJob(nonExistentKey, ethers.parseEther("1000"))
      ).to.be.revertedWithCustomError(providerRegistry, "ProviderNotFound");
    });

    it("Should reject job creation with inactive provider", async function () {
      const { jobEscrow, user, cldToken, providerRegistry, providerOwner } = await loadFixture(
        deployContracts
      );
      const STATIC_BOND = ethers.parseEther("1000");
      const providerkey = ethers.id("test-provider-key");
      const region = "Helsinki";
      const hardwareTier = 1;
      const capacity = 5;

      // Register but don't activate
      await cldToken.mint(providerOwner.address, STATIC_BOND);
      await cldToken.connect(providerOwner).approve(await providerRegistry.getAddress(), STATIC_BOND);
      await providerRegistry
        .connect(providerOwner)
        .registerProvider(providerkey, region, hardwareTier, capacity);
      // Status remains Registered (0), not Active (1)

      await expect(
        jobEscrow.connect(user).createJob(providerkey, ethers.parseEther("1000"))
      ).to.be.revertedWithCustomError(jobEscrow, "ProviderNotActive");
    });

    it("Should deposit additional funds to job", async function () {
      const { jobEscrow, user, cldToken } = await setupProviderAndContracts();

      const initialBudget = ethers.parseEther("1000");
      const additionalDeposit = ethers.parseEther("500");

      await cldToken.mint(user.address, initialBudget + additionalDeposit);
      await cldToken
        .connect(user)
        .approve(await jobEscrow.getAddress(), initialBudget + additionalDeposit);

      await jobEscrow.connect(user).createJob(providerkey, initialBudget);
      await jobEscrow.connect(user).deposit(0, additionalDeposit);

      const job = await jobEscrow.jobs(0);
      expect(job.deposited).to.equal(initialBudget + additionalDeposit);
    });

    it("Should reject deposit from non-user", async function () {
      const { jobEscrow, user, other, cldToken } = await setupProviderAndContracts();

      const budget = ethers.parseEther("1000");
      await cldToken.mint(user.address, budget);
      await cldToken.connect(user).approve(await jobEscrow.getAddress(), budget);

      await jobEscrow.connect(user).createJob(providerkey, budget);

      await expect(
        jobEscrow.connect(other).deposit(0, ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(jobEscrow, "UnauthorizedCloser");
    });

    it("Should reject deposit to closed job", async function () {
      const { jobEscrow, user, cldToken } = await setupProviderAndContracts();

      const budget = ethers.parseEther("1000");
      await cldToken.mint(user.address, budget);
      await cldToken.connect(user).approve(await jobEscrow.getAddress(), budget);

      await jobEscrow.connect(user).createJob(providerkey, budget);
      await jobEscrow.connect(user).closeJob(0);

      await expect(
        jobEscrow.connect(user).deposit(0, ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(jobEscrow, "JobNotOpen");
    });

    it("Should submit usage report with EIP-712 signature", async function () {
      const { jobEscrow, user, validator, cldToken, providerOwner } = await setupProviderAndContracts();

      const budget = ethers.parseEther("1000");
      const grossCost = ethers.parseEther("100");
      const providerEarn = ethers.parseEther("90");

      await cldToken.mint(user.address, budget);
      await cldToken.connect(user).approve(await jobEscrow.getAddress(), budget);
      await jobEscrow.connect(user).createJob(providerkey, budget);

      // Build EIP-712 signature
      const domain = {
        name: "CloudanaJobEscrow",
        version: "1",
        chainId: await ethers.provider.getNetwork().then((n) => Number(n.chainId)),
        verifyingContract: await jobEscrow.getAddress(),
      };

      const types = {
        UsageReport: [
          { name: "jobId", type: "uint256" },
          { name: "user", type: "address" },
          { name: "providerkey", type: "bytes32" },
          { name: "grossCost", type: "uint256" },
          { name: "providerEarn", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };

      const job = await jobEscrow.jobs(0);
      const report = {
        jobId: 0,
        user: user.address,
        providerkey: providerkey,
        grossCost,
        providerEarn,
        nonce: job.nonce,
        deadline: 0,
      };

      const signature = await validator.signTypedData(domain, types, report);

      // Submit usage report
      await jobEscrow.submitUsageReport(report, signature);

      // Verify state
      const jobAfter = await jobEscrow.jobs(0);
      expect(jobAfter.spent).to.equal(grossCost);
      expect(jobAfter.nonce).to.equal(1n);

      expect(await jobEscrow.providerCredit(providerOwner.address)).to.equal(providerEarn);
      expect(await jobEscrow.userRefundCredit(user.address)).to.equal(grossCost - providerEarn);
    });

    it("Should reject usage report with invalid signature", async function () {
      const { jobEscrow, user, other } = await loadFixture(deployContracts);
      const { cldToken } = await setupProviderAndContracts();

      const budget = ethers.parseEther("1000");
      await cldToken.mint(user.address, budget);
      await cldToken.connect(user).approve(await jobEscrow.getAddress(), budget);
      await jobEscrow.connect(user).createJob(providerkey, budget);

      const domain = {
        name: "CloudanaJobEscrow",
        version: "1",
        chainId: await ethers.provider.getNetwork().then((n) => Number(n.chainId)),
        verifyingContract: await jobEscrow.getAddress(),
      };

      const types = {
        UsageReport: [
          { name: "jobId", type: "uint256" },
          { name: "user", type: "address" },
          { name: "providerkey", type: "bytes32" },
          { name: "grossCost", type: "uint256" },
          { name: "providerEarn", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };

      const job = await jobEscrow.jobs(0);
      const report = {
        jobId: 0,
        user: user.address,
        providerkey: providerkey,
        grossCost: ethers.parseEther("100"),
        providerEarn: ethers.parseEther("90"),
        nonce: job.nonce,
        deadline: 0,
      };

      const signature = await other.signTypedData(domain, types, report);

      await expect(
        jobEscrow.submitUsageReport(report, signature)
      ).to.be.revertedWithCustomError(jobEscrow, "InvalidSignature");
    });

    it("Should reject usage report with wrong nonce", async function () {
      const { jobEscrow, user, validator } = await loadFixture(deployContracts);
      const { cldToken } = await setupProviderAndContracts();

      const budget = ethers.parseEther("1000");
      await cldToken.mint(user.address, budget);
      await cldToken.connect(user).approve(await jobEscrow.getAddress(), budget);
      await jobEscrow.connect(user).createJob(providerkey, budget);

      const domain = {
        name: "CloudanaJobEscrow",
        version: "1",
        chainId: await ethers.provider.getNetwork().then((n) => Number(n.chainId)),
        verifyingContract: await jobEscrow.getAddress(),
      };

      const types = {
        UsageReport: [
          { name: "jobId", type: "uint256" },
          { name: "user", type: "address" },
          { name: "providerkey", type: "bytes32" },
          { name: "grossCost", type: "uint256" },
          { name: "providerEarn", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };

      const report = {
        jobId: 0,
        user: user.address,
        providerkey: providerkey,
        grossCost: ethers.parseEther("100"),
        providerEarn: ethers.parseEther("90"),
        nonce: 999, // Wrong nonce
        deadline: 0,
      };

      const signature = await validator.signTypedData(domain, types, report);

      await expect(
        jobEscrow.submitUsageReport(report, signature)
      ).to.be.revertedWithCustomError(jobEscrow, "InvalidNonce");
    });

    it("Should reject usage report with wrong user", async function () {
      const { jobEscrow, user, other, validator } = await loadFixture(deployContracts);
      const { cldToken } = await setupProviderAndContracts();

      const budget = ethers.parseEther("1000");
      await cldToken.mint(user.address, budget);
      await cldToken.connect(user).approve(await jobEscrow.getAddress(), budget);
      await jobEscrow.connect(user).createJob(providerkey, budget);

      const domain = {
        name: "CloudanaJobEscrow",
        version: "1",
        chainId: await ethers.provider.getNetwork().then((n) => Number(n.chainId)),
        verifyingContract: await jobEscrow.getAddress(),
      };

      const types = {
        UsageReport: [
          { name: "jobId", type: "uint256" },
          { name: "user", type: "address" },
          { name: "providerkey", type: "bytes32" },
          { name: "grossCost", type: "uint256" },
          { name: "providerEarn", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };

      const job = await jobEscrow.jobs(0);
      const report = {
        jobId: 0,
        user: other.address, // Wrong user
        providerkey: providerkey,
        grossCost: ethers.parseEther("100"),
        providerEarn: ethers.parseEther("90"),
        nonce: job.nonce,
        deadline: 0,
      };

      const signature = await validator.signTypedData(domain, types, report);

      await expect(
        jobEscrow.submitUsageReport(report, signature)
      ).to.be.revertedWithCustomError(jobEscrow, "InvalidUser");
    });

    it("Should reject usage report with wrong providerkey", async function () {
      const { jobEscrow, user, validator } = await loadFixture(deployContracts);
      const { cldToken } = await setupProviderAndContracts();

      const budget = ethers.parseEther("1000");
      await cldToken.mint(user.address, budget);
      await cldToken.connect(user).approve(await jobEscrow.getAddress(), budget);
      await jobEscrow.connect(user).createJob(providerkey, budget);

      const domain = {
        name: "CloudanaJobEscrow",
        version: "1",
        chainId: await ethers.provider.getNetwork().then((n) => Number(n.chainId)),
        verifyingContract: await jobEscrow.getAddress(),
      };

      const types = {
        UsageReport: [
          { name: "jobId", type: "uint256" },
          { name: "user", type: "address" },
          { name: "providerkey", type: "bytes32" },
          { name: "grossCost", type: "uint256" },
          { name: "providerEarn", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };

      const job = await jobEscrow.jobs(0);
      const report = {
        jobId: 0,
        user: user.address,
        providerkey: ethers.id("wrong-key"), // Wrong providerkey
        grossCost: ethers.parseEther("100"),
        providerEarn: ethers.parseEther("90"),
        nonce: job.nonce,
        deadline: 0,
      };

      const signature = await validator.signTypedData(domain, types, report);

      await expect(
        jobEscrow.submitUsageReport(report, signature)
      ).to.be.revertedWithCustomError(jobEscrow, "InvalidProvider");
    });

    it("Should reject usage report with expired deadline", async function () {
      const { jobEscrow, user, validator } = await loadFixture(deployContracts);
      const { cldToken } = await setupProviderAndContracts();

      const budget = ethers.parseEther("1000");
      await cldToken.mint(user.address, budget);
      await cldToken.connect(user).approve(await jobEscrow.getAddress(), budget);
      await jobEscrow.connect(user).createJob(providerkey, budget);

      const domain = {
        name: "CloudanaJobEscrow",
        version: "1",
        chainId: await ethers.provider.getNetwork().then((n) => Number(n.chainId)),
        verifyingContract: await jobEscrow.getAddress(),
      };

      const types = {
        UsageReport: [
          { name: "jobId", type: "uint256" },
          { name: "user", type: "address" },
          { name: "providerkey", type: "bytes32" },
          { name: "grossCost", type: "uint256" },
          { name: "providerEarn", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };

      const job = await jobEscrow.jobs(0);
      const deadline = (await time.latest()) - 1; // Expired deadline
      const report = {
        jobId: 0,
        user: user.address,
        providerkey: providerkey,
        grossCost: ethers.parseEther("100"),
        providerEarn: ethers.parseEther("90"),
        nonce: job.nonce,
        deadline: BigInt(deadline),
      };

      const signature = await validator.signTypedData(domain, types, report);

      await expect(
        jobEscrow.submitUsageReport(report, signature)
      ).to.be.revertedWithCustomError(jobEscrow, "DeadlineExceeded");
    });

    it("Should reject usage report with overspend", async function () {
      const { jobEscrow, user, validator } = await loadFixture(deployContracts);
      const { cldToken } = await setupProviderAndContracts();

      const budget = ethers.parseEther("1000");
      await cldToken.mint(user.address, budget);
      await cldToken.connect(user).approve(await jobEscrow.getAddress(), budget);
      await jobEscrow.connect(user).createJob(providerkey, budget);

      const domain = {
        name: "CloudanaJobEscrow",
        version: "1",
        chainId: await ethers.provider.getNetwork().then((n) => Number(n.chainId)),
        verifyingContract: await jobEscrow.getAddress(),
      };

      const types = {
        UsageReport: [
          { name: "jobId", type: "uint256" },
          { name: "user", type: "address" },
          { name: "providerkey", type: "bytes32" },
          { name: "grossCost", type: "uint256" },
          { name: "providerEarn", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };

      const job = await jobEscrow.jobs(0);
      const report = {
        jobId: 0,
        user: user.address,
        providerkey: providerkey,
        grossCost: budget + ethers.parseEther("1"), // Overspend
        providerEarn: budget,
        nonce: job.nonce,
        deadline: 0,
      };

      const signature = await validator.signTypedData(domain, types, report);

      await expect(
        jobEscrow.submitUsageReport(report, signature)
      ).to.be.revertedWithCustomError(jobEscrow, "InsufficientDeposit");
    });

    it("Should reject usage report with providerEarn > grossCost", async function () {
      const { jobEscrow, user, validator } = await loadFixture(deployContracts);
      const { cldToken } = await setupProviderAndContracts();

      const budget = ethers.parseEther("1000");
      await cldToken.mint(user.address, budget);
      await cldToken.connect(user).approve(await jobEscrow.getAddress(), budget);
      await jobEscrow.connect(user).createJob(providerkey, budget);

      const domain = {
        name: "CloudanaJobEscrow",
        version: "1",
        chainId: await ethers.provider.getNetwork().then((n) => Number(n.chainId)),
        verifyingContract: await jobEscrow.getAddress(),
      };

      const types = {
        UsageReport: [
          { name: "jobId", type: "uint256" },
          { name: "user", type: "address" },
          { name: "providerkey", type: "bytes32" },
          { name: "grossCost", type: "uint256" },
          { name: "providerEarn", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };

      const job = await jobEscrow.jobs(0);
      const report = {
        jobId: 0,
        user: user.address,
        providerkey: providerkey,
        grossCost: ethers.parseEther("100"),
        providerEarn: ethers.parseEther("101"), // Invalid: > grossCost
        nonce: job.nonce,
        deadline: 0,
      };

      const signature = await validator.signTypedData(domain, types, report);

      await expect(
        jobEscrow.submitUsageReport(report, signature)
      ).to.be.revertedWithCustomError(jobEscrow, "InvalidProviderEarn");
    });

    it("Should reject replay attack (nonce mismatch)", async function () {
      const { jobEscrow, user, validator } = await loadFixture(deployContracts);
      const { cldToken } = await setupProviderAndContracts();

      const budget = ethers.parseEther("1000");
      await cldToken.mint(user.address, budget);
      await cldToken.connect(user).approve(await jobEscrow.getAddress(), budget);
      await jobEscrow.connect(user).createJob(providerkey, budget);

      const domain = {
        name: "CloudanaJobEscrow",
        version: "1",
        chainId: await ethers.provider.getNetwork().then((n) => Number(n.chainId)),
        verifyingContract: await jobEscrow.getAddress(),
      };

      const types = {
        UsageReport: [
          { name: "jobId", type: "uint256" },
          { name: "user", type: "address" },
          { name: "providerkey", type: "bytes32" },
          { name: "grossCost", type: "uint256" },
          { name: "providerEarn", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };

      const job = await jobEscrow.jobs(0);
      const report = {
        jobId: 0,
        user: user.address,
        providerkey: providerkey,
        grossCost: ethers.parseEther("100"),
        providerEarn: ethers.parseEther("90"),
        nonce: job.nonce,
        deadline: 0,
      };

      const signature = await validator.signTypedData(domain, types, report);
      await jobEscrow.submitUsageReport(report, signature);

      // Try to replay with same signature
      await expect(
        jobEscrow.submitUsageReport(report, signature)
      ).to.be.revertedWithCustomError(jobEscrow, "InvalidNonce");
    });

    it("Should close job and credit remaining refund", async function () {
      const { jobEscrow, user } = await loadFixture(deployContracts);
      const { cldToken } = await setupProviderAndContracts();

      const budget = ethers.parseEther("1000");
      await cldToken.mint(user.address, budget);
      await cldToken.connect(user).approve(await jobEscrow.getAddress(), budget);
      await jobEscrow.connect(user).createJob(providerkey, budget);

      await jobEscrow.connect(user).closeJob(0);

      const job = await jobEscrow.jobs(0);
      expect(job.status).to.equal(1); // CLOSED
      expect(await jobEscrow.userRefundCredit(user.address)).to.equal(budget);
    });

    it("Should allow provider owner to close job", async function () {
      const { jobEscrow, user } = await loadFixture(deployContracts);
      const { cldToken, providerOwner } = await setupProviderAndContracts();

      const budget = ethers.parseEther("1000");
      await cldToken.mint(user.address, budget);
      await cldToken.connect(user).approve(await jobEscrow.getAddress(), budget);
      await jobEscrow.connect(user).createJob(providerkey, budget);

      await jobEscrow.connect(providerOwner).closeJob(0);

      const job = await jobEscrow.jobs(0);
      expect(job.status).to.equal(1); // CLOSED
    });

    it("Should allow admin to close job", async function () {
      const { jobEscrow, user, deployer } = await loadFixture(deployContracts);
      const { cldToken } = await setupProviderAndContracts();

      const budget = ethers.parseEther("1000");
      await cldToken.mint(user.address, budget);
      await cldToken.connect(user).approve(await jobEscrow.getAddress(), budget);
      await jobEscrow.connect(user).createJob(providerkey, budget);

      await jobEscrow.connect(deployer).closeJob(0);

      const job = await jobEscrow.jobs(0);
      expect(job.status).to.equal(1); // CLOSED
    });

    it("Should reject close job from unauthorized address", async function () {
      const { jobEscrow, user, other } = await loadFixture(deployContracts);
      const { cldToken } = await setupProviderAndContracts();

      const budget = ethers.parseEther("1000");
      await cldToken.mint(user.address, budget);
      await cldToken.connect(user).approve(await jobEscrow.getAddress(), budget);
      await jobEscrow.connect(user).createJob(providerkey, budget);

      await expect(
        jobEscrow.connect(other).closeJob(0)
      ).to.be.revertedWithCustomError(jobEscrow, "UnauthorizedCloser");
    });

    it("Should close job with partial spending", async function () {
      const { jobEscrow, user, validator } = await loadFixture(deployContracts);
      const { cldToken } = await setupProviderAndContracts();

      const budget = ethers.parseEther("1000");
      const grossCost = ethers.parseEther("300");
      const providerEarn = ethers.parseEther("270");

      await cldToken.mint(user.address, budget);
      await cldToken.connect(user).approve(await jobEscrow.getAddress(), budget);
      await jobEscrow.connect(user).createJob(providerkey, budget);

      // Submit usage report
      const domain = {
        name: "CloudanaJobEscrow",
        version: "1",
        chainId: await ethers.provider.getNetwork().then((n) => Number(n.chainId)),
        verifyingContract: await jobEscrow.getAddress(),
      };

      const types = {
        UsageReport: [
          { name: "jobId", type: "uint256" },
          { name: "user", type: "address" },
          { name: "providerkey", type: "bytes32" },
          { name: "grossCost", type: "uint256" },
          { name: "providerEarn", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };

      const job = await jobEscrow.jobs(0);
      const report = {
        jobId: 0,
        user: user.address,
        providerkey: providerkey,
        grossCost,
        providerEarn,
        nonce: job.nonce,
        deadline: 0,
      };

      const signature = await validator.signTypedData(domain, types, report);
      await jobEscrow.submitUsageReport(report, signature);

      // Close job
      await jobEscrow.connect(user).closeJob(0);

      const jobAfter = await jobEscrow.jobs(0);
      expect(jobAfter.status).to.equal(1); // CLOSED
      const remaining = budget - grossCost;
      const refundFromUsage = grossCost - providerEarn;
      const totalRefund = remaining + refundFromUsage;
      expect(await jobEscrow.userRefundCredit(user.address)).to.equal(totalRefund);
    });

    it("Should withdraw provider credits", async function () {
      const { jobEscrow, user, validator } = await loadFixture(deployContracts);
      const { cldToken, providerOwner } = await setupProviderAndContracts();

      const budget = ethers.parseEther("1000");
      const grossCost = ethers.parseEther("100");
      const providerEarn = ethers.parseEther("90");

      await cldToken.mint(user.address, budget);
      await cldToken.connect(user).approve(await jobEscrow.getAddress(), budget);
      await jobEscrow.connect(user).createJob(providerkey, budget);

      // Submit usage report
      const domain = {
        name: "CloudanaJobEscrow",
        version: "1",
        chainId: await ethers.provider.getNetwork().then((n) => Number(n.chainId)),
        verifyingContract: await jobEscrow.getAddress(),
      };

      const types = {
        UsageReport: [
          { name: "jobId", type: "uint256" },
          { name: "user", type: "address" },
          { name: "providerkey", type: "bytes32" },
          { name: "grossCost", type: "uint256" },
          { name: "providerEarn", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };

      const job = await jobEscrow.jobs(0);
      const report = {
        jobId: 0,
        user: user.address,
        providerkey: providerkey,
        grossCost,
        providerEarn,
        nonce: job.nonce,
        deadline: 0,
      };

      const signature = await validator.signTypedData(domain, types, report);
      await jobEscrow.submitUsageReport(report, signature);

      const balanceBefore = await cldToken.balanceOf(providerOwner.address);
      await jobEscrow.connect(providerOwner).withdrawProvider();
      const balanceAfter = await cldToken.balanceOf(providerOwner.address);

      expect(balanceAfter - balanceBefore).to.equal(providerEarn);
      expect(await jobEscrow.providerCredit(providerOwner.address)).to.equal(0);
    });

    it("Should reject provider withdrawal with no credit", async function () {
      const { jobEscrow, providerOwner } = await loadFixture(deployContracts);
      await setupProviderAndContracts();

      await expect(
        jobEscrow.connect(providerOwner).withdrawProvider()
      ).to.be.revertedWithCustomError(jobEscrow, "NoCreditToWithdraw");
    });

    it("Should withdraw user refund credits", async function () {
      const { jobEscrow, user, validator } = await loadFixture(deployContracts);
      const { cldToken } = await setupProviderAndContracts();

      const budget = ethers.parseEther("1000");
      const grossCost = ethers.parseEther("100");
      const providerEarn = ethers.parseEther("90");

      await cldToken.mint(user.address, budget);
      await cldToken.connect(user).approve(await jobEscrow.getAddress(), budget);
      await jobEscrow.connect(user).createJob(providerkey, budget);

      // Submit usage report
      const domain = {
        name: "CloudanaJobEscrow",
        version: "1",
        chainId: await ethers.provider.getNetwork().then((n) => Number(n.chainId)),
        verifyingContract: await jobEscrow.getAddress(),
      };

      const types = {
        UsageReport: [
          { name: "jobId", type: "uint256" },
          { name: "user", type: "address" },
          { name: "providerkey", type: "bytes32" },
          { name: "grossCost", type: "uint256" },
          { name: "providerEarn", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };

      const job = await jobEscrow.jobs(0);
      const report = {
        jobId: 0,
        user: user.address,
        providerkey: providerkey,
        grossCost,
        providerEarn,
        nonce: job.nonce,
        deadline: 0,
      };

      const signature = await validator.signTypedData(domain, types, report);
      await jobEscrow.submitUsageReport(report, signature);

      const refund = grossCost - providerEarn;
      const balanceBefore = await cldToken.balanceOf(user.address);
      await jobEscrow.connect(user).withdrawUserRefund();
      const balanceAfter = await cldToken.balanceOf(user.address);

      expect(balanceAfter - balanceBefore).to.equal(refund);
      expect(await jobEscrow.userRefundCredit(user.address)).to.equal(0);
    });

    it("Should reject user refund withdrawal with no credit", async function () {
      const { jobEscrow, user } = await loadFixture(deployContracts);
      await setupProviderAndContracts();

      await expect(
        jobEscrow.connect(user).withdrawUserRefund()
      ).to.be.revertedWithCustomError(jobEscrow, "NoCreditToWithdraw");
    });

    it("Should handle multiple usage reports", async function () {
      const { jobEscrow, user, validator, cldToken, providerOwner } = await setupProviderAndContracts();

      const budget = ethers.parseEther("1000");
      await cldToken.mint(user.address, budget);
      await cldToken.connect(user).approve(await jobEscrow.getAddress(), budget);
      await jobEscrow.connect(user).createJob(providerkey, budget);

      const domain = {
        name: "CloudanaJobEscrow",
        version: "1",
        chainId: await ethers.provider.getNetwork().then((n) => Number(n.chainId)),
        verifyingContract: await jobEscrow.getAddress(),
      };

      const types = {
        UsageReport: [
          { name: "jobId", type: "uint256" },
          { name: "user", type: "address" },
          { name: "providerkey", type: "bytes32" },
          { name: "grossCost", type: "uint256" },
          { name: "providerEarn", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };

      // Submit first report
      let job = await jobEscrow.jobs(0);
      let report = {
        jobId: 0,
        user: user.address,
        providerkey: providerkey,
        grossCost: ethers.parseEther("100"),
        providerEarn: ethers.parseEther("90"),
        nonce: job.nonce,
        deadline: 0,
      };
      let signature = await validator.signTypedData(domain, types, report);
      await jobEscrow.submitUsageReport(report, signature);

      // Submit second report
      job = await jobEscrow.jobs(0);
      report = {
        jobId: 0,
        user: user.address,
        providerkey: providerkey,
        grossCost: ethers.parseEther("200"),
        providerEarn: ethers.parseEther("180"),
        nonce: job.nonce,
        deadline: 0,
      };
      signature = await validator.signTypedData(domain, types, report);
      await jobEscrow.submitUsageReport(report, signature);

      // Verify final state
      const jobAfter = await jobEscrow.jobs(0);
      expect(jobAfter.spent).to.equal(ethers.parseEther("300"));
      expect(jobAfter.nonce).to.equal(2n);

      expect(await jobEscrow.providerCredit(providerOwner.address)).to.equal(ethers.parseEther("270"));
      expect(await jobEscrow.userRefundCredit(user.address)).to.equal(ethers.parseEther("30"));
    });
  });
});
