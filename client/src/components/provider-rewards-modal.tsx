import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatEther } from "viem";
import type { Address } from "viem";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Coins, Server, Loader2 } from "lucide-react";
import { getMyProviders } from "@/lib/api";
import { useProviderCredit, useWithdrawProvider } from "@/lib/contracts";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { TxLink } from "@/components/ui/tx-link";

interface ProviderRewardsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ownerAddress?: Address;
}

export function ProviderRewardsModal({ open, onOpenChange, ownerAddress }: ProviderRewardsModalProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const { toast } = useToast();

  // Fetch owner's providers
  const { data: myProviders = [], isLoading: isLoadingProviders } = useQuery({
    queryKey: ["myProviders", ownerAddress],
    queryFn: () => ownerAddress ? getMyProviders(ownerAddress) : Promise.resolve([]),
    staleTime: 10000,
    enabled: open && !!ownerAddress,
  });

  // Fetch owner's total credit
  const { data: providerCredit, refetch: refetchCredit } = useProviderCredit(ownerAddress);
  
  // Withdraw hook
  const { 
    withdraw, 
    hash: withdrawHash, 
    isPending: isWithdrawing, 
    isSuccess: isWithdrawn, 
    error: withdrawError, 
    reset: resetWithdraw 
  } = useWithdrawProvider();

  const totalCredit = providerCredit && typeof providerCredit === 'bigint' ? providerCredit : 0n;
  const creditAmount = parseFloat(formatEther(totalCredit));

  // Show success message after withdrawal
  useEffect(() => {
    if (isWithdrawn && withdrawHash && open) {
      toast({
        title: "Withdrawal Successful!",
        description: "Your rewards have been transferred to your wallet.",
      });
      refetchCredit();
    }
  }, [isWithdrawn, withdrawHash, open, toast, refetchCredit]);

  // Show error message
  useEffect(() => {
    if (withdrawError && !isWithdrawing && !withdrawHash && open) {
      toast({
        title: "Withdrawal Failed",
        description: withdrawError.message || "Failed to withdraw rewards",
        variant: "destructive",
      });
    }
  }, [withdrawError, isWithdrawing, withdrawHash, open, toast]);

  const handleWithdraw = () => {
    resetWithdraw();
    withdraw();
  };

  // Filter providers by search term
  const filteredProviders = useMemo(() => {
    if (!searchTerm) return myProviders;
    
    const searchLower = searchTerm.toLowerCase();
    return myProviders.filter((p: any) => 
      (p.name || "").toLowerCase().includes(searchLower) ||
      (p.providerkey || "").toLowerCase().includes(searchLower)
    );
  }, [myProviders, searchTerm]);

  const isLoading = isLoadingProviders;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0 border-white/10 bg-card/95 backdrop-blur-xl">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-white/5">
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <Coins className="h-6 w-6 text-yellow-400" />
            My Provider Rewards
          </DialogTitle>
          <DialogDescription>
            View your providers and accumulated rewards
          </DialogDescription>
        </DialogHeader>

        {/* Summary Stats & Claim Button */}
        <div className="px-6 py-4 border-b border-white/5 bg-gradient-to-br from-yellow-400/5 to-transparent">
          <div className="flex items-center justify-between">
            <div className="space-y-3 flex-1">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">My Providers</p>
                  <p className="text-2xl font-bold font-mono">{myProviders.length}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Total Accumulated Rewards</p>
                  <p className="text-2xl font-bold font-mono text-yellow-400">
                    {creditAmount.toFixed(4)} CLD
                  </p>
                </div>
              </div>
              {withdrawHash && isWithdrawn && (
                <TxLink hash={withdrawHash} label="Withdrawal confirmed" variant="inline" />
              )}
            </div>
            <div className="ml-6">
              <Button
                className="bg-yellow-400/10 text-yellow-400 hover:bg-yellow-400/20 border border-yellow-400/20 h-12 px-6"
                disabled={creditAmount === 0 || isWithdrawing}
                onClick={handleWithdraw}
              >
                {isWithdrawing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {withdrawHash ? "Confirming..." : "Claiming..."}
                  </>
                ) : (
                  <>
                    <Coins className="mr-2 h-4 w-4" />
                    Claim All Rewards
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* Search Bar */}
        <div className="px-6 py-3 border-b border-white/5">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search provider by name or hash key..."
              className="pl-9 bg-background/50 border-white/10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        {/* Provider List */}
        <ScrollArea className="flex-1 px-6 py-4">
          <div className="space-y-3 pb-4">
            {isLoading ? (
              // Loading skeletons
              Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} className="border-white/5 bg-card/40">
                  <CardContent className="p-4">
                    <Skeleton className="h-6 w-3/4 mb-3" />
                    <Skeleton className="h-4 w-1/2 mb-2" />
                    <Skeleton className="h-4 w-1/4" />
                  </CardContent>
                </Card>
              ))
            ) : filteredProviders.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                {searchTerm ? "No providers found matching your search" : "You haven't registered any providers yet"}
              </div>
            ) : (
              filteredProviders.map((provider: any) => (
                <Card
                  key={provider.pubKeyHash || provider.providerkey}
                  className="group hover:border-primary/50 transition-all duration-300 border-white/5 bg-card/40"
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      {/* Provider Info */}
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div className="h-10 w-10 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
                          <Server className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-lg font-semibold truncate group-hover:text-primary transition-colors">
                            {provider.name || "Unnamed Provider"}
                          </h3>
                          {provider.description && (
                            <p className="text-sm text-muted-foreground line-clamp-1 mt-0.5">
                              {provider.description}
                            </p>
                          )}
                          {provider.providerkey && (
                            <p className="text-xs text-muted-foreground font-mono mt-2 truncate">
                              {provider.providerkey.slice(0, 16)}...{provider.providerkey.slice(-12)}
                            </p>
                          )}
                          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                            {provider.region && (
                              <span>📍 {provider.region}</span>
                            )}
                            {provider.hardwareTier !== undefined && (
                              <span>
                                💻 {provider.hardwareTier === 0 ? "CPU" : provider.hardwareTier === 1 ? "GPU-T1" : "GPU-T2"}
                              </span>
                            )}
                            {provider.capacity && (
                              <span>⚡ {provider.capacity} server{provider.capacity !== 1 ? "s" : ""}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Status Badge */}
                      <Badge
                        variant={
                          provider.status === 1 || provider.status === "Active"
                            ? "default"
                            : "secondary"
                        }
                        className={`flex-shrink-0 ${
                          provider.status === 1 || provider.status === "Active"
                            ? "bg-primary/20 text-primary"
                            : ""
                        }`}
                      >
                        {provider.status === 0
                          ? "⚪ Unregistered"
                          : provider.status === 1
                          ? "🟢 Active"
                          : provider.status === 2
                          ? "🔴 Inactive"
                          : provider.status === 3
                          ? "🟠 Suspended"
                          : provider.status}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

