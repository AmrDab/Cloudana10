#!/usr/bin/env node
/**
 * Simple script to deploy a game manifest to the provider node server
 * Usage: node deploy-manifest.js <manifest-file>
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const PROVIDER_URL = process.env.PROVIDER_NODE_URL || 'http://localhost:4040';

async function deployManifest(manifestPath) {
  try {
    console.log(`📄 Reading manifest: ${manifestPath}`);
    const manifestContent = readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestContent);
    
    console.log(`📤 Deploying to ${PROVIDER_URL}/deploy`);
    console.log(`   Workload ID: ${manifest.workloadId}`);
    console.log(`   Instance ID: ${manifest.instanceId}`);
    console.log(`   Namespace: ${manifest.namespace}`);
    
    const response = await fetch(`${PROVIDER_URL}/deploy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: manifestContent,
    });
    
    const result = await response.json();
    
    if (response.ok) {
      console.log('\n✅ Deploy successful!');
      console.log(JSON.stringify(result, null, 2));
      
      console.log('\n📋 Next steps:');
      console.log(`   Check status: curl ${PROVIDER_URL}/status?workloadId=${manifest.workloadId}&instanceId=${manifest.instanceId}`);
      console.log(`   View pods: kubectl -n ${manifest.namespace} get pods`);
      console.log(`   View service: kubectl -n ${manifest.namespace} get svc`);
    } else {
      console.error('\n❌ Deploy failed:');
      console.error(JSON.stringify(result, null, 2));
      process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

async function checkStatus(workloadId, instanceId = '1') {
  try {
    console.log(`📊 Checking status for workload ${workloadId}, instance ${instanceId}`);
    
    const response = await fetch(`${PROVIDER_URL}/status?workloadId=${workloadId}&instanceId=${instanceId}`);
    const result = await response.json();
    
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

async function checkHealth() {
  try {
    console.log(`🏥 Checking server health at ${PROVIDER_URL}`);
    
    const response = await fetch(`${PROVIDER_URL}/health`);
    const result = await response.json();
    
    console.log(JSON.stringify(result, null, 2));
    
    if (result.status === 'healthy') {
      console.log('\n✅ Server is healthy');
    }
  } catch (error) {
    console.error('\n❌ Server is not responding:', error.message);
    process.exit(1);
  }
}

// Main CLI handler
const command = process.argv[2];
const arg = process.argv[3];

if (!command) {
  console.log('Usage:');
  console.log('  node deploy-manifest.js deploy <manifest-file>');
  console.log('  node deploy-manifest.js status <workload-id>');
  console.log('  node deploy-manifest.js health');
  console.log('');
  console.log('Examples:');
  console.log('  node deploy-manifest.js deploy ../game-manifests/supermario.json');
  console.log('  node deploy-manifest.js status 1');
  console.log('  node deploy-manifest.js health');
  console.log('');
  console.log('Environment:');
  console.log(`  PROVIDER_NODE_URL=${PROVIDER_URL}`);
  process.exit(1);
}

switch (command) {
  case 'deploy':
    if (!arg) {
      console.error('❌ Manifest file required');
      process.exit(1);
    }
    deployManifest(resolve(arg));
    break;
  
  case 'status':
    if (!arg) {
      console.error('❌ Workload ID required');
      process.exit(1);
    }
    checkStatus(arg);
    break;
  
  case 'health':
    checkHealth();
    break;
  
  default:
    console.error(`❌ Unknown command: ${command}`);
    process.exit(1);
}
