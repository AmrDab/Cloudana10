// Classifies hardware scan results into a NodeTier enum that mirrors
// the ProviderMinter.sol contract's NodeTier enum.

import type { HardwareScanResult } from "@/hooks/useHardwareScan";

/** Must match ProviderMinter.sol NodeTier enum order exactly */
export enum NodeTier {
  CPU_ONLY = 0,
  EDGE_RELAY = 1,
  STORAGE = 2,
  GPU_MID = 3,
  GPU_HIGH = 4,
}

export const NODE_TIER_LABELS: Record<NodeTier, string> = {
  [NodeTier.CPU_ONLY]: "CPU Only",
  [NodeTier.EDGE_RELAY]: "Edge Relay",
  [NodeTier.STORAGE]: "Storage",
  [NodeTier.GPU_MID]: "GPU Mid-Range",
  [NodeTier.GPU_HIGH]: "GPU High-End",
};

export const NODE_TIER_DESCRIPTIONS: Record<NodeTier, string> = {
  [NodeTier.CPU_ONLY]: "Standard compute node with CPU-only workloads",
  [NodeTier.EDGE_RELAY]: "Lightweight edge node for low-latency relay tasks",
  [NodeTier.STORAGE]: "High-capacity storage node (2TB+ disk, no GPU)",
  [NodeTier.GPU_MID]: "Mid-range GPU node for inference and rendering",
  [NodeTier.GPU_HIGH]: "High-end GPU node for training and HPC workloads",
};

/**
 * Classify a hardware scan into a NodeTier.
 *
 * Priority:
 * 1. GPU_HIGH: any GPU with >= 16 GB VRAM or >= 20 TFLOPS
 * 2. GPU_MID:  any GPU present (< 16 GB VRAM)
 * 3. STORAGE:  no GPU, disk >= 2 TB
 * 4. EDGE_RELAY: no GPU, low RAM (<= 8 GB) or low CPU (<= 4 threads)
 * 5. CPU_ONLY: everything else
 */
export function classifyNodeTier(scan: HardwareScanResult): NodeTier {
  const hasGpu = scan.gpus && scan.gpus.length > 0;

  if (hasGpu) {
    const bestGpu = scan.gpus.reduce((best, gpu) => {
      const score = gpu.vramGB + gpu.tflops;
      const bestScore = best.vramGB + best.tflops;
      return score > bestScore ? gpu : best;
    }, scan.gpus[0]);

    if (bestGpu.vramGB >= 16 || bestGpu.tflops >= 20) {
      return NodeTier.GPU_HIGH;
    }
    return NodeTier.GPU_MID;
  }

  // No GPU path
  const diskTotalGB = scan.disk?.totalGB ?? 0;
  if (diskTotalGB >= 2000) {
    return NodeTier.STORAGE;
  }

  if (scan.ramGB <= 8 || scan.cpu.threads <= 4) {
    return NodeTier.EDGE_RELAY;
  }

  return NodeTier.CPU_ONLY;
}

/**
 * Classify from manual specs (for the calculator page).
 */
export function classifyFromSpecs(specs: {
  cpuThreads: number;
  ramGB: number;
  diskTB: number;
  hasGpu: boolean;
  gpuVramGB: number;
  gpuTflops: number;
}): NodeTier {
  if (specs.hasGpu) {
    if (specs.gpuVramGB >= 16 || specs.gpuTflops >= 20) {
      return NodeTier.GPU_HIGH;
    }
    return NodeTier.GPU_MID;
  }

  if (specs.diskTB >= 2) {
    return NodeTier.STORAGE;
  }

  if (specs.ramGB <= 8 || specs.cpuThreads <= 4) {
    return NodeTier.EDGE_RELAY;
  }

  return NodeTier.CPU_ONLY;
}
