/**
 * Test script to verify RPC transport configuration
 * Usage: tsx scripts/test-rpc-transport.ts
 */
import { createPublicClient, http, webSocket, fallback } from "viem";
import { baseSepolia } from "viem/chains";

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  dim: '\x1b[2m',
};

function log(color: keyof typeof COLORS, ...args: any[]) {
  console.log(COLORS[color], ...args, COLORS.reset);
}

async function testHttpTransport(url: string): Promise<boolean> {
  log('blue', '\n🔍 Testing HTTP Transport...');
  log('dim', `   URL: ${url}`);
  
  try {
    const client = createPublicClient({
      chain: baseSepolia,
      transport: http(url),
    });
    
    const blockNumber = await client.getBlockNumber();
    log('green', `   ✅ HTTP transport working! Latest block: ${blockNumber}`);
    return true;
  } catch (error: any) {
    log('red', `   ❌ HTTP transport failed: ${error.message}`);
    return false;
  }
}

async function testWebSocketTransport(url: string): Promise<boolean> {
  log('blue', '\n🔍 Testing WebSocket Transport...');
  log('dim', `   URL: ${url}`);
  
  try {
    const client = createPublicClient({
      chain: baseSepolia,
      transport: webSocket(url, {
        reconnect: true,
        retryCount: 2,
        retryDelay: 1000,
      }),
    });
    
    const blockNumber = await client.getBlockNumber();
    log('green', `   ✅ WebSocket transport working! Latest block: ${blockNumber}`);
    
    // Test event subscription
    log('dim', '   Testing event subscription (10 seconds)...');
    let eventReceived = false;
    
    const unwatch = client.watchBlockNumber({
      onBlockNumber: (number) => {
        log('green', `   ✅ Block event received: ${number}`);
        eventReceived = true;
      },
    });
    
    // Wait 10 seconds for at least one block
    await new Promise(resolve => setTimeout(resolve, 10000));
    unwatch();
    
    if (eventReceived) {
      log('green', '   ✅ WebSocket event subscription working!');
    } else {
      log('yellow', '   ⚠️  No events received (may need to wait longer)');
    }
    
    return true;
  } catch (error: any) {
    log('red', `   ❌ WebSocket transport failed: ${error.message}`);
    return false;
  }
}

async function testHybridTransport(httpUrl: string, wssUrl: string): Promise<boolean> {
  log('blue', '\n🔍 Testing Hybrid Transport (WebSocket + HTTP fallback)...');
  log('dim', `   Primary (WSS): ${wssUrl}`);
  log('dim', `   Fallback (HTTP): ${httpUrl}`);
  
  try {
    const client = createPublicClient({
      chain: baseSepolia,
      transport: fallback([
        webSocket(wssUrl, {
          reconnect: true,
          retryCount: 1,
          retryDelay: 1000,
        }),
        http(httpUrl),
      ]),
    });
    
    const blockNumber = await client.getBlockNumber();
    log('green', `   ✅ Hybrid transport working! Latest block: ${blockNumber}`);
    return true;
  } catch (error: any) {
    log('red', `   ❌ Hybrid transport failed: ${error.message}`);
    return false;
  }
}

async function main() {
  log('blue', '═══════════════════════════════════════════════════');
  log('blue', '  Cloudana RPC Transport Test');
  log('blue', '═══════════════════════════════════════════════════');
  
  const rpcUrl = process.env.ORCHESTRATOR_CHAIN_RPC_URL || process.env.RPC_URL || 'https://sepolia.base.org';
  const wssUrl = process.env.ORCHESTRATOR_CHAIN_WSS_URL || '';
  const transportMode = process.env.ORCHESTRATOR_RPC_TRANSPORT || 'http';
  
  log('dim', `\nConfiguration from environment:`);
  log('dim', `  Transport mode: ${transportMode}`);
  log('dim', `  HTTP URL: ${rpcUrl}`);
  log('dim', `  WSS URL: ${wssUrl || '(not set)'}`);
  
  const results: { mode: string; success: boolean }[] = [];
  
  // Test based on configured mode
  switch (transportMode) {
    case 'http': {
      const success = await testHttpTransport(rpcUrl);
      results.push({ mode: 'HTTP', success });
      break;
    }
    
    case 'websocket': {
      if (!wssUrl) {
        log('red', '\n❌ WebSocket mode selected but ORCHESTRATOR_CHAIN_WSS_URL not set!');
        results.push({ mode: 'WebSocket', success: false });
      } else {
        const success = await testWebSocketTransport(wssUrl);
        results.push({ mode: 'WebSocket', success });
      }
      break;
    }
    
    case 'hybrid': {
      if (!wssUrl) {
        log('red', '\n❌ Hybrid mode selected but ORCHESTRATOR_CHAIN_WSS_URL not set!');
        log('yellow', '   Falling back to HTTP only...');
        const success = await testHttpTransport(rpcUrl);
        results.push({ mode: 'Hybrid (HTTP only)', success });
      } else {
        const success = await testHybridTransport(rpcUrl, wssUrl);
        results.push({ mode: 'Hybrid', success });
      }
      break;
    }
    
    default: {
      log('red', `\n❌ Unknown transport mode: ${transportMode}`);
      log('yellow', '   Valid modes: http, websocket, hybrid');
      results.push({ mode: transportMode, success: false });
    }
  }
  
  // Summary
  log('blue', '\n═══════════════════════════════════════════════════');
  log('blue', '  Test Summary');
  log('blue', '═══════════════════════════════════════════════════\n');
  
  results.forEach(({ mode, success }) => {
    if (success) {
      log('green', `✅ ${mode} transport: PASSED`);
    } else {
      log('red', `❌ ${mode} transport: FAILED`);
    }
  });
  
  const allPassed = results.every(r => r.success);
  
  if (allPassed) {
    log('green', '\n✅ All tests passed! RPC transport is configured correctly.');
    log('dim', '   You can now start the orchestrator with confidence.\n');
    process.exit(0);
  } else {
    log('red', '\n❌ Some tests failed. Please check your RPC configuration.');
    log('yellow', '   See client/api/RPC_TRANSPORT_GUIDE.md for troubleshooting.\n');
    process.exit(1);
  }
}

main().catch((error) => {
  log('red', '\n💥 Fatal error:', error.message);
  process.exit(1);
});
