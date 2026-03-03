import { ethers } from 'ethers';
import { uploadToIPFS } from './ipfs-client';

interface ChainConfig {
  rpcUrl: string;
  privateKey: string;
  workloadRegistryAddress: string;
  cldTokenAddress: string;
}

export interface JobDetails {
  id: string;
  user: string;
  specHash: string;
  payment: string;
  status: number;
  resultHash: string;
}

export class ChainInterface {
  private provider: ethers.providers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private workloadRegistry: ethers.Contract;
  private cldToken: ethers.Contract;

  // ABI fragments for required functions
  private static WORKLOAD_REGISTRY_ABI = [
    'function getJob(uint256 jobId) external view returns (address user, bytes32 specHash, uint256 payment, uint8 status, bytes32 resultHash)',
    'function executeWorkload(uint256 jobId, bytes32 resultHash) external',
    'function claimPayment(uint256 jobId) external',
    'function getJobCount() external view returns (uint256)',
    'event WorkloadCreated(uint256 indexed jobId, address indexed user, bytes32 specHash, uint256 payment)',
    'event WorkloadExecuted(uint256 indexed jobId, address indexed provider, bytes32 resultHash)',
    'event PaymentClaimed(uint256 indexed jobId, address indexed provider, uint256 amount)'
  ];

  private static CLD_TOKEN_ABI = [
    'function balanceOf(address account) external view returns (uint256)',
    'function transfer(address to, uint256 amount) external returns (bool)',
    'function approve(address spender, uint256 amount) external returns (bool)',
    'function allowance(address owner, address spender) external view returns (uint256)'
  ];

  constructor(config: ChainConfig) {
    this.provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
    this.wallet = new ethers.Wallet(config.privateKey, this.provider);
    
    this.workloadRegistry = new ethers.Contract(
      config.workloadRegistryAddress,
      ChainInterface.WORKLOAD_REGISTRY_ABI,
      this.wallet
    );

    this.cldToken = new ethers.Contract(
      config.cldTokenAddress,
      ChainInterface.CLD_TOKEN_ABI,
      this.wallet
    );
  }

  async initialize(): Promise<void> {
    // Check connection
    await this.provider.getNetwork();
    console.log('Chain interface initialized');
    console.log('Provider address:', this.wallet.address);
    console.log('ETH balance:', ethers.utils.formatEther(await this.wallet.getBalance()));
  }

  async getAvailableJobs(): Promise<JobDetails[]> {
    try {
      const jobCount = await this.workloadRegistry.getJobCount();
      const jobs: JobDetails[] = [];

      for (let i = 0; i < jobCount.toNumber(); i++) {
        const job = await this.workloadRegistry.getJob(i);
        
        // Status: 0 = Pending, 1 = Running, 2 = Complete, 3 = Failed
        if (job.status === 0) { // Only pending jobs
          jobs.push({
            id: i.toString(),
            user: job.user,
            specHash: job.specHash,
            payment: job.payment.toString(),
            status: job.status,
            resultHash: job.resultHash
          });
        }
      }

      return jobs;
    } catch (error) {
      console.error('Error fetching jobs:', error);
      return [];
    }
  }

  async submitWorkloadResult(jobId: string, resultHash: string): Promise<string> {
    try {
      console.log(`Submitting result for job ${jobId}: ${resultHash}`);
      
      const tx = await this.workloadRegistry.executeWorkload(
        ethers.BigNumber.from(jobId),
        resultHash
      );

      console.log('Transaction submitted:', tx.hash);
      const receipt = await tx.wait();
      
      console.log('Transaction confirmed:', receipt.transactionHash);
      return receipt.transactionHash;

    } catch (error) {
      console.error('Error submitting workload result:', error);
      throw error;
    }
  }

  async claimPayment(jobId: string): Promise<string> {
    try {
      console.log(`Claiming payment for job ${jobId}`);
      
      const tx = await this.workloadRegistry.claimPayment(
        ethers.BigNumber.from(jobId)
      );

      console.log('Payment claim transaction:', tx.hash);
      const receipt = await tx.wait();
      
      console.log('Payment claimed:', receipt.transactionHash);
      return receipt.transactionHash;

    } catch (error) {
      console.error('Error claiming payment:', error);
      throw error;
    }
  }

  async getCLDBalance(): Promise<string> {
    try {
      const balance = await this.cldToken.balanceOf(this.wallet.address);
      return ethers.utils.formatUnits(balance, 18);
    } catch (error) {
      console.error('Error getting CLD balance:', error);
      return '0';
    }
  }

  async listenForNewJobs(callback: (job: JobDetails) => void): Promise<void> {
    console.log('Listening for new jobs...');
    
    this.workloadRegistry.on('WorkloadCreated', async (jobId: ethers.BigNumber, user: string, specHash: string, payment: ethers.BigNumber) => {
      console.log('New job detected:', {
        jobId: jobId.toString(),
        user,
        specHash,
        payment: ethers.utils.formatUnits(payment, 18)
      });

      const job: JobDetails = {
        id: jobId.toString(),
        user,
        specHash,
        payment: payment.toString(),
        status: 0, // Pending
        resultHash: ''
      };

      callback(job);
    });
  }

  async getJobSpecification(specHash: string): Promise<any> {
    try {
      // specHash should be an IPFS hash
      const response = await fetch(`https://ipfs.io/ipfs/${specHash.replace('0x', '')}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch job spec: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Error fetching job specification:', error);
      throw error;
    }
  }

  getAddress(): string {
    return this.wallet.address;
  }

  async estimateGas(jobId: string, resultHash: string): Promise<string> {
    try {
      const gasEstimate = await this.workloadRegistry.estimateGas.executeWorkload(
        ethers.BigNumber.from(jobId),
        resultHash
      );
      return gasEstimate.toString();
    } catch (error) {
      console.error('Error estimating gas:', error);
      return '100000'; // Default gas limit
    }
  }
}