import { ExecutionEngine, WorkloadSpec, ExecutionResult } from './execution-engine';
import { ChainInterface, JobDetails } from './chain-interface';
import { Logger, LogLevel } from './logger';
import { downloadFromIPFS } from './ipfs-client';

export interface ProviderConfig {
  // Chain configuration
  rpcUrl: string;
  privateKey: string;
  workloadRegistryAddress: string;
  cldTokenAddress: string;
  
  // Provider configuration
  maxConcurrentJobs: number;
  workDirectory: string;
  
  // Logging
  logLevel: LogLevel;
}

export interface ProviderStats {
  totalJobsExecuted: number;
  successfulJobs: number;
  failedJobs: number;
  totalEarnings: string; // CLD earned
  uptime: number; // seconds
  currentJobs: number;
}

export class ProviderNode {
  private config: ProviderConfig;
  private executionEngine: ExecutionEngine;
  private chainInterface: ChainInterface;
  private logger: Logger;
  private stats: ProviderStats;
  private activeJobs: Map<string, Promise<void>>;
  private isRunning: boolean;
  private startTime: number;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.logger = new Logger('ProviderNode', config.logLevel);
    
    this.chainInterface = new ChainInterface({
      rpcUrl: config.rpcUrl,
      privateKey: config.privateKey,
      workloadRegistryAddress: config.workloadRegistryAddress,
      cldTokenAddress: config.cldTokenAddress
    });
    
    this.executionEngine = new ExecutionEngine(
      this.chainInterface, 
      config.workDirectory
    );

    this.stats = {
      totalJobsExecuted: 0,
      successfulJobs: 0,
      failedJobs: 0,
      totalEarnings: '0',
      uptime: 0,
      currentJobs: 0
    };

    this.activeJobs = new Map();
    this.isRunning = false;
    this.startTime = 0;
  }

  async start(): Promise<void> {
    try {
      this.logger.info('Starting Cloudana Provider Node...');
      this.startTime = Date.now();

      // Initialize components
      await this.chainInterface.initialize();
      await this.executionEngine.initialize();

      // Start listening for jobs
      await this.startJobListener();

      // Start periodic tasks
      this.startPeriodicTasks();

      this.isRunning = true;
      this.logger.info('Provider Node started successfully');
      this.logger.info(`Provider address: ${this.chainInterface.getAddress()}`);

    } catch (error) {
      this.logger.error('Failed to start provider node:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.logger.info('Stopping provider node...');
    this.isRunning = false;

    // Wait for active jobs to complete
    await Promise.all(this.activeJobs.values());
    
    this.logger.info('Provider node stopped');
  }

  private async startJobListener(): Promise<void> {
    // Listen for new job events
    await this.chainInterface.listenForNewJobs(async (job: JobDetails) => {
      if (this.activeJobs.size >= this.config.maxConcurrentJobs) {
        this.logger.warn(`Max concurrent jobs reached (${this.config.maxConcurrentJobs}), skipping job ${job.id}`);
        return;
      }

      this.logger.info(`New job received: ${job.id}`);
      const jobPromise = this.processJob(job);
      this.activeJobs.set(job.id, jobPromise);

      // Clean up when job completes
      jobPromise.finally(() => {
        this.activeJobs.delete(job.id);
        this.stats.currentJobs = this.activeJobs.size;
      });
    });

    // Also check for existing pending jobs
    await this.checkExistingJobs();
  }

  private async checkExistingJobs(): Promise<void> {
    try {
      const availableJobs = await this.chainInterface.getAvailableJobs();
      this.logger.info(`Found ${availableJobs.length} pending jobs`);

      for (const job of availableJobs) {
        if (this.activeJobs.size < this.config.maxConcurrentJobs) {
          const jobPromise = this.processJob(job);
          this.activeJobs.set(job.id, jobPromise);
          
          jobPromise.finally(() => {
            this.activeJobs.delete(job.id);
            this.stats.currentJobs = this.activeJobs.size;
          });
        }
      }
    } catch (error) {
      this.logger.error('Error checking existing jobs:', error);
    }
  }

  private async processJob(job: JobDetails): Promise<void> {
    const startTime = Date.now();
    this.logger.info(`Processing job ${job.id}`);
    this.stats.totalJobsExecuted++;
    this.stats.currentJobs = this.activeJobs.size;

    try {
      // Download job specification from IPFS
      const specHash = job.specHash.replace('0x', ''); // Remove 0x prefix if present
      const jobSpec = await this.chainInterface.getJobSpecification(specHash);
      
      // Convert to WorkloadSpec format
      const workloadSpec: WorkloadSpec = {
        id: job.id,
        containerImage: jobSpec.containerImage,
        command: jobSpec.command,
        environment: jobSpec.environment,
        resources: jobSpec.resources,
        ports: jobSpec.ports,
        volumes: jobSpec.volumes,
        timeout: jobSpec.timeout || 3600, // Default 1 hour
        payment: job.payment
      };

      // Execute the workload
      const result: ExecutionResult = await this.executionEngine.executeWorkload(workloadSpec);

      if (result.status === 'success') {
        // Submit result to blockchain
        await this.chainInterface.submitWorkloadResult(job.id, result.resultHash);
        
        // Claim payment
        await this.claimJobPayment(job.id);
        
        this.stats.successfulJobs++;
        this.logger.info(`Job ${job.id} completed successfully`);
      } else {
        this.stats.failedJobs++;
        this.logger.error(`Job ${job.id} failed:`, result.error);
      }

    } catch (error) {
      this.stats.failedJobs++;
      this.logger.error(`Job ${job.id} processing error:`, error);
    }

    const executionTime = (Date.now() - startTime) / 1000;
    this.logger.info(`Job ${job.id} processed in ${executionTime.toFixed(2)}s`);
  }

  private async claimJobPayment(jobId: string): Promise<void> {
    try {
      const txHash = await this.chainInterface.claimPayment(jobId);
      this.logger.info(`Payment claimed for job ${jobId}: ${txHash}`);
      
      // Update earnings (this is approximate, should check actual received amount)
      // TODO: Parse transaction receipt for exact payment amount
    } catch (error) {
      this.logger.error(`Failed to claim payment for job ${jobId}:`, error);
    }
  }

  private startPeriodicTasks(): void {
    // Update stats every 30 seconds
    setInterval(async () => {
      if (!this.isRunning) return;

      try {
        // Update uptime
        this.stats.uptime = (Date.now() - this.startTime) / 1000;
        
        // Update CLD balance
        this.stats.totalEarnings = await this.chainInterface.getCLDBalance();
        
        // Log periodic status
        this.logger.debug('Provider stats:', this.stats);

      } catch (error) {
        this.logger.error('Error updating stats:', error);
      }
    }, 30000);

    // Check for new jobs every 60 seconds (backup to event listening)
    setInterval(async () => {
      if (!this.isRunning) return;
      await this.checkExistingJobs();
    }, 60000);
  }

  getStats(): ProviderStats {
    return { ...this.stats };
  }

  getAddress(): string {
    return this.chainInterface.getAddress();
  }

  isActive(): boolean {
    return this.isRunning;
  }

  getCurrentJobCount(): number {
    return this.activeJobs.size;
  }
}