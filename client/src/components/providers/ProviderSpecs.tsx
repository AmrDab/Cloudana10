import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";
import { LabelValue } from "./LabelValue";
import type { ClientProviderDetail } from "@/lib/provider-types";
import { uniqueGpuModels } from "@/lib/provider-utils";

type Props = { provider: ClientProviderDetail };

export function ProviderSpecs({ provider }: Props) {
  const gpuModels = uniqueGpuModels(provider.gpuModels);

  return (
    <Card className="border-white/5 bg-card/60">
      <CardContent className="grid grid-cols-1 gap-4 pt-6 sm:grid-cols-2">
        <div>
          <LabelValue label="GPU" value={provider.hardwareGpuVendor ?? provider.gpuModel ?? "Unknown"} />
          <LabelValue label="CPU" value={provider.hardwareCpu ?? provider.cpuModel ?? "Unknown"} />
          <LabelValue label="Memory (RAM)" value={provider.hardwareMemory ?? provider.ramTotal ?? "Unknown"} />
          <LabelValue
            label="Persistent Storage"
            value={provider.featPersistentStorage ? <Check className="text-primary h-4 w-4" /> : undefined}
          />
          <LabelValue label="Download speed" value={provider.networkSpeedDown} />
          <LabelValue label="Network Provider" value={provider.networkProvider} />
        </div>
        <div>
          <LabelValue
            label="GPU Models"
            value={
              gpuModels.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {gpuModels.map((g) => (
                    <Badge key={g} variant="secondary">
                      {g}
                    </Badge>
                  ))}
                </div>
              ) : undefined
            }
          />
          <LabelValue label="CPU Architecture" value={provider.hardwareCpuArch} />
          <LabelValue label="Disk Storage" value={provider.hardwareDisk ?? provider.storageTotal} />
          <LabelValue label="Persistent Disk Storage" value={provider.featPersistentStorageType} />
          <LabelValue label="Upload speed" value={provider.networkSpeedUp} />
        </div>
      </CardContent>
    </Card>
  );
}
