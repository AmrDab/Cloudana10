/**
 * Hardware scan service: calls GET /hardware-scan on a provider node, validates
 * the response, and persists it to KV. Used for provider capacity verification.
 */
import { getKV } from "../lib/storage.js";
import { log } from "../lib/logger.js";

const L = log.api;
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

function kvKey(deviceId: string): string {
  return `hardware:${deviceId}`;
}

/**
 * The scan endpoint is caller-supplied and we fetch it server-side, so it must
 * not be usable to probe our own network. Only public http(s) origins pass.
 */
export function validateProviderEndpoint(raw: string): { ok: true; url: string } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "endpoint must be an absolute http(s) URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "endpoint must use http or https" };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "endpoint must not contain credentials" };
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isPrivateHost(host)) {
    return { ok: false, reason: "endpoint must be a publicly reachable host" };
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return { ok: true, url: url.toString() };
}

/**
 * Defeat DNS rebinding on the Node orchestrator: resolve the hostname and refuse
 * if any address is private. Cloudflare Workers expose no resolver, but the
 * platform itself blocks outbound requests to private ranges, so there the
 * hostname check is sufficient. Not a full fix (no connection pinning) — the
 * window between this lookup and fetch's own is small but non-zero.
 */
async function assertResolvesPublic(host: string): Promise<void> {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":")) return; // literal IP already checked
  let dns: typeof import("node:dns/promises");
  try {
    dns = await import("node:dns/promises");
  } catch {
    return; // Workers runtime
  }
  const records = await dns.lookup(host, { all: true });
  if (!records.length) throw new Error("endpoint hostname does not resolve");
  for (const r of records) {
    if (isPrivateHost(r.address.toLowerCase())) {
      throw new Error("endpoint resolves to a private address");
    }
  }
}

function isPrivateHost(host: string): boolean {
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||   // carrier NAT
      (a === 169 && b === 254) ||             // link-local / cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224                                // multicast / reserved
    );
  }
  if (host.includes(":")) {
    // IPv6: loopback, unspecified, unique-local, link-local, v4-mapped.
    return host === "::1" || host === "::" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith("::ffff:");
  }
  return false;
}

/**
 * Trigger a hardware scan by calling the provider's /hardware-scan endpoint.
 * Validates the response structure and persists to KV.
 */
export async function scanProviderHardware(endpoint: string): Promise<HardwareScanResult> {
  const url = `${endpoint.replace(/\/+$/, "")}/hardware-scan`;
  await assertResolvesPublic(new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase());
  L.info(`[HardwareScan] Fetching ${url}`);

  // `redirect: "manual"` — a public host must not be able to bounce us to a private one.
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000), redirect: "manual" });
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

  const kv = getKV();
  await kv.put(kvKey(record.deviceId), JSON.stringify(record));

  L.info(`[HardwareScan] Stored: deviceId=${record.deviceId} tier=${record.tier} CS=${record.computeScore} GPUs=${record.gpus.length}`);
  return record;
}

/** Retrieve the latest stored scan for a device. */
export async function getHardwareScan(deviceId: string): Promise<HardwareScanResult | null> {
  const kv = getKV();
  const raw = await kv.get(kvKey(deviceId));
  if (!raw) return null;
  return JSON.parse(raw) as HardwareScanResult;
}

/** Return true if a fresh scan exists (scanned within the last 24 h). */
export async function isHardwareScanFresh(deviceId: string): Promise<boolean> {
  const scan = await getHardwareScan(deviceId);
  if (!scan) return false;
  return Date.now() - scan.verifiedAt < SCAN_STALE_MS;
}
