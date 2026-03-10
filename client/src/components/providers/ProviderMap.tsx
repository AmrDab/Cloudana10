import { useEffect, useState } from "react";
import { ComposableMap, Geographies, Geography, Marker, ZoomableGroup } from "react-simple-maps";
import type { Point } from "react-simple-maps";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Link } from "wouter";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { providerUrls } from "@/lib/provider-urls";
import type { ClientProviderList } from "@/lib/provider-types";
import { getProviderDisplayName } from "@/lib/provider-utils";

const minZoom = 1;
const maxZoom = 8;
const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json";

type Props = {
  providers: ClientProviderList[];
  initialZoom?: number;
  initialCoordinates?: Point;
};

export function ProviderMap({
  providers,
  initialZoom = minZoom,
  initialCoordinates = [0, 0],
}: Props) {
  const [dotSize, setDotSize] = useState({ r: 5, w: 1 });
  const [position, setPosition] = useState({ coordinates: initialCoordinates, zoom: initialZoom });
  const isInitial =
    position.coordinates[0] === initialCoordinates[0] &&
    position.coordinates[1] === initialCoordinates[1] &&
    position.zoom === initialZoom;

  useEffect(() => {
    handleDotSize(position.zoom);
  }, []);

  function resetZoom() {
    setPosition({ coordinates: initialCoordinates, zoom: initialZoom });
    handleDotSize(initialZoom);
  }

  function handleMoveEnd(pos: { coordinates: [number, number]; zoom: number }) {
    setPosition(pos);
    handleDotSize(pos.zoom);
  }

  function handleDotSize(zoom: number) {
    if (zoom < 3) setDotSize({ r: 5, w: 1 });
    else if (zoom < 5) setDotSize({ r: 3, w: 0.8 });
    else if (zoom < 6.5) setDotSize({ r: 2, w: 0.5 });
    else if (zoom <= maxZoom) setDotSize({ r: 1.5, w: 0.2 });
  }

  function zoomIn() {
    setPosition((prev) => {
      const z = Math.min(maxZoom, prev.zoom + 1);
      handleDotSize(z);
      return { ...prev, zoom: z };
    });
  }

  function zoomOut() {
    setPosition((prev) => {
      const z = Math.max(minZoom, prev.zoom - 1);
      handleDotSize(z);
      return { ...prev, zoom: z };
    });
  }

  return (
    <div className="relative flex">
      <div className="absolute left-1/2 top-2 z-10 flex -translate-x-1/2 gap-1 rounded-lg border border-white/10 bg-card/80 p-1.5 backdrop-blur-sm">
        <Button type="button" variant="ghost" size="icon" onClick={zoomIn} disabled={position.zoom === maxZoom}>
          <Plus className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon" onClick={zoomOut} disabled={position.zoom === minZoom}>
          <Minus className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon" onClick={resetZoom} disabled={isInitial}>
          <RotateCcw className="h-4 w-4" />
        </Button>
      </div>
      <ComposableMap projectionConfig={{ rotate: [-10, 0, 0] }}>
        <ZoomableGroup
          zoom={position.zoom}
          center={position.coordinates}
          onMoveEnd={handleMoveEnd}
          filterZoomEvent={(e: Event) => !(e instanceof WheelEvent)}
        >
          <Geographies geography={GEO_URL}>
            {({ geographies }: { geographies: { rsmKey: string }[] }) =>
              geographies.map((geo) => (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill="hsl(var(--muted))"
                  style={{ default: { outline: "none" }, hover: { outline: "none" }, pressed: { outline: "none" } }}
                />
              ))
            }
          </Geographies>
          {(providers || []).map(({ owner, name, ipLon, ipLat, ipRegion, ipCountryCode, isOnline, deviceId }) => (
            <Link key={deviceId ?? owner} href={providerUrls.detail(deviceId ?? owner)}>
              <Marker coordinates={[parseFloat(ipLon), parseFloat(ipLat)]}>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <circle
                        className="cursor-pointer stroke-background transition-opacity hover:opacity-90"
                        style={{
                          fill: isOnline ? "hsl(142 76% 36%)" : "hsl(0 84% 60%)",
                          strokeWidth: dotSize.w,
                        }}
                        r={dotSize.r}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <div className="space-y-0.5">
                        <div className="font-medium">{getProviderDisplayName(name, owner)}</div>
                        <div className="text-muted-foreground text-xs">
                          {ipRegion}, {ipCountryCode}
                        </div>
                        <div className={`text-xs font-medium mt-1 ${isOnline ? "text-green-400" : "text-red-400"}`}>
                          {isOnline ? "Active" : "Inactive"}
                        </div>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </Marker>
            </Link>
          ))}
        </ZoomableGroup>
      </ComposableMap>
    </div>
  );
}
