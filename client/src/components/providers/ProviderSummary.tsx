import type { MouseEventHandler } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { AddressDisplay } from "@/components/ui/address-display";
import { LabelValue } from "./LabelValue";
import { Uptime } from "./Uptime";
import { FavoriteButton } from "./FavoriteButton";
import { ProviderMap } from "./ProviderMap";
import { useFavoriteProviders } from "@/hooks/useFavoriteProviders";
import type { ClientProviderDetail } from "@/lib/provider-types";

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

  return (
    <Card className="overflow-hidden rounded-b-none border-white/5 bg-card/60">
      <CardContent className="p-0">
        <div className="flex flex-col lg:flex-row lg:justify-between">
          <div className="flex-1 p-6">
            {provider.name && <LabelValue label="Name" value={provider.name} />}
            <LabelValue label="Uri" value={provider.hostUri} />
            <LabelValue
              label="Address"
              value={
                <AddressDisplay
                  address={provider.owner}
                  showCopy
                  showLink
                  truncate
                  truncateLength={10}
                />
              }
            />
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
            <div className="h-full w-full flex-shrink-0 lg:basis-2/5">
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
  );
}
