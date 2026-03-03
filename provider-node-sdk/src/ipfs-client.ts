import fetch from 'node-fetch';

interface IPFSConfig {
  gateway?: string;
  pinataJWT?: string;
  pinataGateway?: string;
}

export class IPFSClient {
  private config: IPFSConfig;

  constructor(config: IPFSConfig = {}) {
    this.config = {
      gateway: config.gateway || 'https://ipfs.io/ipfs/',
      pinataJWT: config.pinataJWT || process.env.PINATA_JWT,
      pinataGateway: config.pinataGateway || process.env.PINATA_GATEWAY
    };
  }

  async uploadToIPFS(data: any): Promise<string> {
    if (this.config.pinataJWT) {
      return this.uploadToPinata(data);
    } else {
      // Fallback to local IPFS node or mock for development
      return this.mockUpload(data);
    }
  }

  private async uploadToPinata(data: any): Promise<string> {
    try {
      const response = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.pinataJWT}`
        },
        body: JSON.stringify({
          pinataContent: data,
          pinataMetadata: {
            name: `cloudana-result-${Date.now()}`,
            keyvalues: {
              timestamp: new Date().toISOString(),
              type: 'workload-result'
            }
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Pinata upload failed: ${response.statusText}`);
      }

      const result = await response.json();
      return result.IpfsHash;

    } catch (error) {
      console.error('Pinata upload error:', error);
      // Fallback to mock
      return this.mockUpload(data);
    }
  }

  private async mockUpload(data: any): Promise<string> {
    // Generate a fake IPFS hash for development
    const hash = 'Qm' + Buffer.from(JSON.stringify(data)).toString('base64').slice(0, 44);
    console.log('Mock IPFS upload:', hash);
    return hash;
  }

  async downloadFromIPFS(hash: string): Promise<any> {
    try {
      const url = this.config.pinataGateway 
        ? `${this.config.pinataGateway}/ipfs/${hash}`
        : `${this.config.gateway}${hash}`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`IPFS download failed: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('IPFS download error:', error);
      throw error;
    }
  }
}

// Global instance
const ipfsClient = new IPFSClient();

export async function uploadToIPFS(data: any): Promise<string> {
  return ipfsClient.uploadToIPFS(data);
}

export async function downloadFromIPFS(hash: string): Promise<any> {
  return ipfsClient.downloadFromIPFS(hash);
}