import { useProviderDetail } from "@/hooks/useProviders";
import { ProviderDetailLayout, ProviderDetailTabs } from "./ProviderDetailLayout";
import { Spinner } from "@/components/ui/spinner";

type Props = { deviceId: string };

export function ProviderRawData({ deviceId }: Props) {
  const { data: provider, isLoading, refetch } = useProviderDetail(deviceId);

  const refresh = () => refetch();

  return (
    <ProviderDetailLayout
      address={deviceId}
      page={ProviderDetailTabs.RAW}
      refresh={refresh}
      provider={provider ?? null}
    >
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Spinner className="h-8 w-8 text-primary" />
        </div>
      )}
      {!isLoading && provider && (
        <pre className="overflow-auto rounded-lg border border-white/5 bg-muted/30 p-4 text-muted-foreground text-xs">
          {JSON.stringify(provider, null, 2)}
        </pre>
      )}
      {!isLoading && !provider && (
        <p className="text-muted-foreground">Provider not found.</p>
      )}
    </ProviderDetailLayout>
  );
}
