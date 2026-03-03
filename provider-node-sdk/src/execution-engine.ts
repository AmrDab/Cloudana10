import Docker from 'dockerode';
import { promises as fs } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { uploadToIPFS } from './ipfs-client';
import { ChainInterface } from './chain-interface';
import { Logger } from './logger';

export interface WorkloadSpec {
  id: string;
  containerImage: string;
  command?: string[];
  environment?: Record<string, string>;
  resources: {
    cpu: number;      // CPU cores
    memory: string;   // e.g., "4Gi"
    storage: string;  // e.g., "10Gi"
  };
  ports?: number[];
  volumes?: Array<{
    host: string;
    container: string;
    readonly?: boolean;
  }>;
  timeout: number;    // Execution timeout in seconds
  payment: string;    // CLD amount in wei
}

export interface ExecutionResult {
  jobId: string;
  status: 'success' | 'failed' | 'timeout';
  resultHash: string;
  resultIPFS: string;
  logs: string;
  resourceUsage: {
    cpuUsed: number;
    memoryUsed: number;
    executionTime: number;
  };
  error?: string;
}

export class ExecutionEngine {
  private docker: Docker;
  private logger: Logger;
  private chainInterface: ChainInterface;
  private workDir: string;

  constructor(chainInterface: ChainInterface, workDir = '/tmp/cloudana-work') {
    this.docker = new Docker();
    this.logger = new Logger('ExecutionEngine');
    this.chainInterface = chainInterface;
    this.workDir = workDir;
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.workDir, { recursive: true });
    this.logger.info('Execution engine initialized');
  }

  async executeWorkload(spec: WorkloadSpec): Promise<ExecutionResult> {
    const startTime = Date.now();
    this.logger.info(`Starting workload execution: ${spec.id}`);

    try {
      // Create job directory
      const jobDir = join(this.workDir, spec.id);
      await fs.mkdir(jobDir, { recursive: true });

      // Pull container image
      await this.pullImage(spec.containerImage);

      // Create container
      const container = await this.createContainer(spec, jobDir);

      // Execute container
      const executionResult = await this.runContainer(container, spec.timeout);

      // Collect results
      const results = await this.collectResults(container, jobDir);
      
      // Upload results to IPFS
      const resultIPFS = await uploadToIPFS(results);
      const resultHash = this.calculateResultHash(results);

      // Cleanup
      await container.remove();
      await fs.rm(jobDir, { recursive: true, force: true });

      const executionTime = (Date.now() - startTime) / 1000;

      return {
        jobId: spec.id,
        status: executionResult.status,
        resultHash,
        resultIPFS,
        logs: executionResult.logs,
        resourceUsage: {
          cpuUsed: executionResult.stats.cpu_usage,
          memoryUsed: executionResult.stats.memory_usage,
          executionTime
        }
      };

    } catch (error: any) {
      this.logger.error(`Workload execution failed: ${error?.message}`);
      return {
        jobId: spec.id,
        status: 'failed' as const,
        resultHash: '',
        resultIPFS: '',
        logs: `Execution failed: ${error?.message}`,
        resourceUsage: {
          cpuUsed: 0,
          memoryUsed: 0,
          executionTime: (Date.now() - startTime) / 1000
        },
        error: error?.message
      };
    }
  }

  private async pullImage(image: string): Promise<void> {
    this.logger.info(`Pulling image: ${image}`);
    return new Promise((resolve, reject) => {
      this.docker.pull(image, (err: any, stream: any) => {
        if (err) return reject(err);
        
        this.docker.modem.followProgress(stream, (err: any, res: any) => {
          if (err) return reject(err);
          this.logger.info(`Image pulled successfully: ${image}`);
          resolve();
        });
      });
    });
  }

  private async createContainer(spec: WorkloadSpec, jobDir: string) {
    const containerConfig = {
      Image: spec.containerImage,
      Cmd: spec.command,
      Env: spec.environment ? Object.entries(spec.environment).map(([k, v]) => `${k}=${v}`) : [],
      WorkingDir: '/workspace',
      HostConfig: {
        Memory: this.parseMemory(spec.resources.memory),
        CpuShares: spec.resources.cpu * 1024, // Docker CPU shares
        Binds: [
          `${jobDir}:/workspace:rw`,
          ...(spec.volumes?.map(v => `${v.host}:${v.container}:${v.readonly ? 'ro' : 'rw'}`) || [])
        ],
        PortBindings: spec.ports ? this.buildPortBindings(spec.ports) : undefined,
        AutoRemove: false,
        NetworkMode: 'bridge'
      },
      ExposedPorts: spec.ports ? this.buildExposedPorts(spec.ports) : undefined
    };

    return await this.docker.createContainer(containerConfig);
  }

  private async runContainer(container: any, timeout: number) {
    const stream = await container.attach({
      stream: true,
      stdout: true,
      stderr: true
    });

    let logs = '';
    stream.on('data', (chunk: Buffer) => {
      logs += chunk.toString();
    });

    await container.start();

    // Set up timeout
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Container execution timeout')), timeout * 1000);
    });

    try {
      // Wait for container to finish or timeout
      const result = await Promise.race([
        container.wait(),
        timeoutPromise
      ]);

      // Get container stats
      const stats = await container.stats({ stream: false });

      return {
        status: result.StatusCode === 0 ? 'success' : 'failed',
        logs,
        stats: {
          cpu_usage: stats.cpu_stats?.cpu_usage?.total_usage || 0,
          memory_usage: stats.memory_stats?.usage || 0
        }
      };

    } catch (error) {
      // Kill container if still running
      try {
        await container.kill();
      } catch (killError) {
        // Container might already be stopped
      }

      return {
        status: 'timeout',
        logs,
        stats: { cpu_usage: 0, memory_usage: 0 }
      };
    }
  }

  private async collectResults(container: any, jobDir: string): Promise<any> {
    // Copy files from container to host
    const stream = await container.getArchive({ path: '/workspace' });
    
    // Extract and read result files
    const resultFiles = await fs.readdir(jobDir);
    const results: any = { files: {} };

    for (const file of resultFiles) {
      if (!file.startsWith('.')) {
        const filePath = join(jobDir, file);
        const content = await fs.readFile(filePath, 'utf-8').catch(() => null);
        if (content) {
          results.files[file] = content;
        }
      }
    }

    return results;
  }

  private calculateResultHash(results: any): string {
    const resultString = JSON.stringify(results, Object.keys(results).sort());
    return createHash('sha256').update(resultString).digest('hex');
  }

  private parseMemory(memory: string): number {
    const match = memory.match(/^(\d+)([A-Za-z]*)$/);
    if (!match) throw new Error(`Invalid memory format: ${memory}`);
    
    const [, amount, unit] = match;
    const multipliers: Record<string, number> = {
      'B': 1,
      'KB': 1024,
      'MB': 1024 * 1024,
      'GB': 1024 * 1024 * 1024,
      'Gi': 1024 * 1024 * 1024,
      'Mi': 1024 * 1024,
      'Ki': 1024
    };

    return parseInt(amount) * (multipliers[unit] || multipliers['MB']);
  }

  private buildPortBindings(ports: number[]) {
    const bindings: any = {};
    ports.forEach(port => {
      bindings[`${port}/tcp`] = [{ HostPort: port.toString() }];
    });
    return bindings;
  }

  private buildExposedPorts(ports: number[]) {
    const exposed: any = {};
    ports.forEach(port => {
      exposed[`${port}/tcp`] = {};
    });
    return exposed;
  }
}