import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { CLDToken, ProviderRegistry, JobEscrow } from "../typechain-types";

describe("Cloudana MVP", function () {
  async function deployContracts() {
    const [deployer, validator, user, provider, other] = await ethers.getSigners();

    const CLDTokenFactory = await ethers.getContractFactory("CLDToken");
    const cldToken = await CLDTokenFactory.deploy();
    await cldToken.waitForDeployment();

    const ProviderRegistryFactory = await ethers.getContractFactory("ProviderRegistry");
    const providerRegistry = await ProviderRegistryFactory.deploy(await cldToken.getAddress());
    await providerRegistry.waitForDeployment();

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
      provider,
      other,
    };
  }

  describe("CLDToken", function () {
    it("Should mint tokens", async function () {
      const { cldToken, deployer, user } = await loadFixture(deployContracts);
      const amount = ethers.parseEther("1000");

      await cldToken.mint(user.address, amount);
      expect(await cldToken.balanceOf(user.address)).to.equal(amount);
    });

    it("Should burn tokens", async function () {
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
  });

  describe("ProviderRegistry", function () {
    it("Should register provider", async function () {
      const { providerRegistry, provider } = await loadFixture(deployContracts);
      const metaHash = ethers.id("test-metadata");

      await providerRegistry.connect(provider).registerProvider(metaHash);
      const providerInfo = await providerRegistry.getProvider(provider.address);
      expect(providerInfo.owner).to.equal(provider.address);
      expect(providerInfo.active).to.be.true;
      expect(providerInfo.metaHash).to.equal(metaHash);
    });

    it("Should register provider with burn", async function () {
      const { cldToken, providerRegistry, provider, deployer } = await loadFixture(deployContracts);
      const metaHash = ethers.id("test-metadata");
      const burnAmount = ethers.parseEther("100");

      await cldToken.mint(provider.address, burnAmount);
      await cldToken.connect(provider).approve(await providerRegistry.getAddress(), burnAmount);
      await providerRegistry.connect(provider).registerProviderWithBurn(metaHash, burnAmount);

      expect(await cldToken.balanceOf(provider.address)).to.equal(0);
      const providerInfo = await providerRegistry.getProvider(provider.address);
      expect(providerInfo.active).to.be.true;
    });

    it("Should set provider active status", async function () {
      const { providerRegistry, provider } = await loadFixture(deployContracts);
      const metaHash = ethers.id("test-metadata");

      await providerRegistry.connect(provider).registerProvider(metaHash);
      await providerRegistry.connect(provider).setProviderActive(false);
      const providerInfo = await providerRegistry.getProvider(provider.address);
      expect(providerInfo.active).to.be.false;
    });

    it("Should update meta hash", async function () {
      const { providerRegistry, provider } = await loadFixture(deployContracts);
      const metaHash1 = ethers.id("metadata-1");
      const metaHash2 = ethers.id("metadata-2");

      await providerRegistry.connect(provider).registerProvider(metaHash1);
      await providerRegistry.connect(provider).updateMetaHash(metaHash2);
      const providerInfo = await providerRegistry.getProvider(provider.address);
      expect(providerInfo.metaHash).to.equal(metaHash2);
    });
  });

  describe("JobEscrow", function () {
    it("Should create job", async function () {
      const { cldToken, providerRegistry, jobEscrow, user, provider } = await loadFixture(
        deployContracts
      );
      const budget = ethers.parseEther("1000");

      // Setup
      await providerRegistry.connect(provider).registerProvider(ethers.id("meta"));
      await cldToken.mint(user.address, budget);
      await cldToken.connect(user).approve(await jobEscrow.getAddress(), budget);

      // Create job
      const tx = await jobEscrow.connect(user).createJob(provider.address, budget);
      const receipt = await tx.wait();
      const jobCreatedEvent = receipt?.logs.find(
        (log: any) => log.fragment?.name === "JobCreated"
      );

      expect(jobCreatedEvent).to.not.be.undefined;
      const job = await jobEscrow.jobs(0);
      expect(job.user).to.equal(user.address);
      expect(job.provider).to.equal(provider.address);
      expect(job.deposited).to.equal(budget);
      expect(job.status).to.equal(0); // OPEN
    });

    it("Should deposit additional funds", async function () {
      const { cldToken, providerRegistry, jobEscrow, user, provider } = await loadFixture(
        deployContracts
      );
      const initialBudget = ethers.parseEther("1000");
      const additionalDeposit = ethers.parseEther("500");

      await providerRegistry.connect(provider).registerProvider(ethers.id("meta"));
      await cldToken.mint(user.address, initialBudget + additionalDeposit);
      await cldToken.connect(user).approve(await jobEscrow.getAddress(), initialBudget + additionalDeposit);

      await jobEscrow.connect(user).createJob(provider.address, initialBudget);
      await jobEscrow.connect(user).deposit(0, additionalDeposit);

      const job = await jobEscrow.jobs(0);
      expect(job.deposited).to.equal(initialBudget + additionalDeposit);
    });

    it("Should submit usage report with EIP-712 signature", async function () {
      const { cldToken, providerRegistry, jobEscrow, user, provider, validator } = await loadFixture(
        deployContracts
      );
      const budget = ethers.parseEther("1000");
      const grossCost = ethers.parseEther("100");
      const providerEarn = ethers.parseEther("90");

      // Setup
      await providerRegistry.connect(provider).registerProvider(ethers.id("meta"));
      await cldToken.mint(user.address, budget);
      await cldToken.connect(user).approve(await jobEscrow.getAddress(), budget);
      await jobEscrow.connect(user).createJob(provider.address, budget);

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
          { name: "provider", type: "address" },
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
        provider: provider.address,
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
      expect(await jobEscrow.providerCredit(provider.address)).to.equal(providerEarn);
      expect(await jobEscrow.userRefundCredit(user.address)).to.equal(grossCost - providerEarn);
    });

    it("Should reject replay attack (nonce mismatch)", async function () {
      const { cldToken, providerRegistry, jobEscrow, user, provider, validator } = await loadFixture(
        deployContracts
      );
      const budget = ethers.parseEther("1000");
      const grossCost = ethers.parseEther("100");
      const providerEarn = ethers.parseEther("90");

      await providerRegistry.connect(provider).registerProvider(ethers.id("meta"));
      await cldToken.mint(user.address, budget);
      await cldToken.connect(user).approve(await jobEscrow.getAddress(), budget);
      await jobEscrow.connect(user).createJob(provider.address, budget);

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
          { name: "provider", type: "address" },
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
        provider: provider.address,
        grossCost,
        providerEarn,
        nonce: job.nonce,
        deadline: 0,
      };

      const signature = await validator.signTypedData(domain, types, report);
      await jobEscrow.submitUsageReport(report, signature);

      // Try to replay with same signature
      await expect(jobEscrow.submitUsageReport(report, signature)).to.be.revertedWithCustomError(
        jobEscrow,
        "InvalidNonce"
      );
    });

    it("Should reject overspend", async function () {
      const { cldToken, providerRegistry, jobEscrow, user, provider, validator } = await loadFixture(
        deployContracts
      );
      const budget = ethers.parseEther("1000");
      const overspend = ethers.parseEther("1500");

      await providerRegistry.connect(provider).registerProvider(ethers.id("meta"));
      await cldToken.mint(user.address, budget);
      await cldToken.connect(user).approve(await jobEscrow.getAddress(), budget);
      await jobEscrow.connect(user).createJob(provider.address, budget);

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
          { name: "provider", type: "address" },
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
        provider: provider.address,
        grossCost: overspend,
        providerEarn: overspend,
        nonce: job.nonce,
        deadline: 0,
      };

      const signature = await validator.signTypedData(domain, types, report);
      await expect(jobEscrow.submitUsageReport(report, signature)).to.be.revertedWithCustomError(
        jobEscrow,
        "InsufficientDeposit"
      );
    });

    it("Should close job and credit remaining refund", async function () {
      const { cldToken, providerRegistry, jobEscrow, user, provider } = await loadFixture(
        deployContracts
      );
      const budget = ethers.parseEther("1000");

      await providerRegistry.connect(provider).registerProvider(ethers.id("meta"));
      await cldToken.mint(user.address, budget);
      await cldToken.connect(user).approve(await jobEscrow.getAddress(), budget);
      await jobEscrow.connect(user).createJob(provider.address, budget);

      await jobEscrow.connect(user).closeJob(0);

      const job = await jobEscrow.jobs(0);
      expect(job.status).to.equal(1); // CLOSED
      expect(await jobEscrow.userRefundCredit(user.address)).to.equal(budget);
    });

    it("Should withdraw provider credits", async function () {
      const { cldToken, providerRegistry, jobEscrow, user, provider, validator } = await loadFixture(
        deployContracts
      );
      const budget = ethers.parseEther("1000");
      const grossCost = ethers.parseEther("100");
      const providerEarn = ethers.parseEther("90");

      await providerRegistry.connect(provider).registerProvider(ethers.id("meta"));
      await cldToken.mint(user.address, budget);
      await cldToken.connect(user).approve(await jobEscrow.getAddress(), budget);
      await jobEscrow.connect(user).createJob(provider.address, budget);

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
          { name: "provider", type: "address" },
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
        provider: provider.address,
        grossCost,
        providerEarn,
        nonce: job.nonce,
        deadline: 0,
      };

      const signature = await validator.signTypedData(domain, types, report);
      await jobEscrow.submitUsageReport(report, signature);

      const balanceBefore = await cldToken.balanceOf(provider.address);
      await jobEscrow.connect(provider).withdrawProvider();
      const balanceAfter = await cldToken.balanceOf(provider.address);

      expect(balanceAfter - balanceBefore).to.equal(providerEarn);
      expect(await jobEscrow.providerCredit(provider.address)).to.equal(0);
    });

    it("Should withdraw user refund credits", async function () {
      const { cldToken, providerRegistry, jobEscrow, user, provider, validator } = await loadFixture(
        deployContracts
      );
      const budget = ethers.parseEther("1000");
      const grossCost = ethers.parseEther("100");
      const providerEarn = ethers.parseEther("90");

      await providerRegistry.connect(provider).registerProvider(ethers.id("meta"));
      await cldToken.mint(user.address, budget);
      await cldToken.connect(user).approve(await jobEscrow.getAddress(), budget);
      await jobEscrow.connect(user).createJob(provider.address, budget);

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
          { name: "provider", type: "address" },
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
        provider: provider.address,
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
  });
});

