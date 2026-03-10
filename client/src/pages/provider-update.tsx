import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Loader2, Server, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useProviderDetail } from "@/hooks/useProviders";
import { useUpdateProvider } from "@/lib/contracts";
import { useWallet } from "@/context/wallet-context";
import { getPrepareRegistration } from "@/lib/api";
import { uploadToIPFS, type ProviderMetadata } from "@/lib/api";
import { providerUrls } from "@/lib/provider-urls";
import type { ClientProviderDetail } from "@/lib/provider-types";
import { useQueryClient } from "@tanstack/react-query";

interface ProviderUpdatePageProps {
  params?: { owner?: string };
}

/** Parse "64 GB", "1.5 TB" or "500" (no unit = GB) to number of GB. */
function parseRamOrStorageToGB(capacityValue: string | undefined): number {
  if (capacityValue == null || capacityValue === "") return 0;
  const capacityString = capacityValue.trim().toLowerCase();
  const numericValue = parseFloat(capacityString.replace(/[^\d.]/g, ""));
  if (Number.isNaN(numericValue)) return 0;
  if (capacityString.includes("tb")) return numericValue * 1024;
  return numericValue;
}

export default function ProviderUpdatePage({ params }: ProviderUpdatePageProps) {
  const deviceIdParam = params?.owner ?? "";
  const deviceId = deviceIdParam ? decodeURIComponent(deviceIdParam) : "";
  const effectiveDeviceId = deviceId && deviceId.startsWith("0x") ? (deviceId as `0x${string}`) : null;

  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { userAddress, isConnected } = useWallet();
  const { data: provider, isLoading: providerLoading } = useProviderDetail(deviceId);
  const { update, isPending: isUpdating, isSuccess, reset } = useUpdateProvider();

  const [preparationData, setPreparationData] = useState<{ real_spec: { cpuCores: number; memoryTotalBytes: number; diskTotalBytes?: number | null } | null } | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cpuCores, setCpuCores] = useState(0);
  const [ramGB, setRamGB] = useState(0);
  const [storageGB, setStorageGB] = useState(0);
  const [tier, setTier] = useState("");
  const [region, setRegion] = useState("");
  const [organization, setOrganization] = useState("");
  const [email, setEmail] = useState("");
  const [capacity, setCapacity] = useState<number | "">("");
  const [endpoint, setEndpoint] = useState("");

  const isOwner = isConnected && !!provider?.owner && !!userAddress && provider.owner.toLowerCase() === userAddress.toLowerCase();

  useEffect(() => {
    if (!deviceId) return;
    getPrepareRegistration(deviceId).then((registrationData) => {
      setPreparationData(registrationData ? { real_spec: registrationData.real_spec } : null);
    }).catch(() => setPreparationData(null));
  }, [deviceId]);

  useEffect(() => {
    if (!provider) return;
    setName(provider.name ?? "");
    setDescription(provider.description ?? "");
    setCpuCores(provider.cpuCores ?? 0);
    setRamGB(parseRamOrStorageToGB(provider.ramTotal));
    setStorageGB(parseRamOrStorageToGB(provider.storageTotal));
    setTier(provider.tier ?? "");
    setRegion(provider.region ?? provider.ipRegion ?? "");
    setOrganization(provider.organization ?? "");
    setEmail(provider.email ?? "");
    setCapacity(provider.capacity ?? "");
    setEndpoint(provider.hostUri ?? "");
  }, [provider]);

  useEffect(() => {
    if (isSuccess) {
      queryClient.invalidateQueries({ queryKey: ["providerDetail", deviceId] });
      queryClient.invalidateQueries({ queryKey: ["myProviders"] });
      toast({ title: "Provider updated", description: "Metadata has been updated on IPFS and on-chain." });
      reset();
      setLocation(providerUrls.detail(deviceId));
    }
  }, [isSuccess, queryClient, deviceId, toast, reset, setLocation]);

  const maxCpuCores = preparationData?.real_spec?.cpuCores ?? 999;
  const maxRamGigabytes = preparationData?.real_spec ? Math.round(preparationData.real_spec.memoryTotalBytes / (1024 ** 3) * 10) / 10 : 999;
  const maxStorageGigabytes = preparationData?.real_spec?.diskTotalBytes != null ? Math.round(preparationData.real_spec.diskTotalBytes / (1024 ** 3) * 10) / 10 : 999;

  const handleSubmit = async (formEvent: React.FormEvent) => {
    formEvent.preventDefault();
    if (!effectiveDeviceId) return;
    const existingProvider = provider as ClientProviderDetail | null;
    const updatedMetadata: ProviderMetadata = {
      name: name || "Provider",
      description: description || undefined,
      region: region || "global",
      cpuModel: existingProvider?.cpuModel ?? preparationData?.real_spec ? "Unknown" : undefined,
      cpuCores: Math.min(maxCpuCores, Math.max(0, cpuCores)) || undefined,
      ramTotal: Math.min(maxRamGigabytes, Math.max(0, ramGB)) > 0 ? `${Math.min(maxRamGigabytes, Math.max(0, ramGB))} GB` : undefined,
      storageTotal: Math.min(maxStorageGigabytes, Math.max(0, storageGB)) > 0 ? `${Math.min(maxStorageGigabytes, Math.max(0, storageGB))} GB` : undefined,
      tier: tier || undefined,
      organization: organization || undefined,
      email: email || undefined,
      capacity: typeof capacity === "number" ? capacity : undefined,
      hardwareTier: existingProvider?.hardwareTier,
      gpuModel: existingProvider?.gpuModel,
      gpuCount: existingProvider?.gpuCount,
      gpuMemory: existingProvider?.gpuMemory,
      country: existingProvider?.country,
      city: existingProvider?.city,
      website: existingProvider?.website,
      bandwidth: existingProvider?.bandwidth,
      networkType: existingProvider?.networkType,
      endpoint: endpoint || undefined,
      createdAt: new Date().toISOString(),
    };
    try {
      const ipfsCid = await uploadToIPFS(updatedMetadata);
      update(effectiveDeviceId, ipfsCid);
    } catch (error) {
      toast({
        title: "IPFS upload failed",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  if (!params?.owner || !deviceId) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <p>Missing provider.</p>
        <Button variant="link" onClick={() => setLocation(providerUrls.list())}>Back to dashboard</Button>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <p>Connect your wallet to update this provider.</p>
        <Button variant="link" onClick={() => setLocation(providerUrls.list())}>Back to dashboard</Button>
      </div>
    );
  }

  if (providerLoading && !provider) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (provider && !isOwner) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <p>Only the provider owner can update provider info.</p>
        <Button variant="link" onClick={() => setLocation(providerUrls.detail(deviceId))}>Back to provider</Button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-12">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="rounded-full"
          onClick={() => setLocation(providerUrls.detail(deviceId))}
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">Update provider</h1>
      </div>
      <p className="text-muted-foreground text-sm">
        Update your provider node spec and availability. Changes are stored on IPFS and the new metadata URI is saved on-chain.
      </p>

      <Card className="border-white/10 bg-card/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Server className="h-5 w-5" />
            Provider metadata
          </CardTitle>
          <CardDescription>
            Adjust offered capacity and info. Offered values are capped by your node&apos;s real device spec when available.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(changeEvent) => setName(changeEvent.target.value)}
                  placeholder="My Provider"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tier">Tier</Label>
                <Input
                  id="tier"
                  value={tier}
                  onChange={(changeEvent) => setTier(changeEvent.target.value)}
                  placeholder="e.g. community, premium"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                value={description}
                onChange={(changeEvent) => setDescription(changeEvent.target.value)}
                placeholder="Optional description"
              />
            </div>

            <div>
              <h3 className="text-sm font-medium mb-3">Offered capacity (capped by node spec)</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="cpuCores">CPU cores (max {maxCpuCores})</Label>
                  <Input
                    id="cpuCores"
                    type="number"
                    min={0}
                    max={maxCpuCores}
                    value={cpuCores || ""}
                    onChange={(changeEvent) => setCpuCores(parseInt(changeEvent.target.value, 10) || 0)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ramGB">RAM (GB, max {maxRamGigabytes})</Label>
                  <Input
                    id="ramGB"
                    type="number"
                    min={0}
                    max={maxRamGigabytes}
                    step={0.1}
                    value={ramGB || ""}
                    onChange={(changeEvent) => setRamGB(parseFloat(changeEvent.target.value) || 0)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="storageGB">Storage (GB, max {maxStorageGigabytes})</Label>
                  <Input
                    id="storageGB"
                    type="number"
                    min={0}
                    max={maxStorageGigabytes}
                    step={0.1}
                    value={storageGB || ""}
                    onChange={(changeEvent) => setStorageGB(parseFloat(changeEvent.target.value) || 0)}
                  />
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-medium mb-3">Availability & performance</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="capacity">Capacity score (optional)</Label>
                  <Input
                    id="capacity"
                    type="number"
                    min={0}
                    value={capacity === "" ? "" : capacity}
                    onChange={(changeEvent) => setCapacity(changeEvent.target.value === "" ? "" : parseInt(changeEvent.target.value, 10))}
                    placeholder="e.g. 100"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="region">Region</Label>
                  <Input
                    id="region"
                    value={region}
                    onChange={(changeEvent) => setRegion(changeEvent.target.value)}
                    placeholder="e.g. global, us-east"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="organization">Organization</Label>
                <Input
                  id="organization"
                  value={organization}
                  onChange={(changeEvent) => setOrganization(changeEvent.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(changeEvent) => setEmail(changeEvent.target.value)}
                  placeholder="Optional"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="endpoint">Provider node endpoint</Label>
              <Input
                id="endpoint"
                value={endpoint}
                onChange={(changeEvent) => setEndpoint(changeEvent.target.value)}
                placeholder="http://host:4040"
              />
              <p className="text-xs text-muted-foreground">Used by the orchestrator to deploy workloads.</p>
            </div>

            <div className="flex flex-wrap gap-3 pt-4">
              <Button type="submit" disabled={isUpdating}>
                {isUpdating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Updating…
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Save and update on-chain
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setLocation(providerUrls.detail(deviceId))}
                disabled={isUpdating}
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
