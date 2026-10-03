/**
 * GPU matching for workstations (docs/WORKSTATIONS.md §3). Pure helpers, no I/O.
 *
 * GPUs are not tracked individually: a node's GPUs that match a request (vRAM, class) minus the
 * GPUs its live workstations hold must cover the request. Conservative on mixed-GPU nodes.
 */
export type GpuClass = "consumer" | "datacenter";
export interface Gpu {
  name: string;
  vramGB: number;
}
export interface GpuRequest {
  count: number;
  minVramGb?: number;
  class?: "any" | GpuClass;
}

/** Datacenter / professional parts by nvidia-smi name; everything else is consumer. */
const DATACENTER =
  /\b(A100|A800|H100|H200|H800|B100|B200|GH200|L40S?|L4|A10G?|A16|A30|A40|A2|T4|V100|P100|P40|Tesla|Quadro|Instinct|MI\d{3}[A-Z]?)\b|\bRTX\s?(PRO\s?)?\d{4}\s?Ada\b|\bRTX\s?A\d{4}\b|\bRTX\s?PRO\b/i;

export function gpuClass(name: string): GpuClass {
  return DATACENTER.test(name) ? "datacenter" : "consumer";
}

/** The node's GPUs that satisfy the request's vRAM and class (ignores count). */
export function eligibleGpus(gpus: Gpu[], req: GpuRequest): Gpu[] {
  return gpus.filter(
    (g) => g.vramGB >= (req.minVramGb ?? 0) && (!req.class || req.class === "any" || gpuClass(g.name) === req.class),
  );
}

/** Whether `req` fits on a node with `gpus`, `used` of which are held by its live workstations. */
export function gpusFit(gpus: Gpu[], used: number, req: GpuRequest | undefined): boolean {
  if (!req || req.count === 0) return true;
  return eligibleGpus(gpus, req).length - used >= req.count;
}
