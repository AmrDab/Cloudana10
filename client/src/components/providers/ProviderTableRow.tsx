import type { MouseEventHandler } from "react";
import { useLocation } from "wouter";
import {
  TableCell,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { providerUrls } from "@/lib/provider-urls";
import {
  bytesToShrink,
  roundDecimal,
  truncate,
  hasParentWithClass,
  uniqueGpuModels,
  getProviderDisplayName,
} from "@/lib/provider-utils";
import type { ClientProviderList } from "@/lib/provider-types";
import { FavoriteButton } from "./FavoriteButton";
import { CapacityIcon } from "./CapacityIcon";
import { Uptime } from "./Uptime";
import { useFavoriteProviders } from "@/hooks/useFavoriteProviders";

type Props = { provider: ClientProviderList };

function Unit({ value, unit }: { value: number; unit: string }) {
  return (
    <span>
      {value}
      {value > 0 && <small className="text-muted-foreground"> {unit}</small>}
    </span>
  );
}

export function ProviderTableRow({ provider }: Props) {
  const [, setLocation] = useLocation();
  const { favoriteProviders, toggle } = useFavoriteProviders();
  const isFavorite = favoriteProviders.includes(provider.owner);

  // Defensive checks for stats objects
  const emptyStats = { cpu: 0, gpu: 0, memory: 0, storage: 0 };
  const activeStats = provider.activeStats || emptyStats;
  const pendingStats = provider.pendingStats || emptyStats;
  const availableStats = provider.availableStats || emptyStats;

  const activeCPU = provider.isOnline ? (activeStats.cpu || 0) / 1000 : 0;
  const pendingCPU = provider.isOnline ? (pendingStats.cpu || 0) / 1000 : 0;
  const totalCPU = provider.isOnline
    ? ((availableStats.cpu || 0) + (pendingStats.cpu || 0) + (activeStats.cpu || 0)) / 1000
    : 0;
  const activeGPU = provider.isOnline ? (activeStats.gpu || 0) : 0;
  const pendingGPU = provider.isOnline ? (pendingStats.gpu || 0) : 0;
  const totalGPU = provider.isOnline
    ? (availableStats.gpu || 0) + (pendingStats.gpu || 0) + (activeStats.gpu || 0)
    : 0;
  const activeMem = provider.isOnline
    ? bytesToShrink((activeStats.memory || 0) + (pendingStats.memory || 0))
    : null;
  const totalMem = provider.isOnline
    ? bytesToShrink(
        (availableStats.memory || 0) + (pendingStats.memory || 0) + (activeStats.memory || 0)
      )
    : null;
  const activeStorage = provider.isOnline
    ? bytesToShrink((activeStats.storage || 0) + (pendingStats.storage || 0))
    : null;
  const totalStorage = provider.isOnline
    ? bytesToShrink(
        (availableStats.storage || 0) + (pendingStats.storage || 0) + (activeStats.storage || 0)
      )
    : null;
  const memRatio =
    provider.isOnline && totalMem && totalMem.value > 0
      ? ((activeStats.memory || 0) + (pendingStats.memory || 0)) /
        ((availableStats.memory || 0) + (pendingStats.memory || 0) + (activeStats.memory || 0))
      : 0;
  const storageRatio =
    provider.isOnline && totalStorage && totalStorage.value > 0
      ? ((activeStats.storage || 0) + (pendingStats.storage || 0)) /
        ((availableStats.storage || 0) +
          (pendingStats.storage || 0) +
          (activeStats.storage || 0))
      : 0;
  const gpuModels = uniqueGpuModels(provider.gpuModels);

  const onStarClick: MouseEventHandler = (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggle(provider.owner);
  };

  const onRowClick = (e: React.MouseEvent) => {
    if (hasParentWithClass(e.target as HTMLElement, "provider-list-row")) {
      setLocation(providerUrls.detail(provider.deviceId ?? provider.owner));
    }
  };

  // Use IPFS name as primary display, fall back to truncated owner address
  const displayName = getProviderDisplayName(provider.name, provider.owner);
  const showTooltipName = displayName.length > 20;
  // Show full name in tooltip, with deviceId if available
  const fullName = provider.deviceId 
    ? `${displayName} (${provider.deviceId})`
    : displayName;

  return (
    <TableRow
      className="provider-list-row cursor-pointer border-white/5 transition-colors hover:bg-muted/50 [&>td]:px-2 [&>td]:py-1.5"
      onClick={onRowClick}
    >
      <TableCell>
        {showTooltipName ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-xs font-mono">{displayName}</span>
              </TooltipTrigger>
              <TooltipContent>
                <p className="font-mono text-xs">{fullName}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <span className="text-xs">{displayName || "—"}</span>
        )}
      </TableCell>
      <TableCell className="text-center">
        {provider.ipRegion && provider.ipCountry ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="text-xs">
                  {provider.ipRegionCode}, {provider.ipCountryCode}
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {provider.ipRegion}, {provider.ipCountry}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )}
      </TableCell>
      <TableCell className="text-center font-medium">
        {provider.isOnline ? <Uptime value={provider.uptime7d} /> : "—"}
      </TableCell>
      <TableCell>
        {provider.isOnline && totalCPU > 0 ? (
          <div className="flex items-center gap-1.5">
            <CapacityIcon value={(activeCPU + pendingCPU) / totalCPU} fontSize="small" />
            <span className="whitespace-nowrap text-xs">
              {Math.round(activeCPU + pendingCPU)}/{Math.round(totalCPU)} <span className="text-muted-foreground">cores</span>
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )}
      </TableCell>
      <TableCell>
        {provider.isOnline && totalGPU > 0 ? (
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5">
              <CapacityIcon value={(activeGPU + pendingGPU) / (totalGPU || 1)} fontSize="small" />
              <span className="whitespace-nowrap text-xs">
                {Math.round(activeGPU + pendingGPU)}/{Math.round(totalGPU)} <span className="text-muted-foreground">GPUs</span>
              </span>
            </div>
            {gpuModels.length > 0 && (
              <div className="flex flex-wrap gap-0.5">
                {gpuModels.slice(0, 2).map((g) => (
                  <Badge key={g} variant="secondary" className="h-4 px-1 text-xs">
                    {g}
                  </Badge>
                ))}
                {gpuModels.length > 2 && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge variant="secondary" className="h-4 px-1 text-xs">
                          +{gpuModels.length - 2}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="flex flex-wrap gap-1">
                          {gpuModels.map((g) => (
                            <Badge key={g} variant="secondary">
                              {g}
                            </Badge>
                          ))}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
            )}
          </div>
        ) : provider.isOnline && totalGPU === 0 ? (
          <span className="text-muted-foreground text-xs">No GPU</span>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )}
      </TableCell>
      <TableCell>
        {provider.isOnline && activeMem && totalMem ? (
          <div className="flex items-center gap-1.5">
            <CapacityIcon value={memRatio} fontSize="small" />
            <span className="whitespace-nowrap text-xs">
              <Unit value={roundDecimal(activeMem.value, 0)} unit={activeMem.unit} />/
              <Unit value={roundDecimal(totalMem.value, 0)} unit={totalMem.unit} />
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )}
      </TableCell>
      <TableCell>
        {provider.isOnline && activeStorage && totalStorage ? (
          <div className="flex items-center gap-1.5">
            <CapacityIcon value={storageRatio} fontSize="small" />
            <span className="whitespace-nowrap text-xs">
              <Unit value={roundDecimal(activeStorage.value, 0)} unit={activeStorage.unit} />/
              <Unit value={roundDecimal(totalStorage.value, 0)} unit={totalStorage.unit} />
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )}
      </TableCell>
      <TableCell>
        <div className="flex items-center justify-center gap-1">
          {provider.isAudited ? (
            <span className="text-xs">Yes</span>
          ) : (
            <>
              <span className="text-muted-foreground text-xs">No</span>
              <TriangleAlert className="text-amber-500 h-3.5 w-3.5" />
            </>
          )}
        </div>
      </TableCell>
      <TableCell className="text-center">
        <FavoriteButton isFavorite={isFavorite} onClick={onStarClick} />
      </TableCell>
    </TableRow>
  );
}
