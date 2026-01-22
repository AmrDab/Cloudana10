/**
 * Mock data for jobs and logs (used when contracts are not deployed or for demo purposes)
 */

import type { ClientProviderList } from "@/lib/provider-types";

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

/** Sample providers for map when no real providers (demo only). Mix of active and inactive. */
export const SAMPLE_PROVIDERS = [
  // Active providers (green on map)
  { owner: "0x1111111111111111111111111111111111111111", name: "Sample US East", hostUri: "https://sample1.example.com", ipRegion: "Virginia", ipRegionCode: "VA", ipCountry: "United States", ipCountryCode: "US", ipLat: "37.5", ipLon: "-77.4", isOnline: true, isAudited: false, uptime7d: 100, leaseCount: 12, gpuModels: [], activeStats: { cpu: 1766, gpu: 65, memory: 5.07e12, storage: 25.88e12 }, pendingStats: { cpu: 0, gpu: 0, memory: 0, storage: 0 }, availableStats: { cpu: 7643, gpu: 214, memory: 71e12, storage: 683.27e12 } },
  { owner: "0x2222222222222222222222222222222222222222", name: "Sample EU West", hostUri: "https://sample2.example.com", ipRegion: "Frankfurt", ipRegionCode: "DE-HE", ipCountry: "Germany", ipCountryCode: "DE", ipLat: "50.1", ipLon: "8.7", isOnline: true, isAudited: true, uptime7d: 99, leaseCount: 8, gpuModels: [], activeStats: { cpu: 2500, gpu: 45, memory: 8e12, storage: 50e12 }, pendingStats: { cpu: 500, gpu: 5, memory: 2e12, storage: 10e12 }, availableStats: { cpu: 5000, gpu: 150, memory: 40e12, storage: 200e12 } },
  { owner: "0x3333333333333333333333333333333333333333", name: "Sample Asia Pacific", hostUri: "https://sample3.example.com", ipRegion: "Tokyo", ipRegionCode: "JP-13", ipCountry: "Japan", ipCountryCode: "JP", ipLat: "35.7", ipLon: "139.7", isOnline: true, isAudited: false, uptime7d: 98, leaseCount: 5, gpuModels: [], activeStats: { cpu: 3200, gpu: 80, memory: 12e12, storage: 80e12 }, pendingStats: { cpu: 800, gpu: 10, memory: 3e12, storage: 20e12 }, availableStats: { cpu: 4000, gpu: 110, memory: 35e12, storage: 200e12 } },
  { owner: "0x7777777777777777777777777777777777777777", name: "Sample Canada", hostUri: "https://sample7.example.com", ipRegion: "Toronto", ipRegionCode: "ON", ipCountry: "Canada", ipCountryCode: "CA", ipLat: "43.65", ipLon: "-79.38", isOnline: true, isAudited: true, uptime7d: 97, leaseCount: 6, gpuModels: [], activeStats: { cpu: 1800, gpu: 30, memory: 6e12, storage: 40e12 }, pendingStats: { cpu: 200, gpu: 2, memory: 1e12, storage: 5e12 }, availableStats: { cpu: 6000, gpu: 68, memory: 43e12, storage: 255e12 } },
  { owner: "0x8888888888888888888888888888888888888888", name: "Sample India", hostUri: "https://sample8.example.com", ipRegion: "Mumbai", ipRegionCode: "MH", ipCountry: "India", ipCountryCode: "IN", ipLat: "19.08", ipLon: "72.88", isOnline: true, isAudited: false, uptime7d: 96, leaseCount: 4, gpuModels: [], activeStats: { cpu: 1400, gpu: 25, memory: 4e12, storage: 30e12 }, pendingStats: { cpu: 300, gpu: 3, memory: 1.5e12, storage: 8e12 }, availableStats: { cpu: 5300, gpu: 72, memory: 44.5e12, storage: 262e12 } },
  // Inactive providers (red on map)
  { owner: "0x4444444444444444444444444444444444444444", name: "Sample UK (Inactive)", hostUri: "https://sample4.example.com", ipRegion: "London", ipRegionCode: "GB-LND", ipCountry: "United Kingdom", ipCountryCode: "GB", ipLat: "51.5", ipLon: "-0.1", isOnline: false, isAudited: true, uptime7d: 0, leaseCount: 0, gpuModels: [], activeStats: { cpu: 0, gpu: 0, memory: 0, storage: 0 }, pendingStats: { cpu: 0, gpu: 0, memory: 0, storage: 0 }, availableStats: { cpu: 8000, gpu: 8, memory: 128e12, storage: 4e15 } },
  { owner: "0x5555555555555555555555555555555555555555", name: "Sample Brazil (Inactive)", hostUri: "https://sample5.example.com", ipRegion: "São Paulo", ipRegionCode: "BR-SP", ipCountry: "Brazil", ipCountryCode: "BR", ipLat: "-23.5", ipLon: "-46.6", isOnline: false, isAudited: false, uptime7d: 0, leaseCount: 0, gpuModels: [], activeStats: { cpu: 0, gpu: 0, memory: 0, storage: 0 }, pendingStats: { cpu: 0, gpu: 0, memory: 0, storage: 0 }, availableStats: { cpu: 2000, gpu: 2, memory: 16e12, storage: 500e12 } },
] as ClientProviderList[];
