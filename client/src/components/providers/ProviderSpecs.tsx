import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";
import { LabelValue } from "./LabelValue";
import type { ClientProviderDetail } from "@/lib/provider-types";
import { uniqueGpuModels } from "@/lib/provider-utils";

type Props = { provider: ClientProviderDetail };

function formatSpeed(mb: number | undefined): string | undefined {
  if (mb == null || !Number.isFinite(mb)) return undefined;
  return `${mb} Mbps`;
}

export function ProviderSpecs({ provider }: Props) {
  const gpuModels = uniqueGpuModels(provider.gpuModels);
  const gpuCount = provider.gpuCount ?? 0;
  const hasGpu = gpuCount > 0 || gpuModels.length > 0 || provider.gpuModel;
  const gpuLabel = provider.hardwareGpuVendor ?? provider.gpuModel;
  const gpuValue = !hasGpu
    ? "No GPU"
    : gpuLabel
      ? [gpuLabel, provider.gpuCount != null && provider.gpuCount > 0 ? `×${provider.gpuCount}` : null, provider.gpuMemory ? `(${provider.gpuMemory})` : null]
          .filter(Boolean)
          .join(" ")
      : undefined;
  const cpuLabel = provider.hardwareCpu ?? provider.cpuModel;
  const cpuValue = cpuLabel
    ? provider.cpuCores != null && provider.cpuCores > 0 ? `${cpuLabel} (${provider.cpuCores} cores)` : cpuLabel
    : provider.cpuCores != null && provider.cpuCores > 0 ? `${provider.cpuCores} cores` : undefined;
  const ramValue = provider.hardwareMemory ?? provider.ramTotal;
  const diskValue = provider.hardwareDisk ?? provider.storageTotal;
  
  // Check if critical data is missing (indicates IPFS fetch failure)
  const hasCriticalData = (provider.cpuCores && provider.cpuCores > 0) || 
                          (provider.ramTotal && provider.ramTotal !== "") ||
                          (provider.storageTotal && provider.storageTotal !== "");

  return (
    <>
      {!hasCriticalData && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          <p className="text-amber-600 dark:text-amber-400">
            ⚠️ Hardware specifications not available. IPFS metadata may be unreachable or incomplete.
          </p>
        </div>
      )}
      <Card className="border-white/5 bg-card/60">
        <CardContent className="grid grid-cols-1 gap-4 pt-6 sm:grid-cols-2">
        <div className="space-y-1">
          <LabelValue label="GPU" value={gpuValue} />
          <LabelValue label="GPU Models" value={gpuModels.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {gpuModels.map((g) => (
                <Badge key={g} variant="secondary">{g}</Badge>
              ))}
            </div>
          ) : undefined} />
          <LabelValue label="CPU" value={cpuValue} />
          <LabelValue label="CPU Architecture" value={provider.hardwareCpuArch} />
          <LabelValue label="RAM" value={ramValue} />
          <LabelValue label="Disk" value={diskValue} />
          <LabelValue
            label="Persistent Storage"
            value={provider.featPersistentStorage ? <Check className="text-primary h-4 w-4" /> : undefined}
          />
          <LabelValue label="Persistent Disk Type" value={provider.featPersistentStorageType} />
        </div>
        <div className="space-y-1">
          <LabelValue label="Download speed" value={formatSpeed(provider.networkSpeedDown)} />
          <LabelValue label="Upload speed" value={formatSpeed(provider.networkSpeedUp)} />
          <LabelValue label="Network Provider" value={provider.networkProvider} />
        </div>
      </CardContent>
    </Card>
    </>
  );
}
