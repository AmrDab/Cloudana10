/**
 * Hardware scan service: calls GET /hardware-scan on a provider node, validates
 * the response, and persists it to MongoDB. Used for provider capacity verification.
 */
import { getDb } from "../lib/mongo.js";
import { log } from "../lib/logger.js";

const L = log.api;
const COLLECTION = "hardware_scans";
const SCAN_STALE_MS = 24 * 60 * 60 * 1000; // consider stale after 24 h

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
  signature: string;
  // Added by orchestrator
  verifiedAt: number;
  endpoint: string;
}

/**
 * Trigger a hardware scan by calling the provider's /hardware-scan endpoint.
 * Validates the response structure and persists to MongoDB.
 */
export async function scanProviderHardware(endpoint: string): Promise<HardwareScanResult> {
  const url = `${endpoint.replace(/\/+$/, "")}/hardware-scan`;
  L.info(`[HardwareScan] Fetching ${url}`);

  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`Provider returned HTTP ${res.status}`);

  const data = await res.json() as Partial<HardwareScanResult>;

  if (!data.deviceId || typeof data.computeScore !== "number" || !Array.isArray(data.gpus)) {
    throw new Error("Invalid hardware-scan response: missing required fields");
  }

  const record: HardwareScanResult = {
    deviceId: data.deviceId,
    hostname: data.hostname ?? "unknown",
    scannedAt: data.scannedAt ?? Date.now(),
    cpu: data.cpu ?? { model: "unknown", threads: 0 },
    ramGB: data.ramGB ?? 0,
    disk: data.disk ?? { totalGB: null, freeGB: null },
    gpus: data.gpus,
    computeScore: data.computeScore,
    tier: data.tier ?? "T1",
    signature: data.signature ?? "",
    verifiedAt: Date.now(),
    endpoint,
  };

  const db = await getDb();
  await db.collection(COLLECTION).updateOne(
    { deviceId: record.deviceId },
    { $set: record },
    { upsert: true }
  );

  L.info(`[HardwareScan] Stored: deviceId=${record.deviceId} tier=${record.tier} CS=${record.computeScore} GPUs=${record.gpus.length}`);
  return record;
}

/** Retrieve the latest stored scan for a device. */
export async function getHardwareScan(deviceId: string): Promise<HardwareScanResult | null> {
  const db = await getDb();
  return db.collection<HardwareScanResult>(COLLECTION).findOne(
    { deviceId },
    { projection: { _id: 0 } }
  ) as Promise<HardwareScanResult | null>;
}

/** Return true if a fresh scan exists (scanned within the last 24 h). */
export async function isHardwareScanFresh(deviceId: string): Promise<boolean> {
  const scan = await getHardwareScan(deviceId);
  if (!scan) return false;
  return Date.now() - scan.verifiedAt < SCAN_STALE_MS;
}
