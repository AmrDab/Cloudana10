import { AkashClient, DeploymentSpec } from './akash-client';
import { ethers } from 'ethers';
import axios from 'axios';

export interface CloudanaJob {
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
  payment: string; // CLD amount
  expose?: boolean;
}

export interface BridgeConfig {
  // Ethereum config for CLD token
  ethereumRpcUrl: string;
  cldTokenAddress: string;
  workloadRegistryAddress: string;
  bridgePrivateKey: string;
  
  // Akash config
  akashRpcEndpoint: string;
  akashMnemonic: string;
  akashChainId: string;
  
  // Exchange rate (CLD to AKT)
  exchangeRateProvider: string; // API endpoint for CLD/AKT rate
  platformFeeBps: number; // Basis points for Cloudana fee
}

export interface BridgeDeployment {
  cloudanaJobId: string;
  akashDseq: string;
  status: 'pending' | 'active' | 'completed' | 'failed' | 'closed';
  akashUri?: string;
  createdAt: number;
  completedAt?: number;
  cost: {
    cldPaid: string;
    aktSpent: string;
    platformFee: string;
  };
}

export class CloudanaAkashBridge {
  private config: BridgeConfig;
  private akashClient: AkashClient;
  private ethProvider: ethers.providers.JsonRpcProvider;
  private ethWallet: ethers.Wallet;
  private deployments: Map<string, BridgeDeployment> = new Map();

  constructor(config: BridgeConfig) {
    this.config = config;
    
    // Initialize Akash client
    this.akashClient = new AkashClient({
      rpcEndpoint: config.akashRpcEndpoint,
      mnemonic: config.akashMnemonic,
      chainId: config.akashChainId,
      denom: 'uakt'
    });

    // Initialize Ethereum client
    this.ethProvider = new ethers.providers.JsonRpcProvider(config.ethereumRpcUrl);
    this.ethWallet = new ethers.Wallet(config.bridgePrivateKey, this.ethProvider);
  }

  async initialize(): Promise<void> {
    console.log('Initializing Cloudana-Akash Bridge...');
    
    await this.akashClient.initialize();
    
    console.log('Bridge initialized:');
    console.log('  Akash Address:', this.akashClient.getAddress());
    console.log('  Ethereum Address:', this.ethWallet.address);
    console.log('  AKT Balance:', await this.akashClient.getBalance(), 'uakt');
  }

  async processCloudanaJob(job: CloudanaJob): Promise<BridgeDeployment> {
    console.log(`Processing Cloudana job ${job.id} via Akash network`);

    try {
      // 1. Calculate costs and fees
      const costs = await this.calculateCosts(job);
      
      // 2. Validate payment
      await this.validatePayment(job.user, job.payment);
      
      // 3. Convert Cloudana spec to Akash spec
      const akashSpec = this.convertToAkashSpec(job);
      
      // 4. Deploy on Akash network
      const akashTxHash = await this.akashClient.createDeployment(akashSpec);
      console.log('Akash deployment created:', akashTxHash);
      
      // 5. Extract deployment sequence from transaction
      const dseq = await this.extractDseqFromTx(akashTxHash);
      
      // 6. Create bridge deployment record
      const bridgeDeployment: BridgeDeployment = {
        cloudanaJobId: job.id,
        akashDseq: dseq,
        status: 'pending',
        createdAt: Date.now(),
        cost: {
          cldPaid: job.payment,
          aktSpent: costs.aktRequired,
          platformFee: costs.platformFee
        }
      };
      
      this.deployments.set(job.id, bridgeDeployment);
      
      // 7. Start monitoring deployment
      this.monitorDeployment(job.id);
      
      return bridgeDeployment;
      
    } catch (error) {
      console.error('Error processing Cloudana job:', error);
      throw error;
    }
  }

  async getJobStatus(jobId: string): Promise<BridgeDeployment | null> {
    return this.deployments.get(jobId) || null;
  }

  async getAllDeployments(): Promise<BridgeDeployment[]> {
    return Array.from(this.deployments.values());
  }

  async closeJob(jobId: string): Promise<void> {
    const deployment = this.deployments.get(jobId);
    if (!deployment) {
      throw new Error(`Deployment ${jobId} not found`);
    }

    try {
      await this.akashClient.closeDeployment(deployment.akashDseq);
      deployment.status = 'closed';
      deployment.completedAt = Date.now();
      
      console.log(`Closed Akash deployment for job ${jobId}`);
    } catch (error) {
      console.error(`Error closing job ${jobId}:`, error);
      throw error;
    }
  }

  async getJobLogs(jobId: string): Promise<string> {
    const deployment = this.deployments.get(jobId);
    if (!deployment) {
      throw new Error(`Deployment ${jobId} not found`);
    }

    return await this.akashClient.getDeploymentLogs(deployment.akashDseq);
  }

  private async calculateCosts(job: CloudanaJob): Promise<{
    cldRequired: string;
    aktRequired: string;
    platformFee: string;
  }> {
    // Get current CLD/AKT exchange rate
    const exchangeRate = await this.getCLDAKTRate();
    
    // Calculate resource-based AKT cost
    const cpuCost = job.resources.cpu * 100; // 100 uakt per CPU unit per day
    const memoryCost = this.parseMemoryMB(job.resources.memory) * 10; // 10 uakt per MB per day
    const storageCost = this.parseStorageGB(job.resources.storage) * 50; // 50 uakt per GB per day
    
    const dailyAktCost = cpuCost + memoryCost + storageCost;
    const jobDurationDays = job.timeout / (24 * 3600);
    const totalAktCost = Math.ceil(dailyAktCost * jobDurationDays);
    
    // Add buffer for deployment costs and network fees
    const aktRequired = (totalAktCost * 1.5).toString(); // 50% buffer
    
    // Calculate CLD equivalent
    const cldRequired = (parseFloat(aktRequired) * exchangeRate).toString();
    
    // Calculate platform fee
    const platformFee = (parseFloat(job.payment) * this.config.platformFeeBps / 10000).toString();
    
    return {
      cldRequired,
      aktRequired,
      platformFee
    };
  }

