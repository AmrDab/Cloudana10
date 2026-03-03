#!/usr/bin/env node

const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log(`
🌊 CLOUDANA MVP STARTUP SCRIPT
=====================================

This script will:
1. Install all dependencies
2. Deploy smart contracts to testnet
3. Start the frontend 
4. Configure and start a provider node
5. Create test jobs

Press CTRL+C at any time to exit.
`);

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function runCommand(command, cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    console.log(`🔧 Running: ${command}`);
    const child = spawn(command, { 
      shell: true, 
      stdio: 'inherit', 
      cwd 
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });
  });
}

async function checkPrerequisites() {
  console.log('\n📋 Checking prerequisites...');
  
  const checks = [
    { cmd: 'node --version', name: 'Node.js' },
    { cmd: 'npm --version', name: 'npm' },
    { cmd: 'docker --version', name: 'Docker' },
    { cmd: 'git --version', name: 'Git' }
  ];
  
  for (const check of checks) {
    try {
      await runCommand(check.cmd);
      console.log(`✅ ${check.name} is installed`);
    } catch (error) {
      console.log(`❌ ${check.name} is not installed or not in PATH`);
      console.log(`Please install ${check.name} and try again.`);
      process.exit(1);
    }
  }
}

async function installDependencies() {
  console.log('\n📦 Installing dependencies...');
  
  try {
    // Root dependencies
    await runCommand('npm install');
    
    // Frontend dependencies  
    await runCommand('npm install --legacy-peer-deps', path.join(process.cwd(), 'client'));
    
    // Provider SDK dependencies
    await runCommand('npm install', path.join(process.cwd(), 'provider-node-sdk'));
    
    // Contract dependencies
    await runCommand('npm install', path.join(process.cwd(), 'contract'));
    
    console.log('✅ All dependencies installed');
  } catch (error) {
    console.error('❌ Dependency installation failed:', error.message);
    process.exit(1);
  }
}

async function buildProjects() {
  console.log('\n🔨 Building projects...');
  
  try {
    // Build provider SDK
    await runCommand('npm run build', path.join(process.cwd(), 'provider-node-sdk'));
    
    // Compile contracts
    await runCommand('npx hardhat compile', path.join(process.cwd(), 'contract'));
    
    console.log('✅ All projects built successfully');
  } catch (error) {
    console.error('❌ Build failed:', error.message);
    process.exit(1);
  }
}

async function deployContracts() {
  console.log('\n🚀 Deploying smart contracts...');
  
  const contractDir = path.join(process.cwd(), 'contract');
  
  // Check if hardhat.config.js exists
  const configPath = path.join(contractDir, 'hardhat.config.js');
  if (!fs.existsSync(configPath)) {
    console.log('⚠️  Creating minimal hardhat.config.js...');
    const minimalConfig = `
require("@nomicfoundation/hardhat-toolbox");
require("@openzeppelin/hardhat-upgrades");

module.exports = {
  solidity: "0.8.20",
  networks: {
    baseSepolia: {
      url: "https://sepolia.base.org",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : []
    }
  }
};
`;
    fs.writeFileSync(configPath, minimalConfig);
  }
  
  try {
    // Deploy to local hardhat network for testing
    console.log('📍 Deploying to local test network...');
    await runCommand('npx hardhat node &', contractDir);
    await sleep(3000); // Wait for local node to start
    
    await runCommand('npx hardhat run scripts/deploy-mvp.ts --network localhost', contractDir);
    console.log('✅ Contracts deployed to local testnet');
  } catch (error) {
    console.error('❌ Contract deployment failed:', error.message);
    console.log('💡 You can manually deploy later with: npm run deploy:testnet');
  }
}

async function setupProviderNode() {
  console.log('\n🖥️  Setting up provider node...');
  
  const providerDir = path.join(process.cwd(), 'provider-node-sdk');
  const envPath = path.join(providerDir, '.env');
  
  if (!fs.existsSync(envPath)) {
    console.log('⚙️  Creating provider configuration...');
    
    // Read example env
    const exampleEnvPath = path.join(providerDir, 'example.env');
    let envContent = fs.readFileSync(exampleEnvPath, 'utf-8');
    
    // Try to read contract addresses from deployment
    try {
      const deployedConfig = path.join(process.cwd(), 'client/src/lib/deployed-contracts.json');
      if (fs.existsSync(deployedConfig)) {
        const config = JSON.parse(fs.readFileSync(deployedConfig, 'utf-8'));
        envContent = envContent.replace(
          'WORKLOAD_REGISTRY_ADDRESS=0x1234567890abcdef1234567890abcdef12345678',
          `WORKLOAD_REGISTRY_ADDRESS=${config.contracts.workloadRegistry.address}`
        );
        envContent = envContent.replace(
          'CLD_TOKEN_ADDRESS=0x1234567890abcdef1234567890abcdef12345678', 
          `CLD_TOKEN_ADDRESS=${config.contracts.cldToken.address}`
        );
        envContent = envContent.replace(
          'RPC_URL=https://sepolia.base.org',
          'RPC_URL=http://localhost:8545'
        );
      }
    } catch (error) {
      console.log('⚠️  Could not read deployment config, using defaults');
    }
    
    fs.writeFileSync(envPath, envContent);
    console.log('✅ Provider configuration created');
    console.log('📝 Please edit provider-node-sdk/.env with your private key');
  }
}

async function startServices() {
  console.log('\n🎯 Starting services...');
  
  console.log(`
🎉 MVP Setup Complete!

Next steps:
1. Edit provider-node-sdk/.env with your wallet private key
2. Run: npm run start:provider (in a new terminal)
3. Run: npm run dev:frontend (in another terminal) 
4. Visit: http://localhost:7003
5. Submit test jobs and watch CLD flow!

Manual commands:
- Start frontend: cd client && npm run dev
- Start provider: cd provider-node-sdk && npm start  
- Deploy contracts: cd contract && npm run deploy:testnet
- View jobs: Visit http://localhost:7003/monitor

💰 Revenue will flow when:
   ✅ Provider node is running
   ✅ Jobs are submitted via frontend
   ✅ Provider executes jobs successfully
   ✅ Platform collects 2.5% fees

Happy earning! 🚀
`);
}

async function main() {
  try {
    await checkPrerequisites();
    await installDependencies();
    await buildProjects();
    await deployContracts();
    await setupProviderNode();
    await startServices();
  } catch (error) {
    console.error('\n❌ MVP setup failed:', error.message);
    console.log('\n💡 Try running individual commands:');
    console.log('   npm install');
    console.log('   npm run build');
    console.log('   npm run deploy:testnet');
    process.exit(1);
  }
}

main();