import express from 'express';
import cors from 'cors';
import { SimpleAkashClient, SimpleDeploymentSpec } from './simple-akash-client';
import { ethers } from 'ethers';

interface SimpleBridgeConfig {
  port: number;
  corsOrigin: string;
  mockMode: boolean;
  consoleApiUrl?: string;
  consoleApiKey?: string;
}

export class SimpleBridgeApiServer {
  private app: express.Application;
  private akashClient: SimpleAkashClient;
  private config: SimpleBridgeConfig;

  constructor(config: SimpleBridgeConfig) {
    this.config = config;
    this.akashClient = new SimpleAkashClient({
      consoleApiUrl: config.consoleApiUrl || 'https://console.akash.network/api/v1',
      mockMode: config.mockMode,
      consoleApiKey: config.consoleApiKey
    });
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    // CORS
    this.app.use(cors({
      origin: this.config.corsOrigin,
      credentials: true
    }));

    // JSON parsing
    this.app.use(express.json({ limit: '10mb' }));

    // Request logging
    this.app.use((req, res, next) => {
      console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
      next();
    });
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        service: 'cloudana-akash-bridge',
        mockMode: this.config.mockMode
      });
    });

    // Bridge status
    this.app.get('/api/bridge/status', async (req, res) => {
      try {
        const providers = await this.akashClient.getProviders();
        res.json({ 
          success: true, 
          data: {
            mockMode: this.config.mockMode,
            providersAvailable: providers.length,
            providers: providers.slice(0, 3) // Return first 3
          } 
        });
      } catch (error) {
        res.status(500).json({ 
          success: false, 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    });

    // Submit job (Cloudana → Akash)
    this.app.post('/api/jobs/submit', async (req, res) => {
      try {
        const cloudanaJob = req.body;
        
        // Validate job specification
        this.validateJobSpec(cloudanaJob);
        
        // Convert Cloudana job to Akash spec
        const akashSpec: SimpleDeploymentSpec = {
          name: `cloudana-${cloudanaJob.id}`,
          image: cloudanaJob.containerImage,
          cpu: `${cloudanaJob.resources.cpu * 1000}m`,
          memory: cloudanaJob.resources.memory,
          storage: cloudanaJob.resources.storage,
          ports: cloudanaJob.ports,
          env: cloudanaJob.environment,
          expose: cloudanaJob.ports && cloudanaJob.ports.length > 0
        };
        
        // Deploy to Akash
        const deployment = await this.akashClient.createDeployment(akashSpec);
        
        res.json({ 
          success: true, 
          data: { 
            jobId: cloudanaJob.id,
            akashDseq: deployment.id,
            status: deployment.status,
            provider: deployment.provider,
            region: deployment.region,
            estimatedCost: {
              usd: deployment.cost?.usd,
              akt: deployment.cost?.akt,
              platformFee: parseFloat(cloudanaJob.payment) * 0.025
            },
            uri: deployment.uri
          } 
        });
        
      } catch (error) {
        console.error('Job submission error:', error);
        res.status(400).json({ 
          success: false, 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    });

    // Get job status
    this.app.get('/api/jobs/:jobId', async (req, res) => {
      try {
        const { jobId } = req.params;
        
        // In a real implementation, we'd store the mapping between 
        // Cloudana job ID and Akash deployment ID
        const mockDeploymentId = `mock-${jobId.replace('job-', '')}`;
        const deployment = await this.akashClient.getDeploymentStatus(mockDeploymentId);
        
        if (!deployment) {
          return res.status(404).json({ success: false, error: 'Job not found' });
        }
        
        res.json({ success: true, data: deployment });
        
      } catch (error) {
        res.status(500).json({ 
          success: false, 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    });

    // Get job logs
    this.app.get('/api/jobs/:jobId/logs', async (req, res) => {
      try {
        const { jobId } = req.params;
        const mockDeploymentId = `mock-${jobId.replace('job-', '')}`;
        const logs = await this.akashClient.getDeploymentLogs(mockDeploymentId);
        
        res.json({ success: true, data: { logs } });
        
      } catch (error) {
        res.status(500).json({ 
          success: false, 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    });

    // Close/terminate job
    this.app.post('/api/jobs/:jobId/close', async (req, res) => {
      try {
        const { jobId } = req.params;
        const mockDeploymentId = `mock-${jobId.replace('job-', '')}`;
        const success = await this.akashClient.closeDeployment(mockDeploymentId);
        
        if (success) {
          res.json({ success: true, message: 'Job closed successfully' });
        } else {
          res.status(500).json({ success: false, error: 'Failed to close job' });
        }
        
      } catch (error) {
        res.status(500).json({ 
          success: false, 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    });

    // Get available job templates optimized for Akash
    this.app.get('/api/templates', (req, res) => {
      const templates = this.getAkashOptimizedTemplates();
      res.json({ success: true, data: templates });
    });

    // Estimate job cost
    this.app.post('/api/jobs/estimate', async (req, res) => {
      try {
        const jobSpec = req.body;
        const estimate = this.estimateJobCost(jobSpec);
        
        res.json({ success: true, data: estimate });
        
      } catch (error) {
        res.status(400).json({ 
          success: false, 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    });

    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({ 
        success: false, 
        error: 'Endpoint not found' 
      });
    });
  }

  private validateJobSpec(job: any): void {
    const required = ['id', 'user', 'containerImage', 'resources', 'timeout', 'payment'];
    
    for (const field of required) {
      if (!job[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Validate payment amount
    const payment = parseFloat(job.payment);
    if (isNaN(payment) || payment <= 0) {
      throw new Error('Payment must be a positive number');
    }
  }

  private getAkashOptimizedTemplates() {
    return [
      {
        id: 'akash-web-hosting',
        name: 'Web Hosting (Akash)',
        description: 'Static website hosting on Akash network',
        category: 'web',
        spec: {
          containerImage: 'nginx:alpine',
          resources: { cpu: 0.5, memory: '512Mi', storage: '1Gi' },
          ports: [80],
          timeout: 86400,
          payment: '25' // Reduced cost for Akash
        }
      },
      {
        id: 'akash-api-service',
        name: 'API Service (Akash)',
        description: 'RESTful API on decentralized infrastructure',
        category: 'compute',
        spec: {
          containerImage: 'node:18-alpine',
          command: ['npm', 'start'],
          resources: { cpu: 1, memory: '1Gi', storage: '2Gi' },
          ports: [3000],
          timeout: 86400,
          payment: '50' // Reduced cost for Akash
        }
      }
    ];
  }

  private estimateJobCost(jobSpec: any) {
    const baseCost = {
      cpu: jobSpec.resources.cpu * 0.01, // $0.01 per CPU hour (Akash pricing)
      memory: this.parseMemoryGB(jobSpec.resources.memory) * 0.0005,
      storage: this.parseStorageGB(jobSpec.resources.storage) * 0.0002
    };

    const hourlyRate = baseCost.cpu + baseCost.memory + baseCost.storage;
    const hours = (jobSpec.timeout || 3600) / 3600;
    const totalCostUSD = hourlyRate * hours;
    const totalCostCLD = totalCostUSD / 0.10; // Assume 1 CLD = $0.10
    const platformFee = totalCostCLD * 0.025;

    return {
      estimated: {
        totalCostUSD: totalCostUSD.toFixed(4),
        totalCostCLD: totalCostCLD.toFixed(2),
        platformFee: platformFee.toFixed(2),
        userPayment: (totalCostCLD + platformFee).toFixed(2)
      },
      akashAdvantage: {
        savings: '60-80% vs traditional cloud',
        providers: '100+ globally distributed',
        regions: 'Worldwide coverage'
      }
    };
  }

  private parseMemoryGB(memory: string): number {
    const units = { 'Ki': 1/(1024*1024), 'Mi': 1/1024, 'Gi': 1, 'Ti': 1024 };
    for (const [suffix, multiplier] of Object.entries(units)) {
      if (memory.endsWith(suffix)) {
        return parseFloat(memory.replace(suffix, '')) * multiplier;
      }
    }
    return parseFloat(memory);
  }

  private parseStorageGB(storage: string): number {
    return this.parseMemoryGB(storage);
  }

  async start(): Promise<void> {
    try {
      // Initialize Akash client
      await this.akashClient.initialize();
      
      // Start HTTP server
      const server = this.app.listen(this.config.port, () => {
        console.log(`
🌊 CLOUDANA-AKASH BRIDGE API (SIMPLE VERSION)
=============================================
Port: ${this.config.port}
CORS Origin: ${this.config.corsOrigin}
Mock Mode: ${this.config.mockMode ? 'ENABLED' : 'DISABLED'}
Bridge Status: Active

Available Endpoints:
  GET  /health - Health check
  GET  /api/bridge/status - Bridge status
  POST /api/jobs/submit - Submit job to Akash
  GET  /api/jobs/:id - Get job status
  GET  /api/jobs/:id/logs - Get job logs
  POST /api/jobs/:id/close - Close job
  GET  /api/templates - Akash templates
  POST /api/jobs/estimate - Cost estimation

🎯 Ready to bridge Cloudana jobs to Akash!
        `);
      });

      // Graceful shutdown
      process.on('SIGTERM', () => {
        console.log('Received SIGTERM, shutting down gracefully');
        server.close(() => {
          console.log('API server closed');
          process.exit(0);
        });
      });

    } catch (error) {
      console.error('Failed to start bridge API:', error);
      process.exit(1);
    }
  }
}

export default SimpleBridgeApiServer;