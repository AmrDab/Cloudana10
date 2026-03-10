import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Cpu, HardDrive, Server } from "lucide-react";
import { getPrepareRegistration, type RealDeviceSpec, type ProviderMetadata } from "@/lib/api";

function formatBytesToGB(bytes: number): number {
  return Math.round(bytes / (1024 ** 3) * 10) / 10;
}

export interface ConfirmRegisterModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deviceId: string;
  defaultName: string;
  defaultDescription?: string;
  /** Optional: additional metadata fields to preserve (GPU, network, location, etc.) */
  additionalMetadata?: Partial<ProviderMetadata>;
  /** Called with metadata built from real spec (capped) + name/description. Parent uploads to IPFS and registers. */
  onConfirm: (metadata: ProviderMetadata) => void;
  isRegistering?: boolean;
}

export function ConfirmRegisterModal({
  open,
  onOpenChange,
  deviceId,
  defaultName,
  defaultDescription = "",
  additionalMetadata,
  onConfirm,
  isRegistering = false,
}: ConfirmRegisterModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prep, setPrep] = useState<{ device_id: string; real_spec: RealDeviceSpec | null } | null>(null);

  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState(defaultDescription);
  const [offeredCpuCores, setOfferedCpuCores] = useState(0);
  const [offeredRamGB, setOfferedRamGB] = useState(0);
  const [offeredStorageGB, setOfferedStorageGB] = useState(0);

  useEffect(() => {
    setName(defaultName);
    setDescription(defaultDescription ?? "");
  }, [defaultName, defaultDescription]);

  useEffect(() => {
    if (!open || !deviceId) return;
    setError(null);
    setPrep(null);
    setLoading(true);
    getPrepareRegistration(deviceId)
      .then((data) => {
        setPrep(data ?? null);
        if (data?.real_spec) {
          const r = data.real_spec;
          setOfferedCpuCores(r.cpuCores);
          setOfferedRamGB(Math.max(0, formatBytesToGB(r.memoryTotalBytes)));
          setOfferedStorageGB(r.diskTotalBytes != null ? formatBytesToGB(r.diskTotalBytes) : 0);
        } else {
          setOfferedCpuCores(0);
          setOfferedRamGB(0);
          setOfferedStorageGB(0);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load device spec"))
      .finally(() => setLoading(false));
  }, [open, deviceId]);

  const real = prep?.real_spec ?? null;
  const maxCpu = real?.cpuCores ?? 999;
  const maxRamGB = real ? formatBytesToGB(real.memoryTotalBytes) : 999;
  const maxStorageGB = real?.diskTotalBytes != null ? formatBytesToGB(real.diskTotalBytes) : 999;

  const handleConfirm = () => {
    const cpuCores = Math.min(maxCpu, Math.max(0, offeredCpuCores));
    const ramGB = Math.min(maxRamGB, Math.max(0, offeredRamGB));
    const storageGB = Math.min(maxStorageGB, Math.max(0, offeredStorageGB));
    
    // Build metadata: start with any additional metadata passed in, then override with confirmed values
    // This preserves GPU, network, location, and other attributes that were set elsewhere
    const metadata: ProviderMetadata = {
      // Schema version for future compatibility
      schemaVersion: "1.0",
      // Start with additional metadata (GPU, network, location, etc.)
      ...additionalMetadata,
      // Override/set core fields
      name: name || defaultName || "Provider",
      description: description || (additionalMetadata?.description ?? undefined),
      region: additionalMetadata?.region ?? "global",
      // CPU info - preserve model from real spec, use offered cores
      cpuModel: real?.cpuModel ?? additionalMetadata?.cpuModel,
      cpuCores: cpuCores > 0 ? cpuCores : undefined,
      // Preserve CPU attributes if they exist
      cpuThreads: additionalMetadata?.cpuThreads,
      cpuClockSpeed: additionalMetadata?.cpuClockSpeed,
      // Memory - use offered amount
      ramTotal: ramGB > 0 ? `${ramGB} GB` : undefined,
      ramType: additionalMetadata?.ramType,
      // Storage - use offered amount
      storageTotal: storageGB > 0 ? `${storageGB} GB` : undefined,
      storageType: additionalMetadata?.storageType,
      storageSpeed: additionalMetadata?.storageSpeed,
      // GPU info - preserve from additional metadata if set
      gpuModel: additionalMetadata?.gpuModel,
      gpuCount: additionalMetadata?.gpuCount,
      gpuMemory: additionalMetadata?.gpuMemory,
      gpuCudaCores: additionalMetadata?.gpuCudaCores,
      // Network - preserve from additional metadata
      bandwidth: additionalMetadata?.bandwidth,
      networkType: additionalMetadata?.networkType,
      // Location - preserve from additional metadata
      location: additionalMetadata?.location,
      country: additionalMetadata?.country,
      city: additionalMetadata?.city,
      // Contact/org - preserve from additional metadata
      website: additionalMetadata?.website,
      email: additionalMetadata?.email,
      organization: additionalMetadata?.organization,
      // Tier/capacity - preserve from additional metadata
      hardwareTier: additionalMetadata?.hardwareTier,
      capacity: additionalMetadata?.capacity,
      tier: additionalMetadata?.tier,
      // CRITICAL: Endpoint for orchestrator to deploy workloads (provider node URL)
      // The orchestrator needs this to send POST /deploy requests
      endpoint: additionalMetadata?.endpoint,
      // Timestamp
      createdAt: new Date().toISOString(),
    };
    onConfirm(metadata);
  };

  const canConfirm = (name || defaultName) && !isRegistering;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            Confirm registration
          </DialogTitle>
          <DialogDescription>
            Device spec is from your node. Set what you want to offer (cannot exceed real capacity).
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
            {error}
          </div>
        )}

        {!loading && prep && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Provider name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Provider" />
            </div>
            <div className="space-y-2">
              <Label>Description (optional)</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional description" />
            </div>

            {real ? (
              <>
                <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                  <p className="font-medium text-muted-foreground mb-2">Real device spec (from node)</p>
                  <div className="flex flex-wrap gap-4">
                    <span className="flex items-center gap-1"><Cpu className="h-4 w-4" /> {real.cpuModel}, {real.cpuCores} cores</span>
                    <span className="flex items-center gap-1"><HardDrive className="h-4 w-4" /> {formatBytesToGB(real.memoryTotalBytes)} GB RAM</span>
                    {real.diskTotalBytes != null && (
                      <span>{formatBytesToGB(real.diskTotalBytes)} GB disk</span>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Offered CPU cores (max {maxCpu})</Label>
                    <Input
                      type="number"
                      min={0}
                      max={maxCpu}
                      value={offeredCpuCores}
                      onChange={(e) => setOfferedCpuCores(parseInt(e.target.value, 10) || 0)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Offered RAM (GB, max {maxRamGB.toFixed(0)})</Label>
                    <Input
                      type="number"
                      min={0}
                      max={maxRamGB}
                      value={offeredRamGB}
                      onChange={(e) => setOfferedRamGB(parseFloat(e.target.value) || 0)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Offered storage (GB, max {maxStorageGB.toFixed(0)})</Label>
                    <Input
                      type="number"
                      min={0}
                      max={maxStorageGB}
                      value={offeredStorageGB}
                      onChange={(e) => setOfferedStorageGB(parseFloat(e.target.value) || 0)}
                    />
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No device spec from node. You can still register with name and description; spec will be minimal.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isRegistering}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm || loading}>
            {isRegistering ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Registering…</> : "Confirm and register"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
