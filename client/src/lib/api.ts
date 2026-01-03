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

export async function getProviderByAddress(address: string): Promise<Provider | null> {
  const res = await fetch(`${API_BASE}/providers/address/${address}`);
  if (!res.ok) return null;
  return res.json();
}

export async function registerProvider(data: {
  address: string;
  name: string;
  metaHash: string;
  status: "active" | "inactive";
  pricing: string;
}): Promise<Provider> {
  const res = await fetch(`${API_BASE}/providers`, {
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

// Job API
export async function getUserJobs(userAddress: string): Promise<Job[]> {
  const res = await fetch(`${API_BASE}/jobs/user/${userAddress}`);
  if (!res.ok) throw new Error("Failed to fetch jobs");
  return res.json();
}

export async function getProviderJobs(providerId: string): Promise<Job[]> {
  const res = await fetch(`${API_BASE}/jobs/provider/${providerId}`);
  if (!res.ok) throw new Error("Failed to fetch jobs");
  return res.json();
}

export async function getJob(jobId: string): Promise<Job> {
  const res = await fetch(`${API_BASE}/jobs/${jobId}`);
  if (!res.ok) throw new Error("Failed to fetch job");
  return res.json();
}

export async function getJobByNumber(jobNumber: string): Promise<Job> {
  const res = await fetch(`${API_BASE}/jobs/number/${jobNumber}`);
  if (!res.ok) throw new Error("Failed to fetch job");
  return res.json();
}

export async function createJob(data: {
  creator: string;
  providerId: string;
  deposit: string;
}): Promise<Job> {
  const res = await fetch(`${API_BASE}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || "Failed to create job");
  }
  return res.json();
}

export async function closeJob(jobId: string): Promise<{ success: boolean; refundAmount: string }> {
  const res = await fetch(`${API_BASE}/jobs/${jobId}/close`, {
    method: "POST",
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || "Failed to close job");
  }
  return res.json();
}

// Usage Report API
export async function getUsageReports(jobId: string): Promise<UsageReport[]> {
  const res = await fetch(`${API_BASE}/usage-reports/job/${jobId}`);
  if (!res.ok) throw new Error("Failed to fetch usage reports");
  return res.json();
}

export async function requestSignature(data: {
  jobId: string;
  grossCost: string;
  providerEarn: string;
  userRefund?: string;
}): Promise<{ reportId: string; signature: string; jobNonce: number }> {
  const res = await fetch(`${API_BASE}/usage-reports/request-signature`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || "Failed to request signature");
  }
  return res.json();
}

export async function confirmUsageReport(reportId: string, txHash: string): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE}/usage-reports/${reportId}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ txHash }),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || "Failed to confirm usage report");
  }
  return res.json();
}

// User Credits API
export async function getUserCredits(userAddress: string): Promise<UserCredit> {
  const res = await fetch(`${API_BASE}/credits/${userAddress}`);
  if (!res.ok) throw new Error("Failed to fetch user credits");
  return res.json();
}

// Events API
export async function getJobEvents(jobId: string): Promise<Event[]> {
  const res = await fetch(`${API_BASE}/events/job/${jobId}`);
  if (!res.ok) throw new Error("Failed to fetch events");
  return res.json();
}

export async function getUserEvents(userAddress: string): Promise<Event[]> {
  const res = await fetch(`${API_BASE}/events/user/${userAddress}`);
  if (!res.ok) throw new Error("Failed to fetch events");
  return res.json();
}