  private async getCLDAKTRate(): Promise<number> {
    try {
      // In production, get real exchange rate from DEX/CEX
      // For now, use mock rate: 1 CLD = 0.1 AKT
      const response = await axios.get(this.config.exchangeRateProvider);
      return response.data.cld_akt_rate || 0.1;
    } catch (error) {
      console.warn('Could not fetch CLD/AKT rate, using default 0.1');
      return 0.1; // Fallback rate
    }
  }

  private async validatePayment(user: string, payment: string): Promise<void> {
    // Check if user has sufficient CLD balance and has approved the bridge
    const cldToken = new ethers.Contract(
      this.config.cldTokenAddress,
      ['function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)'],
      this.ethProvider
    );

    const balance = await cldToken.balanceOf(user);
    const allowance = await cldToken.allowance(user, this.ethWallet.address);
    const paymentWei = ethers.utils.parseUnits(payment, 18);

    if (balance.lt(paymentWei)) {
      throw new Error(`Insufficient CLD balance: ${ethers.utils.formatUnits(balance, 18)} < ${payment}`);
    }

    if (allowance.lt(paymentWei)) {
      throw new Error(`Insufficient CLD allowance: ${ethers.utils.formatUnits(allowance, 18)} < ${payment}`);
    }
  }

  private convertToAkashSpec(job: CloudanaJob): DeploymentSpec {
    return {
      image: job.containerImage,
      cpu: `${job.resources.cpu * 1000}m`, // Convert to millicores
      memory: job.resources.memory,
      storage: job.resources.storage,
      ports: job.ports,
      env: job.environment,
      command: job.command,
      expose: job.expose !== false // Default to true for web services
    };
  }

  private async extractDseqFromTx(txHash: string): Promise<string> {
    // In a real implementation, parse transaction logs to extract DSEQ
    // For now, use timestamp as mock DSEQ
    return Date.now().toString();
  }

  private async monitorDeployment(jobId: string): Promise<void> {
    const deployment = this.deployments.get(jobId);
    if (!deployment) return;

    console.log(`Starting monitoring for job ${jobId}`);

    const checkStatus = async () => {
      try {
        const akashStatus = await this.akashClient.getDeploymentStatus(deployment.akashDseq);
        
        if (akashStatus) {
          deployment.status = akashStatus.status as any;
          
          if (akashStatus.uri) {
            deployment.akashUri = akashStatus.uri;
          }
          
          if (akashStatus.status === 'active') {
            console.log(`Job ${jobId} is now active on Akash`);
            
            // Mark as completed after successful activation
            setTimeout(() => {
              deployment.status = 'completed';
              deployment.completedAt = Date.now();
              console.log(`Job ${jobId} marked as completed`);
            }, 5000);
          }
        }
        
        // Continue monitoring if not completed/failed
        if (!['completed', 'failed', 'closed'].includes(deployment.status)) {
          setTimeout(checkStatus, 30000); // Check every 30 seconds
        }
        
      } catch (error) {
        console.error(`Error monitoring job ${jobId}:`, error);
        deployment.status = 'failed';
      }
    };

    // Start monitoring after initial delay
    setTimeout(checkStatus, 5000);
  }

  private parseMemoryMB(memory: string): number {
    const units = { 'Ki': 1/1024, 'Mi': 1, 'Gi': 1024, 'Ti': 1024*1024 };
    for (const [suffix, multiplier] of Object.entries(units)) {
      if (memory.endsWith(suffix)) {
        return parseFloat(memory.replace(suffix, '')) * multiplier;
      }
    }
    return parseFloat(memory);
  }

  private parseStorageGB(storage: string): number {
    const units = { 'Ki': 1/(1024*1024), 'Mi': 1/1024, 'Gi': 1, 'Ti': 1024 };
    for (const [suffix, multiplier] of Object.entries(units)) {
      if (storage.endsWith(suffix)) {
        return parseFloat(storage.replace(suffix, '')) * multiplier;
      }
    }
    return parseFloat(storage);
  }

  // Statistics and analytics
  async getBridgeStats(): Promise<{
    totalJobs: number;
    activeJobs: number;
    completedJobs: number;
    totalCLDProcessed: string;
    totalAKTSpent: string;
    totalPlatformFees: string;
  }> {
    const deployments = Array.from(this.deployments.values());
    
    return {
      totalJobs: deployments.length,
      activeJobs: deployments.filter(d => d.status === 'active').length,
      completedJobs: deployments.filter(d => d.status === 'completed').length,
      totalCLDProcessed: deployments.reduce((sum, d) => sum + parseFloat(d.cost.cldPaid), 0).toString(),
      totalAKTSpent: deployments.reduce((sum, d) => sum + parseFloat(d.cost.aktSpent), 0).toString(),
      totalPlatformFees: deployments.reduce((sum, d) => sum + parseFloat(d.cost.platformFee), 0).toString()
    };
  }
}