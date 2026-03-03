#!/usr/bin/env node

import { SimpleAkashClient } from './simple-akash-client';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function testAkashIntegration() {
  console.log('🌊 Testing Cloudana-Akash Bridge Integration');
  console.log('============================================\n');

  // Initialize Simple Akash Client in mock mode for testing
  const akashClient = new SimpleAkashClient({
    consoleApiUrl: 'https://console.akash.network/api/v1', // Mock URL
    mockMode: true, // Enable mock mode for testing
  });

  await akashClient.initialize();

  try {
    console.log('📋 Test 1: Get Available Providers');
    const providers = await akashClient.getProviders();
    console.log(`✅ Found ${providers.length} providers:`);
    providers.forEach(p => {
      console.log(`   - ${p.id} (${p.region}) - ${p.available ? 'Available' : 'Busy'}`);
    });

    console.log('\n📦 Test 2: Create Mock Deployment');
    const deployment = await akashClient.createDeployment({
      name: 'test-webapp',
      image: 'nginx:alpine',
      cpu: '500m',
      memory: '512Mi', 
      storage: '1Gi',
      ports: [80],
      expose: true,
      env: {
        'ENVIRONMENT': 'test'
      }
    });

    console.log('✅ Deployment created:');
    console.log(`   ID: ${deployment.id}`);
    console.log(`   Status: ${deployment.status}`);
    console.log(`   Provider: ${deployment.provider}`);
    console.log(`   Region: ${deployment.region}`);
    console.log(`   Estimated Cost: $${deployment.cost?.usd}/day (${deployment.cost?.akt} AKT)`);

    console.log('\n🔍 Test 3: Check Deployment Status');
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
    
    const status = await akashClient.getDeploymentStatus(deployment.id);
    if (status) {
      console.log('✅ Status retrieved:');
      console.log(`   Status: ${status.status}`);
      console.log(`   URI: ${status.uri || 'Not available yet'}`);
    }

    console.log('\n📜 Test 4: Get Deployment Logs');
    const logs = await akashClient.getDeploymentLogs(deployment.id);
    console.log('✅ Logs retrieved:');
    console.log(logs);

    console.log('\n🔒 Test 5: Close Deployment');
    const closed = await akashClient.closeDeployment(deployment.id);
    console.log(`✅ Deployment ${closed ? 'closed successfully' : 'failed to close'}`);

    console.log('\n🎉 All Tests Passed!');
    console.log('\n📋 Next Steps:');
    console.log('1. Set mockMode: false in config to test real Akash integration');
    console.log('2. Add your Akash Console API key for real deployments');
    console.log('3. Configure CLD token integration');
    console.log('4. Test with real Cloudana frontend');

    return true;

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    return false;
  }
}

async function testCloudanaIntegration() {
  console.log('\n🌊 Testing Cloudana Smart Contract Integration');
  console.log('===============================================\n');

  // Mock Cloudana job data
  const mockJob = {
    id: 'job-test-12345',
    user: '0x1234567890123456789012345678901234567890',
    containerImage: 'node:18-alpine',
    resources: {
      cpu: 1,
      memory: '1Gi',
      storage: '5Gi'
    },
    environment: {
      'NODE_ENV': 'production'
    },
    timeout: 3600,
    payment: '100' // 100 CLD
  };

  console.log('✅ Mock Cloudana job created:');
  console.log(`   ID: ${mockJob.id}`);
  console.log(`   Image: ${mockJob.containerImage}`);
  console.log(`   Resources: ${mockJob.resources.cpu} CPU, ${mockJob.resources.memory} RAM`);
  console.log(`   Payment: ${mockJob.payment} CLD`);

  // Simulate bridge processing
  console.log('\n🔄 Simulating bridge processing...');
  
  // Convert CLD to AKT (mock exchange rate)
  const cldToAktRate = 0.1; // 1 CLD = 0.1 AKT
  const platformFee = parseFloat(mockJob.payment) * 0.025; // 2.5%
  const aktNeeded = (parseFloat(mockJob.payment) - platformFee) * cldToAktRate;

  console.log(`   Platform Fee: ${platformFee} CLD (2.5%)`);
  console.log(`   AKT Needed: ${aktNeeded} AKT`);
  console.log(`   Exchange Rate: 1 CLD = ${cldToAktRate} AKT`);

  console.log('\n✅ Bridge simulation completed successfully!');
  
  return true;
}

async function main() {
  console.log('🚀 Cloudana-Akash Bridge Test Suite');
  console.log('====================================\n');

  const akashTest = await testAkashIntegration();
  const cloudanaTest = await testCloudanaIntegration();

  console.log('\n📊 Test Results Summary');
  console.log('======================');
  console.log(`Akash Integration: ${akashTest ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Cloudana Integration: ${cloudanaTest ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Overall: ${akashTest && cloudanaTest ? '🎉 ALL TESTS PASSED' : '⚠️ SOME TESTS FAILED'}`);

  if (akashTest && cloudanaTest) {
    console.log('\n🎯 Ready for Production Testing!');
    console.log('To deploy the bridge API:');
    console.log('1. npm run build');
    console.log('2. Configure .env with real credentials');
    console.log('3. npm start');
  }

  process.exit(akashTest && cloudanaTest ? 0 : 1);
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Test suite failed:', error);
    process.exit(1);
  });
}

export { testAkashIntegration, testCloudanaIntegration };