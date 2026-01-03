import { Provider, Job } from './types';

export const MOCK_PROVIDERS: Provider[] = [
  {
    id: 'prov-001',
    address: '0x71C...9A21',
    name: 'AWS High-Perf Cluster',
    status: 'active',
    metaHash: 'ipfs://QmHash123',
    pricing: 10,
  },
  {
    id: 'prov-002',
    address: '0x82D...3B44',
    name: 'Decentralized GPU Node A',
    status: 'active',
    metaHash: 'ipfs://QmHash456',
    pricing: 5,
  },
  {
    id: 'prov-003',
    address: '0x93E...5C67',
    name: 'Bare Metal Server EU',
    status: 'inactive',
    metaHash: 'ipfs://QmHash789',
    pricing: 15,
  },
  {
    id: 'prov-004',
    address: '0xA4F...7D89',
    name: 'Community Node #42',
    status: 'active',
    metaHash: 'ipfs://QmHashABC',
    pricing: 2,
  },
];

export const MOCK_JOBS: Job[] = [
  {
    id: 'job-1001',
    creator: '0x123...abc',
    providerId: 'prov-001',
    providerAddress: '0x71C...9A21',
    deposit: 500,
    spent: 120,
    remaining: 380,
    status: 'OPEN',
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(), // 2 days ago
    lastUpdated: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: 'job-1002',
    creator: '0x123...abc',
    providerId: 'prov-002',
    providerAddress: '0x82D...3B44',
    deposit: 1000,
    spent: 950,
    remaining: 50,
    status: 'CLOSED',
    createdAt: new Date(Date.now() - 86400000 * 10).toISOString(),
    lastUpdated: new Date(Date.now() - 86400000 * 1).toISOString(),
  },
];

export const MOCK_LOGS = [
  { event: 'JobCreated', jobId: 'job-1001', timestamp: new Date(Date.now() - 86400000 * 2).toISOString(), tx: '0xabc...123' },
  { event: 'UsageSubmitted', jobId: 'job-1001', amount: 50, timestamp: new Date(Date.now() - 86400000 * 1.5).toISOString(), tx: '0xdef...456' },
  { event: 'UsageSubmitted', jobId: 'job-1001', amount: 70, timestamp: new Date(Date.now() - 3600000).toISOString(), tx: '0xghi...789' },
];
