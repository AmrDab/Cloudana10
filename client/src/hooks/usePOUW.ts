/**
 * React hooks for POUW mining data — connects to orchestrator POUW API.
 */
import { useQuery } from "@tanstack/react-query";

const ORCHESTRATOR_URL = import.meta.env.VITE_ORCHESTRATOR_URL ?? "http://localhost:7002";

export interface ProviderMiningStats {
  providerAddress: string;
  deviceId: string;
  totalCertificates: number;
  totalDifficulty: number;
  lastSeen: number;
  firstSeen: number;
  recentHashRate: number;
}

export interface NetworkMiningStats {
  totalCertificates: number;
  activeProviders: number;
  certsLast1Min: number;
  certsLast5Min: number;
  networkHashRate: number;
  totalDifficultyMined: number;
}

export interface RecentCertificate {
  id: string;
  providerAddress: string;
  deviceId: string;
  n: number;
  difficulty: number;
  z: string;
  transcriptHash: string;
  verifiedAt: number;
}

async function fetcher<T>(path: string): Promise<T> {
  const res = await fetch(`${ORCHESTRATOR_URL}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function useNetworkMiningStats() {
  return useQuery<NetworkMiningStats>({
    queryKey: ["pouw-stats"],
    queryFn: () => fetcher<NetworkMiningStats>("/v1/pouw/stats"),
    refetchInterval: 5000,
    staleTime: 3000,
  });
}

export function useMiningLeaderboard() {
  return useQuery<{ providers: ProviderMiningStats[] }>({
    queryKey: ["pouw-leaderboard"],
    queryFn: () => fetcher<{ providers: ProviderMiningStats[] }>("/v1/pouw/leaderboard"),
    refetchInterval: 10000,
    staleTime: 5000,
  });
}

export function useRecentCertificates(limit = 20) {
  return useQuery<{ certificates: RecentCertificate[] }>({
    queryKey: ["pouw-certificates", limit],
    queryFn: () => fetcher<{ certificates: RecentCertificate[] }>(`/v1/pouw/certificates?limit=${limit}`),
    refetchInterval: 4000,
    staleTime: 2000,
  });
}

export function useMiningChainSeed() {
  return useQuery<{ seed: string; blockNumber: string; fetchedAt: number }>({
    queryKey: ["pouw-seed"],
    queryFn: () => fetcher("/v1/pouw/seed"),
    refetchInterval: 6000,
  });
}
