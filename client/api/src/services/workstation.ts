/**
 * GPU matching for workstations, GPU containers and endpoint replicas (docs/WORKSTATIONS.md §3, docs/PRICES_USD.md).
 * Pure helpers, no I/O.
 *
 * GPUs are not tracked individually: a node's GPUs that match a request (tier, vRAM) minus the GPUs its live
 * deployments hold must cover the request. Conservative on mixed-GPU nodes.
 */
import { gpuTier, requestTier, type GpuTier } from "../../../../shared/gpu-tier.js";

export { gpuTier, requestTier, type GpuTier };

export interface Gpu {
  name: string;
  vramGB: number;
}
export interface GpuRequest {
  count: number;
  minVramGb?: number;
  /** A tier; legacy any / consumer / datacenter are read through requestTier. */
  class?: string;
}

/** The node's GPUs that satisfy the request's tier and vRAM (ignores count). */
export function eligibleGpus(gpus: Gpu[], req: GpuRequest): Gpu[] {
  const tier = requestTier(req.class);
  return gpus.filter((g) => g.vramGB >= (req.minVramGb ?? 0) && gpuTier(g) === tier);
}

/** Whether `req` fits on a node with `gpus`, `used` of which are held by its live deployments. */
export function gpusFit(gpus: Gpu[], used: number, req: GpuRequest | undefined): boolean {
  if (!req || req.count === 0) return true;
  return eligibleGpus(gpus, req).length - used >= req.count;
}
