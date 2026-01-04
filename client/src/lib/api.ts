import type { Provider, Job, UsageReport, UserCredit, Event } from "@shared/schema";

const API_BASE = "/api";

// Provider API
export async function getAllProviders(): Promise<Provider[]> {
  const res = await fetch(`${API_BASE}/providers`);
  if (!res.ok) throw new Error("Failed to fetch providers");
  return res.json();
}

export async function getActiveProviders(): Promise<Provider[]> {
  const res = await fetch(`${API_BASE}/providers/active`);
  if (!res.ok) throw new Error("Failed to fetch providers");
  return res.json();
}

export async function getProviderByProviderkey(providerkey: string): Promise<Provider | null> {
  const res = await fetch(`${API_BASE}/providers/key/${providerkey}`);
  if (!res.ok) return null;
  return res.json();
}

export async function getProvidersByOwner(ownerAddress: string): Promise<Provider[]> {
  const res = await fetch(`${API_BASE}/providers/owner/${ownerAddress}`);
  if (!res.ok) throw new Error("Failed to fetch providers");
  return res.json();
}

export async function registerProvider(data: {
  ownerAddress: string;
  providerkey: string;
  region: string;
  hardwareTier: number;
  capacity: number;
  bondAmount: string;
  name: string;
  description?: string;
  cpuModel?: string;
  cpuCores?: number;
  cpuThreads?: number;
  cpuClockSpeed?: string;
  gpuModel?: string;
  gpuCount?: number;
  gpuMemory?: string;
  gpuCudaCores?: string;
  ramTotal?: string;
  ramType?: string;
  storageTotal?: string;
  storageType?: string;
  storageSpeed?: string;
  bandwidth?: string;
  networkType?: string;
  location?: string;
  country?: string;
  city?: string;
  pricing?: string;
}): Promise<Provider> {
  const res = await fetch(`${API_BASE}/providers/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || "Failed to register provider");
  }
  return res.json();
}


// Node Registry API
export interface BondInfo {
  bondAmount: string;
  teamWallet: string;
  treasuryWallet: string;
  deadAddress: string;
}

export interface ValidateAndPrepareResponse {
  success: boolean;
  validated: {
    providerkey: string;
    region: string;
    hardwareTier: number;
    capacity: number;
    name: string;
    ownerAddress: string;
  };
  transaction: {
    to: string;
    functionName: "registerProvider";
    args: [string, string, number, number];
  };
  bondInfo: {
    totalBond: string;
    required: string;
    available: string;
    allowance: string;
  };
  gasEstimate: string;
}

export interface ProviderNode {
  providerkey: string;
  region: string;
  hardwareTier: number;
  capacity: number;
  bondAmount: string;
  registeredAt: number;
  status: number; // 0=Registered, 1=Active, 2=Inactive
}

export async function getBondInfo(): Promise<BondInfo> {
  const res = await fetch(`${API_BASE}/bond-info`);
  if (!res.ok) throw new Error("Failed to fetch bond info");
  return res.json();
}

export async function validateAndPrepareRegistration(data: {
  ownerAddress: string;
  providerkey: string;
  region: "Helsinki" | "EU" | "Global";
  hardwareTier: number;
  capacity: number;
  name: string;
  description?: string;
  cpuModel?: string;
  cpuCores?: number;
  cpuThreads?: number;
  cpuClockSpeed?: string;
  gpuModel?: string;
  gpuCount?: number;
  gpuMemory?: string;
  gpuCudaCores?: string;
  ramTotal?: string;
  ramType?: string;
  storageTotal?: string;
  storageType?: string;
  storageSpeed?: string;
  bandwidth?: string;
  networkType?: string;
  location?: string;
  country?: string;
  city?: string;
}): Promise<ValidateAndPrepareResponse> {
  const res = await fetch(`${API_BASE}/providers/validate-and-prepare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || "Failed to validate and prepare registration");
  }
  return res.json();
}

export async function getMyProviders(owner: string): Promise<ProviderNode[]> {
  const res = await fetch(`${API_BASE}/providers/${owner}`);
  if (!res.ok) throw new Error("Failed to fetch providers");
  return res.json();
}

export async function sendHeartbeat(data: {
  providerkey: string;
  uptime?: number;
  timestamp?: number;
  signature?: string;
}): Promise<{ success: boolean; message: string; timestamp: number }> {
  const res = await fetch(`${API_BASE}/providers/heartbeat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || "Failed to send heartbeat");
  }
  return res.json();
}
