const hre = require("hardhat");
const { getCreateAddress } = require("ethers");

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

  // Nonce + delay config
  const DEPLOYMENT_DELAY_MS = Number(process.env.DEPLOYMENT_DELAY_MS || "3000");
  const DEPLOY_CONFIRMATIONS = Number(process.env.DEPLOY_CONFIRMATIONS || "1");
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const nonceLatest = await hre.ethers.provider.getTransactionCount(deployer.address, "latest");
  const noncePending = await hre.ethers.provider.getTransactionCount(deployer.address, "pending");
  console.log(`Deployer nonce latest: ${nonceLatest}, pending: ${noncePending}`);
  if (noncePending !== nonceLatest) {
    console.log("⚠️  Pending transactions detected for deployer. If you previously ran this script, wait for pending txs to mine or use a fresh deployer.");
  }
  let nextNonce = noncePending;

  function isAlreadyKnownError(e) {
    const msg = (e && (e.message || e.toString && e.toString())) || "";
    return /already known|known transaction/i.test(msg);
  }

  function isNonceTooLowError(e) {
    const msg = (e && (e.message || e.toString && e.toString())) || "";
    return /nonce too low/i.test(msg);
  }

  function normalizeAddr(addr) {
    try {
      return hre.ethers.getAddress(addr);
    } catch {
      return (addr || "").toLowerCase();
    }
  }

  function sameAddr(a, b) {
    return normalizeAddr(a) === normalizeAddr(b);
  }

  async function syncNextNonce(reason) {
    const chainPending = await hre.ethers.provider.getTransactionCount(deployer.address, "pending");
    if (chainPending > nextNonce) {
      console.log(`ℹ️  Nonce drift detected (${reason}): local ${nextNonce} -> chain pending ${chainPending}`);
      nextNonce = chainPending;
    }
    return nextNonce;
  }

  async function allocateNonce(reason) {
    await syncNextNonce(reason);
    return nextNonce++;
  }

  async function waitForNonceMined(nonce, { pollMs = 2000, timeoutMs = 10 * 60 * 1000 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const latest = await hre.ethers.provider.getTransactionCount(deployer.address, "latest");
      if (latest > nonce) return true;
      await sleep(pollMs);
    }
    return false;
  }

  async function waitForPostCheck(postCheck, { pollMs = 2000, timeoutMs = 5 * 60 * 1000 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const ok = await postCheck();
        if (ok) return true;
      } catch {
        // ignore transient RPC errors while waiting
      }
      await sleep(pollMs);
    }
    return false;
  }

  async function waitForContractCode(address, { pollMs = 2000, timeoutMs = 10 * 60 * 1000 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const code = await hre.ethers.provider.getCode(address);
      if (code && code !== "0x") return true;
      await sleep(pollMs);
    }
    return false;
  }

  async function deployContract(contractName, factory, constructorArgs = []) {
    const maxAttempts = Number(process.env.NONCE_RETRY_ATTEMPTS || "3");
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const nonce = await allocateNonce(`${contractName} deploy`);
      const expectedAddress = getCreateAddress({ from: deployer.address, nonce });
      console.log(`\nDeploying ${contractName} (nonce ${nonce})...`);
      try {
        const contract = await factory.connect(deployer).deploy(...constructorArgs, { nonce });
        const tx = contract.deploymentTransaction();
        if (tx) {
          console.log(`${contractName} deploy tx sent: ${tx.hash}`);
          await sleep(DEPLOYMENT_DELAY_MS);
          const receipt = await tx.wait(DEPLOY_CONFIRMATIONS);
          console.log(`${contractName} deploy tx mined in block: ${receipt.blockNumber}`);
        }
        await contract.waitForDeployment();
        const address = await contract.getAddress();
        console.log(`${contractName} deployed to: ${address}`);
        return { contract, address };
      } catch (e) {
        lastErr = e;
        if (isNonceTooLowError(e)) {
          console.log(`⚠️  ${contractName} nonce too low on attempt ${attempt}/${maxAttempts}. Resyncing and retrying...`);
          await syncNextNonce(`${contractName} nonce-too-low`);
          continue;
        }
        if (isAlreadyKnownError(e)) {
          console.log(
            `⚠️  ${contractName} deploy tx is already known by the RPC node. ` +
              `Waiting for contract code at expected address: ${expectedAddress}`
          );
          const ok = await waitForContractCode(expectedAddress);
          if (!ok) {
            throw new Error(
              `${contractName} deploy tx was "already known", but contract code did not appear at ${expectedAddress} within timeout. ` +
                `This usually means the tx is stuck/dropped or nonce management is out of sync.`
            );
          }
          console.log(`${contractName} detected deployed at: ${expectedAddress}`);
          const contract = factory.attach(expectedAddress).connect(deployer);
          return { contract, address: expectedAddress };
        }
        throw e;
      }
    }
    throw lastErr;
  }

  async function sendTx(label, fn) {
    const maxAttempts = Number(process.env.NONCE_RETRY_ATTEMPTS || "3");
    const opts = arguments.length >= 3 ? arguments[2] : {};
    const postCheck = opts && typeof opts.postCheck === "function" ? opts.postCheck : null;
    const postCheckLabel = (opts && opts.postCheckLabel) || "postCheck";
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const nonce = await allocateNonce(label);
      try {
        const tx = await fn(nonce);
        console.log(`${label} tx sent: ${tx.hash} (nonce ${nonce})`);
        await sleep(DEPLOYMENT_DELAY_MS);
        const receipt = await tx.wait(DEPLOY_CONFIRMATIONS);
        console.log(`${label} tx mined in block: ${receipt.blockNumber}`);
        if (postCheck) {
          const ok = await waitForPostCheck(postCheck, {
            pollMs: Number(process.env.POSTCHECK_POLL_MS || "2000"),
            timeoutMs: Number(process.env.POSTCHECK_TIMEOUT_MS || String(5 * 60 * 1000)),
          });
          if (!ok) {
            throw new Error(`${label}: ${postCheckLabel} did not pass after tx mined`);
          }
        }
        return receipt;
      } catch (e) {
        lastErr = e;
        if (isNonceTooLowError(e)) {
          console.log(`⚠️  ${label} nonce too low on attempt ${attempt}/${maxAttempts}. Resyncing and retrying...`);
          await syncNextNonce(`${label} nonce-too-low`);
          continue;
        }
        if (isAlreadyKnownError(e)) {
          console.log(`⚠️  ${label} tx already known by RPC (nonce ${nonce}). Waiting for nonce to be mined...`);
          const mined = await waitForNonceMined(nonce, {
            pollMs: Number(process.env.NONCE_WAIT_POLL_MS || "2000"),
            timeoutMs: Number(process.env.NONCE_WAIT_TIMEOUT_MS || String(10 * 60 * 1000)),
          });
          if (!mined) {
            throw new Error(`${label}: tx was "already known" but nonce ${nonce} did not mine within timeout`);
          }
          if (postCheck) {
            const ok = await waitForPostCheck(postCheck, {
              pollMs: Number(process.env.POSTCHECK_POLL_MS || "2000"),
              timeoutMs: Number(process.env.POSTCHECK_TIMEOUT_MS || String(5 * 60 * 1000)),
            });
            if (!ok) {
              throw new Error(`${label}: ${postCheckLabel} did not pass after waiting for nonce ${nonce} to mine`);
            }
          }
          console.log(`${label} confirmed (nonce ${nonce} mined).`);
          return;
        }
        throw e;
      }
    }
    throw lastErr;
  }

  // 1. Deploy CLDToken
  const CLDToken = await hre.ethers.getContractFactory("CLDToken");
  const { contract: token, address: tokenAddress } = await deployContract(
    "CLDToken",
    CLDToken,
    ["Cloudana", "CLD", TEMPORARY_CAP]
  );

  // 2. Deploy Config
  const Config = await hre.ethers.getContractFactory("Config");
  const { contract: config, address: configAddress } = await deployContract("Config", Config, []);

  // 3. Deploy MockCapOracle
  const MockCapOracle = await hre.ethers.getContractFactory("MockCapOracle");
  const { contract: oracle, address: oracleAddress } = await deployContract("MockCapOracle", MockCapOracle, [tokenAddress]);

  // 4. Deploy Treasury
  const Treasury = await hre.ethers.getContractFactory("Treasury");
  const { contract: treasury, address: treasuryAddress } = await deployContract("Treasury", Treasury, [tokenAddress]);

  // 5. Deploy GasBank
  const GasBank = await hre.ethers.getContractFactory("GasBank");
  const { contract: gasBank, address: gasBankAddress } = await deployContract("GasBank", GasBank, [configAddress]);

  // 6. Deploy EmissionController
  const EmissionController = await hre.ethers.getContractFactory("EmissionController");
  const { contract: emissionController, address: emissionControllerAddress } = await deployContract(
    "EmissionController",
    EmissionController,
    [tokenAddress, treasuryAddress, hre.ethers.ZeroAddress, EPOCH_DURATION] // MerkleRewards set later
  );

  // 7. Deploy MerkleRewardsPoUW
  const MerkleRewardsPoUW = await hre.ethers.getContractFactory("MerkleRewardsPoUW");
  const { contract: merkleRewards, address: merkleRewardsAddress } = await deployContract(
    "MerkleRewardsPoUW",
    MerkleRewardsPoUW,
    [tokenAddress, emissionControllerAddress]
  );

  // 7a. Update EmissionController with MerkleRewards address
  console.log("\n7a. Setting MerkleRewards address in EmissionController...");
  await sendTx("EmissionController.setMerkleRewards", (nonce) =>
    emissionController.connect(deployer).setMerkleRewards(merkleRewardsAddress, { nonce })
  , {
    postCheckLabel: "EmissionController.merkleRewards == merkleRewardsAddress",
    postCheck: async () => sameAddr(await emissionController.merkleRewards(), merkleRewardsAddress),
  }
  );
  console.log("MerkleRewards address set in EmissionController");

  // 8. Deploy ProviderRegistry
  const ProviderRegistry = await hre.ethers.getContractFactory("ProviderRegistry");
  const { contract: providerRegistry, address: providerRegistryAddress } = await deployContract(
    "ProviderRegistry",
    ProviderRegistry,
    [configAddress]
  );

  // 9. Deploy JobEscrow
  const JobEscrow = await hre.ethers.getContractFactory("JobEscrow");
  const { contract: jobEscrow, address: jobEscrowAddress } = await deployContract(
    "JobEscrow",
    JobEscrow,
    [tokenAddress, configAddress, providerRegistryAddress]
  );
  
  // Setup roles
  console.log("\n10. Setting up roles...");
  
  // Grant CAP_SETTER_ROLE to oracle
  const CAP_SETTER_ROLE = await token.CAP_SETTER_ROLE();
  await sendTx("CLDToken.grantRole(CAP_SETTER_ROLE)", (nonce) =>
    token.connect(deployer).grantRole(CAP_SETTER_ROLE, oracleAddress, { nonce })
  , {
    postCheckLabel: "token.hasRole(CAP_SETTER_ROLE, oracle)",
    postCheck: async () => await token.hasRole(CAP_SETTER_ROLE, oracleAddress),
  }
  );
  console.log("Granted CAP_SETTER_ROLE to oracle");
  
  // Grant MINTER_ROLE to EmissionController and MerkleRewards
  const MINTER_ROLE = await token.MINTER_ROLE();
  await sendTx("CLDToken.grantRole(MINTER_ROLE, EmissionController)", (nonce) =>
    token.connect(deployer).grantRole(MINTER_ROLE, emissionControllerAddress, { nonce })
  , {
    postCheckLabel: "token.hasRole(MINTER_ROLE, EmissionController)",
    postCheck: async () => await token.hasRole(MINTER_ROLE, emissionControllerAddress),
  }
  );
  await sendTx("CLDToken.grantRole(MINTER_ROLE, MerkleRewardsPoUW)", (nonce) =>
    token.connect(deployer).grantRole(MINTER_ROLE, merkleRewardsAddress, { nonce })
  , {
    postCheckLabel: "token.hasRole(MINTER_ROLE, MerkleRewardsPoUW)",
    postCheck: async () => await token.hasRole(MINTER_ROLE, merkleRewardsAddress),
  }
  );
  console.log("Granted MINTER_ROLE to EmissionController and MerkleRewards");
  
  // Grant roles to all validator addresses
  const SETTLER_ROLE = await merkleRewards.SETTLER_ROLE();
  const VALIDATOR_ROLE = await providerRegistry.VALIDATOR_ROLE();
  const VALIDATOR_ROLE_JOB = await jobEscrow.VALIDATOR_ROLE();
  const RELAYER_ROLE = await gasBank.RELAYER_ROLE();
  const RELAYER_ROLE_JOB = await jobEscrow.RELAYER_ROLE();

  // JobEscrow.completeJob() calls ProviderRegistry.addReward(), which requires ProviderRegistry.VALIDATOR_ROLE
  await sendTx(`ProviderRegistry.grantRole(VALIDATOR_ROLE, JobEscrow)`, (nonce) =>
    providerRegistry.connect(deployer).grantRole(VALIDATOR_ROLE, jobEscrowAddress, { nonce })
  , {
    postCheckLabel: `providerRegistry.hasRole(VALIDATOR_ROLE, JobEscrow)`,
    postCheck: async () => await providerRegistry.hasRole(VALIDATOR_ROLE, jobEscrowAddress),
  });
  
  for (const validatorAddr of validatorAddresses) {
    await sendTx(`MerkleRewardsPoUW.grantRole(SETTLER_ROLE, ${validatorAddr})`, (nonce) =>
      merkleRewards.connect(deployer).grantRole(SETTLER_ROLE, validatorAddr, { nonce })
    , {
      postCheckLabel: `merkleRewards.hasRole(SETTLER_ROLE, ${validatorAddr})`,
      postCheck: async () => await merkleRewards.hasRole(SETTLER_ROLE, validatorAddr),
    }
    );
    await sendTx(`ProviderRegistry.grantRole(VALIDATOR_ROLE, ${validatorAddr})`, (nonce) =>
      providerRegistry.connect(deployer).grantRole(VALIDATOR_ROLE, validatorAddr, { nonce })
    , {
      postCheckLabel: `providerRegistry.hasRole(VALIDATOR_ROLE, ${validatorAddr})`,
      postCheck: async () => await providerRegistry.hasRole(VALIDATOR_ROLE, validatorAddr),
    }
    );
    await sendTx(`JobEscrow.grantRole(VALIDATOR_ROLE, ${validatorAddr})`, (nonce) =>
      jobEscrow.connect(deployer).grantRole(VALIDATOR_ROLE_JOB, validatorAddr, { nonce })
    , {
      postCheckLabel: `jobEscrow.hasRole(VALIDATOR_ROLE, ${validatorAddr})`,
      postCheck: async () => await jobEscrow.hasRole(VALIDATOR_ROLE_JOB, validatorAddr),
    }
    );
    await sendTx(`GasBank.grantRole(RELAYER_ROLE, ${validatorAddr})`, (nonce) =>
      gasBank.connect(deployer).grantRole(RELAYER_ROLE, validatorAddr, { nonce })
    , {
      postCheckLabel: `gasBank.hasRole(RELAYER_ROLE, ${validatorAddr})`,
      postCheck: async () => await gasBank.hasRole(RELAYER_ROLE, validatorAddr),
    }
    );
    await sendTx(`JobEscrow.grantRole(RELAYER_ROLE, ${validatorAddr})`, (nonce) =>
      jobEscrow.connect(deployer).grantRole(RELAYER_ROLE_JOB, validatorAddr, { nonce })
    , {
      postCheckLabel: `jobEscrow.hasRole(RELAYER_ROLE, ${validatorAddr})`,
      postCheck: async () => await jobEscrow.hasRole(RELAYER_ROLE_JOB, validatorAddr),
    }
    );
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
      await sendTx(`Treasury.grantRole(TREASURY_ROLE, ${treasuryAddr})`, (nonce) =>
        treasuryContract.connect(deployer).grantRole(TREASURY_ROLE, treasuryAddr, { nonce })
      , {
        postCheckLabel: `treasury.hasRole(TREASURY_ROLE, ${treasuryAddr})`,
        postCheck: async () => await treasuryContract.hasRole(TREASURY_ROLE, treasuryAddr),
      }
      );
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
      { name: "EmissionController", address: emissionControllerAddress, args: [tokenAddress, treasuryAddress, hre.ethers.ZeroAddress, EPOCH_DURATION] },
      { name: "MerkleRewardsPoUW", address: merkleRewardsAddress, args: [tokenAddress, emissionControllerAddress] },
      { name: "ProviderRegistry", address: providerRegistryAddress, args: [configAddress] },
      { name: "JobEscrow", address: jobEscrowAddress, args: [tokenAddress, configAddress, providerRegistryAddress] },
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

