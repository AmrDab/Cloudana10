import { ethers, upgrades } from "hardhat";

async function main() {
  console.log("🚀 Deploying Cloudana MVP Contracts...");
  
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log("Account balance:", ethers.utils.formatEther(await deployer.getBalance()), "ETH");

  // 1. Deploy CLD Token
  console.log("\n1. Deploying CLD Token...");
  const CLDToken = await ethers.getContractFactory("CLDToken");
  const cldToken = await CLDToken.deploy();
  await cldToken.deployed();
  console.log("✅ CLD Token deployed to:", cldToken.address);

  // Initial CLD distribution
  const initialSupply = ethers.utils.parseUnits("1000000", 18); // 1M CLD
  console.log("Initial supply:", ethers.utils.formatUnits(await cldToken.totalSupply(), 18), "CLD");

  // 2. Deploy WorkloadRegistry V2 (Upgradeable)
  console.log("\n2. Deploying WorkloadRegistry V2...");
  const WorkloadRegistryV2 = await ethers.getContractFactory("WorkloadRegistryV2");
  
  const platformFeeBps = 250; // 2.5%
  const feeCollector = deployer.address; // For MVP, deployer collects fees
  
  const workloadRegistry = await upgrades.deployProxy(
    WorkloadRegistryV2,
    [cldToken.address, platformFeeBps, feeCollector],
    { initializer: 'initialize' }
  );
  await workloadRegistry.deployed();
  console.log("✅ WorkloadRegistry V2 deployed to:", workloadRegistry.address);

  // 3. Grant necessary permissions
  console.log("\n3. Setting up permissions...");
  
  // Grant minter role to registry for potential future rewards
  const MINTER_ROLE = await cldToken.MINTER_ROLE();
  await cldToken.grantRole(MINTER_ROLE, workloadRegistry.address);
  console.log("✅ Granted MINTER_ROLE to WorkloadRegistry");

  // 4. Distribute initial CLD for testing
  console.log("\n4. Distributing test CLD tokens...");
  
  // Create test accounts for providers and users
  const testAccounts = [
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", // Hardhat account #1
    "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", // Hardhat account #2  
    "0x90F79bf6EB2c4f870365E785982E1f101E93b906", // Hardhat account #3
  ];
  
  for (const account of testAccounts) {
    const amount = ethers.utils.parseUnits("10000", 18); // 10K CLD each
    try {
      await cldToken.transfer(account, amount);
      console.log(`✅ Sent ${ethers.utils.formatUnits(amount, 18)} CLD to ${account}`);
    } catch (error) {
      console.log(`⚠️  Failed to send CLD to ${account}: ${error.message}`);
    }
  }

  // 5. Verify deployments
  console.log("\n5. Verifying deployments...");
  
  const registryJobCount = await workloadRegistry.getJobCount();
  const platformFee = await workloadRegistry.platformFeeBps();
  const tokenBalance = await cldToken.balanceOf(deployer.address);
  
  console.log("✅ Registry job count:", registryJobCount.toString());
  console.log("✅ Platform fee:", platformFee.toString(), "bps (", (platformFee.toNumber() / 100).toFixed(2), "%)");
  console.log("✅ Deployer CLD balance:", ethers.utils.formatUnits(tokenBalance, 18));

  // 6. Create test workloads for demonstration
  console.log("\n6. Creating test workloads...");
  
  const testSpecs = [
    {
      name: "nginx-web-server",
      specHash: ethers.utils.keccak256(ethers.utils.toUtf8Bytes(JSON.stringify({
        containerImage: "nginx:alpine",
        resources: { cpu: 1, memory: "1Gi", storage: "5Gi" },
        ports: [80],
        timeout: 86400,
        payment: "100"
      }))),
      payment: ethers.utils.parseUnits("100", 18)
    },
    {
      name: "nodejs-api", 
      specHash: ethers.utils.keccak256(ethers.utils.toUtf8Bytes(JSON.stringify({
        containerImage: "node:18-alpine",
        command: ["npm", "start"],
        resources: { cpu: 2, memory: "2Gi", storage: "10Gi" },
        ports: [3000],
        timeout: 86400,
        payment: "200"
      }))),
      payment: ethers.utils.parseUnits("200", 18)
    }
  ];

  // Approve registry to spend CLD
  const totalTestPayment = testSpecs.reduce((sum, spec) => sum.add(spec.payment), ethers.BigNumber.from(0));
  await cldToken.approve(workloadRegistry.address, totalTestPayment);
  console.log("✅ Approved registry to spend", ethers.utils.formatUnits(totalTestPayment, 18), "CLD");

  // Create test workloads
  for (const spec of testSpecs) {
    try {
      const tx = await workloadRegistry.createWorkload(spec.specHash, spec.payment);
      const receipt = await tx.wait();
      console.log(`✅ Created test workload: ${spec.name} (tx: ${receipt.transactionHash})`);
    } catch (error) {
      console.log(`⚠️  Failed to create ${spec.name}: ${error.message}`);
    }
  }

  // 7. Display summary
  console.log("\n" + "=".repeat(60));
  console.log("🎉 CLOUDANA MVP DEPLOYMENT COMPLETE!");
  console.log("=".repeat(60));
  console.log("📍 Contract Addresses:");
  console.log("   CLD Token:", cldToken.address);
  console.log("   WorkloadRegistry V2:", workloadRegistry.address);
  console.log("");
  console.log("💰 Token Distribution:");
  console.log("   Total Supply:", ethers.utils.formatUnits(await cldToken.totalSupply(), 18), "CLD");
  console.log("   Deployer Balance:", ethers.utils.formatUnits(await cldToken.balanceOf(deployer.address), 18), "CLD");
  console.log("");
  console.log("⚙️  Configuration:");
  console.log("   Platform Fee:", (platformFeeBps / 100).toFixed(2) + "%");
  console.log("   Fee Collector:", feeCollector);
  console.log("   Test Jobs Created:", testSpecs.length);
  console.log("");
  console.log("🔧 Next Steps:");
  console.log("   1. Update frontend with new contract addresses");
  console.log("   2. Deploy provider nodes with new registry address");
  console.log("   3. Start processing test workloads");
  console.log("   4. Monitor platform fees and provider earnings");
  console.log("");
  console.log("🌐 Network:", (await ethers.provider.getNetwork()).name);
  console.log("📊 Gas Used: ~", receipt?.gasUsed ? receipt.gasUsed.toString() : "N/A");

  // 8. Create .env template for provider nodes
  const envTemplate = `# Cloudana Provider Node Configuration - Generated ${new Date().toISOString()}

# Blockchain Configuration
RPC_URL=https://sepolia.base.org
PROVIDER_PRIVATE_KEY=your_provider_wallet_private_key_here
WORKLOAD_REGISTRY_ADDRESS=${workloadRegistry.address}
CLD_TOKEN_ADDRESS=${cldToken.address}

# Provider Configuration  
MAX_CONCURRENT_JOBS=3
WORK_DIRECTORY=/tmp/cloudana-provider

# IPFS Configuration (Optional)
PINATA_JWT=your_pinata_jwt_here
PINATA_GATEWAY=https://your-gateway.mypinata.cloud

# Logging
LOG_LEVEL=info
`;

  const fs = require('fs');
  const path = require('path');
  const envPath = path.join(__dirname, '../../provider-node-sdk/.env.example');
  
  try {
    fs.writeFileSync(envPath, envTemplate);
    console.log("✅ Created provider environment template:", envPath);
  } catch (error) {
    console.log("⚠️  Could not create .env template:", error.message);
  }

  // 9. Create frontend config
  const frontendConfig = {
    contracts: {
      cldToken: {
        address: cldToken.address,
        abi: "CLDToken"
      },
      workloadRegistry: {
        address: workloadRegistry.address, 
        abi: "WorkloadRegistryV2"
      }
    },
    network: {
      chainId: (await ethers.provider.getNetwork()).chainId,
      name: (await ethers.provider.getNetwork()).name,
      rpcUrl: "https://sepolia.base.org"
    },
    config: {
      platformFeeBps: platformFeeBps,
      feeCollector: feeCollector
    }
  };

  const configPath = path.join(__dirname, '../../client/src/lib/deployed-contracts.json');
  try {
    fs.writeFileSync(configPath, JSON.stringify(frontendConfig, null, 2));
    console.log("✅ Created frontend config:", configPath);
  } catch (error) {
    console.log("⚠️  Could not create frontend config:", error.message);
  }

  console.log("\n🚀 Ready to start earning CLD! Deploy providers and create jobs.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });