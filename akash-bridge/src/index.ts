#!/usr/bin/env node

import BridgeApiServer from './bridge-api';
import { BridgeConfig } from './cloudana-akash-bridge';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} is required`);
  }
  return value;
}

function getOptionalEnv(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

async function main() {
  console.log('🌊 Cloudana-Akash Bridge Starting...');
  console.log('=====================================');

  try {
    // Build configuration from environment
    const config = {
      // API Server config
      port: parseInt(getOptionalEnv('PORT', '3001')),
      corsOrigin: getOptionalEnv('CORS_ORIGIN', 'http://localhost:7003'),
      
      // Ethereum/CLD config
      ethereumRpcUrl: getOptionalEnv('ETHEREUM_RPC_URL', 'https://sepolia.base.org'),
      cldTokenAddress: getRequiredEnv('CLD_TOKEN_ADDRESS'),
      workloadRegistryAddress: getRequiredEnv('WORKLOAD_REGISTRY_ADDRESS'),
      bridgePrivateKey: getRequiredEnv('BRIDGE_PRIVATE_KEY'),
      
      // Akash config
      akashRpcEndpoint: getOptionalEnv('AKASH_RPC_ENDPOINT', 'https://rpc.akash.forbole.com:443'),
      akashMnemonic: getRequiredEnv('AKASH_MNEMONIC'),
      akashChainId: getOptionalEnv('AKASH_CHAIN_ID', 'akashnet-2'),
      
      // Economic config
      exchangeRateProvider: getOptionalEnv('EXCHANGE_RATE_API', 'https://api.coingecko.com/api/v3/simple/price?ids=cloudana,akash-network&vs_currencies=usd'),
      platformFeeBps: parseInt(getOptionalEnv('PLATFORM_FEE_BPS', '250')) // 2.5%
    };

    console.log('Configuration loaded:');
    console.log('  API Port:', config.port);
    console.log('  CORS Origin:', config.corsOrigin);
    console.log('  Ethereum RPC:', config.ethereumRpcUrl);
    console.log('  Akash RPC:', config.akashRpcEndpoint);
    console.log('  Platform Fee:', (config.platformFeeBps / 100).toFixed(2) + '%');
    console.log('  CLD Token:', config.cldTokenAddress);
    console.log('  Registry:', config.workloadRegistryAddress);
    
    // Validate critical configuration
    await validateConfiguration(config);
    
    // Create and start API server
    const apiServer = new BridgeApiServer(config);
    await apiServer.start();

  } catch (error) {
    console.error('❌ Bridge startup failed:', error.message);
    console.log('\n💡 Required environment variables:');
    console.log('  BRIDGE_PRIVATE_KEY - Ethereum private key for bridge operations');
    console.log('  CLD_TOKEN_ADDRESS - Cloudana token contract address');
    console.log('  WORKLOAD_REGISTRY_ADDRESS - Cloudana registry contract');
    console.log('  AKASH_MNEMONIC - Akash wallet mnemonic phrase');
    console.log('\n📖 See .env.example for complete configuration');
    process.exit(1);
  }
}

async function validateConfiguration(config: any): Promise<void> {
  // Validate Ethereum private key format
  if (!config.bridgePrivateKey.startsWith('0x') || config.bridgePrivateKey.length !== 66) {
    throw new Error('BRIDGE_PRIVATE_KEY must be a valid hex private key (0x...)');
  }

  // Validate contract addresses
  if (!config.cldTokenAddress.startsWith('0x') || config.cldTokenAddress.length !== 42) {
    throw new Error('CLD_TOKEN_ADDRESS must be a valid Ethereum address');
  }

  if (!config.workloadRegistryAddress.startsWith('0x') || config.workloadRegistryAddress.length !== 42) {
    throw new Error('WORKLOAD_REGISTRY_ADDRESS must be a valid Ethereum address');
  }

  // Validate Akash mnemonic (should be 12 or 24 words)
  const mnemonicWords = config.akashMnemonic.trim().split(' ');
  if (![12, 24].includes(mnemonicWords.length)) {
    throw new Error('AKASH_MNEMONIC must be 12 or 24 words');
  }

  // Validate platform fee (max 10%)
  if (config.platformFeeBps < 0 || config.platformFeeBps > 1000) {
    throw new Error('PLATFORM_FEE_BPS must be between 0 and 1000 (0-10%)');
  }

  console.log('✅ Configuration validation passed');
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🔄 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🔄 Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

// Run if this is the main module
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}

export { BridgeApiServer };
export default main;