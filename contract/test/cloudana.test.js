const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { expect } = require("chai");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { MerkleTree } = require("merkletreejs");
const keccak256 = require("keccak256");

describe("Cloudana DePIN System", function () {
  // Deploy all contracts
  async function deployCloudanaFixture() {
    const [deployer, validator, user, provider, treasuryAdmin] = await ethers.getSigners();
    
    const TEMPORARY_CAP = ethers.parseEther("64000000"); // 64M CLD
    const EPOCH_DURATION = 300; // 5 minutes
    
    // Deploy CLDToken
    const CLDToken = await ethers.getContractFactory("CLDToken");
    const token = await CLDToken.deploy("Cloudana", "CLD", TEMPORARY_CAP);
    
    // Deploy Config
    const Config = await ethers.getContractFactory("Config");
    const config = await Config.deploy();
    
    // Deploy MockCapOracle
    const MockCapOracle = await ethers.getContractFactory("MockCapOracle");
    const oracle = await MockCapOracle.deploy(await token.getAddress());
    
    // Deploy Treasury
    const Treasury = await ethers.getContractFactory("Treasury");
    const treasury = await Treasury.deploy(await token.getAddress());
    
    // Deploy GasBank
    const GasBank = await ethers.getContractFactory("GasBank");
    const gasBank = await GasBank.deploy(await config.getAddress());
    
    // Deploy EmissionController
    const EmissionController = await ethers.getContractFactory("EmissionController");
    const emissionController = await EmissionController.deploy(
      await token.getAddress(),
      await treasury.getAddress(),
      ethers.ZeroAddress, // Will set later
      EPOCH_DURATION
    );
    
    // Deploy MerkleRewardsPoUW
    const MerkleRewardsPoUW = await ethers.getContractFactory("MerkleRewardsPoUW");
    const merkleRewards = await MerkleRewardsPoUW.deploy(
      await token.getAddress(),
      await emissionController.getAddress()
    );

    // Wire circular dependency (matches production deploy flow)
    await emissionController.setMerkleRewards(await merkleRewards.getAddress());
    
    // Deploy ProviderRegistry
    const ProviderRegistry = await ethers.getContractFactory("ProviderRegistry");
    const providerRegistry = await ProviderRegistry.deploy(await config.getAddress());
    
    // Deploy JobEscrow
    const JobEscrow = await ethers.getContractFactory("JobEscrow");
    const jobEscrow = await JobEscrow.deploy(
      await token.getAddress(),
      await config.getAddress(),
      await providerRegistry.getAddress()
    );
    
    // Setup roles
    const CAP_SETTER_ROLE = await token.CAP_SETTER_ROLE();
    await token.grantRole(CAP_SETTER_ROLE, await oracle.getAddress());
    
    const MINTER_ROLE = await token.MINTER_ROLE();
    await token.grantRole(MINTER_ROLE, await emissionController.getAddress());
    await token.grantRole(MINTER_ROLE, await merkleRewards.getAddress());
    // Allow deployer to mint in tests for setup convenience
    await token.grantRole(MINTER_ROLE, deployer.address);
    
    const SETTLER_ROLE = await merkleRewards.SETTLER_ROLE();
    await merkleRewards.grantRole(SETTLER_ROLE, validator.address);
    
    const VALIDATOR_ROLE = await providerRegistry.VALIDATOR_ROLE();
    await providerRegistry.grantRole(VALIDATOR_ROLE, validator.address);
    // JobEscrow calls ProviderRegistry.addReward() during completeJob()
    await providerRegistry.grantRole(VALIDATOR_ROLE, await jobEscrow.getAddress());
    
    const VALIDATOR_ROLE_JOB = await jobEscrow.VALIDATOR_ROLE();
    await jobEscrow.grantRole(VALIDATOR_ROLE_JOB, validator.address);

    // GasBank relayer role (withdrawForRelay requires caller to have RELAYER_ROLE)
    const RELAYER_ROLE = await gasBank.RELAYER_ROLE();
    await gasBank.grantRole(RELAYER_ROLE, validator.address);
    
    return {
      deployer,
      validator,
      user,
      provider,
      treasuryAdmin,
      token,
      config,
      oracle,
      treasury,
      gasBank,
      emissionController,
      merkleRewards,
      providerRegistry,
      jobEscrow,
      TEMPORARY_CAP,
      EPOCH_DURATION,
    };
  }
  
  describe("CLDToken", function () {
    it("Should deploy with correct name and symbol", async function () {
      const { token } = await loadFixture(deployCloudanaFixture);
      expect(await token.name()).to.equal("Cloudana");
      expect(await token.symbol()).to.equal("CLD");
    });
    
    it("Should have correct temporary cap", async function () {
      const { token, TEMPORARY_CAP } = await loadFixture(deployCloudanaFixture);
      expect(await token.cap()).to.equal(TEMPORARY_CAP);
    });
    
    it("Should allow minter to mint tokens", async function () {
      const { token, user } = await loadFixture(deployCloudanaFixture);
      const amount = ethers.parseEther("1000");
      await token.mint(user.address, amount);
      expect(await token.balanceOf(user.address)).to.equal(amount);
    });
    
    it("Should not allow minting above cap", async function () {
      const { token, TEMPORARY_CAP } = await loadFixture(deployCloudanaFixture);
      const amount = TEMPORARY_CAP + 1n;
      await expect(
        token.mint(await token.getAddress(), amount)
      ).to.be.revertedWith("CLDToken: Cap exceeded");
    });
  });
  
  describe("MockCapOracle", function () {
    it("Should finalize cap with random value", async function () {
      const { oracle, token } = await loadFixture(deployCloudanaFixture);
      const randomValue = ethers.parseEther("10000000"); // 10M
      const expectedFinalCap = ethers.parseEther("31000000"); // 21M + 10M
      
      await oracle.finalizeCap(randomValue);
      
      expect(await oracle.capFinalized()).to.be.true;
      expect(await oracle.getFinalCap()).to.equal(expectedFinalCap);
      expect(await token.cap()).to.equal(expectedFinalCap);
    });
    
    it("Should not allow finalizing cap twice", async function () {
      const { oracle } = await loadFixture(deployCloudanaFixture);
      const randomValue = ethers.parseEther("10000000");
      
      await oracle.finalizeCap(randomValue);
      await expect(oracle.finalizeCap(randomValue)).to.be.revertedWith(
        "MockCapOracle: Cap already finalized"
      );
    });
  });
  
  describe("ProviderRegistry", function () {
    it("Should allow provider to register with deposit", async function () {
      const { providerRegistry, provider, config } = await loadFixture(deployCloudanaFixture);
      const depositAmount = await config.providerDepositAmount();
      
      await expect(providerRegistry.connect(provider).register({ value: depositAmount }))
        .to.emit(providerRegistry, "ProviderRegistered")
        .withArgs(provider.address, depositAmount);
      
      expect(await providerRegistry.isProviderActive(provider.address)).to.be.true;
    });
    
    it("Should not allow registration without sufficient deposit", async function () {
      const { providerRegistry, provider, config } = await loadFixture(deployCloudanaFixture);
      const depositAmount = await config.providerDepositAmount();
      
      await expect(
        providerRegistry.connect(provider).register({ value: depositAmount - 1n })
      ).to.be.revertedWith("ProviderRegistry: Insufficient deposit");
    });
    
    it("Should allow enabling auto-reward", async function () {
      const { providerRegistry, provider, config } = await loadFixture(deployCloudanaFixture);
      const depositAmount = await config.providerDepositAmount();
      const gasDeposit = ethers.parseEther("0.1");
      
      await providerRegistry.connect(provider).register({ value: depositAmount });
      await providerRegistry.connect(provider).enableAutoReward({ value: gasDeposit });
      
      const providerInfo = await providerRegistry.getProvider(provider.address);
      expect(providerInfo.autoRewardEnabled).to.be.true;
      expect(providerInfo.autoRewardGasDeposit).to.equal(gasDeposit);
    });
  });
  
  describe("JobEscrow", function () {
    it("Should allow user to create job with CLD deposit", async function () {
      const { jobEscrow, token, user, provider, providerRegistry, config } = await loadFixture(
        deployCloudanaFixture
      );
      
      // Register provider
      const providerDeposit = await config.providerDepositAmount();
      await providerRegistry.connect(provider).register({ value: providerDeposit });
      
      // Mint CLD to user
      const jobDeposit = await config.minJobDeposit();
      await token.mint(user.address, jobDeposit);
      await token.connect(user).approve(await jobEscrow.getAddress(), jobDeposit);
      
      // Create job
      await expect(jobEscrow.connect(user).createJob(provider.address, jobDeposit))
        .to.emit(jobEscrow, "JobCreated")
        .withArgs(anyValue, user.address, provider.address, jobDeposit);
    });
    
    it("Should allow completing job and paying provider", async function () {
      const { jobEscrow, token, user, provider, providerRegistry, config, validator } = await loadFixture(
        deployCloudanaFixture
      );
      
      // Setup
      const providerDeposit = await config.providerDepositAmount();
      await providerRegistry.connect(provider).register({ value: providerDeposit });
      
      const jobDeposit = ethers.parseEther("10");
      await token.mint(user.address, jobDeposit);
      await token.connect(user).approve(await jobEscrow.getAddress(), jobDeposit);
      
      // Create job
      await jobEscrow.connect(user).createJob(provider.address, jobDeposit);
      const userJobs = await jobEscrow.getUserJobs(user.address);
      const jobId = userJobs[0];
      
      // Complete job
      const rewardAmount = ethers.parseEther("8");
      await jobEscrow.connect(user).completeJob(jobId, rewardAmount);
      
      // Check balances
      expect(await token.balanceOf(provider.address)).to.equal(rewardAmount);
    });
  });
  
  describe("MerkleRewardsPoUW", function () {
    it("Should allow publishing merkle root", async function () {
      const { merkleRewards, emissionController, validator } = await loadFixture(
        deployCloudanaFixture
      );
      
      // Start emissions first
      const E0 = ethers.parseEther("10000");
      await emissionController.startEmissions(E0);
      
      // Process epoch 0
      await emissionController.processEpoch(0);
      
      // Build merkle tree
      const rewards = [
        { provider: "0x1111111111111111111111111111111111111111", amount: ethers.parseEther("100") },
        { provider: "0x2222222222222222222222222222222222222222", amount: ethers.parseEther("200") },
      ];
      
      const leaves = rewards.map((r) =>
        keccak256(ethers.solidityPacked(["address", "uint256"], [r.provider, r.amount]))
      );
      const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
      const root = tree.getHexRoot();
      const totalAmount = rewards.reduce((sum, r) => sum + r.amount, 0n);
      
      // Publish root
      await expect(merkleRewards.connect(validator).setRoot(0, root, totalAmount))
        .to.emit(merkleRewards, "RootPublished")
        .withArgs(0, root, totalAmount);
    });
    
    it("Should allow claiming reward with valid proof", async function () {
      const { merkleRewards, emissionController, validator, token } = await loadFixture(
        deployCloudanaFixture
      );
      
      // Setup
      const E0 = ethers.parseEther("10000");
      await emissionController.startEmissions(E0);
      await emissionController.processEpoch(0);
      
      // Build merkle tree
      const [claimant] = await ethers.getSigners();
      const rewardAmount = ethers.parseEther("100");
      const rewards = [
        { provider: claimant.address, amount: rewardAmount },
      ];
      
      const leaves = rewards.map((r) =>
        keccak256(ethers.solidityPacked(["address", "uint256"], [r.provider, r.amount]))
      );
      const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
      const root = tree.getHexRoot();
      const totalAmount = rewardAmount;
      
      // Publish root
      await merkleRewards.connect(validator).setRoot(0, root, totalAmount);
      
      // Claim
      const leaf = keccak256(
        ethers.solidityPacked(["address", "uint256"], [claimant.address, rewardAmount])
      );
      const proof = tree.getHexProof(leaf);
      
      await expect(merkleRewards.connect(claimant).claim(0, rewardAmount, proof))
        .to.emit(merkleRewards, "RewardClaimed")
        .withArgs(0, claimant.address, rewardAmount);
      
      expect(await token.balanceOf(claimant.address)).to.equal(rewardAmount);
    });
    
    it("Should not allow double claiming", async function () {
      const { merkleRewards, emissionController, validator } = await loadFixture(
        deployCloudanaFixture
      );
      
      // Setup
      const E0 = ethers.parseEther("10000");
      await emissionController.startEmissions(E0);
      await emissionController.processEpoch(0);
      
      const [claimant] = await ethers.getSigners();
      const rewardAmount = ethers.parseEther("100");
      const rewards = [{ provider: claimant.address, amount: rewardAmount }];
      
      const leaves = rewards.map((r) =>
        keccak256(ethers.solidityPacked(["address", "uint256"], [r.provider, r.amount]))
      );
      const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
      const root = tree.getHexRoot();
      
      await merkleRewards.connect(validator).setRoot(0, root, rewardAmount);
      
      const leaf = keccak256(
        ethers.solidityPacked(["address", "uint256"], [claimant.address, rewardAmount])
      );
      const proof = tree.getHexProof(leaf);
      
      await merkleRewards.connect(claimant).claim(0, rewardAmount, proof);
      
      await expect(
        merkleRewards.connect(claimant).claim(0, rewardAmount, proof)
      ).to.be.revertedWith("MerkleRewardsPoUW: Already claimed");
    });
  });
  
  describe("EmissionController", function () {
    it("Should start emissions", async function () {
      const { emissionController } = await loadFixture(deployCloudanaFixture);
      const E0 = ethers.parseEther("10000");
      
      await expect(emissionController.startEmissions(E0))
        .to.emit(emissionController, "EmissionsStarted");
      
      expect(await emissionController.emissionsStarted()).to.be.true;
    });
    
    it("Should process epoch and set PoUW budget", async function () {
      const { emissionController, treasury, token } = await loadFixture(deployCloudanaFixture);
      
      const E0 = ethers.parseEther("10000");
      await emissionController.startEmissions(E0);
      
      await emissionController.processEpoch(0);
      
      const budget = await emissionController.getPouwBudget(0);
      expect(budget).to.be.gt(0);
      
      // Check treasury received tokens (35% validators + 18% treasury + 7% governance)
      const treasuryBalance = await token.balanceOf(await treasury.getAddress());
      expect(treasuryBalance).to.be.gt(0);
    });
  });
  
  describe("GasBank", function () {
    it("Should allow depositing ETH", async function () {
      const { gasBank } = await loadFixture(deployCloudanaFixture);
      const amount = ethers.parseEther("1");
      
      await expect(gasBank.depositETH({ value: amount }))
        .to.emit(gasBank, "ETHDeposited");
      
      expect(await gasBank.getETHBalance()).to.equal(amount);
    });
    
    it("Should allow relayer to withdraw for relay", async function () {
      const { gasBank, validator } = await loadFixture(deployCloudanaFixture);
      const depositAmount = ethers.parseEther("10");
      const withdrawAmount = ethers.parseEther("1");
      
      await gasBank.depositETH({ value: depositAmount });
      await gasBank.whitelistRelayer(validator.address, true);
      
      await expect(
        gasBank.connect(validator).withdrawForRelay(validator.address, withdrawAmount)
      ).to.emit(gasBank, "ETHWithdrawn");
    });
  });
});

