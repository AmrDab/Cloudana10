#!/usr/bin/env node

import { ProviderNode, ProviderConfig } from './provider-node';
import { LogLevel } from './logger';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
  console.log('🌊 Cloudana Provider Node v1.0.0');
  console.log('=====================================');

  // Configuration from environment variables
  const config: ProviderConfig = {
    // Chain configuration
    rpcUrl: process.env.RPC_URL || 'https://sepolia.base.org',
    privateKey: process.env.PROVIDER_PRIVATE_KEY || '',
    workloadRegistryAddress: process.env.WORKLOAD_REGISTRY_ADDRESS || '',
    cldTokenAddress: process.env.CLD_TOKEN_ADDRESS || '',
    
    // Provider configuration
    maxConcurrentJobs: parseInt(process.env.MAX_CONCURRENT_JOBS || '3'),
    workDirectory: process.env.WORK_DIRECTORY || '/tmp/cloudana-provider',
    
    // Logging
    logLevel: process.env.LOG_LEVEL === 'debug' ? LogLevel.DEBUG : LogLevel.INFO
  };

  // Validate configuration
  if (!config.privateKey) {
    console.error('❌ Error: PROVIDER_PRIVATE_KEY environment variable is required');
    process.exit(1);
  }

  if (!config.workloadRegistryAddress) {
    console.error('❌ Error: WORKLOAD_REGISTRY_ADDRESS environment variable is required');
    process.exit(1);
  }

  if (!config.cldTokenAddress) {
    console.error('❌ Error: CLD_TOKEN_ADDRESS environment variable is required');
    process.exit(1);
  }

  // Create and start provider node
  const provider = new ProviderNode(config);

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🔄 Shutting down provider node...');
    await provider.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n🔄 Shutting down provider node...');
    await provider.stop();
    process.exit(0);
  });

  try {
    await provider.start();
    
    // Display status
    console.log('✅ Provider node started successfully!');
    console.log(`📍 Provider Address: ${provider.getAddress()}`);
    console.log(`🔧 Max Concurrent Jobs: ${config.maxConcurrentJobs}`);
    console.log(`📁 Work Directory: ${config.workDirectory}`);
    console.log('🎯 Listening for jobs...\n');

    // Keep the process alive and show periodic stats
    setInterval(() => {
      const stats = provider.getStats();
      console.log(`\n📊 Provider Stats:`);
      console.log(`   Active Jobs: ${stats.currentJobs}`);
      console.log(`   Total Executed: ${stats.totalJobsExecuted}`);
      console.log(`   Success Rate: ${stats.totalJobsExecuted > 0 ? ((stats.successfulJobs / stats.totalJobsExecuted) * 100).toFixed(1) : 0}%`);
      console.log(`   Total Earnings: ${parseFloat(stats.totalEarnings).toFixed(4)} CLD`);
      console.log(`   Uptime: ${Math.floor(stats.uptime / 3600)}h ${Math.floor((stats.uptime % 3600) / 60)}m`);
    }, 60000); // Show stats every minute

  } catch (error) {
    console.error('❌ Failed to start provider node:', error);
    process.exit(1);
  }
}

// Export components for use as library
export { ProviderNode, ProviderConfig } from './provider-node';
export { ExecutionEngine, WorkloadSpec, ExecutionResult } from './execution-engine';
export { ChainInterface, JobDetails } from './chain-interface';
export { Logger, LogLevel } from './logger';

// Run main function if this is the entry point
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Unhandled error:', error);
    process.exit(1);
  });
}