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
  Coins,
  ArrowRight,
  Layers,
  Clock,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NodeTier, NODE_TIER_LABELS, NODE_TIER_DESCRIPTIONS } from "@/lib/node-tier";
import {
  calculateProjection,
  ESTIMATED_HOURLY_RATES,
  FEE_SPLIT,
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
  const [utilization, setUtilization] = useState(60);
  const [activeProviders, setActiveProviders] = useState(100);

  const projection = useMemo<EarningsProjection>(
    () =>
      calculateProjection({
        tier: selectedTier,
        activeProviders,
        utilization: utilization / 100,
      }),
    [selectedTier, activeProviders, utilization]
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
          Estimate your CLD earnings by providing compute to the Cloudana network. All
          CLD is generated through Proof of Useful Work — your hardware earns by doing
          real computation.
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
                        {ESTIMATED_HOURLY_RATES[tier]} CLD/hr
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

              {/* Network Size */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label className="text-sm text-muted-foreground flex items-center gap-1">
                    <Users className="h-3 w-3" /> Active Providers
                  </Label>
                  <span className="text-sm font-mono font-semibold">{fmt(activeProviders)}</span>
                </div>
                <Slider
                  min={10}
                  max={10000}
                  step={10}
                  value={[activeProviders]}
                  onValueChange={(v) => setActiveProviders(v[0])}
                />
                <p className="text-xs text-muted-foreground">
                  Block rewards are shared among all providers. More providers = less per provider.
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
              <CardTitle className="text-base flex items-center gap-2">
                <Coins className="h-4 w-4 text-primary" />
                Your Earnings Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Top-line numbers */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-white/10 p-3">
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" /> Gross Monthly
                  </p>
                  <p className="text-xl font-bold font-mono mt-1">
                    {fmt(projection.grossMonthly)}
                  </p>
                  <p className="text-xs text-muted-foreground">CLD (before fees)</p>
                </div>
                <div className="rounded-lg border border-white/10 p-3">
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Coins className="h-3 w-3" /> Net Monthly
                  </p>
                  <p className="text-xl font-bold font-mono mt-1">
                    {fmt(projection.netMonthly)}
                  </p>
                  <p className="text-xs text-muted-foreground">CLD (75% share)</p>
                </div>
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" /> Annual
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
                  label="POUW Hourly Rate"
                  value={`${ESTIMATED_HOURLY_RATES[selectedTier]} CLD/hr`}
                  sub={`Base rate for ${NODE_TIER_LABELS[selectedTier]}`}
                />
                <Row
                  label="Utilization"
                  value={`${utilization}%`}
                  sub="Percentage of time serving workloads"
                />
                <Row
                  label="Active Providers"
                  value={fmt(activeProviders)}
                  sub="Block rewards shared across all providers"
                />
                <Row
                  label="Fee Split"
                  value="75 / 20 / 5"
                  sub="Provider / Burned / Treasury"
                />
                <Separator className="bg-white/10" />
                <Row
                  label="Net Monthly"
                  value={`${fmt(projection.netMonthly)} CLD`}
                  sub="After 75% provider share"
                  bold
                />
                <Row
                  label="Annual Projection"
                  value={`${fmt(projection.annualProjection)} CLD`}
                  sub="12 months at current settings"
                  bold
                />
              </div>

              <Link href="/provider/register">
                <Button className="w-full gap-2 mt-2" variant="outline">
                  <ArrowRight className="h-4 w-4" />
                  Register a Provider Node
                </Button>
              </Link>
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
