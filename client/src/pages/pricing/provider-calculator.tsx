import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import {
  Cpu,
  HardDrive,
  Radio,
  MonitorSmartphone,
  Zap,
  TrendingDown,
  Coins,
  ArrowRight,
  Layers,
  Clock,
  Calendar,
  Sparkles,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";
import { cn } from "@/lib/utils";
import { NodeTier, NODE_TIER_LABELS, NODE_TIER_DESCRIPTIONS } from "@/lib/node-tier";
import {
  calculateProjection,
  generateDecayCurve,
  BASE_REGISTRATION_REWARDS,
  POUW_HOURLY_RATES,
  STAKING_TIERS,
  HALVING_INTERVAL,
  type EarningsProjection,
} from "@/lib/provider-economics";

// ── Tier icons ───────────────────────────────────────────────────────────────

const TIER_ICONS: Record<NodeTier, typeof Cpu> = {
  [NodeTier.CPU_ONLY]: Cpu,
  [NodeTier.EDGE_RELAY]: Radio,
  [NodeTier.STORAGE]: HardDrive,
  [NodeTier.GPU_MID]: MonitorSmartphone,
  [NodeTier.GPU_HIGH]: Zap,
};

const TIER_COLORS: Record<NodeTier, string> = {
  [NodeTier.CPU_ONLY]: "border-blue-500/30 bg-blue-500/5",
  [NodeTier.EDGE_RELAY]: "border-cyan-500/30 bg-cyan-500/5",
  [NodeTier.STORAGE]: "border-amber-500/30 bg-amber-500/5",
  [NodeTier.GPU_MID]: "border-violet-500/30 bg-violet-500/5",
  [NodeTier.GPU_HIGH]: "border-emerald-500/30 bg-emerald-500/5",
};

const TIER_ICON_COLORS: Record<NodeTier, string> = {
  [NodeTier.CPU_ONLY]: "text-blue-400",
  [NodeTier.EDGE_RELAY]: "text-cyan-400",
  [NodeTier.STORAGE]: "text-amber-400",
  [NodeTier.GPU_MID]: "text-violet-400",
  [NodeTier.GPU_HIGH]: "text-emerald-400",
};

// ── Format helpers ───────────────────────────────────────────────────────────

function fmt(n: number, decimals = 0): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ProviderCalculatorPage() {
  const [selectedTier, setSelectedTier] = useState<NodeTier>(NodeTier.GPU_MID);
  const [stakingIndex, setStakingIndex] = useState(0);
  const [utilization, setUtilization] = useState(60);
  const [networkEpoch, setNetworkEpoch] = useState(0);

  const projection = useMemo<EarningsProjection>(
    () =>
      calculateProjection({
        tier: selectedTier,
        epoch: networkEpoch,
        stakingTierIndex: stakingIndex,
        utilization: utilization / 100,
      }),
    [selectedTier, stakingIndex, utilization, networkEpoch]
  );

  const decayCurve = useMemo(
    () => generateDecayCurve(selectedTier, 10),
    [selectedTier]
  );

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Coins className="h-6 w-6 text-primary" />
          <h1 className="text-3xl font-bold">Provider Earn Calculator</h1>
        </div>
        <p className="text-muted-foreground max-w-2xl">
          Estimate your CLD earnings by providing compute to the Cloudana network.
          Earn a one-time registration mint plus ongoing Proof of Useful Work rewards.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* ─── Left: Hardware Tier + Controls ────────────────────────── */}
        <div className="lg:col-span-5 space-y-6">
          {/* Tier selector */}
          <Card className="border-white/5 bg-card/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Layers className="h-4 w-4 text-primary" />
                Select Your Hardware
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {Object.values(NodeTier)
                .filter((v): v is NodeTier => typeof v === "number")
                .map((tier) => {
                  const Icon = TIER_ICONS[tier];
                  const isSelected = tier === selectedTier;
                  return (
                    <button
                      key={tier}
                      onClick={() => setSelectedTier(tier)}
                      className={cn(
                        "w-full flex items-center gap-3 rounded-lg border p-3 text-left transition-all",
                        isSelected
                          ? `${TIER_COLORS[tier]} ring-1 ring-primary/40`
                          : "border-white/5 hover:border-white/15 hover:bg-white/[0.02]"
                      )}
                    >
                      <Icon className={cn("h-5 w-5 shrink-0", isSelected ? TIER_ICON_COLORS[tier] : "text-muted-foreground")} />
                      <div className="min-w-0 flex-1">
                        <p className={cn("text-sm font-medium", isSelected && "text-foreground")}>
                          {NODE_TIER_LABELS[tier]}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {NODE_TIER_DESCRIPTIONS[tier]}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={cn(
                          "shrink-0 text-xs font-mono",
                          isSelected
                            ? "border-primary/30 text-primary"
                            : "border-white/10 text-muted-foreground"
                        )}
                      >
                        {fmt(BASE_REGISTRATION_REWARDS[tier])} CLD
                      </Badge>
                    </button>
                  );
                })}
            </CardContent>
          </Card>

          {/* Controls */}
          <Card className="border-white/5 bg-card/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Utilization */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label className="text-sm text-muted-foreground">Utilization</Label>
                  <span className="text-sm font-mono font-semibold">{utilization}%</span>
                </div>
                <Slider
                  min={10}
                  max={100}
                  step={5}
                  value={[utilization]}
                  onValueChange={(v) => setUtilization(v[0])}
                />
                <p className="text-xs text-muted-foreground">
                  Percentage of time your node serves workloads
                </p>
              </div>

              <Separator className="bg-white/10" />

              {/* Staking tier */}
              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">Staking Tier</Label>
                <div className="grid grid-cols-2 gap-2">
                  {STAKING_TIERS.map((st, i) => (
                    <button
                      key={i}
                      onClick={() => setStakingIndex(i)}
                      className={cn(
                        "rounded-lg border p-2 text-center transition-all text-sm",
                        i === stakingIndex
                          ? "border-primary/40 bg-primary/10 text-foreground"
                          : "border-white/5 hover:border-white/15 text-muted-foreground"
                      )}
                    >
                      <p className="font-medium">{st.name}</p>
                      <p className="text-xs mt-0.5">
                        {st.stakeRequired > 0 ? `${fmt(st.stakeRequired)} CLD` : "No stake"}
                        {st.multiplier > 1 ? ` (${st.multiplier}x)` : ""}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              <Separator className="bg-white/10" />

              {/* Network epoch */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label className="text-sm text-muted-foreground">Network Epoch</Label>
                  <span className="text-sm font-mono font-semibold">
                    {networkEpoch} ({fmt(networkEpoch * HALVING_INTERVAL)} providers)
                  </span>
                </div>
                <Slider
                  min={0}
                  max={8}
                  step={1}
                  value={[networkEpoch]}
                  onValueChange={(v) => setNetworkEpoch(v[0])}
                />
                <p className="text-xs text-muted-foreground">
                  Registration rewards halve every {fmt(HALVING_INTERVAL)} providers
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ─── Right: Earnings + Decay ───────────────────────────────── */}
        <div className="lg:col-span-7 space-y-6">
          {/* Earnings breakdown */}
          <Card className="border-white/5 bg-card/50">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  Your Earnings Breakdown
                </CardTitle>
                {networkEpoch === 0 && (
                  <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 text-xs">
                    Early Adopter Bonus Active
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Top-line numbers */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-white/10 p-3">
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Coins className="h-3 w-3" /> Registration Mint
                  </p>
                  <p className="text-xl font-bold font-mono mt-1">
                    {fmt(projection.registrationMint)}
                  </p>
                  <p className="text-xs text-muted-foreground">CLD (one-time)</p>
                </div>
                <div className="rounded-lg border border-white/10 p-3">
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" /> Monthly POUW
                  </p>
                  <p className="text-xl font-bold font-mono mt-1">
                    {fmt(projection.pouwMonthly)}
                  </p>
                  <p className="text-xs text-muted-foreground">CLD/month</p>
                </div>
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Calendar className="h-3 w-3" /> Annual Total
                  </p>
                  <p className="text-xl font-bold font-mono mt-1 text-primary">
                    {fmt(projection.annualProjection)}
                  </p>
                  <p className="text-xs text-muted-foreground">CLD/year</p>
                </div>
              </div>

              <Separator className="bg-white/10" />

              {/* Detailed breakdown */}
              <div className="space-y-3">
                <Row
                  label="Registration Mint (one-time)"
                  value={`${fmt(projection.registrationMint)} CLD`}
                  sub={`${NODE_TIER_LABELS[selectedTier]} at epoch ${networkEpoch}`}
                />
                <Row
                  label="POUW Hourly Rate"
                  value={`${POUW_HOURLY_RATES[selectedTier]} CLD/hr`}
                  sub={`Base rate for ${NODE_TIER_LABELS[selectedTier]}`}
                />
                <Row
                  label="Utilization"
                  value={`${utilization}%`}
                  sub="Percentage of time serving workloads"
                />
                <Row
                  label="Base Monthly POUW"
                  value={`${fmt(projection.basePouwMonthly)} CLD`}
                  sub="Hourly rate x 720 hours x utilization"
                />
                {projection.stakingMultiplier > 1 && (
                  <Row
                    label="Staking Multiplier"
                    value={`${projection.stakingMultiplier}x`}
                    sub={`${STAKING_TIERS[stakingIndex].name}: stake ${fmt(STAKING_TIERS[stakingIndex].stakeRequired)} CLD`}
                    highlight
                  />
                )}
                <Separator className="bg-white/10" />
                <Row
                  label="First Month Total"
                  value={`${fmt(projection.firstMonthTotal)} CLD`}
                  sub="Registration mint + first month POUW"
                  bold
                />
                <Row
                  label="Monthly Recurring"
                  value={`${fmt(projection.monthlyRecurring)} CLD`}
                  sub="POUW earnings after registration"
                />
              </div>

              <Link href="/providers/register">
                <Button className="w-full gap-2 mt-2" variant="outline">
                  <ArrowRight className="h-4 w-4" />
                  Register a Provider Node
                </Button>
              </Link>
            </CardContent>
          </Card>

          {/* Decay chart */}
          <Card className="border-white/5 bg-card/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-primary" />
                Registration Reward Decay
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Rewards halve every {fmt(HALVING_INTERVAL)} provider registrations, similar to Bitcoin mining.
                Earlier providers earn the most.
              </p>
            </CardHeader>
            <CardContent>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={decayCurve}>
                    <defs>
                      <linearGradient id="rewardFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 100% / 0.06)" />
                    <XAxis
                      dataKey="totalProviders"
                      tickFormatter={(v: number) => (v >= 1000 ? `${v / 1000}K` : String(v))}
                      stroke="hsl(0 0% 100% / 0.2)"
                      fontSize={11}
                      label={{
                        value: "Total Providers",
                        position: "insideBottom",
                        offset: -4,
                        style: { fill: "hsl(0 0% 100% / 0.4)", fontSize: 11 },
                      }}
                    />
                    <YAxis
                      tickFormatter={(v: number) => `${v}`}
                      stroke="hsl(0 0% 100% / 0.2)"
                      fontSize={11}
                      label={{
                        value: "CLD",
                        angle: -90,
                        position: "insideLeft",
                        offset: 10,
                        style: { fill: "hsl(0 0% 100% / 0.4)", fontSize: 11 },
                      }}
                    />
                    <RechartsTooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(0 0% 100% / 0.1)",
                        borderRadius: "8px",
                        fontSize: 12,
                      }}
                      formatter={(value: number) => [`${fmt(value)} CLD`, "Reward"]}
                      labelFormatter={(label: number) =>
                        `After ${label >= 1000 ? `${label / 1000}K` : label} providers`
                      }
                    />
                    <Area
                      type="stepAfter"
                      dataKey="reward"
                      stroke="hsl(var(--primary))"
                      fill="url(#rewardFill)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Comparison table */}
              <div className="mt-4 rounded-lg border border-white/5 overflow-hidden">
                <div className="grid grid-cols-4 text-xs text-muted-foreground font-medium bg-white/[0.02]">
                  <div className="px-3 py-2">If you join at</div>
                  <div className="px-3 py-2 text-right">Epoch</div>
                  <div className="px-3 py-2 text-right">Mint Reward</div>
                  <div className="px-3 py-2 text-right">vs. Now</div>
                </div>
                {[0, 1, 2, 3, 5].map((epoch) => {
                  const reward = BASE_REGISTRATION_REWARDS[selectedTier] / Math.pow(2, epoch);
                  const currentReward = BASE_REGISTRATION_REWARDS[selectedTier] / Math.pow(2, networkEpoch);
                  const diff = reward - currentReward;
                  return (
                    <div
                      key={epoch}
                      className={cn(
                        "grid grid-cols-4 text-xs border-t border-white/5",
                        epoch === networkEpoch && "bg-primary/5"
                      )}
                    >
                      <div className="px-3 py-2 text-muted-foreground">
                        {epoch === 0 ? "Now (0)" : `${fmt(epoch * HALVING_INTERVAL)} providers`}
                        {epoch === networkEpoch && (
                          <span className="ml-1 text-primary">(current)</span>
                        )}
                      </div>
                      <div className="px-3 py-2 text-right font-mono">{epoch}</div>
                      <div className="px-3 py-2 text-right font-mono font-medium">
                        {fmt(reward)} CLD
                      </div>
                      <div
                        className={cn(
                          "px-3 py-2 text-right font-mono",
                          diff > 0 ? "text-emerald-400" : diff < 0 ? "text-red-400" : "text-muted-foreground"
                        )}
                      >
                        {diff > 0 ? `+${fmt(diff)}` : diff < 0 ? fmt(diff) : "current"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ── Row helper ───────────────────────────────────────────────────────────────

function Row({
  label,
  value,
  sub,
  bold,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  bold?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-start justify-between">
      <div className="min-w-0">
        <p className={cn("text-sm", bold ? "font-semibold text-foreground" : "text-muted-foreground")}>
          {label}
        </p>
        {sub && <p className="text-xs text-muted-foreground/70">{sub}</p>}
      </div>
      <span
        className={cn(
          "font-mono text-sm shrink-0 ml-3",
          bold && "font-semibold text-foreground",
          highlight && "text-primary font-semibold"
        )}
      >
        {value}
      </span>
    </div>
  );
}
