import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import {
  Coins,
  ArrowRight,
  Clock,
  Pickaxe,
  Briefcase,
  Calendar,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  calculateProjection,
  type EarningsProjection,
} from "@/lib/provider-economics";

// ── Format helpers ───────────────────────────────────────────────────────────

function fmt(n: number, decimals = 0): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ProviderCalculatorPage() {
  const [certsPerMonth, setCertsPerMonth] = useState(10);
  const [jobRevenuePerMonth, setJobRevenuePerMonth] = useState(500);
  const [networkYear, setNetworkYear] = useState(1);

  const projection = useMemo<EarningsProjection>(
    () =>
      calculateProjection({
        certsPerMonth,
        jobRevenuePerMonth,
        networkYear,
      }),
    [certsPerMonth, jobRevenuePerMonth, networkYear]
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
        {/* ─── Left: Controls ─────────────────────────────────────── */}
        <div className="lg:col-span-5 space-y-6">
          <Card className="border-white/5 bg-card/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Certificates per month */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label className="text-sm text-muted-foreground flex items-center gap-1">
                    <Pickaxe className="h-3 w-3" /> POUW Certificates / Month
                  </Label>
                  <span className="text-sm font-mono font-semibold">{certsPerMonth}</span>
                </div>
                <Slider
                  min={0}
                  max={100}
                  step={1}
                  value={[certsPerMonth]}
                  onValueChange={(v) => setCertsPerMonth(v[0])}
                />
                <p className="text-xs text-muted-foreground">
                  Expected POUW certificates found per month. Set to 0 for non-GPU providers.
                </p>
              </div>

              <Separator className="bg-white/10" />

              {/* Job revenue per month */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label className="text-sm text-muted-foreground flex items-center gap-1">
                    <Briefcase className="h-3 w-3" /> Job Revenue / Month (CLD)
                  </Label>
                  <span className="text-sm font-mono font-semibold">{fmt(jobRevenuePerMonth)}</span>
                </div>
                <Slider
                  min={0}
                  max={5000}
                  step={50}
                  value={[jobRevenuePerMonth]}
                  onValueChange={(v) => setJobRevenuePerMonth(v[0])}
                />
                <p className="text-xs text-muted-foreground">
                  Expected job fee revenue per month (CLD, before split). All provider types earn here.
                </p>
              </div>

              <Separator className="bg-white/10" />

              {/* Network year */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label className="text-sm text-muted-foreground flex items-center gap-1">
                    <Calendar className="h-3 w-3" /> Network Year
                  </Label>
                  <span className="text-sm font-mono font-semibold">Year {networkYear}</span>
                </div>
                <Slider
                  min={1}
                  max={10}
                  step={1}
                  value={[networkYear]}
                  onValueChange={(v) => setNetworkYear(v[0])}
                />
                <p className="text-xs text-muted-foreground">
                  Block reward halves over time: 100 CLD (Y1-4), 50 CLD (Y5-8), 25 CLD (Y9+).
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ─── Right: Earnings Breakdown ──────────────────────────── */}
        <div className="lg:col-span-7 space-y-6">
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
                    <Pickaxe className="h-3 w-3" /> Mining
                  </p>
                  <p className="text-xl font-bold font-mono mt-1">
                    {fmt(projection.miningIncome)}
                  </p>
                  <p className="text-xs text-muted-foreground">CLD/month</p>
                </div>
                <div className="rounded-lg border border-white/10 p-3">
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Briefcase className="h-3 w-3" /> Job Fees
                  </p>
                  <p className="text-xl font-bold font-mono mt-1">
                    {fmt(projection.jobFeeIncome)}
                  </p>
                  <p className="text-xs text-muted-foreground">CLD/month</p>
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
                  label="POUW Certificates"
                  value={`${certsPerMonth}/month`}
                  sub="Each cert earns block reward × 75% provider share"
                />
                <Row
                  label="Block Reward"
                  value={`${networkYear < 5 ? 100 : networkYear < 9 ? 50 : 25} CLD`}
                  sub={`Year ${networkYear} reward schedule`}
                />
                <Row
                  label="Job Revenue"
                  value={`${fmt(jobRevenuePerMonth)} CLD/month`}
                  sub="Before fee split (all provider types)"
                />
                <Row
                  label="Fee Split"
                  value="75 / 20 / 5"
                  sub="Provider / Burned / Treasury"
                />
                <Separator className="bg-white/10" />
                <Row
                  label="Total Monthly"
                  value={`${fmt(projection.totalMonthly)} CLD`}
                  sub="Mining + job fee income after 75% split"
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
