const hre = require("hardhat");

/**
 * Main deployment script for Cloudana DePIN system
 * Deploys all contracts and sets up roles
 */
async function main() {
  console.log("Network:", hre.network.name);
  
  // Get deployer signer using getSigners() (standard Hardhat approach)
  const signers = await hre.ethers.getSigners();
  if (signers.length === 0) {
    throw new Error("No deployer account configured! Set DEPLOYER_PRIVATE_KEY in .env");
  }
  
  const deployer = signers[0];
  
  // Parse validator addresses from env (comma-separated or single address)
  // Example: VALIDATOR_ADDRESSES=0x123...,0x456... or VALIDATOR_ADDRESSES=0x123...
  // Also supports legacy VALIDATOR_ADDRESS for backward compatibility
  const validatorAddresses = process.env.VALIDATOR_ADDRESSES
    ? process.env.VALIDATOR_ADDRESSES.split(',').map(addr => hre.ethers.getAddress(addr.trim())).filter(addr => addr !== hre.ethers.ZeroAddress)
    : process.env.VALIDATOR_ADDRESS
      ? [hre.ethers.getAddress(process.env.VALIDATOR_ADDRESS.trim())]
      : [deployer.address];
  
  // Parse treasury admin addresses from env (comma-separated or single address)
  // Example: TREASURY_ADMIN_ADDRESSES=0x123...,0x456... or TREASURY_ADMIN_ADDRESSES=0x123...
  // Also supports legacy TREASURY_ADMIN_ADDRESS for backward compatibility
  const treasuryAdminAddresses = process.env.TREASURY_ADMIN_ADDRESSES
    ? process.env.TREASURY_ADMIN_ADDRESSES.split(',').map(addr => hre.ethers.getAddress(addr.trim())).filter(addr => addr !== hre.ethers.ZeroAddress)
    : process.env.TREASURY_ADMIN_ADDRESS
      ? [hre.ethers.getAddress(process.env.TREASURY_ADMIN_ADDRESS.trim())]
      : [deployer.address];
  
  console.log("\n=== Account Information ===");
  console.log("Deployer address:", deployer.address);
  console.log("Deployer balance:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)), "ETH");
  console.log("Validator addresses:", validatorAddresses.length);
  for (let i = 0; i < validatorAddresses.length; i++) {
    const addr = validatorAddresses[i];
    try {
      const balance = await hre.ethers.provider.getBalance(addr);
      console.log(`  [${i + 1}] ${addr} (${hre.ethers.formatEther(balance)} ETH)`);
    } catch (e) {
      console.log(`  [${i + 1}] ${addr} (balance check failed)`);
    }
  }
  console.log("Treasury admin addresses:", treasuryAdminAddresses.length);
  for (let i = 0; i < treasuryAdminAddresses.length; i++) {
    const addr = treasuryAdminAddresses[i];
    try {
      const balance = await hre.ethers.provider.getBalance(addr);
      console.log(`  [${i + 1}] ${addr} (${hre.ethers.formatEther(balance)} ETH)`);
    } catch (e) {
      console.log(`  [${i + 1}] ${addr} (balance check failed)`);
    }
  }
  console.log("===========================\n");
  
  if (validatorAddresses.length === 1 && validatorAddresses[0] === deployer.address) {
    console.log("ℹ️  Using deployer account as validator (set VALIDATOR_ADDRESSES in .env for separate addresses)");
  }
  if (treasuryAdminAddresses.length === 1 && treasuryAdminAddresses[0] === deployer.address) {
    console.log("ℹ️  Using deployer account as treasury admin (set TREASURY_ADMIN_ADDRESSES in .env for separate addresses, e.g., multisig)");
  }
  
  // Constants
  const TEMPORARY_CAP = hre.ethers.parseEther("64000000"); // 64M CLD
  const EPOCH_DURATION = 300; // 5 minutes for MVP (testnet)
  
  // 1. Deploy CLDToken
  console.log("\n1. Deploying CLDToken...");
  const CLDToken = await hre.ethers.getContractFactory("CLDToken");
  const token = await CLDToken.connect(deployer).deploy(
    "Cloudana",
    "CLD",
    TEMPORARY_CAP
  );
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log("CLDToken deployed to:", tokenAddress);
  
  // 2. Deploy Config
  console.log("\n2. Deploying Config...");
  const Config = await hre.ethers.getContractFactory("Config");
  const config = await Config.connect(deployer).deploy();
  await config.waitForDeployment();
  const configAddress = await config.getAddress();
  console.log("Config deployed to:", configAddress);
  
  // 3. Deploy MockCapOracle
  console.log("\n3. Deploying MockCapOracle...");
  const MockCapOracle = await hre.ethers.getContractFactory("MockCapOracle");
  const oracle = await MockCapOracle.connect(deployer).deploy(tokenAddress);
  await oracle.waitForDeployment();
  const oracleAddress = await oracle.getAddress();
  console.log("MockCapOracle deployed to:", oracleAddress);
  
  // 4. Deploy Treasury
  console.log("\n4. Deploying Treasury...");
  const Treasury = await hre.ethers.getContractFactory("Treasury");
  const treasury = await Treasury.connect(deployer).deploy(tokenAddress);
  await treasury.waitForDeployment();
  const treasuryAddress = await treasury.getAddress();
  console.log("Treasury deployed to:", treasuryAddress);
  
  // 5. Deploy GasBank
  console.log("\n5. Deploying GasBank...");
  const GasBank = await hre.ethers.getContractFactory("GasBank");
  const gasBank = await GasBank.connect(deployer).deploy(configAddress);
  await gasBank.waitForDeployment();
  const gasBankAddress = await gasBank.getAddress();
  console.log("GasBank deployed to:", gasBankAddress);
  
  // 6. Deploy EmissionController
  console.log("\n6. Deploying EmissionController...");
  const EmissionController = await hre.ethers.getContractFactory("EmissionController");
  const emissionController = await EmissionController.connect(deployer).deploy(
    tokenAddress,
    treasuryAddress,
    hre.ethers.ZeroAddress, // MerkleRewards will be set later
    EPOCH_DURATION
  );
  await emissionController.waitForDeployment();
  const emissionControllerAddress = await emissionController.getAddress();
  console.log("EmissionController deployed to:", emissionControllerAddress);
  
  // 7. Deploy MerkleRewardsPoUW
  console.log("\n7. Deploying MerkleRewardsPoUW...");
  const MerkleRewardsPoUW = await hre.ethers.getContractFactory("MerkleRewardsPoUW");
  const merkleRewards = await MerkleRewardsPoUW.connect(deployer).deploy(
    tokenAddress,
    emissionControllerAddress
  );
  await merkleRewards.waitForDeployment();
  const merkleRewardsAddress = await merkleRewards.getAddress();
  console.log("MerkleRewardsPoUW deployed to:", merkleRewardsAddress);
  
  // Update EmissionController with MerkleRewards address
  console.log("\n7a. Setting MerkleRewards address in EmissionController...");
  const setMerkleRewardsTx = await emissionController.connect(deployer).setMerkleRewards(merkleRewardsAddress);
  await setMerkleRewardsTx.wait();
  console.log("MerkleRewards address set in EmissionController");
  
  // 8. Deploy ProviderRegistry
  console.log("\n8. Deploying ProviderRegistry...");
  const ProviderRegistry = await hre.ethers.getContractFactory("ProviderRegistry");
  const providerRegistry = await ProviderRegistry.connect(deployer).deploy(configAddress);
  await providerRegistry.waitForDeployment();
  const providerRegistryAddress = await providerRegistry.getAddress();
  console.log("ProviderRegistry deployed to:", providerRegistryAddress);
  
  // 9. Deploy JobEscrow
  console.log("\n9. Deploying JobEscrow...");
  const JobEscrow = await hre.ethers.getContractFactory("JobEscrow");
  const jobEscrow = await JobEscrow.connect(deployer).deploy(
    tokenAddress,
    configAddress,
    providerRegistryAddress
  );
  await jobEscrow.waitForDeployment();
  const jobEscrowAddress = await jobEscrow.getAddress();
  console.log("JobEscrow deployed to:", jobEscrowAddress);
  
  // Setup roles
  console.log("\n10. Setting up roles...");
  
  // Grant CAP_SETTER_ROLE to oracle
  const CAP_SETTER_ROLE = await token.CAP_SETTER_ROLE();
  await token.connect(deployer).grantRole(CAP_SETTER_ROLE, oracleAddress);
  console.log("Granted CAP_SETTER_ROLE to oracle");
  
  // Grant MINTER_ROLE to EmissionController and MerkleRewards
  const MINTER_ROLE = await token.MINTER_ROLE();
  await token.connect(deployer).grantRole(MINTER_ROLE, emissionControllerAddress);
  await token.connect(deployer).grantRole(MINTER_ROLE, merkleRewardsAddress);
  console.log("Granted MINTER_ROLE to EmissionController and MerkleRewards");
  
  // Grant roles to all validator addresses
  const SETTLER_ROLE = await merkleRewards.SETTLER_ROLE();
  const VALIDATOR_ROLE = await providerRegistry.VALIDATOR_ROLE();
  const VALIDATOR_ROLE_JOB = await jobEscrow.VALIDATOR_ROLE();
  const RELAYER_ROLE = await gasBank.RELAYER_ROLE();
  const RELAYER_ROLE_JOB = await jobEscrow.RELAYER_ROLE();
  
  for (const validatorAddr of validatorAddresses) {
    await merkleRewards.connect(deployer).grantRole(SETTLER_ROLE, validatorAddr);
    await providerRegistry.connect(deployer).grantRole(VALIDATOR_ROLE, validatorAddr);
    await jobEscrow.connect(deployer).grantRole(VALIDATOR_ROLE_JOB, validatorAddr);
    await gasBank.connect(deployer).grantRole(RELAYER_ROLE, validatorAddr);
    await jobEscrow.connect(deployer).grantRole(RELAYER_ROLE_JOB, validatorAddr);
    console.log(`Granted all validator roles to: ${validatorAddr}`);
  }
  
  // Grant TREASURY_ROLE to all treasury admin addresses
  // Note: Treasury contract grants DEFAULT_ADMIN_ROLE and TREASURY_ROLE to deployer in constructor
  // You may want to transfer admin role or grant TREASURY_ROLE to treasury admin addresses
  try {
    const Treasury = await hre.ethers.getContractFactory("Treasury");
    const treasuryContract = Treasury.attach(treasuryAddress);
    const TREASURY_ROLE = await treasuryContract.TREASURY_ROLE();
    for (const treasuryAddr of treasuryAdminAddresses) {
      await treasuryContract.connect(deployer).grantRole(TREASURY_ROLE, treasuryAddr);
      console.log(`Granted TREASURY_ROLE to: ${treasuryAddr}`);
    }
  } catch (e) {
    console.log("ℹ️  Treasury role setup:", e.message);
  }
  
  // Summary
  console.log("\n=== Deployment Summary ===");
  console.log("CLDToken:", tokenAddress);
  console.log("Config:", configAddress);
  console.log("MockCapOracle:", oracleAddress);
  console.log("Treasury:", treasuryAddress);
  console.log("GasBank:", gasBankAddress);
  console.log("EmissionController:", emissionControllerAddress);
  console.log("MerkleRewardsPoUW:", merkleRewardsAddress);
  console.log("ProviderRegistry:", providerRegistryAddress);
  console.log("JobEscrow:", jobEscrowAddress);
  console.log("\nValidator addresses:", validatorAddresses);
  console.log("Treasury admin addresses:", treasuryAdminAddresses);
  
  // Save addresses to file for other scripts
  const fs = require("fs");
  const addresses = {
    CLDToken: tokenAddress,
    Config: configAddress,
    MockCapOracle: oracleAddress,
    Treasury: treasuryAddress,
    GasBank: gasBankAddress,
    EmissionController: emissionControllerAddress,
    MerkleRewardsPoUW: merkleRewardsAddress,
    ProviderRegistry: providerRegistryAddress,
    JobEscrow: jobEscrowAddress,
    Validators: validatorAddresses,
    TreasuryAdmins: treasuryAdminAddresses,
    Deployer: deployer.address,
    Network: hre.network.name,
    Timestamp: new Date().toISOString()
  };
  
  fs.writeFileSync(
    "./deployment-addresses.json",
    JSON.stringify(addresses, null, 2)
  );
  console.log("\nAddresses saved to deployment-addresses.json");
  
  // Verify contracts if not on local network
  if (hre.network.name !== "hardhat" && hre.network.name !== "localhost") {
    console.log("\nWaiting for block confirmations...");
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    console.log("Verifying contracts...");
    const contracts = [
      { name: "CLDToken", address: tokenAddress, args: ["Cloudana", "CLD", TEMPORARY_CAP] },
      { name: "Config", address: configAddress, args: [] },
      { name: "MockCapOracle", address: oracleAddress, args: [tokenAddress] },
      { name: "Treasury", address: treasuryAddress, args: [tokenAddress] },
      { name: "GasBank", address: gasBankAddress, args: [configAddress] },
    ];
    
    for (const contract of contracts) {
      try {
        await hre.run("verify:verify", {
          address: contract.address,
          constructorArguments: contract.args,
        });
        console.log(`${contract.name} verified!`);
      } catch (error) {
        if (error.message.includes("Already Verified")) {
          console.log(`${contract.name} already verified!`);
        } else {
          console.error(`${contract.name} verification failed:`, error.message);
        }
      }
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

