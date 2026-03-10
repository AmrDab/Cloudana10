import type { MouseEventHandler } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { AddressDisplay } from "@/components/ui/address-display";
import { LabelValue } from "./LabelValue";
import { CopyableTruncated } from "./CopyableTruncated";
import { Uptime } from "./Uptime";
import { FavoriteButton } from "./FavoriteButton";
import { ProviderMap } from "./ProviderMap";
import { useFavoriteProviders } from "@/hooks/useFavoriteProviders";
import type { ClientProviderDetail } from "@/lib/provider-types";
import { getProviderDisplayName } from "@/lib/provider-utils";

type Props = { provider: ClientProviderDetail };

function parseNum(v: string | number): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

export function ProviderSummary({ provider }: Props) {
  const { favoriteProviders, toggle } = useFavoriteProviders();
  const isFavorite = favoriteProviders.includes(provider.owner);

  const onStarClick: MouseEventHandler = (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggle(provider.owner);
  };

  // Check if we have IPFS metadata (specs from IPFS)
  const hasIpfsMetadata = provider.cpuCores || provider.ramTotal || provider.storageTotal;

  return (
    <>
    {!hasIpfsMetadata && (
      <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
        <p className="text-amber-600 dark:text-amber-400">
          ⚠️ Provider metadata from IPFS could not be loaded. Showing on-chain data only. Check browser console for details.
        </p>
      </div>
    )}
    <Card className="overflow-hidden rounded-b-none border-white/5 bg-card/60">
      <CardContent className="p-0">
        <div className="flex flex-col lg:flex-row lg:justify-between min-w-0">
          <div className="flex-1 p-6 min-w-0">
            <LabelValue label="Name" value={getProviderDisplayName(provider.name, provider.owner)} />
            {provider.deviceId && (
              <div className="mb-2">
                <span className="text-muted-foreground text-xs">Device ID</span>
                <div className="text-sm font-medium">
                  <CopyableTruncated value={provider.deviceId} truncateLength={36} />
                </div>
              </div>
            )}
            <div className="mb-2">
              <span className="text-muted-foreground text-xs">Metadata URI</span>
              <div className="text-sm font-medium">
                <CopyableTruncated value={provider.hostUri} truncateLength={36} link />
              </div>
            </div>
            <div className="mb-2">
              <span className="text-muted-foreground text-xs">Owner Address</span>
              <div className="text-sm font-medium">
                <AddressDisplay
                  address={provider.owner}
                  showCopy
                  showLink
                  truncate
                  truncateLength={10}
                />
              </div>
            </div>
            <LabelValue
              label="Region"
              value={
                provider.ipRegion && provider.ipCountry
                  ? `${provider.ipRegion}, ${provider.ipCountry}`
                  : undefined
              }
            />
            <LabelValue
              label="Up time (7d)"
              value={provider.isOnline ? <Uptime value={provider.uptime7d} /> : undefined}
            />
            <LabelValue
              label="Favorite"
              value={<FavoriteButton isFavorite={isFavorite} onClick={onStarClick} />}
            />
            <LabelValue
              label="Audited"
              value={
                provider.isAudited ? (
                  <span className="text-muted-foreground text-sm">Yes</span>
                ) : (
                  <span className="text-muted-foreground text-sm">No</span>
                )
              }
            />
          </div>
          {provider.isOnline && (
            <div className="h-full min-h-[240px] w-full flex-shrink-0 lg:min-w-[280px] lg:basis-2/5">
              <ProviderMap
                providers={[provider]}
                initialZoom={5}
                initialCoordinates={[parseNum(provider.ipLon), parseNum(provider.ipLat)]}
              />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
    </>
  );
}
