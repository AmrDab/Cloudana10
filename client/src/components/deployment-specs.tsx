import { Cpu, HardDrive, MemoryStick, Gpu } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface SpecDetailListProps {
  cpuAmount: number; // CPU units (millicores / 1000 = cores)
  memoryAmount: bigint; // Memory in bytes
  storageAmount: bigint; // Storage in bytes
  gpuAmount?: number; // GPU count
  className?: string;
}

// Helper to format bytes
function formatBytes(bytes: bigint): { value: number; unit: string } {
  const bytesNum = Number(bytes);
  if (bytesNum === 0) return { value: 0, unit: "B" };
  
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytesNum) / Math.log(k));
  
  return {
    value: bytesNum / Math.pow(k, i),
    unit: sizes[i],
  };
}

// Helper to round decimal
function roundDecimal(value: number, decimals: number): number {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

export function DeploymentSpecs({
  cpuAmount,
  memoryAmount,
  storageAmount,
  gpuAmount = 0,
  className,
}: SpecDetailListProps) {
  const memory = formatBytes(memoryAmount);
  const storage = formatBytes(storageAmount);
  const cpuCores = cpuAmount / 1000; // Convert millicores to cores

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Badge variant="outline" className="border-white/20 bg-white/5 text-xs w-fit">
        <div className="flex items-center gap-1 py-0.5">
          <Cpu className="h-3 w-3" />
          <span>{roundDecimal(cpuCores, 1)} CPU</span>
        </div>
      </Badge>

      {gpuAmount > 0 && (
        <Badge variant="outline" className="border-white/20 bg-white/5 text-xs w-fit">
          <div className="flex items-center gap-1 py-0.5">
            <Gpu className="h-3 w-3" />
            <span>{gpuAmount} GPU</span>
          </div>
        </Badge>
      )}

      <Badge variant="outline" className="border-white/20 bg-white/5 text-xs w-fit">
        <div className="flex items-center gap-1 py-0.5">
          <MemoryStick className="h-3 w-3" />
          <span>{roundDecimal(memory.value, 1)} {memory.unit}</span>
        </div>
      </Badge>

      <Badge variant="outline" className="border-white/20 bg-white/5 text-xs w-fit">
        <div className="flex items-center gap-1 py-0.5">
          <HardDrive className="h-3 w-3" />
          <span>{roundDecimal(storage.value, 1)} {storage.unit}</span>
        </div>
      </Badge>
    </div>
  );
}
