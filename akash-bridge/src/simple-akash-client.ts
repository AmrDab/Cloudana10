import axios from 'axios';

export interface SimpleAkashConfig {
  consoleApiKey?: string;
  consoleApiUrl: string;
  mockMode: boolean; // For testing without real Akash integration
}

export interface SimpleDeploymentSpec {
  name: string;
  image: string;
  cpu: string;    // e.g., "1000m"
  memory: string; // e.g., "1Gi"
  storage: string; // e.g., "10Gi"
  ports?: number[];
  env?: Record<string, string>;
  expose?: boolean;
}

export interface SimpleDeployment {
  id: string;
  status: 'pending' | 'active' | 'failed' | 'closed';
  uri?: string;
  cost?: {
    usd: number;
    akt: number;
  };
  provider?: string;
  region?: string;
  createdAt: Date;
}

export class SimpleAkashClient {
  private config: SimpleAkashConfig;

  constructor(config: SimpleAkashConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    console.log(`Simple Akash Client initialized (mock: ${this.config.mockMode})`);
  }

  async createDeployment(spec: SimpleDeploymentSpec): Promise<SimpleDeployment> {
    if (this.config.mockMode) {
      return this.createMockDeployment(spec);
    }

    try {
      // Use Akash Console API for real deployments
      const response = await this.callConsoleAPI('/deployments', 'POST', {
        template: this.convertSpecToTemplate(spec),
        deposit: 5000000, // 5 AKT in uakt
      });

      return {
        id: response.data.dseq,
        status: 'pending',
        provider: 'akash-provider',
        region: 'global',
        createdAt: new Date(),
        cost: {
          usd: this.estimateCostUSD(spec),
          akt: this.estimateCostAKT(spec)
        }
      };

    } catch (error) {
      console.error('Akash deployment failed:', error);
      throw new Error(`Akash deployment failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getDeploymentStatus(deploymentId: string): Promise<SimpleDeployment | null> {
    if (this.config.mockMode) {
      return this.getMockDeploymentStatus(deploymentId);
    }

    try {
      const response = await this.callConsoleAPI(`/deployments/${deploymentId}`, 'GET');
      return this.parseDeploymentResponse(response.data);
    } catch (error) {
      console.error('Error getting deployment status:', error);
      return null;
    }
  }

  async closeDeployment(deploymentId: string): Promise<boolean> {
    if (this.config.mockMode) {
      console.log(`Mock: Closing deployment ${deploymentId}`);
      return true;
    }

    try {
      await this.callConsoleAPI(`/deployments/${deploymentId}/close`, 'POST');
      return true;
    } catch (error) {
      console.error('Error closing deployment:', error);
      return false;
    }
  }

  async getDeploymentLogs(deploymentId: string): Promise<string> {
    if (this.config.mockMode) {
      return `Mock logs for deployment ${deploymentId}:\n2026-03-03 10:45:00 Container started\n2026-03-03 10:45:01 Application listening on port 80`;
    }

    try {
      const response = await this.callConsoleAPI(`/deployments/${deploymentId}/logs`, 'GET');
      return response.data.logs || 'No logs available';
    } catch (error) {
      return `Error retrieving logs: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  async getProviders(): Promise<Array<{id: string, region: string, available: boolean}>> {
    if (this.config.mockMode) {
      return [
        { id: 'provider-us-east', region: 'US East', available: true },
        { id: 'provider-eu-west', region: 'Europe West', available: true },
        { id: 'provider-asia', region: 'Asia Pacific', available: true },
      ];
    }

    try {
      const response = await this.callConsoleAPI('/providers', 'GET');
      return response.data.providers || [];
    } catch (error) {
      console.error('Error getting providers:', error);
      return [];
    }
  }

  private async callConsoleAPI(endpoint: string, method: string, data?: any): Promise<any> {
    const headers: any = {
      'Content-Type': 'application/json',
    };

    if (this.config.consoleApiKey) {
      headers['Authorization'] = `Bearer ${this.config.consoleApiKey}`;
    }

    const response = await axios({
      method,
      url: `${this.config.consoleApiUrl}${endpoint}`,
      headers,
      data,
      timeout: 30000
    });

    return response;
  }

  private convertSpecToTemplate(spec: SimpleDeploymentSpec): any {
    return {
      services: {
        [spec.name]: {
          image: spec.image,
          env: spec.env || {},
          resources: {
            cpu: {
              units: spec.cpu
            },
            memory: {
              size: spec.memory
            },
            storage: [{
              size: spec.storage
            }]
          },
          expose: spec.expose ? [{
            port: spec.ports?.[0] || 80,
            as: 80,
            to: [{
              global: true
            }]
          }] : []
        }
      },
      profiles: {
        compute: {
          [spec.name]: {
            resources: {
              cpu: { units: spec.cpu },
              memory: { size: spec.memory },
              storage: [{ size: spec.storage }]
            }
          }
        },
        placement: {
          akash: {
            pricing: {
              [spec.name]: {
                denom: 'uakt',
                amount: 1000
              }
            }
          }
        }
      },
      deployment: {
        [spec.name]: {
          akash: {
            profile: spec.name,
            count: 1
          }
        }
      }
    };
  }

  private estimateCostUSD(spec: SimpleDeploymentSpec): number {
    // Simple cost estimation
    const cpuCost = parseFloat(spec.cpu.replace('m', '')) / 1000 * 0.02; // $0.02 per CPU/hour
    const memoryCost = this.parseMemoryGB(spec.memory) * 0.001; // $0.001 per GB/hour
    const storageCost = this.parseStorageGB(spec.storage) * 0.0005; // $0.0005 per GB/hour
    
    return (cpuCost + memoryCost + storageCost) * 24; // Daily cost
  }

  private estimateCostAKT(spec: SimpleDeploymentSpec): number {
    const usdCost = this.estimateCostUSD(spec);
    return usdCost / 0.5; // Assuming 1 AKT = $0.50
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

  // Mock implementations for testing
  private createMockDeployment(spec: SimpleDeploymentSpec): SimpleDeployment {
    const deploymentId = `mock-${Date.now()}`;
    console.log(`Mock: Creating deployment ${deploymentId} for image ${spec.image}`);
    
    return {
      id: deploymentId,
      status: 'pending',
      provider: 'mock-provider-us-east',
      region: 'US East (Mock)',
      createdAt: new Date(),
      uri: spec.expose ? `http://mock-${deploymentId}.akash.network` : undefined,
      cost: {
        usd: this.estimateCostUSD(spec),
        akt: this.estimateCostAKT(spec)
      }
    };
  }

  private getMockDeploymentStatus(deploymentId: string): SimpleDeployment {
    // Simulate deployment progression
    const age = Date.now() - parseInt(deploymentId.replace('mock-', ''));
    
    let status: 'pending' | 'active' | 'failed' | 'closed' = 'pending';
    if (age > 30000) status = 'active'; // Active after 30 seconds
    if (age > 300000) status = 'closed'; // Closed after 5 minutes
    
    return {
      id: deploymentId,
      status,
      provider: 'mock-provider-us-east',
      region: 'US East (Mock)',
      createdAt: new Date(parseInt(deploymentId.replace('mock-', ''))),
      uri: status === 'active' ? `http://mock-${deploymentId}.akash.network` : undefined,
      cost: {
        usd: 2.50,
        akt: 5.0
      }
    };
  }

  private parseDeploymentResponse(data: any): SimpleDeployment {
    return {
      id: data.dseq,
      status: this.mapAkashStatus(data.state),
      provider: data.provider,
      region: data.region || 'Unknown',
      createdAt: new Date(data.created_at),
      uri: data.uri,
      cost: data.cost
    };
  }

  private mapAkashStatus(akashState: number): 'pending' | 'active' | 'failed' | 'closed' {
    switch (akashState) {
      case 1: return 'active';
      case 2: return 'failed';
      case 3: return 'closed';
      default: return 'pending';
    }
  }
}

export default SimpleAkashClient;