import { useMemo } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useProviderDetail } from "@/hooks/useProviders";
import { ProviderDetailLayout, ProviderDetailTabs } from "@/components/providers/ProviderDetailLayout";
import { LabelValue } from "@/components/providers/LabelValue";
import { CopyableTruncated } from "@/components/providers/CopyableTruncated";
import { ProviderSpecs } from "@/components/providers/ProviderSpecs";
import { NetworkCapacity } from "@/components/providers/NetworkCapacity";

interface ProviderDetailPageProps {
  params?: { owner?: string };
}

/** URL param is deviceId (unique provider key). Decode for use in API. */
export default function ProviderDetailPage({ params }: ProviderDetailPageProps) {
  const deviceIdParam = params?.owner ?? "";
  const deviceId = deviceIdParam ? decodeURIComponent(deviceIdParam) : "";
  const { data: provider, isLoading, refetch } = useProviderDetail(deviceId);

  if (!params || !deviceIdParam) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner className="h-10 w-10 text-primary" />
      </div>
    );
  }

  const refresh = () => refetch();

  const networkCapacity = useMemo(() => {
    if (!provider) return null;
    // Defensive checks for stats objects
    const emptyStats = { cpu: 0, gpu: 0, memory: 0, storage: 0 };
    const a = provider.activeStats || emptyStats;
    const p = provider.pendingStats || emptyStats;
    const v = provider.availableStats || emptyStats;
    const totalCpu = ((a.cpu || 0) + (p.cpu || 0) + (v.cpu || 0)) / 1000;
    const totalGpu = (a.gpu || 0) + (p.gpu || 0) + (v.gpu || 0);
    const totalMem = (a.memory || 0) + (p.memory || 0) + (v.memory || 0);
    const totalStorage = (a.storage || 0) + (p.storage || 0) + (v.storage || 0);
    if (totalCpu + totalGpu + totalMem + totalStorage === 0) return null;
    return {
      activeCPU: ((a.cpu || 0) + (p.cpu || 0)) / 1000,
      totalCPU: totalCpu,
      activeGPU: (a.gpu || 0) + (p.gpu || 0),
      totalGPU: totalGpu,
      activeMemory: (a.memory || 0) + (p.memory || 0),
      totalMemory: totalMem,
      activeStorage: (a.storage || 0) + (p.storage || 0),
      totalStorage,
    };
  }, [provider]);

  const wasRecentlyOnline = provider && (provider.isOnline);

  return (
    <ProviderDetailLayout
      address={deviceId}
      page={ProviderDetailTabs.DETAIL}
      refresh={refresh}
      provider={provider ?? null}
    >
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Spinner className="h-10 w-10 text-primary" />
        </div>
      )}

      {!isLoading && provider && !wasRecentlyOnline && (
        <Alert variant="destructive" className="border-amber-500/50 bg-amber-500/10">
          <AlertDescription>This provider is inactive.</AlertDescription>
        </Alert>
      )}

      {!isLoading && provider && wasRecentlyOnline && networkCapacity && (
        <div className="space-y-6">
          <div>
            <NetworkCapacity
              activeCPU={networkCapacity.activeCPU}
              totalCPU={networkCapacity.totalCPU}
              activeGPU={networkCapacity.activeGPU}
              totalGPU={networkCapacity.totalGPU}
              activeMemory={networkCapacity.activeMemory}
              totalMemory={networkCapacity.totalMemory}
              activeStorage={networkCapacity.activeStorage}
              totalStorage={networkCapacity.totalStorage}
            />
          </div>
        </div>
      )}

      {!isLoading && provider && (
        <>
          <div className="mb-6 mt-6">
            <h2 className="mb-4 text-lg font-semibold tracking-tight">General Info</h2>
            <Card className="border-white/5 bg-card/60">
              <CardContent className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
                <div>
                  <div className="mb-2">
                  <span className="text-muted-foreground text-xs">Host</span>
                  <div className="text-sm font-medium">
                    <CopyableTruncated value={provider.hostUri} truncateLength={36} link />
                  </div>
                </div>
                {provider.website != null && provider.website !== "" && (
                  <div className="mb-2">
                    <span className="text-muted-foreground text-xs">Website</span>
                    <div className="text-sm font-medium">
                      <CopyableTruncated value={provider.website} truncateLength={36} link />
                    </div>
                  </div>
                )}
                  <LabelValue label="Country" value={provider.country ?? provider.ipCountry} />
                  <LabelValue label="Region" value={provider.region ?? provider.ipRegion} />
                  <LabelValue label="City" value={provider.city} />
                </div>
                <div>
                  <LabelValue label="Email" value={provider.email} />
                  <LabelValue label="Organization" value={provider.organization} />
                  <LabelValue label="Tier" value={provider.tier} />
                </div>
              </CardContent>
            </Card>
          </div>

          <h2 className="mb-4 text-lg font-semibold tracking-tight">Specs</h2>
          <div className="mb-6">
            <ProviderSpecs provider={provider} />
          </div>

          {provider.error != null && provider.error !== "" && (
            <>
              <h2 className="mb-4 text-lg font-semibold tracking-tight">Stats</h2>
              <Card className="mb-6 border-white/5 bg-card/60">
                <CardContent className="pt-6">
                  <LabelValue label="Errors" value={provider.error} />
                </CardContent>
              </Card>
            </>
          )}

          {provider.attributes && provider.attributes.length > 0 && (
            <>
              <h2 className="mb-4 text-lg font-semibold tracking-tight">Raw attributes</h2>
              <Card className="border-white/5 bg-card/60">
                <CardContent className="pt-6">
                  {provider.attributes.map((x) => (
                    <LabelValue key={x.key} label={x.key} value={x.value} />
                  ))}
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}

      {!isLoading && !deviceId && <p className="text-muted-foreground">Missing provider.</p>}
      {!isLoading && deviceId && !provider && <p className="text-muted-foreground">Provider not found.</p>}
    </ProviderDetailLayout>
  );
}
