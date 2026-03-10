import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Cpu, HardDrive, Monitor, Zap, CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";
import { useHardwareScan } from "@/hooks/useHardwareScan";

const TIER_COLOR: Record<string, string> = {
  T1: "border-white/20 text-muted-foreground",
  T2: "border-blue-500/30 text-blue-400",
  T3: "border-green-500/30 text-green-400",
  T4: "border-purple-500/30 text-purple-400",
  T5: "border-yellow-500/30 text-yellow-400",
};
const TIER_LABEL: Record<string, string> = {
  T1: "Edge Node", T2: "Consumer", T3: "Prosumer", T4: "Professional", T5: "Enterprise",
};

function GPURow({ gpu }: { gpu: { vendor: string; name: string; vramGB: number; driverVersion: string; utilizationPct: number; tflops: number } }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5 border-b border-white/5 last:border-0 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <Monitor className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="truncate font-medium">{gpu.name}</span>
        <Badge variant="outline" className="text-xs border-white/15 text-muted-foreground shrink-0">
          {gpu.vendor}
        </Badge>
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
        {gpu.vramGB > 0 && <span>{gpu.vramGB} GB VRAM</span>}
        {gpu.tflops > 0 && <span>{gpu.tflops} TFLOPS</span>}
        {gpu.utilizationPct > 0 && (
          <span className={gpu.utilizationPct > 80 ? "text-amber-400" : "text-green-400"}>
            {gpu.utilizationPct}% util
          </span>
        )}
      </div>
    </div>
  );
}

interface Props {
  endpoint: string;
  deviceId?: string;
}

export function HardwareScanCard({ endpoint, deviceId }: Props) {
  const { state, scan, error, triggerScan, reset } = useHardwareScan();

  const tier = scan?.tier ?? "T1";
  const verifiedAgo = scan?.verifiedAt
    ? Math.round((Date.now() - scan.verifiedAt) / 1000)
    : null;

  return (
    <Card className="p-6 border-white/10">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            Hardware Verification
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Orchestrator scans your provider node directly to verify hardware claims.
          </p>
        </div>

        {state === "idle" && (
          <Button size="sm" onClick={() => triggerScan(endpoint)} className="shrink-0">
            Scan Hardware
          </Button>
        )}
        {state === "scanning" && (
          <Button size="sm" disabled className="shrink-0">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Scanning...
          </Button>
        )}
        {(state === "done" || state === "error") && (
          <Button size="sm" variant="outline" onClick={reset} className="shrink-0 border-white/10 gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Re-scan
          </Button>
        )}
      </div>

      {state === "scanning" && (
        <div className="text-sm text-muted-foreground animate-pulse">
          Connecting to provider node &middot; running nvidia-smi &middot; computing Compute Score...
        </div>
      )}

      {state === "error" && (
        <div className="flex items-center gap-2 text-sm text-red-400 rounded-lg border border-red-500/20 bg-red-500/5 p-3">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error ?? "Scan failed. Is the provider node running and reachable?"}</span>
        </div>
      )}

      {state === "done" && scan && (
        <div className="space-y-4">
          {/* Tier + CS header */}
          <div className="flex items-center gap-3 flex-wrap">
            <Badge variant="outline" className={`${TIER_COLOR[tier]} text-sm px-3 py-1`}>
              {tier} &mdash; {TIER_LABEL[tier] ?? tier}
            </Badge>
            <div className="flex items-center gap-1.5 text-sm">
              <Zap className="h-3.5 w-3.5 text-primary" />
              <span className="font-bold text-primary">{scan.computeScore.toLocaleString()}</span>
              <span className="text-muted-foreground">Compute Score</span>
            </div>
            <div className="flex items-center gap-1 text-xs text-green-400 ml-auto">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>Verified {verifiedAgo != null ? `${verifiedAgo}s ago` : "just now"}</span>
            </div>
          </div>

          {/* Stat grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3 rounded-lg bg-white/5 border border-white/8">
              <div className="flex items-center gap-1.5 mb-1">
                <Cpu className="h-3.5 w-3.5 text-blue-400" />
                <span className="text-xs text-muted-foreground">CPU</span>
              </div>
              <p className="text-sm font-semibold">{scan.cpu.threads} threads</p>
              <p className="text-xs text-muted-foreground truncate mt-0.5">{scan.cpu.model}</p>
            </div>
            <div className="p-3 rounded-lg bg-white/5 border border-white/8">
              <div className="flex items-center gap-1.5 mb-1">
                <HardDrive className="h-3.5 w-3.5 text-green-400" />
                <span className="text-xs text-muted-foreground">RAM</span>
              </div>
              <p className="text-sm font-semibold">{scan.ramGB} GB</p>
              <p className="text-xs text-muted-foreground mt-0.5">system RAM</p>
            </div>
            <div className="p-3 rounded-lg bg-white/5 border border-white/8">
              <div className="flex items-center gap-1.5 mb-1">
                <HardDrive className="h-3.5 w-3.5 text-purple-400" />
                <span className="text-xs text-muted-foreground">Storage</span>
              </div>
              <p className="text-sm font-semibold">
                {scan.disk.freeGB != null ? `${scan.disk.freeGB} GB free` : "N/A"}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {scan.disk.totalGB != null ? `of ${scan.disk.totalGB} GB` : ""}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-white/5 border border-white/8">
              <div className="flex items-center gap-1.5 mb-1">
                <Monitor className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs text-muted-foreground">GPUs</span>
              </div>
              <p className="text-sm font-semibold">{scan.gpus.length} detected</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {scan.gpus.reduce((s, g) => s + g.tflops, 0).toFixed(1)} TFLOPS total
              </p>
            </div>
          </div>

          {/* GPU list */}
          {scan.gpus.length > 0 && (
            <div className="rounded-lg border border-white/8 bg-white/3 p-3">
              <p className="text-xs font-medium text-muted-foreground mb-2">GPU Details</p>
              {scan.gpus.map((gpu, i) => (
                <GPURow key={i} gpu={gpu} />
              ))}
            </div>
          )}

          {scan.gpus.length === 0 && (
            <div className="text-xs text-muted-foreground rounded-lg border border-white/8 bg-white/3 p-3">
              No GPU detected &mdash; CPU-only node. Install <code className="font-mono text-blue-400">nvidia-smi</code> or <code className="font-mono text-blue-400">rocm-smi</code> on the provider for GPU detection.
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Node: <span className="font-mono text-blue-400">{scan.hostname}</span>
            &nbsp;&middot;&nbsp;
            Endpoint: <span className="font-mono text-xs">{scan.endpoint}</span>
          </p>
        </div>
      )}
    </Card>
  );
}
