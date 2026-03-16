import { useState, useEffect, useCallback } from "react";
import { useAccount } from "wagmi";
import { formatEther } from "viem";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Droplets, ExternalLink, Loader2, CheckCircle2, Clock, Wallet, AlertTriangle } from "lucide-react";
import { useCLDTokenBalance } from "@/lib/contracts";
import { useToast } from "@/hooks/use-toast";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:7002/v1";

export default function FaucetPage() {
  const { address, isConnected } = useAccount();
  const { toast } = useToast();
  const { data: tokenBalance, refetch: refetchBalance } = useCLDTokenBalance(
    isConnected ? (address as `0x${string}`) : undefined
  );

  const [claiming, setClaiming] = useState(false);
  const [canClaim, setCanClaim] = useState(false);
  const [cooldownMs, setCooldownMs] = useState(0);
  const [lastTx, setLastTx] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cldBalance =
    tokenBalance && typeof tokenBalance === "bigint"
      ? parseFloat(formatEther(tokenBalance))
      : 0;

  // Check faucet status
  const checkStatus = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch(`${API_BASE}/faucet/status?address=${address}`);
      const data = await res.json();
      setCanClaim(data.canClaim);
      setCooldownMs(data.cooldownMs || 0);
    } catch {
      // Faucet endpoint might not be running yet
      setCanClaim(true);
      setCooldownMs(0);
    }
  }, [address]);

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 30_000);
    return () => clearInterval(interval);
  }, [checkStatus]);

  // Countdown timer display
  const [displayTime, setDisplayTime] = useState("");
  useEffect(() => {
    if (cooldownMs <= 0) {
      setDisplayTime("");
      return;
    }
    const tick = () => {
      const now = Date.now();
      const remaining = Math.max(0, cooldownMs - (now - Date.now()));
      if (remaining <= 0) {
        setDisplayTime("");
        setCanClaim(true);
        return;
      }
      const h = Math.floor(remaining / 3600000);
      const m = Math.floor((remaining % 3600000) / 60000);
      setDisplayTime(`${h}h ${m}m`);
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [cooldownMs]);

  const handleClaim = async () => {
    if (!address) return;
    setClaiming(true);
    setError(null);
    setLastTx(null);

    try {
      const res = await fetch(`${API_BASE}/faucet/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });

      const data = await res.json();

      if (data.success) {
        setLastTx(data.txHash);
        setCanClaim(false);
        setCooldownMs(24 * 60 * 60 * 1000);
        toast({ title: "Tokens claimed!", description: "100 CLD has been sent to your wallet." });
        // Wait a moment for chain to propagate, then refetch balance
        setTimeout(() => refetchBalance(), 3000);
      } else {
        setError(data.error || "Claim failed");
        if (data.cooldownMs) {
          setCooldownMs(data.cooldownMs);
          setCanClaim(false);
        }
      }
    } catch (err: any) {
      setError(err.message || "Network error");
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <Droplets className="h-8 w-8 text-primary" />
          Testnet Faucet
        </h1>
        <p className="text-muted-foreground mt-1">
          Get free testnet CLD tokens to try deploying workloads on Cloudana
        </p>
      </div>

      {/* Balance Card */}
      <Card className="border-white/5 bg-card/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Your CLD Balance</CardTitle>
        </CardHeader>
        <CardContent>
          {isConnected ? (
            <div className="text-4xl font-bold tracking-tight">
              {cldBalance.toFixed(2)} <span className="text-lg text-muted-foreground font-normal">CLD</span>
            </div>
          ) : (
            <p className="text-muted-foreground">Connect your wallet to view balance</p>
          )}
        </CardContent>
      </Card>

      {/* Claim Card */}
      <Card className="border-primary/20 bg-card/60">
        <CardHeader>
          <CardTitle className="text-xl flex items-center gap-2">
            <Droplets className="h-5 w-5 text-primary" />
            Claim 100 CLD
          </CardTitle>
          <CardDescription>
            Receive 100 testnet CLD tokens. One claim per wallet every 24 hours.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isConnected ? (
            <div className="flex items-center gap-3 p-4 rounded-lg border border-white/10 bg-muted/20">
              <Wallet className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                Connect your wallet to claim testnet tokens
              </span>
            </div>
          ) : (
            <>
              <Button
                size="lg"
                className="w-full gap-2"
                disabled={!canClaim || claiming}
                onClick={handleClaim}
              >
                {claiming ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Minting tokens...
                  </>
                ) : !canClaim ? (
                  <>
                    <Clock className="h-4 w-4" />
                    Cooldown {displayTime && `(${displayTime} remaining)`}
                  </>
                ) : (
                  <>
                    <Droplets className="h-4 w-4" />
                    Claim 100 CLD
                  </>
                )}
              </Button>

              {lastTx && (
                <div className="flex items-center gap-2 p-3 rounded-lg border border-green-500/20 bg-green-500/5 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                  <span className="text-green-400">Tokens sent!</span>
                  <a
                    href={`https://sepolia.basescan.org/tx/${lastTx}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto text-primary hover:underline flex items-center gap-1"
                  >
                    View TX <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 p-3 rounded-lg border border-red-500/20 bg-red-500/5 text-sm">
                  <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
                  <span className="text-red-400">{error}</span>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Gas Guide */}
      <Card className="border-white/5 bg-card/60">
        <CardHeader>
          <CardTitle className="text-lg">Need gas too?</CardTitle>
          <CardDescription>
            You also need a small amount of Base Sepolia ETH to pay for transaction gas fees.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <a href="https://www.alchemy.com/faucets/base-sepolia" target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm" className="gap-1">
                Alchemy Faucet <ExternalLink className="h-3 w-3" />
              </Button>
            </a>
            <a href="https://faucet.quicknode.com/base/sepolia" target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm" className="gap-1">
                QuickNode Faucet <ExternalLink className="h-3 w-3" />
              </Button>
            </a>
            <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm" className="gap-1">
                Circle Faucet <ExternalLink className="h-3 w-3" />
              </Button>
            </a>
          </div>
        </CardContent>
      </Card>

      {/* Info */}
      <div className="text-xs text-muted-foreground/60 text-center space-y-1">
        <p>CLD is a testnet token on Base Sepolia with no real monetary value.</p>
        <p>Token contract: <code className="font-mono">0xcfd19DF5a3f963Dabf52aC7B46d4780Cc0E599e2</code></p>
      </div>
    </div>
  );
}
