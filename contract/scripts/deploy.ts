import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  // Deploy CLDToken
  console.log("\nDeploying CLDToken...");
  const CLDToken = await ethers.getContractFactory("CLDToken");
  const cldToken = await CLDToken.deploy();
  await cldToken.waitForDeployment();
  const cldTokenAddress = await cldToken.getAddress();
  console.log("CLDToken deployed to:", cldTokenAddress);

  // Deploy ProviderRegistry
  console.log("\nDeploying ProviderRegistry...");
  const ProviderRegistry = await ethers.getContractFactory("ProviderRegistry");
  const providerRegistry = await ProviderRegistry.deploy(cldTokenAddress);
  await providerRegistry.waitForDeployment();
  const providerRegistryAddress = await providerRegistry.getAddress();
  console.log("ProviderRegistry deployed to:", providerRegistryAddress);

  // Deploy JobEscrow
  console.log("\nDeploying JobEscrow...");
  const JobEscrow = await ethers.getContractFactory("JobEscrow");
  const jobEscrow = await JobEscrow.deploy(cldTokenAddress, providerRegistryAddress);
  await jobEscrow.waitForDeployment();
  const jobEscrowAddress = await jobEscrow.getAddress();
  console.log("JobEscrow deployed to:", jobEscrowAddress);

  // Deploy providerRegistry
  console.log("\nDeploying providerRegistry...");
  const TEAM_WALLET = process.env.TEAM_WALLET || deployer.address;
  const TREASURY_WALLET = process.env.TREASURY_WALLET || deployer.address;
  const providerRegistry = await ethers.getContractFactory("providerRegistry");
  const providerRegistry = await providerRegistry.deploy(cldTokenAddress, TEAM_WALLET, TREASURY_WALLET);
  await providerRegistry.waitForDeployment();
  const providerRegistryAddress = await providerRegistry.getAddress();
  console.log("providerRegistry deployed to:", providerRegistryAddress);
  console.log("Team Wallet:", TEAM_WALLET);
  console.log("Treasury Wallet:", TREASURY_WALLET);

  // Grant roles
  console.log("\nGranting roles...");
  const MINTER_ROLE = await cldToken.MINTER_ROLE();
  await cldToken.grantRole(MINTER_ROLE, deployer.address);
  console.log("Granted MINTER_ROLE to deployer");

  const VALIDATOR_ADDRESS = process.env.VALIDATOR_ADDRESS || deployer.address;
  const VALIDATOR_ROLE = await jobEscrow.VALIDATOR_ROLE();
  await jobEscrow.grantRole(VALIDATOR_ROLE, VALIDATOR_ADDRESS);
  console.log(`Granted VALIDATOR_ROLE to ${VALIDATOR_ADDRESS}`);

  // Get network info
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const networkName = network.name === "unknown" ? "baseSepolia" : network.name;

  // Prepare addresses object
  const addresses = {
    chainId,
    network: networkName,
    contracts: {
      CLDToken: cldTokenAddress,
      ProviderRegistry: providerRegistryAddress,
      JobEscrow: jobEscrowAddress,
      providerRegistry: providerRegistryAddress,
    },
    roles: {
      minter: deployer.address,
      validator: VALIDATOR_ADDRESS,
    },
  };

  // Write addresses to shared folder
  const sharedDir = path.join(__dirname, "../../shared");
  if (!fs.existsSync(sharedDir)) {
    fs.mkdirSync(sharedDir, { recursive: true });
  }

  const addressesFile = path.join(sharedDir, `addresses.${networkName}.json`);
  fs.writeFileSync(addressesFile, JSON.stringify(addresses, null, 2));
  console.log(`\nAddresses written to ${addressesFile}`);

  // Export ABIs
  const abiDir = path.join(sharedDir, "abi");
  if (!fs.existsSync(abiDir)) {
    fs.mkdirSync(abiDir, { recursive: true });
  }

  const cldTokenArtifact = await ethers.getContractFactory("CLDToken");
  const providerRegistryArtifact = await ethers.getContractFactory("ProviderRegistry");
  const jobEscrowArtifact = await ethers.getContractFactory("JobEscrow");
  const providerRegistryArtifact = await ethers.getContractFactory("providerRegistry");

  // Read compiled artifacts
  const artifactsPath = path.join(__dirname, "../artifacts/contracts");
  const cldTokenAbi = JSON.parse(
    fs.readFileSync(path.join(artifactsPath, "CLDToken.sol/CLDToken.json"), "utf8")
  ).abi;
  const providerRegistryAbi = JSON.parse(
    fs.readFileSync(
      path.join(artifactsPath, "ProviderRegistry.sol/ProviderRegistry.json"),
      "utf8"
    )
  ).abi;
  const jobEscrowAbi = JSON.parse(
    fs.readFileSync(path.join(artifactsPath, "JobEscrow.sol/JobEscrow.json"), "utf8")
  ).abi;
  const ProviderRegistryAbi = JSON.parse(
    fs.readFileSync(path.join(artifactsPath, "providerRegistry.sol/providerRegistry.json"), "utf8")
  ).abi;

  fs.writeFileSync(path.join(abiDir, "CLDToken.json"), JSON.stringify(cldTokenAbi, null, 2));
  fs.writeFileSync(
    path.join(abiDir, "ProviderRegistry.json"),
    JSON.stringify(providerRegistryAbi, null, 2)
  );
  fs.writeFileSync(path.join(abiDir, "JobEscrow.json"), JSON.stringify(jobEscrowAbi, null, 2));
  fs.writeFileSync(path.join(abiDir, "providerRegistry.json"), JSON.stringify(ProviderRegistryAbi, null, 2));
  console.log(`ABIs exported to ${abiDir}`);

  // Write EIP-712 schema
  const eip712Dir = path.join(sharedDir, "eip712");
  if (!fs.existsSync(eip712Dir)) {
    fs.mkdirSync(eip712Dir, { recursive: true });
  }

  const eip712Schema = {
    domain: {
      name: "CloudanaJobEscrow",
      version: "1",
      chainId: chainId,
      verifyingContract: jobEscrowAddress,
    },
    types: {
      UsageReport: [
        { name: "jobId", type: "uint256" },
        { name: "user", type: "address" },
        { name: "provider", type: "address" },
        { name: "grossCost", type: "uint256" },
        { name: "providerEarn", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
  };

  fs.writeFileSync(
    path.join(eip712Dir, "usageReport.json"),
    JSON.stringify(eip712Schema, null, 2)
  );
  console.log(`EIP-712 schema written to ${path.join(eip712Dir, "usageReport.json")}`);

  console.log("\n=== Deployment Summary ===");
  console.log("CLDToken:", cldTokenAddress);
  console.log("ProviderRegistry:", providerRegistryAddress);
  console.log("JobEscrow:", jobEscrowAddress);
  console.log("providerRegistry:", providerRegistryAddress);
  console.log("Team Wallet:", TEAM_WALLET);
  console.log("Treasury Wallet:", TREASURY_WALLET);
  console.log("Validator:", VALIDATOR_ADDRESS);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

