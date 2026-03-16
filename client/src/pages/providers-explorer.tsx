import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AddressDisplay } from "@/components/ui/address-display";
import { getPinataGatewayUrl } from "@/lib/api";
import { getProviderDisplayName } from "@/lib/provider-utils";
import { useProviderList, useMyProviders } from "@/hooks/useProviders";
import { Search, Server, Cpu, HardDrive, Network, MapPin, ExternalLink, Copy, Check } from "lucide-react";
import { useState, useMemo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import { ProviderGlobe } from "@/components/providers/ProviderGlobe";

export default function ProvidersExplorer() {
  const { address, isConnected } = useAccount();
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("all");

  const { data: allProviders = [], isLoading: isLoadingAll } = useProviderList();
  const { data: myProviders = [], isLoading: isLoadingMy } = useMyProviders();

  const providersToShow = activeTab === "all" ? allProviders : myProviders;
  const isLoading = activeTab === "all" ? isLoadingAll : isLoadingMy;

  const filteredProviders = useMemo(() => 
    providersToShow.filter((p: any) => {
      const searchLower = searchTerm.toLowerCase();
      return (
        (p.name || "").toLowerCase().includes(searchLower) ||
        (p.providerkey || "").toLowerCase().includes(searchLower) ||
        (p.ownerAddress || "").toLowerCase().includes(searchLower) ||
        (p.region || "").toLowerCase().includes(searchLower) ||
        (p.cpuModel || "").toLowerCase().includes(searchLower) ||
        (p.gpuModel || "").toLowerCase().includes(searchLower)
      );
    }),
    [providersToShow, searchTerm]
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Provider Explorer</h1>
          <p className="text-muted-foreground">
            {activeTab === "all" 
              ? "Browse all registered compute providers" 
              : "View and manage your registered providers"}
          </p>
        </div>
        <div className="relative w-full md:w-96">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search providers..." 
            className="pl-9 bg-card/50 border-white/10"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* 3D Globe */}
      <Card className="border-white/5 bg-card/40 backdrop-blur-sm overflow-hidden">
        <ProviderGlobe providers={allProviders} className="h-[350px]" />
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="all">All Providers</TabsTrigger>
          <TabsTrigger value="my" disabled={!isConnected}>
            My Providers {isConnected && `(${myProviders.length})`}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <Card key={i} className="border-white/5">
                  <CardHeader>
                    <Skeleton className="h-10 w-10 rounded-lg mb-2" />
                    <Skeleton className="h-6 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-16 w-full" />
                  </CardContent>
                </Card>
              ))
            ) : filteredProviders.length === 0 ? (
              <div className="col-span-full text-center py-12 text-muted-foreground">
                No providers found
              </div>
            ) : (
              filteredProviders.map((provider: any) => (
                <ProviderCard key={provider.id || provider.providerkey} provider={provider} />
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="my" className="mt-6">
          {!isConnected ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                Please connect your wallet to view your providers
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <Card key={i} className="border-white/5">
                    <CardHeader>
                      <Skeleton className="h-10 w-10 rounded-lg mb-2" />
                      <Skeleton className="h-6 w-3/4" />
                      <Skeleton className="h-4 w-1/2" />
                    </CardHeader>
                    <CardContent>
                      <Skeleton className="h-16 w-full" />
                    </CardContent>
                  </Card>
                ))
              ) : filteredProviders.length === 0 ? (
                <div className="col-span-full text-center py-12 text-muted-foreground">
                  You haven't registered any providers yet
                </div>
              ) : (
                filteredProviders.map((provider: any) => (
                  <ProviderCard key={provider.id || provider.providerkey} provider={provider} isOwner />
                ))
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProviderCard({ provider, isOwner = false }: { provider: any; isOwner?: boolean }) {
  const [copiedHash, setCopiedHash] = useState(false);

  const statusLabels: Record<string, string> = {
    "Unregistered": "⚪ Unregistered",
    "Active": "🟢 Active",
    "Inactive": "🔴 Inactive",
    "Suspended": "🟠 Suspended",
    "active": "🟢 Active",
    "inactive": "🔴 Inactive",
  };

  const status = provider.status === 0 ? "Unregistered" : provider.status === 1 ? "Active" : provider.status === 2 ? "Inactive" : provider.status === 3 ? "Suspended" : provider.status;
  const statusLabel = statusLabels[status] || status;

  const handleCopyHash = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    try {
      const hashToCopy = provider.providerkey || "";
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(hashToCopy);
      } else {
        // Fallback for older browsers
        const textArea = document.createElement("textarea");
        textArea.value = hashToCopy;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        textArea.remove();
      }
      
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 2000);
    } catch (err) {
      console.error('Failed to copy hash:', err);
    }
  };

  return (
    <Card className="group hover:border-primary/50 transition-all duration-300 overflow-hidden bg-card/60 backdrop-blur-sm border-white/5">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      
      <CardHeader className="relative">
        <div className="flex justify-between items-start mb-2">
          <div className="h-10 w-10 rounded-lg bg-secondary flex items-center justify-center">
            <Server className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
          </div>
          <Badge 
            variant={status === "Active" || status === "active" ? "default" : "secondary"} 
            className={status === "Active" || status === "active" ? "bg-primary/20 text-primary hover:bg-primary/30" : ""}
          >
            {statusLabel}
          </Badge>
        </div>
        <CardTitle className="text-xl group-hover:text-primary transition-colors">
          {getProviderDisplayName(provider.name, provider.owner ?? provider.ownerAddress ?? "")}
        </CardTitle>
        {provider.description && (
          <CardDescription className="line-clamp-2">{provider.description}</CardDescription>
        )}
        {provider.providerkey && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs text-muted-foreground">HashKey:</span>
            <code className="font-mono text-xs bg-muted px-2 py-0.5 rounded">
              {provider.providerkey.slice(0, 10)}...{provider.providerkey.slice(-8)}
            </code>
            <Button
              variant="ghost"
              size="icon"
              className={`h-6 w-6 transition-colors ${copiedHash ? "bg-green-500/10 hover:bg-green-500/20" : ""}`}
              onClick={handleCopyHash}
              title={copiedHash ? "Copied!" : "Copy hash key"}
            >
              {copiedHash ? (
                <Check className="h-3 w-3 text-green-500" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </Button>
          </div>
        )}
      </CardHeader>
      
      <CardContent className="relative space-y-4">
        {/* Basic Info */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="space-y-1">
            <span className="text-muted-foreground text-xs">Region</span>
            <div className="font-medium">{provider.region || "N/A"}</div>
          </div>
          <div className="space-y-1">
            <span className="text-muted-foreground text-xs">Hardware Tier</span>
            <div className="font-medium">
              {provider.hardwareTier === 0 ? "CPU" : provider.hardwareTier === 1 ? "GPU-T1" : provider.hardwareTier === 2 ? "GPU-T2" : "N/A"}
            </div>
          </div>
          <div className="space-y-1">
            <span className="text-muted-foreground text-xs">Capacity</span>
            <div className="font-medium">{provider.capacity || "N/A"} server{provider.capacity !== 1 ? "s" : ""}</div>
          </div>
          {provider.bondAmount && (
            <div className="space-y-1">
              <span className="text-muted-foreground text-xs">Bond</span>
              <div className="font-medium">{parseFloat(provider.bondAmount) / 1e18} CLD</div>
            </div>
          )}
          {provider.ipfsCID && (
            <div className="space-y-1 col-span-2">
              <span className="text-muted-foreground text-xs">Metadata</span>
              <div className="flex items-center gap-2">
                <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                  {provider.ipfsCID.slice(0, 15)}...
                </code>
                <a
                  href={getPinataGatewayUrl(provider.ipfsCID)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:text-primary/80 transition-colors"
                  title="View metadata on IPFS"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>
          )}
        </div>

        {/* Device Details */}
        {(provider.cpuModel || provider.gpuModel || provider.ramTotal || provider.storageTotal || provider.bandwidth) && (
          <div className="space-y-2 pt-2 border-t border-white/5">
            {provider.cpuModel && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Cpu className="h-3 w-3" />
                <span>{provider.cpuModel} {provider.cpuCores && `(${provider.cpuCores} cores)`}</span>
              </div>
            )}
            {provider.gpuModel && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Cpu className="h-3 w-3" />
                <span>{provider.gpuModel} {provider.gpuCount && `x${provider.gpuCount}`} {provider.gpuMemory && `(${provider.gpuMemory} GB)`}</span>
              </div>
            )}
            {provider.ramTotal && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <HardDrive className="h-3 w-3" />
                <span>{provider.ramTotal} GB RAM {provider.ramType && `(${provider.ramType})`}</span>
              </div>
            )}
            {provider.storageTotal && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <HardDrive className="h-3 w-3" />
                <span>{provider.storageTotal} {provider.storageType && `(${provider.storageType})`}</span>
              </div>
            )}
            {provider.bandwidth && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Network className="h-3 w-3" />
                <span>{provider.bandwidth} {provider.networkType && `(${provider.networkType})`}</span>
              </div>
            )}
            {(provider.country || provider.city) && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3" />
                <span>{provider.city || ""} {provider.country || ""}</span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
