import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RefreshCw, ExternalLink, Server, Loader2 } from "lucide-react";
import { useAccount } from "wagmi";
import { useDeregisterProvider, useActivateProvider } from "@/lib/contracts";
import { useToast } from "@/hooks/use-toast";
import { useMyProviders } from "@/hooks/useProviders";
import type { ClientProviderList } from "@/lib/provider-types";
import { ProviderMap } from "@/components/providers/ProviderMap";
import { ProviderTable } from "@/components/providers/ProviderTable";
import { ProviderStatsDonutChart } from "@/components/providers/ProviderStatsDonutChart";
import { AddressDisplay } from "@/components/ui/address-display";
import { HardwareScanCard } from "@/components/providers/HardwareScanCard";

/**
 * Provider dashboard: connected wallet's provider(s) by deviceId (one wallet can have many devices).
 * Uses only IPFS-enriched list from chain; deviceId is the unique key everywhere.
 */
export default function ProviderListPage() {
  const { toast } = useToast();
  const { address, isConnected } = useAccount();
  const { data: myProviders = [], isLoading: myProviderLoading, isFetching: isRefetching, refetch: refetchMyProvider } = useMyProviders();
  const { deregister, isPending: isDeactivating, isSuccess: isDeactivated, reset: resetDeregister } = useDeregisterProvider();
  const { activate, isPending: isActivating, isSuccess: isActivated, reset: resetActivate } = useActivateProvider();

  const ownerOnlyProviders: ClientProviderList[] = myProviders;
  const firstProvider = ownerOnlyProviders[0];
  const firstDeviceId = firstProvider?.deviceId;
  const isMyProviderRegistered = ownerOnlyProviders.length > 0;
  const isMyProviderActive = firstProvider?.isOnline ?? false;
  const endpoint = firstProvider?.hostUri ?? "";
  const region = firstProvider?.ipRegion ?? "—";

  const networkCapacity = useMemo(() => {
    if (!ownerOnlyProviders.length) return null;
    const emptyStats = { cpu: 0, gpu: 0, memory: 0, storage: 0 };
    let aCpu = 0, tCpu = 0, aGpu = 0, tGpu = 0, aMem = 0, tMem = 0, aStore = 0, tStore = 0;
    for (const p of ownerOnlyProviders) {
      const active = p.activeStats || emptyStats;
      const pending = p.pendingStats || emptyStats;
      const available = p.availableStats || emptyStats;
      aCpu += ((active.cpu || 0) + (pending.cpu || 0)) / 1000;
      tCpu += ((active.cpu || 0) + (pending.cpu || 0) + (available.cpu || 0)) / 1000;
      aGpu += (active.gpu || 0) + (pending.gpu || 0);
      tGpu += (active.gpu || 0) + (pending.gpu || 0) + (available.gpu || 0);
      aMem += (active.memory || 0) + (pending.memory || 0);
      tMem += (active.memory || 0) + (pending.memory || 0) + (available.memory || 0);
      aStore += (active.storage || 0) + (pending.storage || 0);
      tStore += (active.storage || 0) + (pending.storage || 0) + (available.storage || 0);
    }
    if (tCpu + tGpu + tMem + tStore === 0) return null;
    return {
      activeCPU: aCpu,
      totalCPU: tCpu,
      activeGPU: aGpu,
      totalGPU: tGpu,
      activeMemory: aMem,
      totalMemory: tMem,
      activeStorage: aStore,
      totalStorage: tStore,
    };
  }, [ownerOnlyProviders]);

  useEffect(() => {
    if (isDeactivated || isActivated) {
      refetchMyProvider();
      toast({
        title: isActivated ? "Provider activated" : "Provider deactivated",
        description: isActivated
          ? "Your provider is now active and can receive workloads."
          : "Your provider is now inactive.",
      });
      resetDeregister();
      resetActivate();
    }
  }, [isDeactivated, isActivated, refetchMyProvider, toast, resetDeregister, resetActivate]);

  const activeCount = ownerOnlyProviders.filter((x) => x.isOnline).length;
  const totalCount = ownerOnlyProviders.length;

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Provider Dashboard</h1>
        <p className="mt-2 text-muted-foreground text-base">
          Your provider only. Table, map, and status are based on your wallet&apos;s registered provider.
        </p>
      </div>

      {!isConnected && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="py-8">
            <p className="text-muted-foreground text-center">
              Connect your wallet to view and manage your provider.
            </p>
          </CardContent>
        </Card>
      )}

      {isConnected && myProviderLoading && (
        <div className="flex items-center justify-center py-12">
          <Spinner className="h-10 w-10 text-primary" />
        </div>
      )}

      {isConnected && address && !myProviderLoading && (
        <>
          {/* Status / capacity and map: skeleton when loading; empty status / empty map when no data */}
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Your provider status</h2>
            {myProviderLoading ? (
              <Skeleton className="mt-2 h-5 w-64" />
            ) : (
              <p className="mt-1 text-muted-foreground text-sm">
                <span className={totalCount > 0 ? "font-bold text-primary" : "font-bold"}>{activeCount}</span> active / <span className="font-bold">{totalCount}</span> total (yours)
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <div className="lg:col-span-2 flex items-center justify-center min-h-[120px] rounded-lg border border-white/10 bg-card/40">
              {myProviderLoading ? (
                <Skeleton className="h-[110px] w-[110px] rounded-full shrink-0" />
              ) : (
                <ProviderStatsDonutChart
                  activeCPU={networkCapacity?.activeCPU ?? 0}
                  totalCPU={networkCapacity?.totalCPU ?? 0}
                  activeGPU={networkCapacity?.activeGPU ?? 0}
                  totalGPU={networkCapacity?.totalGPU ?? 0}
                  activeMemory={networkCapacity?.activeMemory ?? 0}
                  totalMemory={networkCapacity?.totalMemory ?? 0}
                  activeStorage={networkCapacity?.activeStorage ?? 0}
                  totalStorage={networkCapacity?.totalStorage ?? 0}
                />
              )}
            </div>
            <div className="lg:col-span-3 min-h-[140px] rounded-lg overflow-hidden border border-white/10 bg-card/40">
              {myProviderLoading ? (
                <div className="h-full min-h-[140px] flex items-center justify-center p-6">
                  <Skeleton className="h-full w-full rounded-md" />
                </div>
              ) : (
                <ProviderMap providers={ownerOnlyProviders} />
              )}
            </div>
          </div>

          {/* Hardware scan — only shown when provider has a registered endpoint */}
          {endpoint && (
            <HardwareScanCard endpoint={endpoint} deviceId={firstDeviceId} />
          )}

          <div>
            <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-semibold tracking-tight">Your provider</h2>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="rounded-full" 
                  onClick={() => refetchMyProvider()} 
                  disabled={isRefetching}
                  aria-label="Refresh"
                >
                  <RefreshCw className={`h-4 w-4 ${isRefetching ? 'animate-spin' : ''}`} />
                </Button>
              </div>
              <Link href="/provider">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 hover:bg-primary/10 hover:border-primary/50 hover:text-primary transition-colors"
                >
                  <Server className="h-4 w-4" />
                  Register provider
                </Button>
              </Link>
            </div>
            <div className="mt-4">
              {myProviderLoading ? (
                <Table>
                  <TableHeader>
                    <TableRow className="border-white/10 hover:bg-transparent">
                      <TableHead className="w-[12%] font-medium text-muted-foreground">Name</TableHead>
                      <TableHead className="w-[12%] text-center font-medium text-muted-foreground">Location</TableHead>
                      <TableHead className="w-[8%] text-center font-medium text-muted-foreground">Uptime (7d)</TableHead>
                      <TableHead className="w-[15%] font-medium text-muted-foreground">CPU</TableHead>
                      <TableHead className="w-[15%] font-medium text-muted-foreground">GPU</TableHead>
                      <TableHead className="w-[15%] font-medium text-muted-foreground">Memory</TableHead>
                      <TableHead className="w-[15%] font-medium text-muted-foreground">Disk</TableHead>
                      <TableHead className="w-[8%] text-center font-medium text-muted-foreground">Audited</TableHead>
                      <TableHead className="w-[10%] text-center font-medium text-muted-foreground">Favorite</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[1, 2, 3].map((i) => (
                      <TableRow key={i} className="border-white/5">
                        <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-16 mx-auto" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-12 mx-auto" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-14" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-8 mx-auto" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-8 mx-auto" /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : ownerOnlyProviders.length > 0 ? (
                <ProviderTable providers={ownerOnlyProviders} sortOption="gpu-available-desc" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-white/10 hover:bg-transparent">
                      <TableHead className="w-[12%] font-medium text-muted-foreground">Name</TableHead>
                      <TableHead className="w-[12%] text-center font-medium text-muted-foreground">Location</TableHead>
                      <TableHead className="w-[8%] text-center font-medium text-muted-foreground">Uptime (7d)</TableHead>
                      <TableHead className="w-[15%] font-medium text-muted-foreground">CPU</TableHead>
                      <TableHead className="w-[15%] font-medium text-muted-foreground">GPU</TableHead>
                      <TableHead className="w-[15%] font-medium text-muted-foreground">Memory</TableHead>
                      <TableHead className="w-[15%] font-medium text-muted-foreground">Disk</TableHead>
                      <TableHead className="w-[8%] text-center font-medium text-muted-foreground">Audited</TableHead>
                      <TableHead className="w-[10%] text-center font-medium text-muted-foreground">Favorite</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow className="border-white/5 hover:bg-transparent">
                      <TableCell colSpan={9} className="text-center text-muted-foreground py-10">
                        No data
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </div>
          </div>

        </>
      )}
    </div>
  );
}
