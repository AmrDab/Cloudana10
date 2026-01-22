/**
 * Mock data for jobs and logs (used when contracts are not deployed or for demo purposes)
 */

export interface MockJob {
  id: string;
  createdAt: string | number;
  status: 'OPEN' | 'CLOSED';
  creator: `0x${string}`;
  providerAddress: `0x${string}`;
  spent: number;
  deposit: number;
  remaining: number;
}

export interface MockLog {
  jobId: string;
  event: string;
  timestamp: string | number;
  amount?: number;
  tx?: `0x${string}`;
}

export const MOCK_JOBS: MockJob[] = [
  {
    id: "1",
    createdAt: Date.now() - 7 * 24 * 60 * 60 * 1000, // 7 days ago
    status: "OPEN",
    creator: "0x1234567890123456789012345678901234567890",
    providerAddress: "0x1111111111111111111111111111111111111111",
    spent: 45.5,
    deposit: 100,
    remaining: 54.5,
  },
  {
    id: "2",
    createdAt: Date.now() - 3 * 24 * 60 * 60 * 1000, // 3 days ago
    status: "OPEN",
    creator: "0x1234567890123456789012345678901234567890",
    providerAddress: "0x2222222222222222222222222222222222222222",
    spent: 12.3,
    deposit: 50,
    remaining: 37.7,
  },
  {
    id: "3",
    createdAt: Date.now() - 14 * 24 * 60 * 60 * 1000, // 14 days ago
    status: "CLOSED",
    creator: "0x1234567890123456789012345678901234567890",
    providerAddress: "0x3333333333333333333333333333333333333333",
    spent: 75.0,
    deposit: 75,
    remaining: 0,
  },
  {
    id: "4",
    createdAt: Date.now() - 1 * 24 * 60 * 60 * 1000, // 1 day ago
    status: "OPEN",
    creator: "0x1234567890123456789012345678901234567890",
    providerAddress: "0x4444444444444444444444444444444444444444",
    spent: 5.2,
    deposit: 200,
    remaining: 194.8,
  },
];

export const MOCK_LOGS: MockLog[] = [
  {
    jobId: "1",
    event: "Job Created",
    timestamp: Date.now() - 7 * 24 * 60 * 60 * 1000,
    tx: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
  },
  {
    jobId: "1",
    event: "Usage Deducted",
    timestamp: Date.now() - 6 * 24 * 60 * 60 * 1000,
    amount: 10.5,
    tx: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  },
  {
    jobId: "1",
    event: "Usage Deducted",
    timestamp: Date.now() - 5 * 24 * 60 * 60 * 1000,
    amount: 15.2,
    tx: "0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba",
  },
  {
    jobId: "1",
    event: "Usage Deducted",
    timestamp: Date.now() - 4 * 24 * 60 * 60 * 1000,
    amount: 12.8,
    tx: "0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321",
  },
  {
    jobId: "1",
    event: "Usage Deducted",
    timestamp: Date.now() - 2 * 24 * 60 * 60 * 1000,
    amount: 7.0,
    tx: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  },
  {
    jobId: "2",
    event: "Job Created",
    timestamp: Date.now() - 3 * 24 * 60 * 60 * 1000,
    tx: "0x1111111111111111111111111111111111111111111111111111111111111111",
  },
  {
    jobId: "2",
    event: "Usage Deducted",
    timestamp: Date.now() - 2 * 24 * 60 * 60 * 1000,
    amount: 8.5,
    tx: "0x2222222222222222222222222222222222222222222222222222222222222222",
  },
  {
    jobId: "2",
    event: "Usage Deducted",
    timestamp: Date.now() - 1 * 24 * 60 * 60 * 1000,
    amount: 3.8,
    tx: "0x3333333333333333333333333333333333333333333333333333333333333333",
  },
  {
    jobId: "3",
    event: "Job Created",
    timestamp: Date.now() - 14 * 24 * 60 * 60 * 1000,
    tx: "0x4444444444444444444444444444444444444444444444444444444444444444",
  },
  {
    jobId: "3",
    event: "Usage Deducted",
    timestamp: Date.now() - 13 * 24 * 60 * 60 * 1000,
    amount: 25.0,
    tx: "0x5555555555555555555555555555555555555555555555555555555555555555",
  },
  {
    jobId: "3",
    event: "Usage Deducted",
    timestamp: Date.now() - 12 * 24 * 60 * 60 * 1000,
    amount: 30.0,
    tx: "0x6666666666666666666666666666666666666666666666666666666666666666",
  },
  {
    jobId: "3",
    event: "Usage Deducted",
    timestamp: Date.now() - 11 * 24 * 60 * 60 * 1000,
    amount: 20.0,
    tx: "0x7777777777777777777777777777777777777777777777777777777777777777",
  },
  {
    jobId: "3",
    event: "Job Closed",
    timestamp: Date.now() - 10 * 24 * 60 * 60 * 1000,
    tx: "0x8888888888888888888888888888888888888888888888888888888888888888",
  },
  {
    jobId: "4",
    event: "Job Created",
    timestamp: Date.now() - 1 * 24 * 60 * 60 * 1000,
    tx: "0x9999999999999999999999999999999999999999999999999999999999999999",
  },
  {
    jobId: "4",
    event: "Usage Deducted",
    timestamp: Date.now() - 12 * 60 * 60 * 1000, // 12 hours ago
    amount: 3.2,
    tx: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  },
  {
    jobId: "4",
    event: "Usage Deducted",
    timestamp: Date.now() - 6 * 60 * 60 * 1000, // 6 hours ago
    amount: 2.0,
    tx: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  },
];
