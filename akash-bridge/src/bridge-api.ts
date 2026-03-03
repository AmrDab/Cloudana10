import express from 'express';
import cors from 'cors';
import { CloudanaAkashBridge, CloudanaJob, BridgeConfig } from './cloudana-akash-bridge';
import { ethers } from 'ethers';
import rateLimit from 'express-rate-limit';

interface BridgeApiConfig extends BridgeConfig {
  port: number;
  corsOrigin: string;
}

export class BridgeApiServer {
  private app: express.Application;
  private bridge: CloudanaAkashBridge;
  private config: BridgeApiConfig;

  constructor(config: BridgeApiConfig) {
    this.config = config;
    this.bridge = new CloudanaAkashBridge(config);
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

    // Rate limiting
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // 100 requests per 15 minutes
      message: 'Too many requests from this IP'
    });
    this.app.use('/api/', limiter);

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
        service: 'cloudana-akash-bridge'
      });
    });

    // Bridge status
    this.app.get('/api/bridge/status', async (req, res) => {
      try {
        const stats = await this.bridge.getBridgeStats();
        res.json({ success: true, data: stats });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Submit job (Cloudana → Akash)
    this.app.post('/api/jobs/submit', async (req, res) => {
      try {
        const job: CloudanaJob = req.body;
        
        // Validate job specification
        this.validateJobSpec(job);
        
        // Process through bridge
        const deployment = await this.bridge.processCloudanaJob(job);
        
        res.json({ 
          success: true, 
          data: { 
            jobId: job.id,
            akashDseq: deployment.akashDseq,
            status: deployment.status,
            estimatedCost: deployment.cost
          } 
        });
        
      } catch (error) {
        console.error('Job submission error:', error);
        res.status(400).json({ success: false, error: error.message });
      }
    });

    // Get job status
    this.app.get('/api/jobs/:jobId', async (req, res) => {
      try {
        const { jobId } = req.params;
        const deployment = await this.bridge.getJobStatus(jobId);
        
        if (!deployment) {
          return res.status(404).json({ success: false, error: 'Job not found' });
        }
        
        res.json({ success: true, data: deployment });
        
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Get job logs
    this.app.get('/api/jobs/:jobId/logs', async (req, res) => {
      try {
        const { jobId } = req.params;
        const logs = await this.bridge.getJobLogs(jobId);
        
        res.json({ success: true, data: { logs } });
        
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Close/terminate job
    this.app.post('/api/jobs/:jobId/close', async (req, res) => {
      try {
        const { jobId } = req.params;
        await this.bridge.closeJob(jobId);
        
        res.json({ success: true, message: 'Job closed successfully' });
        
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // List all deployments (admin)
    this.app.get('/api/admin/deployments', async (req, res) => {
      try {
        // TODO: Add admin authentication
        const deployments = await this.bridge.getAllDeployments();
        res.json({ success: true, data: deployments });
        
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Get available job templates optimized for Akash
    this.app.get('/api/templates', (req, res) => {
      const templates = this.getAkashOptimizedTemplates();
      res.json({ success: true, data: templates });
    });

    // Estimate job cost (CLD → AKT conversion)
    this.app.post('/api/jobs/estimate', async (req, res) => {
      try {
        const jobSpec = req.body;
        const estimate = await this.estimateJobCost(jobSpec);
        
        res.json({ success: true, data: estimate });
        
      } catch (error) {
        res.status(400).json({ success: false, error: error.message });
      }
    });

    // Get network statistics
    this.app.get('/api/network/stats', async (req, res) => {
      try {
        const stats = await this.getNetworkStats();
        res.json({ success: true, data: stats });
        
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Error handling middleware
    this.app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      console.error('API Error:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Internal server error' 
      });
    });

    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({ 
        success: false, 
        error: 'Endpoint not found' 
      });
    });
  }

  private validateJobSpec(job: CloudanaJob): void {
    const required = ['id', 'user', 'containerImage', 'resources', 'timeout', 'payment'];
    
    for (const field of required) {
      if (!job[field as keyof CloudanaJob]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Validate resource specifications
    if (!job.resources.cpu || job.resources.cpu < 0.1 || job.resources.cpu > 32) {
      throw new Error('CPU must be between 0.1 and 32 cores');
    }

    if (!job.resources.memory.match(/^\d+(\.\d+)?(Ki|Mi|Gi|Ti)$/)) {
      throw new Error('Invalid memory format. Use Ki/Mi/Gi/Ti units');
    }

    if (!job.resources.storage.match(/^\d+(\.\d+)?(Ki|Mi|Gi|Ti)$/)) {
      throw new Error('Invalid storage format. Use Ki/Mi/Gi/Ti units');
    }

    // Validate timeout (max 7 days)
    if (job.timeout < 60 || job.timeout > 7 * 24 * 3600) {
      throw new Error('Timeout must be between 1 minute and 7 days');
    }

    // Validate payment amount
    const payment = parseFloat(job.payment);
    if (isNaN(payment) || payment <= 0) {
      throw new Error('Payment must be a positive number');
    }

    // Validate container image
    if (!job.containerImage.includes(':')) {
      job.containerImage += ':latest'; // Add default tag
    }

    // Security checks for container image
    const allowedRegistries = ['docker.io', 'ghcr.io', 'quay.io', 'gcr.io'];
    const hasAllowedRegistry = allowedRegistries.some(registry => 
      job.containerImage.includes(registry) || !job.containerImage.includes('/')
    );
    
    if (!hasAllowedRegistry) {
      throw new Error('Container image must be from an approved registry');
    }
  }

  private getAkashOptimizedTemplates() {
    return [
      {
        id: 'akash-web-hosting',
        name: 'Web Hosting (Akash Optimized)',
        description: 'Static website or web app hosting on Akash network',
        category: 'web',
        spec: {
          containerImage: 'nginx:alpine',
          resources: { cpu: 0.5, memory: '512Mi', storage: '1Gi' },
          ports: [80],
          timeout: 86400, // 24 hours
          payment: '50', // Reduced cost due to Akash efficiency
          expose: true
        },
        akashFeatures: {
          globalExpose: true,
          persistentStorage: false,
          autoScale: false
        }
      },
      {
        id: 'akash-api-service',
        name: 'API Service (Akash Optimized)', 
        description: 'RESTful API service on decentralized infrastructure',
        category: 'compute',
        spec: {
          containerImage: 'node:18-alpine',
          command: ['npm', 'start'],
          resources: { cpu: 1, memory: '1Gi', storage: '2Gi' },
          ports: [3000],
          timeout: 86400,
          payment: '75',
          expose: true
        },
        akashFeatures: {
          globalExpose: true,
          persistentStorage: false,
          autoScale: false
        }
      },
      {
        id: 'akash-ml-training',
        name: 'ML Training (Akash GPU)',
        description: 'Machine learning model training with GPU acceleration',
        category: 'ai',
        spec: {
          containerImage: 'tensorflow/tensorflow:latest-gpu',
          command: ['python', 'train.py'],
          resources: { cpu: 4, memory: '8Gi', storage: '20Gi' },
          timeout: 7200, // 2 hours
          payment: '200'
        },
        akashFeatures: {
          gpuRequired: true,
          persistentStorage: true,
          autoScale: false
        }
      }
    ];
  }

  private async estimateJobCost(jobSpec: any): Promise<any> {
    // Mock cost estimation based on Akash network rates
    const baseCost = {
      cpu: jobSpec.resources.cpu * 0.02, // $0.02 per CPU hour
      memory: this.parseMemoryGB(jobSpec.resources.memory) * 0.001, // $0.001 per GB hour
      storage: this.parseStorageGB(jobSpec.resources.storage) * 0.0005 // $0.0005 per GB hour
    };

    const hourlyRate = baseCost.cpu + baseCost.memory + baseCost.storage;
    const hours = (jobSpec.timeout || 3600) / 3600;
    const totalCostUSD = hourlyRate * hours;

    // Convert to CLD (assuming 1 CLD = $0.10)
    const cldRate = 0.10;
    const totalCostCLD = totalCostUSD / cldRate;

    // Add platform fee
    const platformFee = totalCostCLD * (this.config.platformFeeBps / 10000);
    const userPayment = totalCostCLD + platformFee;

    return {
      estimated: {
        totalCostUSD: totalCostUSD.toFixed(4),
        totalCostCLD: totalCostCLD.toFixed(2),
        platformFee: platformFee.toFixed(2),
        userPayment: userPayment.toFixed(2)
      },
      breakdown: {
        hourlyRate: hourlyRate.toFixed(4),
        duration: `${hours.toFixed(2)} hours`,
        resources: baseCost
      },
      akashNetwork: {
        estimatedAktCost: (totalCostCLD * 0.1).toFixed(4), // Mock AKT conversion
        providers: '100+ available',
        regions: 'Global'
      }
    };
  }

  private async getNetworkStats(): Promise<any> {
    const bridgeStats = await this.bridge.getBridgeStats();
    
    return {
      bridge: bridgeStats,
      akash: {
        providers: '100+', // Would fetch from Akash API
        regions: 15,
        activeDeployments: '1000+',
        avgCost: '$0.03/hour'
      },
      cloudana: {
        uniqueUsers: this.getUniqueUsersCount(),
        platformFees: bridgeStats.totalPlatformFees,
        successRate: '98.5%'
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

  private getUniqueUsersCount(): number {
    // Count unique users from deployments
    const deployments = Array.from((this.bridge as any).deployments.values());
    const uniqueUsers = new Set(deployments.map((d: any) => d.cloudanaJobId.split('-')[0]));
    return uniqueUsers.size;
  }

  async start(): Promise<void> {
    try {
      // Initialize bridge
      await this.bridge.initialize();
      
      // Start HTTP server
      const server = this.app.listen(this.config.port, () => {
        console.log(`
🌊 CLOUDANA-AKASH BRIDGE API STARTED
=====================================
Port: ${this.config.port}
CORS Origin: ${this.config.corsOrigin}
Bridge Status: Active
Akash Integration: Connected

Available Endpoints:
  GET  /health - Health check
  GET  /api/bridge/status - Bridge statistics
  POST /api/jobs/submit - Submit job to Akash
  GET  /api/jobs/:id - Get job status
  GET  /api/jobs/:id/logs - Get job logs
  POST /api/jobs/:id/close - Close job
  GET  /api/templates - Akash-optimized templates
  POST /api/jobs/estimate - Cost estimation
  GET  /api/network/stats - Network statistics

🎯 Ready to route Cloudana jobs to Akash network!
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

// Export for use as module
export default BridgeApiServer;