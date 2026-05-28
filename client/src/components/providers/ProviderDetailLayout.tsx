import { type ReactNode, useState, useEffect, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, RefreshCw, Play, Square, Loader2, Info, Wrench } from "lucide-react";
import { useWallet } from "@/context/wallet-context";
import { useMyProviders } from "@/lib/contracts";
import { providerUrls } from "@/lib/provider-urls";
import type { ClientProviderDetail } from "@/lib/provider-types";
import { ProviderSummary } from "./ProviderSummary";
import { cn } from "@/lib/utils";
import { nodeApiBase as apiBase } from "@/lib/api-base";

const NO_BUILD_MESSAGE = "No build found for this device. Register from the build flow first.";
function isNoBuildStatus(status: string, message: string | null): boolean {
  return status === "unknown" && (message === NO_BUILD_MESSAGE || (message != null && message.includes("No build found")));
}

export enum ProviderDetailTabs {
  DETAIL = "1",
  RAW = "2",
  LOGS = "3",
}

type Props = {
  page: ProviderDetailTabs;
  provider: Partial<ClientProviderDetail> | null;
  address: string;
  refresh: () => void;
  children?: ReactNode;
};

export function ProviderDetailLayout({ children, page, address, provider, refresh }: Props) {
  const [, setLocation] = useLocation();
  const { userAddress, isConnected } = useWallet();
  const { data: myDeviceIds } = useMyProviders(isConnected ? (userAddress as `0x${string}`) : undefined);
  const deviceIdList = (myDeviceIds && Array.isArray(myDeviceIds) ? myDeviceIds : []) as string[];
  const isOwner = isConnected && !!provider?.owner && !!userAddress && provider.owner.toLowerCase() === userAddress.toLowerCase();
  const deviceIdForOwner = isOwner ? (provider?.deviceId ?? address ?? deviceIdList[0]) : null;

  const [nodeStatus, setNodeStatus] = useState<"active" | "inactive" | "unknown" | "loading" | "error">("loading");
  const [nodeMessage, setNodeMessage] = useState<string | null>(null);
  const [nodeAction, setNodeAction] = useState<"idle" | "starting" | "stopping">("idle");

  const fetchNodeStatus = useCallback(async () => {
    if (!deviceIdForOwner) {
      setNodeStatus("unknown");
      setNodeMessage(null);
      return;
    }
    setNodeStatus("loading");
    setNodeMessage(null);
    try {
      const res = await fetch(`${apiBase()}/build-provider/provider-node/status-by-device/${encodeURIComponent(deviceIdForOwner)}`);
      const data = await res.json();
      setNodeStatus(
        data.status === "active" ? "active"
        : data.status === "inactive" ? "inactive"
        : data.status === "error" ? "error"
        : "unknown"
      );
      setNodeMessage(data.message ?? null);
    } catch {
      setNodeStatus("error");
      setNodeMessage("Failed to fetch");
    }
  }, [deviceIdForOwner]);

  useEffect(() => {
    if (deviceIdForOwner) fetchNodeStatus();
    else setNodeStatus("unknown");
  }, [deviceIdForOwner, fetchNodeStatus]);

  const startNode = async () => {
    if (!deviceIdForOwner || nodeAction !== "idle") return;
    setNodeAction("starting");
    try {
      const res = await fetch(`${apiBase()}/build-provider/provider-node/start-by-device/${encodeURIComponent(deviceIdForOwner)}`, { method: "POST" });
      const data = await res.json();
      if (data.status === "success") await fetchNodeStatus();
    } finally {
      setNodeAction("idle");
    }
  };

  const stopNode = async () => {
    if (!deviceIdForOwner || nodeAction !== "idle") return;
    setNodeAction("stopping");
    try {
      const res = await fetch(`${apiBase()}/build-provider/provider-node/stop-by-device/${encodeURIComponent(deviceIdForOwner)}`, { method: "POST" });
      const data = await res.json();
      if (data.status === "success") await fetchNodeStatus();
    } finally {
      setNodeAction("idle");
    }
  };

  const handleTabChange = (value: string) => {
    switch (value as ProviderDetailTabs) {
      case ProviderDetailTabs.RAW:
        setLocation(providerUrls.detailRaw(address));
        break;
      case ProviderDetailTabs.LOGS:
        setLocation(providerUrls.detailLogs(address));
        break;
      case ProviderDetailTabs.DETAIL:
      default:
        setLocation(providerUrls.detail(address));
        break;
    }
  };

  function handleBackClick() {
    setLocation(providerUrls.list());
  }

  return (
    <div className="pb-12">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="rounded-full"
          onClick={handleBackClick}
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">Provider detail</h1>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="rounded-full"
          onClick={() => refresh()}
          aria-label="Refresh"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
        {provider && isOwner && (
          <Link href={providerUrls.detailEdit((provider.deviceId ?? provider.owner) as string)}>
            <Button variant="default" size="sm" className="rounded-full">
              Update Provider
            </Button>
          </Link>
        )}
      </div>

      {provider && (
        <>
          {isOwner && deviceIdForOwner && (
            <Card className="mb-6 border-border bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Provider node</CardTitle>
                <CardDescription>Work status and control for this device. Start to accept workloads, stop to pause.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {isNoBuildStatus(nodeStatus, nodeMessage) ? (
                  <>
                    <div className="flex items-start gap-3 rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 text-sm">
                      <Info className="h-5 w-5 shrink-0 text-blue-500 mt-0.5" />
                      <div>
                        <p className="font-medium text-foreground">Setup required</p>
                        <p className="text-muted-foreground mt-1">
                          This device is registered on-chain but the provider node has not been built yet. Complete the build flow to install and run the node on your machine, then you can start or stop it here.
                        </p>
                        <Link href={providerUrls.register()}>
                          <Button size="sm" variant="outline" className="mt-3 gap-2">
                            <Wrench className="h-4 w-4" />
                            Go to build flow
                          </Button>
                        </Link>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground font-mono truncate">Device: {deviceIdForOwner.slice(0, 18)}…</p>
                  </>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-sm font-medium">Status:</span>
                      {nodeStatus === "loading" && (
                        <span className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" /> Checking…
                        </span>
                      )}
                      {nodeStatus === "active" && (
                        <Badge variant="default" className="bg-green-600 hover:bg-green-600">Running</Badge>
                      )}
                      {nodeStatus === "inactive" && (
                        <Badge variant="secondary">Stopped</Badge>
                      )}
                      {(nodeStatus === "unknown" || nodeStatus === "error") && !isNoBuildStatus(nodeStatus, nodeMessage) && (
                        <Badge variant="outline" className="text-amber-600 border-amber-600">{nodeMessage || nodeStatus}</Badge>
                      )}
                      {nodeMessage && nodeStatus !== "loading" && !isNoBuildStatus(nodeStatus, nodeMessage) && (
                        <span className="text-xs text-muted-foreground">{nodeMessage}</span>
                      )}
                      <Button variant="ghost" size="icon" onClick={fetchNodeStatus} disabled={nodeStatus === "loading"} aria-label="Refresh status">
                        <RefreshCw className={cn("h-4 w-4", nodeStatus === "loading" && "animate-spin")} />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={startNode}
                        disabled={nodeAction !== "idle" || nodeStatus === "active"}
                      >
                        {nodeAction === "starting" ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Play className="h-4 w-4 mr-1.5" />}
                        Start
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={stopNode}
                        disabled={nodeAction !== "idle" || nodeStatus === "inactive"}
                      >
                        {nodeAction === "stopping" ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Square className="h-4 w-4 mr-1.5" />}
                        Stop
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground font-mono truncate">Device: {deviceIdForOwner.slice(0, 18)}…</p>
                  </>
                )}
              </CardContent>
            </Card>
          )}
          <ProviderSummary provider={provider as ClientProviderDetail} />

          <Tabs value={page} onValueChange={handleTabChange} className="w-full">
            <TabsList className="mt-0 grid w-full grid-cols-3 rounded-t-none border-b border-white/5 bg-transparent p-0">
              <TabsTrigger
                value={ProviderDetailTabs.DETAIL}
                className={cn(
                  "rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                )}
              >
                Detail
              </TabsTrigger>
              <TabsTrigger
                value={ProviderDetailTabs.LOGS}
                className={cn(
                  "rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                )}
              >
                Logs & Monitoring
              </TabsTrigger>
              <TabsTrigger
                value={ProviderDetailTabs.RAW}
                className={cn(
                  "rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                )}
              >
                Raw Data
              </TabsTrigger>
            </TabsList>
            <div className="pt-6">{children}</div>
          </Tabs>
        </>
      )}
    </div>
  );
}
