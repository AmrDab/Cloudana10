#!/usr/bin/env node

import SimpleBridgeApiServer from './simple-bridge-api';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
  console.log('🌊 Cloudana-Akash Bridge (Simple Version) Starting...');
  console.log('===================================================');

  try {
    const config = {
      port: parseInt(process.env.PORT || '3001'),
      corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:7003',
      mockMode: process.env.MOCK_MODE !== 'false', // Default to mock mode
      consoleApiUrl: process.env.CONSOLE_API_URL,
      consoleApiKey: process.env.CONSOLE_API_KEY
    };

    console.log('Configuration:');
    console.log('  Port:', config.port);
    console.log('  CORS Origin:', config.corsOrigin);
    console.log('  Mock Mode:', config.mockMode ? 'ENABLED (safe for testing)' : 'DISABLED (real Akash)');
    
    if (config.mockMode) {
      console.log('\n⚠️  Running in MOCK MODE - no real Akash deployments');
      console.log('   Set MOCK_MODE=false in .env to enable real Akash integration');
    }
    
    const apiServer = new SimpleBridgeApiServer(config);
    await apiServer.start();

  } catch (error) {
    console.error('❌ Bridge startup failed:', error instanceof Error ? error.message : String(error));
    console.log('\n💡 To run in safe mock mode:');
    console.log('  No environment variables needed!');
    console.log('  Just run: npm run dev');
    console.log('\n💡 For real Akash integration:');
    console.log('  Set MOCK_MODE=false in .env');
    console.log('  Add CONSOLE_API_KEY for Akash Console');
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🔄 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

// Run main function
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}