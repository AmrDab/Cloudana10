import { useState } from "react";
import { ApiError, fetchJson, readJson } from "@/lib/api-error";

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
      const data = await readJson<{ scan: HardwareScanResult }>(res, "Scan failed");
      setScan(data.scan);
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  };

  const reset = () => { setState("idle"); setScan(null); setError(null); };

  return { state, scan, error, triggerScan, reset };
}

/** Stored scan for a device; null when none exists. Other failures throw `ApiError`. */
export async function fetchStoredScan(deviceId: string): Promise<HardwareScanResult | null> {
  try {
    const { status: _status, ...scan } = await fetchJson<HardwareScanResult & { status?: string }>(
      `${API}/v1/providers/${deviceId}/hardware`,
      "Failed to load hardware scan",
    );
    return scan;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}
