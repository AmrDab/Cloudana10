/**
 * GPU price tiers (docs/PRICES_USD.md), shared by the API (placement, price) and the node agent (which devices it
 * hands a container), so both sides always agree on what a GPU is.
 *
 *   h100      H100 / H200 / H800 / H20 / GH200 and Blackwell (B100 / B200 / GB200 / B300)
 *   large     any other GPU with at least 39 GB (A100 40/80, A6000, A40, L40S, RTX 6000 Ada); 39 absorbs nvidia-smi rounding
 *   standard  everything else (RTX 30/40/50, T4, L4, A10…)
 *
 * A request names one tier and is placed only on GPUs of exactly that tier, so an H100 is never rented at the
 * standard price. Requests written before 2026-10-13 used classes any / consumer / datacenter: requestTier maps them.
 */
export const GPU_TIERS = ["standard", "large", "h100"] as const;
export type GpuTier = (typeof GPU_TIERS)[number];

const H100_CLASS = /\b(H100|H200|H800|H20|GH200|B100|B200|GB200|B300)\b/i;
export const LARGE_MIN_VRAM_GB = 39;

export function gpuTier(gpu: { name: string; vramGB: number }): GpuTier {
  if (H100_CLASS.test(gpu.name)) return "h100";
  return gpu.vramGB >= LARGE_MIN_VRAM_GB ? "large" : "standard";
}

/** The tier a request asks for; absent and the legacy "any" / "consumer" mean standard, legacy "datacenter" means large. */
export function requestTier(cls: string | undefined | null): GpuTier {
  if (cls === "large" || cls === "h100") return cls;
  if (cls === "datacenter") return "large";
  return "standard";
}
