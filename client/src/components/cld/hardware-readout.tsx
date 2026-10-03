// "What a node sees": this browser's own hardware, read from navigator / WebGPU / WebGL.
// Ported from the landing page. Honest about what browsers mask.
import { useEffect, useState } from "react";

export type Hardware = { gpu: string; webgpu: boolean; threads: number; memoryGb: number | null };

export async function detectHardware(): Promise<Hardware> {
  const threads = navigator.hardwareConcurrency || 0;
  const memoryGb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null;
  let gpu = "";
  let webgpu = false;
  try {
    const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<any> } };
    if (nav.gpu) {
      const ad = await nav.gpu.requestAdapter();
      if (ad) {
        webgpu = true;
        const info = ad.info || (ad.requestAdapterInfo ? await ad.requestAdapterInfo() : null);
        if (info) gpu = [info.description, info.architecture, info.vendor].filter(Boolean).join(" · ");
      }
    }
  } catch {
    /* adapter unavailable */
  }
  if (!gpu) {
    try {
      const gl = document.createElement("canvas").getContext("webgl");
      const dbg = gl?.getExtension("WEBGL_debug_renderer_info");
      if (gl && dbg) gpu = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL));
    } catch {
      /* masked */
    }
  }
  return { gpu, webgpu, threads, memoryGb };
}

export function useHardware() {
  const [hw, setHw] = useState<Hardware | null>(null);
  useEffect(() => {
    let alive = true;
    detectHardware().then((h) => alive && setHw(h));
    return () => {
      alive = false;
    };
  }, []);
  return hw;
}

/** Tier estimate from the browser's view (same rule as the landing page). */
export function tierOf(hw: Hardware): { level: 1 | 2 | 3; label: string } {
  if (hw.threads >= 12 && hw.webgpu) return { level: 3, label: "heavy" };
  if (hw.threads >= 8) return { level: 2, label: "worker" };
  return { level: 1, label: "edge" };
}

export function HardwareReadout({ className }: { className?: string }) {
  const hw = useHardware();
  const rows: [string, string][] = [
    ["GPU", hw ? hw.gpu || "masked by this browser" : "detecting…"],
    ["CPU threads", hw ? (hw.threads ? `${hw.threads} threads` : "not exposed") : "—"],
    ["Memory", hw ? (hw.memoryGb ? `≥ ${hw.memoryGb} GB (browser cap)` : "not exposed") : "—"],
  ];
  const tier = hw ? tierOf(hw) : null;
  return (
    <div className={className}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 font-mono text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-[11px] tracking-[.06em] text-faint uppercase">{k}</dt>
            <dd className="min-w-0 truncate text-muted-foreground" title={v}>
              {v}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-4" aria-label={tier ? `Browser estimate: tier ${tier.level}, ${tier.label}` : "Estimating tier"}>
        <div className="grid grid-cols-3 gap-1">
          {[1, 2, 3].map((l) => (
            <i key={l} className={`h-1 rounded-sm transition-colors duration-400 ${tier && l <= tier.level ? "bg-ok" : "bg-[rgba(148,163,184,.12)]"}`} />
          ))}
        </div>
        <div className="mt-2 grid grid-cols-3 font-mono text-[11px] tracking-[.06em] text-faint uppercase" aria-hidden>
          <span>edge</span>
          <span className="text-center">worker</span>
          <span className="text-right">heavy</span>
        </div>
      </div>
    </div>
  );
}
