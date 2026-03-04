export interface Provider {
  id: string;
  address: string;
  name: string;
  status: 'active' | 'inactive';
  metaHash: string;
  pricing: number; // CLD per unit
}

export interface Job {
  id: string;
  creator: string;
  providerId: string;
  providerAddress: string;
  deposit: number;
  spent: number;
  remaining: number;
  status: 'OPEN' | 'CLOSED' | 'DISPUTED';
  createdAt: string;
  lastUpdated: string;
}

export interface WalletState {
  isConnected: boolean;
  address: string | null;
  balance: number;
  isProvider: boolean;
  providerId?: string | null;
}

export interface Transaction {
  hash: string;
  type: 'DEPOSIT' | 'WITHDRAW' | 'USAGE' | 'REGISTER' | 'CLOSE';
  amount?: number;
  timestamp: string;
  status: 'pending' | 'confirmed' | 'failed';
}
