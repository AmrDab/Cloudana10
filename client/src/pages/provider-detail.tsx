import { useMemo } from "react";
import { useRoute } from "wouter";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useProviderDetail } from "@/hooks/useProviders";
import { ProviderDetailLayout, ProviderDetailTabs } from "@/components/providers/ProviderDetailLayout";
import { LabelValue } from "@/components/providers/LabelValue";
import { ProviderSpecs } from "@/components/providers/ProviderSpecs";
import { NetworkCapacity } from "@/components/providers/NetworkCapacity";

export default function ProviderDetailPage() {
  const [, params] = useRoute("/providers/:owner");
  const owner = params?.owner ?? "";
  const { data: provider, isLoading, refetch } = useProviderDetail(owner);

  const refresh = () => refetch();

  const networkCapacity = useMemo(() => {
    if (!provider) return null;
    const a = provider.activeStats;
    const p = provider.pendingStats;
    const v = provider.availableStats;
    const totalCpu = (a.cpu + p.cpu + v.cpu) / 1000;
    const totalGpu = a.gpu + p.gpu + v.gpu;
    const totalMem = a.memory + p.memory + v.memory;
    const totalStorage = a.storage + p.storage + v.storage;
    if (totalCpu + totalGpu + totalMem + totalStorage === 0) return null;
    return {
      activeCPU: (a.cpu + p.cpu) / 1000,
      totalCPU: totalCpu,
      activeGPU: a.gpu + p.gpu,
      totalGPU: totalGpu,
      activeMemory: a.memory + p.memory,
      totalMemory: totalMem,
      activeStorage: a.storage + p.storage,
      totalStorage,
    };
  }, [provider]);

  const wasRecentlyOnline = provider && (provider.isOnline);

  return (
    <ProviderDetailLayout
      address={owner}
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
                  <LabelValue label="Host" value={provider.hostUri} />
                  <LabelValue label="Website" value={provider.website} />
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

      {!isLoading && !owner && <p className="text-muted-foreground">Missing provider address.</p>}
      {!isLoading && owner && !provider && <p className="text-muted-foreground">Provider not found.</p>}
    </ProviderDetailLayout>
  );
}
