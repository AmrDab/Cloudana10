import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { CLDToken, RewardContract } from "../typechain-types";

describe("RewardContract", function () {
  async function deployRewardContract() {
    const [deployer, orchestrator, workloadOwner, provider1, provider2, treasury, team, other] =
      await ethers.getSigners();

    // Deploy CLDToken
    const CLDTokenFactory = await ethers.getContractFactory("CLDToken");
    const cldToken = await CLDTokenFactory.deploy(treasury.address, team.address);
    await cldToken.waitForDeployment();

    // Deploy RewardContract with CLD token as settlement token
    const RewardFactory = await ethers.getContractFactory("RewardContract");
    const rewardContract = await RewardFactory.deploy(
      await cldToken.getAddress()
    );
    await rewardContract.waitForDeployment();

    // Grant ORCHESTRATOR_ROLE to orchestrator signer
    const ORCHESTRATOR_ROLE = await rewardContract.ORCHESTRATOR_ROLE();
    await rewardContract.grantRole(ORCHESTRATOR_ROLE, orchestrator.address);

    // Grant MINTER_ROLE to deployer so we can mint tokens for tests
    const MINTER_ROLE = await cldToken.MINTER_ROLE();
    await cldToken.grantRole(MINTER_ROLE, deployer.address);

    return {
      cldToken,
      rewardContract,
      deployer,
      orchestrator,
      workloadOwner,
      provider1,
      provider2,
      treasury,
      team,
      other,
      ORCHESTRATOR_ROLE,
    };
  }

  describe("Fund workload", function () {
    it("Should fund a workload with CLD tokens", async function () {
      const { cldToken, rewardContract, workloadOwner } =
        await loadFixture(deployRewardContract);

      const workloadId = 1;
      const amount = ethers.parseEther("500");

      // Mint tokens to workload owner and approve
      await cldToken.mint(workloadOwner.address, amount);
      await cldToken
        .connect(workloadOwner)
        .approve(await rewardContract.getAddress(), amount);

      await rewardContract.connect(workloadOwner).fundWorkload(workloadId, amount);

      const deposit = await rewardContract.workloadDeposits(workloadId);
      expect(deposit).to.equal(amount);
    });

    it("Should emit WorkloadFunded event", async function () {
      const { cldToken, rewardContract, workloadOwner } = await loadFixture(
        deployRewardContract
      );

      const workloadId = 1;
      const amount = ethers.parseEther("500");

      await cldToken.mint(workloadOwner.address, amount);
      await cldToken
        .connect(workloadOwner)
        .approve(await rewardContract.getAddress(), amount);

      await expect(
        rewardContract.connect(workloadOwner).fundWorkload(workloadId, amount)
      )
        .to.emit(rewardContract, "WorkloadFunded")
        .withArgs(workloadId, workloadOwner.address, amount, (ts: bigint) => ts > 0n);
    });

    it("Should allow multiple fundings to the same workload", async function () {
      const { cldToken, rewardContract, workloadOwner } = await loadFixture(
        deployRewardContract
      );

      const workloadId = 1;
      const amount1 = ethers.parseEther("200");
      const amount2 = ethers.parseEther("300");
      const total = amount1 + amount2;

      await cldToken.mint(workloadOwner.address, total);
      await cldToken
        .connect(workloadOwner)
        .approve(await rewardContract.getAddress(), total);

      await rewardContract.connect(workloadOwner).fundWorkload(workloadId, amount1);
      await rewardContract.connect(workloadOwner).fundWorkload(workloadId, amount2);

      const deposit = await rewardContract.workloadDeposits(workloadId);
      expect(deposit).to.equal(total);
    });

    it("Should reject funding with zero amount", async function () {
      const { rewardContract, workloadOwner } = await loadFixture(
        deployRewardContract
      );

      await expect(
        rewardContract.connect(workloadOwner).fundWorkload(1, 0)
      ).to.be.revertedWith("Amount must be > 0");
    });

    it("Should reject funding with insufficient token balance", async function () {
      const { cldToken, rewardContract, workloadOwner } = await loadFixture(
        deployRewardContract
      );

      const amount = ethers.parseEther("500");

      // Approve without having tokens
      await cldToken
        .connect(workloadOwner)
        .approve(await rewardContract.getAddress(), amount);

      await expect(
        rewardContract.connect(workloadOwner).fundWorkload(1, amount)
      ).to.be.reverted;
    });
  });

  describe("Reward provider", function () {
    it("Should reward a provider (requires ORCHESTRATOR_ROLE)", async function () {
      const { cldToken, rewardContract, orchestrator, workloadOwner, provider1 } =
        await loadFixture(deployRewardContract);

      const workloadId = 1;
      const fundAmount = ethers.parseEther("1000");
      const rewardAmount = ethers.parseEther("200");

      // Fund the workload
      await cldToken.mint(workloadOwner.address, fundAmount);
      await cldToken
        .connect(workloadOwner)
        .approve(await rewardContract.getAddress(), fundAmount);
      await rewardContract
        .connect(workloadOwner)
        .fundWorkload(workloadId, fundAmount);

      // Reward the provider
      await rewardContract
        .connect(orchestrator)
        .rewardProvider(provider1.address, workloadId, rewardAmount);

      // Check pending rewards
      const pending = await rewardContract.providerPendingRewards(
        provider1.address
      );
      expect(pending).to.equal(rewardAmount);

      // Check workload deposit was reduced
      const remainingDeposit = await rewardContract.workloadDeposits(workloadId);
      expect(remainingDeposit).to.equal(fundAmount - rewardAmount);
    });

    it("Should emit ProviderRewarded event", async function () {
      const { cldToken, rewardContract, orchestrator, workloadOwner, provider1 } =
        await loadFixture(deployRewardContract);

      const workloadId = 1;
      const fundAmount = ethers.parseEther("1000");
      const rewardAmount = ethers.parseEther("200");

      await cldToken.mint(workloadOwner.address, fundAmount);
      await cldToken
        .connect(workloadOwner)
        .approve(await rewardContract.getAddress(), fundAmount);
      await rewardContract
        .connect(workloadOwner)
        .fundWorkload(workloadId, fundAmount);

      await expect(
        rewardContract
          .connect(orchestrator)
          .rewardProvider(provider1.address, workloadId, rewardAmount)
      )
        .to.emit(rewardContract, "ProviderRewarded")
        .withArgs(
          provider1.address,
          rewardAmount,
          workloadId,
          (ts: bigint) => ts > 0n
        );
    });

    it("Should reject unauthorized reward calls", async function () {
      const { cldToken, rewardContract, workloadOwner, provider1, other } =
        await loadFixture(deployRewardContract);

      const workloadId = 1;
      const fundAmount = ethers.parseEther("1000");

      await cldToken.mint(workloadOwner.address, fundAmount);
      await cldToken
        .connect(workloadOwner)
        .approve(await rewardContract.getAddress(), fundAmount);
      await rewardContract
        .connect(workloadOwner)
        .fundWorkload(workloadId, fundAmount);

      await expect(
        rewardContract
          .connect(other)
          .rewardProvider(provider1.address, workloadId, ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(
        rewardContract,
        "AccessControlUnauthorizedAccount"
      );
    });

    it("Should handle insufficient funds gracefully", async function () {
      const { cldToken, rewardContract, orchestrator, workloadOwner, provider1 } =
        await loadFixture(deployRewardContract);

      const workloadId = 1;
      const fundAmount = ethers.parseEther("100");
      const rewardAmount = ethers.parseEther("200"); // More than deposited

      await cldToken.mint(workloadOwner.address, fundAmount);
      await cldToken
        .connect(workloadOwner)
        .approve(await rewardContract.getAddress(), fundAmount);
      await rewardContract
        .connect(workloadOwner)
        .fundWorkload(workloadId, fundAmount);

      await expect(
        rewardContract
          .connect(orchestrator)
          .rewardProvider(provider1.address, workloadId, rewardAmount)
      ).to.be.revertedWith("Insufficient workload deposit");
    });

    it("Should reject reward with zero amount", async function () {
      const { cldToken, rewardContract, orchestrator, workloadOwner, provider1 } =
        await loadFixture(deployRewardContract);

      const workloadId = 1;
      const fundAmount = ethers.parseEther("1000");

      await cldToken.mint(workloadOwner.address, fundAmount);
      await cldToken
        .connect(workloadOwner)
        .approve(await rewardContract.getAddress(), fundAmount);
      await rewardContract
        .connect(workloadOwner)
        .fundWorkload(workloadId, fundAmount);

      await expect(
        rewardContract
          .connect(orchestrator)
          .rewardProvider(provider1.address, workloadId, 0)
      ).to.be.revertedWith("Amount must be > 0");
    });

    it("Should reject reward to zero address", async function () {
      const { cldToken, rewardContract, orchestrator, workloadOwner } =
        await loadFixture(deployRewardContract);

      const workloadId = 1;
      const fundAmount = ethers.parseEther("1000");

      await cldToken.mint(workloadOwner.address, fundAmount);
      await cldToken
        .connect(workloadOwner)
        .approve(await rewardContract.getAddress(), fundAmount);
      await rewardContract
        .connect(workloadOwner)
        .fundWorkload(workloadId, fundAmount);

      await expect(
        rewardContract
          .connect(orchestrator)
          .rewardProvider(ethers.ZeroAddress, workloadId, ethers.parseEther("100"))
      ).to.be.revertedWith("Invalid provider");
    });

    it("Should track per-provider-per-workload payments", async function () {
      const { cldToken, rewardContract, orchestrator, workloadOwner, provider1 } =
        await loadFixture(deployRewardContract);

      const workloadId = 1;
      const fundAmount = ethers.parseEther("1000");
      const reward1 = ethers.parseEther("100");
      const reward2 = ethers.parseEther("150");

      await cldToken.mint(workloadOwner.address, fundAmount);
      await cldToken
        .connect(workloadOwner)
        .approve(await rewardContract.getAddress(), fundAmount);
      await rewardContract
        .connect(workloadOwner)
        .fundWorkload(workloadId, fundAmount);

      await rewardContract
        .connect(orchestrator)
        .rewardProvider(provider1.address, workloadId, reward1);
      await rewardContract
        .connect(orchestrator)
        .rewardProvider(provider1.address, workloadId, reward2);

      const totalPayment = await rewardContract.providerWorkloadPayments(
        provider1.address,
        workloadId
      );
      expect(totalPayment).to.equal(reward1 + reward2);
    });
  });

  describe("Withdraw earnings", function () {
    it("Should allow provider to withdraw earnings", async function () {
      const { cldToken, rewardContract, orchestrator, workloadOwner, provider1 } =
        await loadFixture(deployRewardContract);

      const workloadId = 1;
      const fundAmount = ethers.parseEther("1000");
      const rewardAmount = ethers.parseEther("300");

      // Fund workload
      await cldToken.mint(workloadOwner.address, fundAmount);
      await cldToken
        .connect(workloadOwner)
        .approve(await rewardContract.getAddress(), fundAmount);
      await rewardContract
        .connect(workloadOwner)
        .fundWorkload(workloadId, fundAmount);

      // Reward provider
      await rewardContract
        .connect(orchestrator)
        .rewardProvider(provider1.address, workloadId, rewardAmount);

      // Provider withdraws
      const balanceBefore = await cldToken.balanceOf(provider1.address);
      await rewardContract.connect(provider1).withdrawEarnings();
      const balanceAfter = await cldToken.balanceOf(provider1.address);

      expect(balanceAfter - balanceBefore).to.equal(rewardAmount);

      // Pending rewards should be zero after withdrawal
      const pending = await rewardContract.providerPendingRewards(
        provider1.address
      );
      expect(pending).to.equal(0);
    });

    it("Should emit EarningsWithdrawn event", async function () {
      const { cldToken, rewardContract, orchestrator, workloadOwner, provider1 } =
        await loadFixture(deployRewardContract);

      const workloadId = 1;
      const fundAmount = ethers.parseEther("1000");
      const rewardAmount = ethers.parseEther("300");

      await cldToken.mint(workloadOwner.address, fundAmount);
      await cldToken
        .connect(workloadOwner)
        .approve(await rewardContract.getAddress(), fundAmount);
      await rewardContract
        .connect(workloadOwner)
        .fundWorkload(workloadId, fundAmount);
      await rewardContract
        .connect(orchestrator)
        .rewardProvider(provider1.address, workloadId, rewardAmount);

      await expect(rewardContract.connect(provider1).withdrawEarnings())
        .to.emit(rewardContract, "EarningsWithdrawn")
        .withArgs(provider1.address, rewardAmount, (ts: bigint) => ts > 0n);
    });

    it("Should reject withdrawal with no pending rewards", async function () {
      const { rewardContract, provider1 } = await loadFixture(
        deployRewardContract
      );

      await expect(
        rewardContract.connect(provider1).withdrawEarnings()
      ).to.be.revertedWith("No pending rewards");
    });

    it("Should allow multiple rewards then single withdrawal", async function () {
      const { cldToken, rewardContract, orchestrator, workloadOwner, provider1 } =
        await loadFixture(deployRewardContract);

      const fundAmount = ethers.parseEther("2000");
      const reward1 = ethers.parseEther("100");
      const reward2 = ethers.parseEther("250");
      const reward3 = ethers.parseEther("175");
      const totalReward = reward1 + reward2 + reward3;

      await cldToken.mint(workloadOwner.address, fundAmount);
      await cldToken
        .connect(workloadOwner)
        .approve(await rewardContract.getAddress(), fundAmount);
      await rewardContract
        .connect(workloadOwner)
        .fundWorkload(1, fundAmount);

      await rewardContract
        .connect(orchestrator)
        .rewardProvider(provider1.address, 1, reward1);
      await rewardContract
        .connect(orchestrator)
        .rewardProvider(provider1.address, 1, reward2);
      await rewardContract
        .connect(orchestrator)
        .rewardProvider(provider1.address, 1, reward3);

      const balanceBefore = await cldToken.balanceOf(provider1.address);
      await rewardContract.connect(provider1).withdrawEarnings();
      const balanceAfter = await cldToken.balanceOf(provider1.address);

      expect(balanceAfter - balanceBefore).to.equal(totalReward);
    });

    it("Should reset pending rewards to zero after withdrawal", async function () {
      const { cldToken, rewardContract, orchestrator, workloadOwner, provider1 } =
        await loadFixture(deployRewardContract);

      const fundAmount = ethers.parseEther("1000");
      const rewardAmount = ethers.parseEther("300");

      await cldToken.mint(workloadOwner.address, fundAmount);
      await cldToken
        .connect(workloadOwner)
        .approve(await rewardContract.getAddress(), fundAmount);
      await rewardContract
        .connect(workloadOwner)
        .fundWorkload(1, fundAmount);
      await rewardContract
        .connect(orchestrator)
        .rewardProvider(provider1.address, 1, rewardAmount);

      await rewardContract.connect(provider1).withdrawEarnings();

      // Second withdrawal should fail
      await expect(
        rewardContract.connect(provider1).withdrawEarnings()
      ).to.be.revertedWith("No pending rewards");
    });
  });

  describe("Refund workload", function () {
    it("Should refund workload owner", async function () {
      const { cldToken, rewardContract, orchestrator, workloadOwner } =
        await loadFixture(deployRewardContract);

      const workloadId = 1;
      const fundAmount = ethers.parseEther("1000");

      await cldToken.mint(workloadOwner.address, fundAmount);
      await cldToken
        .connect(workloadOwner)
        .approve(await rewardContract.getAddress(), fundAmount);
      await rewardContract
        .connect(workloadOwner)
        .fundWorkload(workloadId, fundAmount);

      // Verify tokens left the owner
      const balanceAfterFund = await cldToken.balanceOf(workloadOwner.address);
      expect(balanceAfterFund).to.equal(0);

      // Orchestrator triggers refund
      await rewardContract
        .connect(orchestrator)
        .refundWorkload(workloadId, workloadOwner.address);

      // Owner should have tokens back
      const balanceAfterRefund = await cldToken.balanceOf(workloadOwner.address);
      expect(balanceAfterRefund).to.equal(fundAmount);

      // Workload deposit should be zero
      const deposit = await rewardContract.workloadDeposits(workloadId);
      expect(deposit).to.equal(0);
    });

    it("Should emit WorkloadRefunded event", async function () {
      const { cldToken, rewardContract, orchestrator, workloadOwner } =
        await loadFixture(deployRewardContract);

      const workloadId = 1;
      const fundAmount = ethers.parseEther("1000");

      await cldToken.mint(workloadOwner.address, fundAmount);
      await cldToken
        .connect(workloadOwner)
        .approve(await rewardContract.getAddress(), fundAmount);
      await rewardContract
        .connect(workloadOwner)
        .fundWorkload(workloadId, fundAmount);

      await expect(
        rewardContract
          .connect(orchestrator)
          .refundWorkload(workloadId, workloadOwner.address)
      )
        .to.emit(rewardContract, "WorkloadRefunded")
        .withArgs(
          workloadId,
          workloadOwner.address,
          fundAmount,
          (ts: bigint) => ts > 0n
        );
    });

    it("Should refund only remaining deposit after partial rewards", async function () {
      const { cldToken, rewardContract, orchestrator, workloadOwner, provider1 } =
        await loadFixture(deployRewardContract);

      const workloadId = 1;
      const fundAmount = ethers.parseEther("1000");
      const rewardAmount = ethers.parseEther("300");
      const expectedRefund = fundAmount - rewardAmount;

      await cldToken.mint(workloadOwner.address, fundAmount);
      await cldToken
        .connect(workloadOwner)
        .approve(await rewardContract.getAddress(), fundAmount);
      await rewardContract
        .connect(workloadOwner)
        .fundWorkload(workloadId, fundAmount);

      // Partial reward
      await rewardContract
        .connect(orchestrator)
        .rewardProvider(provider1.address, workloadId, rewardAmount);

      // Refund remaining
      await rewardContract
        .connect(orchestrator)
        .refundWorkload(workloadId, workloadOwner.address);

      const ownerBalance = await cldToken.balanceOf(workloadOwner.address);
      expect(ownerBalance).to.equal(expectedRefund);
    });

    it("Should reject refund with no remaining deposit", async function () {
      const { cldToken, rewardContract, orchestrator, workloadOwner, provider1 } =
        await loadFixture(deployRewardContract);

      const workloadId = 1;
      const fundAmount = ethers.parseEther("1000");

      await cldToken.mint(workloadOwner.address, fundAmount);
      await cldToken
        .connect(workloadOwner)
        .approve(await rewardContract.getAddress(), fundAmount);
      await rewardContract
        .connect(workloadOwner)
        .fundWorkload(workloadId, fundAmount);

      // Reward the full amount
      await rewardContract
        .connect(orchestrator)
        .rewardProvider(provider1.address, workloadId, fundAmount);

      // Try to refund -- no deposit left
      await expect(
        rewardContract
          .connect(orchestrator)
          .refundWorkload(workloadId, workloadOwner.address)
      ).to.be.revertedWith("No refund available");
    });

    it("Should reject unauthorized refund calls", async function () {
      const { cldToken, rewardContract, workloadOwner, other } =
        await loadFixture(deployRewardContract);

      const workloadId = 1;
      const fundAmount = ethers.parseEther("1000");

      await cldToken.mint(workloadOwner.address, fundAmount);
      await cldToken
        .connect(workloadOwner)
        .approve(await rewardContract.getAddress(), fundAmount);
      await rewardContract
        .connect(workloadOwner)
        .fundWorkload(workloadId, fundAmount);

      await expect(
        rewardContract
          .connect(other)
          .refundWorkload(workloadId, workloadOwner.address)
      ).to.be.revertedWithCustomError(
        rewardContract,
        "AccessControlUnauthorizedAccount"
      );
    });

    it("Should reject refund to zero address", async function () {
      const { cldToken, rewardContract, orchestrator, workloadOwner } =
        await loadFixture(deployRewardContract);

      const workloadId = 1;
      const fundAmount = ethers.parseEther("1000");

      await cldToken.mint(workloadOwner.address, fundAmount);
      await cldToken
        .connect(workloadOwner)
        .approve(await rewardContract.getAddress(), fundAmount);
      await rewardContract
        .connect(workloadOwner)
        .fundWorkload(workloadId, fundAmount);

      await expect(
        rewardContract
          .connect(orchestrator)
          .refundWorkload(workloadId, ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid user");
    });
  });

  describe("Batch rewards", function () {
    it("Should batch reward multiple providers", async function () {
      const { cldToken, rewardContract, orchestrator, workloadOwner, provider1, provider2 } =
        await loadFixture(deployRewardContract);

      const workloadId = 1;
      const fundAmount = ethers.parseEther("2000");
      const reward1 = ethers.parseEther("300");
      const reward2 = ethers.parseEther("500");

      await cldToken.mint(workloadOwner.address, fundAmount);
      await cldToken
        .connect(workloadOwner)
        .approve(await rewardContract.getAddress(), fundAmount);
      await rewardContract
        .connect(workloadOwner)
        .fundWorkload(workloadId, fundAmount);

      await rewardContract
        .connect(orchestrator)
        .batchRewardProviders(
          [provider1.address, provider2.address],
          [workloadId, workloadId],
          [reward1, reward2]
        );

      const pending1 = await rewardContract.providerPendingRewards(provider1.address);
      const pending2 = await rewardContract.providerPendingRewards(provider2.address);
      expect(pending1).to.equal(reward1);
      expect(pending2).to.equal(reward2);

      const remainingDeposit = await rewardContract.workloadDeposits(workloadId);
      expect(remainingDeposit).to.equal(fundAmount - reward1 - reward2);
    });

    it("Should reject batch with mismatched array lengths", async function () {
      const { rewardContract, orchestrator, provider1 } = await loadFixture(
        deployRewardContract
      );

      await expect(
        rewardContract
          .connect(orchestrator)
          .batchRewardProviders(
            [provider1.address],
            [1, 2],
            [ethers.parseEther("100")]
          )
      ).to.be.revertedWith("Length mismatch");
    });

    it("Should reject unauthorized batch reward", async function () {
      const { rewardContract, other, provider1 } = await loadFixture(
        deployRewardContract
      );

      await expect(
        rewardContract
          .connect(other)
          .batchRewardProviders(
            [provider1.address],
            [1],
            [ethers.parseEther("100")]
          )
      ).to.be.revertedWithCustomError(
        rewardContract,
        "AccessControlUnauthorizedAccount"
      );
    });

    it("Should emit ProviderRewarded for each provider in batch", async function () {
      const { cldToken, rewardContract, orchestrator, workloadOwner, provider1, provider2 } =
        await loadFixture(deployRewardContract);

      const fundAmount = ethers.parseEther("2000");
      const reward1 = ethers.parseEther("100");
      const reward2 = ethers.parseEther("200");

      await cldToken.mint(workloadOwner.address, fundAmount);
      await cldToken
        .connect(workloadOwner)
        .approve(await rewardContract.getAddress(), fundAmount);
      await rewardContract
        .connect(workloadOwner)
        .fundWorkload(1, fundAmount);

      const tx = rewardContract
        .connect(orchestrator)
        .batchRewardProviders(
          [provider1.address, provider2.address],
          [1, 1],
          [reward1, reward2]
        );

      await expect(tx)
        .to.emit(rewardContract, "ProviderRewarded")
        .withArgs(provider1.address, reward1, 1, (ts: bigint) => ts > 0n);

      await expect(tx)
        .to.emit(rewardContract, "ProviderRewarded")
        .withArgs(provider2.address, reward2, 1, (ts: bigint) => ts > 0n);
    });
  });
});
