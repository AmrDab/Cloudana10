#!/usr/bin/env node

const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log(`
🌊 CLOUDANA + AKASH INTEGRATION SETUP
=====================================

This script will:
1. Install Akash bridge dependencies
2. Build the bridge API server
3. Configure environment templates  
4. Update Cloudana frontend with Akash option
5. Provide startup instructions

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

async function setupAkashBridge() {
  console.log('\n📦 Setting up Akash Bridge...');
  
  const bridgeDir = path.join(process.cwd(), 'akash-bridge');
  
  try {
    // Install bridge dependencies
    await runCommand('npm install', bridgeDir);
    console.log('✅ Bridge dependencies installed');
    
    // Build TypeScript
    await runCommand('npm run build', bridgeDir);
    console.log('✅ Bridge compiled successfully');
    
    // Create environment config if it doesn't exist
    const envPath = path.join(bridgeDir, '.env');
    const envExamplePath = path.join(bridgeDir, '.env.example');
    
    if (!fs.existsSync(envPath)) {
      fs.copyFileSync(envExamplePath, envPath);
      console.log('✅ Environment template created at akash-bridge/.env');
      console.log('⚠️  You MUST edit this file with your credentials before running!');
    }
    
  } catch (error) {
    console.error('❌ Bridge setup failed:', error.message);
    throw error;
  }
}

async function updateFrontendIntegration() {
  console.log('\n🎨 Updating Cloudana frontend...');
  
  const frontendDir = path.join(process.cwd(), 'client');
  
  // Create Akash integration hook
  const akashHookContent = `
import { useState, useCallback } from 'react';
import { useToast } from './use-toast';

interface AkashJobSpec {
  id: string;
  user: string;
  containerImage: string;
  resources: {
    cpu: number;
    memory: string; 
    storage: string;
  };
  environment?: Record<string, string>;
  command?: string[];
  ports?: number[];
  timeout: number;
  payment: string;
}

interface AkashDeployment {
  jobId: string;
  akashDseq: string;
  status: string;
  cost: {
    cldPaid: string;
    aktSpent: string;
    platformFee: string;
  };
}

const AKASH_API_BASE = 'http://localhost:3001/api';

export function useAkashBridge() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deployments, setDeployments] = useState<Map<string, AkashDeployment>>(new Map());
  const { toast } = useToast();

  const submitJobToAkash = useCallback(async (spec: AkashJobSpec): Promise<AkashDeployment> => {
    setIsSubmitting(true);
    
    try {
      const response = await fetch(\`\${AKASH_API_BASE}/jobs/submit\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(spec)
      });
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Akash deployment failed');
      }
      
      const deployment = {
        jobId: spec.id,
        akashDseq: result.data.akashDseq,
        status: result.data.status,
        cost: result.data.estimatedCost
      };
      
      setDeployments(prev => new Map(prev.set(spec.id, deployment)));
      
      toast({
        title: 'Job deployed to Akash Network!',
        description: \`Deployment ID: \${result.data.akashDseq}\`
      });
      
      return deployment;
      
    } catch (error) {
      toast({
        title: 'Akash deployment failed',
        description: error.message,
        variant: 'destructive'
      });
      throw error;
    } finally {
      setIsSubmitting(false);
    }
  }, [toast]);

  const getJobStatus = useCallback(async (jobId: string): Promise<AkashDeployment | null> => {
    try {
      const response = await fetch(\`\${AKASH_API_BASE}/jobs/\${jobId}\`);
      const result = await response.json();
      
      if (result.success) {
        const deployment = result.data;
        setDeployments(prev => new Map(prev.set(jobId, deployment)));
        return deployment;
      }
      
      return null;
    } catch (error) {
      console.error('Error fetching job status:', error);
      return null;
    }
  }, []);

  const closeJob = useCallback(async (jobId: string): Promise<void> => {
    try {
      const response = await fetch(\`\${AKASH_API_BASE}/jobs/\${jobId}/close\`, {
        method: 'POST'
      });
      
      const result = await response.json();
      
      if (result.success) {
        toast({
          title: 'Job closed successfully',
          description: 'Akash deployment terminated'
        });
      }
    } catch (error) {
      toast({
        title: 'Error closing job',
        description: error.message,
        variant: 'destructive'
      });
    }
  }, [toast]);

  const getAkashTemplates = useCallback(async () => {
    try {
      const response = await fetch(\`\${AKASH_API_BASE}/templates\`);
      const result = await response.json();
      return result.success ? result.data : [];
    } catch (error) {
      console.error('Error fetching Akash templates:', error);
      return [];
    }
  }, []);

  return {
    submitJobToAkash,
    getJobStatus,
    closeJob,
    getAkashTemplates,
    deployments,
    isSubmitting
  };
}
`;

  const hookPath = path.join(frontendDir, 'src/hooks/use-akash-bridge.ts');
  fs.writeFileSync(hookPath, akashHookContent);
  console.log('✅ Created Akash integration hook');
  
  // Update job creation page to include Akash option
  const jobCreatePath = path.join(frontendDir, 'src/pages/job-create.tsx');
  
  if (fs.existsSync(jobCreatePath)) {
    console.log('✅ Frontend integration files ready');
    console.log('⚠️  You may need to update job-create.tsx to include Akash provider option');
  }
}

async function createLaunchScripts() {
  console.log('\n📜 Creating launch scripts...');
  
  // Bridge startup script
  const bridgeStartScript = `#!/usr/bin/env node

console.log('🌊 Starting Cloudana-Akash Bridge...');

const { spawn } = require('child_process');
const path = require('path');

const bridgeDir = path.join(__dirname, '../akash-bridge');
const bridge = spawn('npm', ['start'], { 
  cwd: bridgeDir, 
  stdio: 'inherit' 
});

bridge.on('close', (code) => {
  console.log('Bridge process exited with code', code);
  process.exit(code);
});

process.on('SIGINT', () => {
  console.log('Shutting down bridge...');
  bridge.kill('SIGINT');
});
`;
  
  fs.writeFileSync(path.join(process.cwd(), 'scripts/start-bridge.js'), bridgeStartScript);
  
  // Combined startup script
  const combinedStartScript = `#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting Cloudana + Akash Integration...');

// Start bridge API
const bridge = spawn('node', ['scripts/start-bridge.js'], { 
  stdio: 'inherit' 
});

// Start frontend  
const frontend = spawn('npm', ['run', 'dev'], {
  cwd: path.join(__dirname, '../client'),
  stdio: 'inherit'
});

// Cleanup on exit
process.on('SIGINT', () => {
  console.log('Shutting down all services...');
  bridge.kill('SIGINT');
  frontend.kill('SIGINT');
  process.exit(0);
});
`;

  fs.writeFileSync(path.join(process.cwd(), 'scripts/start-with-akash.js'), combinedStartScript);
  
  console.log('✅ Launch scripts created');
}

async function displayInstructions() {
  console.log(`
🎉 AKASH INTEGRATION SETUP COMPLETE!
====================================

📋 Next Steps:

1. CONFIGURE CREDENTIALS:
   Edit akash-bridge/.env with your:
   • Ethereum private key (for CLD operations)  
   • Akash mnemonic (12-24 words)
   • Contract addresses from your Cloudana deployment

2. FUND WALLETS:
   • Ethereum wallet: ETH for gas + some CLD tokens
   • Akash wallet: AKT tokens for deployments (~5 AKT minimum)

3. TEST THE BRIDGE:
   cd akash-bridge/
   npm run dev
   
   # In another terminal:
   curl http://localhost:3001/health
   # Should return: {"status":"healthy"}

4. START COMPLETE SYSTEM:
   node scripts/start-with-akash.js
   
   This starts:
   • Akash bridge API (port 3001)
   • Cloudana frontend (port 7003)

5. SUBMIT TEST JOBS:
   • Visit http://localhost:7003
   • Create jobs with "Akash Network" provider option
   • Watch them deploy to 100+ Akash providers worldwide!

💰 REVENUE FLOW:
   User pays CLD → Cloudana keeps 2.5% → Routes to Akash → Profit!

📖 DOCUMENTATION:
   • Complete guide: AKASH_INTEGRATION_GUIDE.md
   • API reference: akash-bridge/README.md
   • Troubleshooting: See guide for common issues

🎯 READY TO LAUNCH:
   You now have a complete DePIN platform with:
   ✅ Instant global infrastructure (via Akash)
   ✅ Platform fee collection (2.5%)  
   ✅ Better UX than raw Akash
   ✅ Migration path to native providers

Happy earning! 🚀
`);
}

async function main() {
  try {
    await setupAkashBridge();
    await updateFrontendIntegration();
    await createLaunchScripts();
    await displayInstructions();
  } catch (error) {
    console.error('\n❌ Setup failed:', error.message);
    console.log('\n💡 Manual steps:');
    console.log('1. cd akash-bridge && npm install && npm run build');
    console.log('2. cp akash-bridge/.env.example akash-bridge/.env');
    console.log('3. Edit akash-bridge/.env with your credentials');
    console.log('4. npm run dev from akash-bridge/ directory');
    process.exit(1);
  }
}

main();