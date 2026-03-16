import { useState } from "react";

const API = import.meta.env.VITE_API_URL ?? "http://localhost:7002";

export interface GPUScanResult {
  index: number;
  vendor: string;
  name: string;
  vramGB: number;
  driverVersion: string;
  utilizationPct: number;
  tflops: number;
}

export interface HardwareScanResult {
  deviceId: string;
  hostname: string;
  scannedAt: number;
  cpu: { model: string; threads: number };
  ramGB: number;
  disk: { totalGB: number | null; freeGB: number | null };
  gpus: GPUScanResult[];
  computeScore: number;
  tier: string;
  verifiedAt: number;
  endpoint: string;
}

export function useHardwareScan() {
  const [state, setState] = useState<"idle" | "scanning" | "done" | "error">("idle");
  const [scan, setScan] = useState<HardwareScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const triggerScan = async (endpoint: string) => {
    setState("scanning");
    setError(null);
    try {
      const res = await fetch(`${API}/v1/providers/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? "Scan failed");
      setScan(data.scan as HardwareScanResult);
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  };

  const reset = () => { setState("idle"); setScan(null); setError(null); };

  return { state, scan, error, triggerScan, reset };
}

export async function fetchStoredScan(deviceId: string): Promise<HardwareScanResult | null> {
  try {
    const res = await fetch(`${API}/v1/providers/${deviceId}/hardware`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}
