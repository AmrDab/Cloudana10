import { Progress } from "@/components/ui/progress";
import { bytesToShrink, roundDecimal } from "@/lib/provider-utils";

export interface NetworkCapacityProps {
  activeCPU: number;
  totalCPU: number;
  activeGPU: number;
  totalGPU: number;
  activeMemory: number;
  totalMemory: number;
  activeStorage: number;
  totalStorage: number;
  /** Use 2x2 grid for narrow panels (e.g. stats left of map) */
  compact?: boolean;
}

export function NetworkCapacity({
  activeCPU,
  totalCPU,
  activeGPU,
  totalGPU,
  activeMemory,
  totalMemory,
  activeStorage,
  totalStorage,
  compact = false,
}: NetworkCapacityProps) {
  const cpuPct = totalCPU > 0 ? (activeCPU / totalCPU) * 100 : 0;
  const gpuPct = totalGPU > 0 ? (activeGPU / totalGPU) * 100 : 0;
  const memPct = totalMemory > 0 ? (activeMemory / totalMemory) * 100 : 0;
  const storagePct = totalStorage > 0 ? (activeStorage / totalStorage) * 100 : 0;

  const am = bytesToShrink(activeMemory);
  const tm = bytesToShrink(totalMemory);
  const as = bytesToShrink(activeStorage);
  const ts = bytesToShrink(totalStorage);

  return (
    <div
      className={
        compact
          ? "grid grid-cols-2 gap-4"
          : "grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4"
      }
    >
      <div className="space-y-2">
        <p className="text-sm font-semibold tracking-tight">CPU</p>
        <p className="text-muted-foreground text-xs">
          {Math.round(activeCPU)} / {Math.round(totalCPU)} CPU
        </p>
        <Progress value={cpuPct} className="h-2" />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-semibold tracking-tight">GPU</p>
        <p className="text-muted-foreground text-xs">
          {Math.round(activeGPU)} / {Math.round(totalGPU)} GPU
        </p>
        <Progress value={gpuPct} className="h-2" />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-semibold tracking-tight">Memory</p>
        <p className="text-muted-foreground text-xs">
          {roundDecimal(am.value, 2)} {am.unit} / {roundDecimal(tm.value, 2)} {tm.unit}
        </p>
        <Progress value={memPct} className="h-2" />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-semibold tracking-tight">Storage</p>
        <p className="text-muted-foreground text-xs">
          {roundDecimal(as.value, 2)} {as.unit} / {roundDecimal(ts.value, 2)} {ts.unit}
        </p>
        <Progress value={storagePct} className="h-2" />
      </div>
    </div>
  );
}
