import { useState } from "react";
import { formatEther, parseEther, type Address } from "viem";
import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount } from "wagmi";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Coins, ShieldAlert, Shield, Lock, AlertTriangle } from "lucide-react";

// ─── Placeholder ABIs (replace with compiled ABIs from shared/) ──────────────

const STAKING_ABI = [
  { name: "getStake", type: "function", stateMutability: "view", inputs: [{ name: "provider", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "getTier", type: "function", stateMutability: "view", inputs: [{ name: "provider", type: "address" }], outputs: [{ type: "uint8" }] },
  { name: "getStakeInfo", type: "function", stateMutability: "view", inputs: [{ name: "provider", type: "address" }], outputs: [{ components: [{ name: "amount", type: "uint256" }, { name: "unstakeRequestedAt", type: "uint256" }, { name: "pendingUnstakeAmount", type: "uint256" }, { name: "activeChallengeCnt", type: "uint256" }, { name: "totalSlashed", type: "uint256" }], type: "tuple" }] },
  { name: "stake", type: "function", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { name: "requestUnstake", type: "function", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
] as const;

// ─── Tier Config ──────────────────────────────────────────────────────────────

const TIERS = {
  0: { label: "Unregistered", color: "bg-zinc-800 text-zinc-400 border-zinc-700", min: "0" },
  1: { label: "Tier 1", color: "bg-emerald-950 text-emerald-400 border-emerald-800", min: "1,000 CLD" },
  2: { label: "Tier 2", color: "bg-blue-950 text-blue-400 border-blue-800", min: "10,000 CLD" },
  3: { label: "Tier 3", color: "bg-purple-950 text-purple-400 border-purple-800", min: "50,000 CLD" },
} as const;

const TIER_REQUIREMENTS = [
  { tier: 1, min: 1_000n, label: "Standard workloads (web, APIs, DBs)" },
  { tier: 2, min: 10_000n, label: "Optimistic workloads (data, transcoding)" },
  { tier: 3, min: 50_000n, label: "POUW-verified (AI/ML, scientific compute)" },
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface StakePanelProps {
  stakingManagerAddress?: Address;
  providerAddress?: Address;
  className?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function StakePanel({ stakingManagerAddress, providerAddress, className }: StakePanelProps) {
  const { address: connectedAddress } = useAccount();
  const target = providerAddress ?? connectedAddress;

  const [stakeInput, setStakeInput] = useState("");
  const [unstakeInput, setUnstakeInput] = useState("");

  // Contract reads
  const { data: stakeInfo, refetch } = useReadContract({
    address: stakingManagerAddress,
    abi: STAKING_ABI,
    functionName: "getStakeInfo",
    args: target ? [target] : undefined,
    query: { enabled: !!target && !!stakingManagerAddress },
  });

  const { data: tier } = useReadContract({
    address: stakingManagerAddress,
    abi: STAKING_ABI,
    functionName: "getTier",
    args: target ? [target] : undefined,
    query: { enabled: !!target && !!stakingManagerAddress },
  });

  // Writes
  const { writeContract: writeStake, data: stakeTxHash, isPending: staking } = useWriteContract();
  const { writeContract: writeUnstake, data: unstakeTxHash, isPending: unstaking } = useWriteContract();

  const { isLoading: stakeTxLoading } = useWaitForTransactionReceipt({
    hash: stakeTxHash,
    query: { enabled: !!stakeTxHash, onSuccess: () => refetch() } as any,
  });

  const handleStake = () => {
    if (!stakeInput || !stakingManagerAddress) return;
    writeStake({
      address: stakingManagerAddress,
      abi: STAKING_ABI,
      functionName: "stake",
      args: [parseEther(stakeInput)],
    });
  };

  const handleRequestUnstake = () => {
    if (!unstakeInput || !stakingManagerAddress) return;
    writeUnstake({
      address: stakingManagerAddress,
      abi: STAKING_ABI,
      functionName: "requestUnstake",
      args: [parseEther(unstakeInput)],
    });
  };

  const tierNum = (tier ?? 0) as 0 | 1 | 2 | 3;
  const tierCfg = TIERS[tierNum];
  const stakedAmount = stakeInfo ? (stakeInfo as any).amount ?? 0n : 0n;
  const activeChallenges = stakeInfo ? Number((stakeInfo as any).activeChallengeCnt ?? 0n) : 0;
  const totalSlashed = stakeInfo ? (stakeInfo as any).totalSlashed ?? 0n : 0n;
  const hasActiveChallenges = activeChallenges > 0;

  // Demo mode: no contract address configured yet
  const isDemoMode = !stakingManagerAddress;

  return (
    <TooltipProvider>
      <Card className={cn("border-white/5 bg-card/50", className)}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-cyan-400" />
              <span className="font-semibold text-sm">Stake & Security</span>
            </div>
            <Badge className={cn("text-xs border", tierCfg.color)}>
              {tierCfg.label}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {isDemoMode && (
            <div className="rounded-md bg-yellow-950/40 border border-yellow-800/40 px-3 py-2 text-xs text-yellow-400">
              StakingManager contract not yet deployed. Deploy contracts to enable staking.
            </div>
          )}

          {/* Stake Summary */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-background/50 border border-white/5 p-3">
              <div className="text-xs text-muted-foreground mb-1">Staked</div>
              <div className="font-mono text-sm font-semibold text-cyan-400">
                {isDemoMode ? "—" : `${Number(formatEther(stakedAmount)).toLocaleString()} CLD`}
              </div>
            </div>
            <div className="rounded-lg bg-background/50 border border-white/5 p-3">
              <div className="text-xs text-muted-foreground mb-1">Total Slashed</div>
              <div className={cn("font-mono text-sm font-semibold", totalSlashed > 0n ? "text-red-400" : "text-muted-foreground")}>
                {isDemoMode ? "—" : `${Number(formatEther(totalSlashed)).toLocaleString()} CLD`}
              </div>
            </div>
          </div>

          {/* Active Challenges */}
          {hasActiveChallenges && (
            <div className="flex items-center gap-2 rounded-md bg-red-950/40 border border-red-800/40 px-3 py-2">
              <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
              <span className="text-xs text-red-400">
                <span className="font-bold">{activeChallenges} active challenge{activeChallenges > 1 ? "s" : ""}</span>
                {" "}: unstaking locked until resolved
              </span>
            </div>
          )}

          {/* Tier Requirements */}
          <div className="space-y-1.5">
            <div className="text-xs text-muted-foreground font-medium">Tier Requirements</div>
            {TIER_REQUIREMENTS.map(({ tier: t, min, label }) => (
              <div
                key={t}
                className={cn(
                  "flex items-center justify-between rounded px-2.5 py-1.5 text-xs",
                  tierNum >= t
                    ? "bg-emerald-950/30 border border-emerald-900/40"
                    : "bg-background/30 border border-white/5 opacity-60"
                )}
              >
                <span className="text-muted-foreground">{label}</span>
                <span className={cn("font-mono font-medium", tierNum >= t ? "text-emerald-400" : "text-zinc-500")}>
                  {tierNum >= t ? "✓" : `${min.toLocaleString()}k CLD`}
                </span>
              </div>
            ))}
          </div>

          {/* Stake Input */}
          {!isDemoMode && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="Amount (CLD)"
                  value={stakeInput}
                  onChange={e => setStakeInput(e.target.value)}
                  className="flex-1 h-8 rounded-md border border-white/10 bg-background/50 px-3 text-xs font-mono focus:outline-none focus:border-cyan-500/50"
                />
                <Button
                  size="sm"
                  onClick={handleStake}
                  disabled={staking || stakeTxLoading || !stakeInput}
                  className="text-xs h-8"
                >
                  {staking || stakeTxLoading ? "Staking..." : "Stake"}
                </Button>
              </div>

              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="Unstake amount"
                  value={unstakeInput}
                  onChange={e => setUnstakeInput(e.target.value)}
                  className="flex-1 h-8 rounded-md border border-white/10 bg-background/50 px-3 text-xs font-mono focus:outline-none focus:border-white/20"
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleRequestUnstake}
                      disabled={unstaking || hasActiveChallenges || !unstakeInput}
                      className="text-xs h-8 gap-1"
                    >
                      {hasActiveChallenges && <Lock className="h-3 w-3" />}
                      Request Unstake
                    </Button>
                  </TooltipTrigger>
                  {hasActiveChallenges && (
                    <TooltipContent>
                      Cannot unstake with active challenges. Resolve them first.
                    </TooltipContent>
                  )}
                </Tooltip>
              </div>
              <p className="text-xs text-muted-foreground">7-day cooldown after requesting unstake.</p>
            </div>
          )}

          {/* Security Note */}
          <div className="flex items-start gap-2 rounded-md bg-background/30 border border-white/5 px-3 py-2">
            <ShieldAlert className="h-3.5 w-3.5 text-cyan-400/70 mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              Stake is slashed 50% for fraud. Challengers earn 25% of slashed amount for catching fake work.
            </p>
          </div>
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
