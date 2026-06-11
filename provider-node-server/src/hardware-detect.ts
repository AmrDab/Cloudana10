/**
 * hardware-detect.ts — PLUG-AND-PLAY provider onboarding.
 *
 * The Cloudana promise: a provider flashes/installs once, and the node figures
 * out what it is. No manual spec entry, no marketplace bidding. This module
 * fingerprints the machine, maps it to a NodeTier (matching ProviderMinter.sol),
 * derives a STABLE deviceId, and hands back a registration payload.
 *
 * "We can't cluster GPUs" — correct. So we don't pretend to. Each node self-reports
 * its real capacity; the orchestrator does whole-job routing (and request-level
 * sharding for batch jobs) across independent nodes. A user who wants to run an AI
 * workload picks WHAT they need (model + size + tier); the backend matches it to a
 * node that fits. The heterogeneity is hidden behind that one selection.
 */

import os from "node:os";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";

/** Mirrors ProviderMinter.NodeTier exactly. */
export enum NodeTier {
  CPU_ONLY = 0,
  EDGE_RELAY = 1,
  STORAGE = 2,
  GPU_MID = 3,
  GPU_HIGH = 4,
}

export interface GpuInfo {
  model: string;
  vramMB: number;
}

export interface HardwareProfile {
  cpuModel: string;
  cpuCores: number;
  totalRamMB: number;
  diskGB: number;
  gpus: GpuInfo[];
  tier: NodeTier;
  deviceId: `0x${string}`;
}

/** Detect GPUs via nvidia-smi; returns [] if none / not present. */
function detectGpus(): GpuInfo[] {
  try {
    const out = execSync(
      "nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits",
      { stdio: ["ignore", "pipe", "ignore"], timeout: 5000 },
    ).toString().trim();
    if (!out) return [];
    return out.split("\n").map((line) => {
      const [model, vram] = line.split(",").map((s) => s.trim());
      return { model, vramMB: Number(vram) || 0 };
    });
  } catch {
    return []; // no NVIDIA GPU or driver — treat as CPU node
  }
}

function detectDiskGB(): number {
  try {
    // POSIX df on the data dir; fall back to root.
    const out = execSync("df -k --output=size / | tail -1", {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).toString().trim();
    return Math.round(Number(out) / 1024 / 1024);
  } catch {
    return 0;
  }
}

/** Classify into a tier from the detected profile. */
function classify(cores: number, ramMB: number, diskGB: number, gpus: GpuInfo[]): NodeTier {
  const maxVram = gpus.reduce((m, g) => Math.max(m, g.vramMB), 0);
  if (maxVram >= 24_000) return NodeTier.GPU_HIGH;       // 24GB+ (4090/A100/H100 class)
  if (maxVram >= 8_000) return NodeTier.GPU_MID;          // 8–24GB
  if (diskGB >= 2_000 && ramMB >= 16_000) return NodeTier.STORAGE;
  if (cores <= 2 && ramMB <= 4_000) return NodeTier.EDGE_RELAY;
  return NodeTier.CPU_ONLY;
}

/**
 * Stable device fingerprint. Uses machine-stable identifiers so the SAME box
 * always produces the SAME deviceId (critical for the one-claim-per-device
 * anti-sybil in ProviderMinter). Avoids volatile values (uptime, free mem).
 */
function deriveDeviceId(cpuModel: string, cores: number, gpus: GpuInfo[]): `0x${string}` {
  let machineId = "";
  try {
    machineId = execSync("cat /etc/machine-id 2>/dev/null || true", {
      stdio: ["ignore", "pipe", "ignore"], timeout: 3000,
    }).toString().trim();
  } catch { /* ignore */ }

  const fingerprint = [
    machineId,
    cpuModel,
    String(cores),
    os.hostname(),
    gpus.map((g) => `${g.model}:${g.vramMB}`).join("|"),
  ].join("::");

  return ("0x" + createHash("sha256").update(fingerprint).digest("hex").slice(0, 64)) as `0x${string}`;
}

/** Run the full detection. Call this once at provider node startup. */
export function detectHardware(): HardwareProfile {
  const cpus = os.cpus();
  const cpuModel = cpus[0]?.model?.trim() ?? "unknown";
  const cpuCores = cpus.length;
  const totalRamMB = Math.round(os.totalmem() / 1024 / 1024);
  const diskGB = detectDiskGB();
  const gpus = detectGpus();
  const tier = classify(cpuCores, totalRamMB, diskGB, gpus);
  const deviceId = deriveDeviceId(cpuModel, cpuCores, gpus);

  return { cpuModel, cpuCores, totalRamMB, diskGB, gpus, tier, deviceId };
}

/**
 * Registration payload the installer posts to the orchestrator. The provider
 * signs this with their wallet; no manual spec entry, no bidding. This is the
 * "flash and it just works" path.
 */
export interface RegistrationPayload {
  deviceId: `0x${string}`;
  tier: NodeTier;
  capacity: {
    cpuCores: number;
    ramMB: number;
    diskGB: number;
    gpus: GpuInfo[];
  };
  detectedAt: number;
}

export function buildRegistration(profile: HardwareProfile): RegistrationPayload {
  return {
    deviceId: profile.deviceId,
    tier: profile.tier,
    capacity: {
      cpuCores: profile.cpuCores,
      ramMB: profile.totalRamMB,
      diskGB: profile.diskGB,
      gpus: profile.gpus,
    },
    detectedAt: Date.now(),
  };
}

// CLI: `node hardware-detect.js` prints the profile so an installer can register.
if (process.argv[1] && process.argv[1].endsWith("hardware-detect.js")) {
  const profile = detectHardware();
  console.log(JSON.stringify(buildRegistration(profile), null, 2));
}
