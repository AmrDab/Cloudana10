/**
 * POUW Mining Dashboard — real-time view of network mining activity.
 * Route: /mining
 */

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  useNetworkMiningStats,
  useMiningLeaderboard,
  useRecentCertificates,
  useMiningChainSeed,
  type ProviderMiningStats,
  type RecentCertificate,
} from "@/hooks/usePOUW";
import { Cpu, Activity, Trophy, Hash, Zap, Clock, Shield, BarChart3 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// ─── Stat Card ───────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  loading,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  loading?: boolean;
}) {
  return (
    <Card className="border-white/5 bg-card/50">
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{label}</p>
            {loading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <p className="text-2xl font-bold tracking-tight">{value}</p>
            )}
            {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
          </div>
          <div className="p-2 rounded-lg bg-primary/10">
            <Icon className="h-5 w-5 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Leaderboard Row ─────────────────────────────────────────────────────────

function LeaderboardRow({ rank, provider }: { rank: number; provider: ProviderMiningStats }) {
  const addr = provider.providerAddress;
  const shortAddr = `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  const avgDiff = provider.totalCertificates > 0
    ? (provider.totalDifficulty / provider.totalCertificates).toFixed(1)
    : "—";
  const lastSeen = provider.lastSeen
    ? formatDistanceToNow(provider.lastSeen, { addSuffix: true })
    : "never";

  return (
    <TableRow className="border-white/5 hover:bg-white/5">
      <TableCell>
        <div className="flex items-center gap-2">
          {rank <= 3 ? (
            <Trophy className={`h-4 w-4 ${rank === 1 ? "text-yellow-400" : rank === 2 ? "text-gray-400" : "text-amber-600"}`} />
          ) : (
            <span className="text-muted-foreground text-sm w-4">{rank}</span>
          )}
        </div>
      </TableCell>
      <TableCell>
        <code className="text-xs font-mono text-blue-400">{shortAddr}</code>
      </TableCell>
      <TableCell className="text-right font-bold">{provider.totalCertificates}</TableCell>
      <TableCell className="text-right">
        <Badge variant="outline" className="border-green-500/30 text-green-400 text-xs">
          {provider.recentHashRate}/5min
        </Badge>
      </TableCell>
      <TableCell className="text-right text-muted-foreground text-xs">{avgDiff} bits</TableCell>
      <TableCell className="text-right text-muted-foreground text-xs">{lastSeen}</TableCell>
    </TableRow>
  );
}

// ─── Certificate Feed ────────────────────────────────────────────────────────

function CertRow({ cert }: { cert: RecentCertificate }) {
  const addr = cert.providerAddress;
  const shortAddr = `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  const age = cert.verifiedAt ? formatDistanceToNow(cert.verifiedAt, { addSuffix: true }) : "unknown";

  return (
    <TableRow className="border-white/5 hover:bg-white/5 animate-in fade-in slide-in-from-top-1 duration-300">
      <TableCell>
        <Badge variant="outline" className="border-purple-500/30 text-purple-400 text-xs font-mono">
          #{cert.id.replace("cert-", "")}
        </Badge>
      </TableCell>
      <TableCell>
        <code className="text-xs font-mono text-blue-400">{shortAddr}</code>
      </TableCell>
      <TableCell className="text-center">
        <Badge variant="outline" className="border-white/20 text-xs">{cert.n}×{cert.n}</Badge>
      </TableCell>
      <TableCell className="text-center">
        <span className="text-green-400 font-bold text-sm">{cert.difficulty}</span>
        <span className="text-muted-foreground text-xs"> bits</span>
      </TableCell>
      <TableCell>
        <code className="text-xs font-mono text-muted-foreground">{cert.z}</code>
      </TableCell>
      <TableCell className="text-right text-muted-foreground text-xs">{age}</TableCell>
    </TableRow>
  );
}

// ─── Chain Seed ──────────────────────────────────────────────────────────────

function SeedBar() {
  const { data } = useMiningChainSeed();
  if (!data) return null;
  return (
    <div className="flex items-center gap-3 px-4 py-2 rounded-lg border border-white/5 bg-card/30 text-xs font-mono">
      <Shield className="h-3 w-3 text-green-400 shrink-0" />
      <span className="text-muted-foreground">Seed σ:</span>
      <span className="text-green-400 truncate">{data.seed.slice(0, 32)}...</span>
      <span className="text-muted-foreground shrink-0">Block #{data.blockNumber}</span>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function MiningDashboard() {
  const { data: stats, isLoading: statsLoading } = useNetworkMiningStats();
  const { data: leaderboard, isLoading: lbLoading } = useMiningLeaderboard();
  const { data: certs, isLoading: certsLoading } = useRecentCertificates(30);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-lg bg-green-500/10">
            <Cpu className="h-6 w-6 text-green-400" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Mining Dashboard</h1>
            <p className="text-muted-foreground text-sm">
              Proof of Useful Work — cuPOW (matrix multiplication consensus)
            </p>
          </div>
        </div>
        <SeedBar />
      </div>

      {/* Network Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard
          icon={BarChart3}
          label="Total Certs"
          value={stats?.totalCertificates.toLocaleString() ?? "—"}
          loading={statsLoading}
        />
        <StatCard
          icon={Zap}
          label="Active Miners"
          value={stats?.activeProviders.toLocaleString() ?? "—"}
          loading={statsLoading}
        />
        <StatCard
          icon={Activity}
          label="Certs / min"
          value={stats ? stats.networkHashRate.toFixed(1) : "—"}
          sub="5-min avg"
          loading={statsLoading}
        />
        <StatCard
          icon={Clock}
          label="Last 1 min"
          value={stats?.certsLast1Min.toLocaleString() ?? "—"}
          loading={statsLoading}
        />
        <StatCard
          icon={Clock}
          label="Last 5 min"
          value={stats?.certsLast5Min.toLocaleString() ?? "—"}
          loading={statsLoading}
        />
        <StatCard
          icon={Hash}
          label="Total Difficulty"
          value={stats ? `${stats.totalDifficultyMined.toLocaleString()} bits` : "—"}
          loading={statsLoading}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Leaderboard */}
        <Card className="border-white/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Trophy className="h-5 w-5 text-yellow-400" />
              Miner Leaderboard
            </CardTitle>
            <CardDescription>Ranked by total difficulty mined</CardDescription>
          </CardHeader>
          <CardContent>
            {lbLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : !leaderboard?.providers?.length ? (
              <div className="text-center py-12 text-muted-foreground">
                <Cpu className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p>No miners yet. Start mining to appear here.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-white/5">
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead className="text-right">Certs</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Avg Diff</TableHead>
                    <TableHead className="text-right">Last Seen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leaderboard.providers.map((p, i) => (
                    <LeaderboardRow key={p.providerAddress} rank={i + 1} provider={p} />
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Live Certificate Feed */}
        <Card className="border-white/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Activity className="h-5 w-5 text-green-400" />
              Live Certificate Feed
            </CardTitle>
            <CardDescription>Recently verified POUW proofs</CardDescription>
          </CardHeader>
          <CardContent>
            {certsLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : !certs?.certificates?.length ? (
              <div className="text-center py-12 text-muted-foreground">
                <Hash className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p>No certificates yet. Mining will populate this feed.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-white/5">
                      <TableHead>ID</TableHead>
                      <TableHead>Provider</TableHead>
                      <TableHead className="text-center">Size</TableHead>
                      <TableHead className="text-center">Diff</TableHead>
                      <TableHead>z (proof hash)</TableHead>
                      <TableHead className="text-right">Age</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {certs.certificates.map((cert) => (
                      <CertRow key={cert.id} cert={cert} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* POUW Info Box */}
      <Card className="border-white/5 bg-card/30">
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
            <div>
              <h3 className="font-semibold mb-2 text-green-400">How cuPOW Works</h3>
              <p className="text-muted-foreground leading-relaxed">
                Providers compute matrix multiplications with injected low-rank noise.
                The intermediate computation transcript is hashed — if the hash meets
                the difficulty target, a valid certificate is produced.
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-2 text-blue-400">Why It's Secure</h3>
              <p className="text-muted-foreground leading-relaxed">
                Each intermediate block in the blocked matrix multiply is marginally uniform random.
                No shortcut exists — the full O(n³) computation is unavoidable to produce
                a valid transcript hash.
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-2 text-purple-400">Dual Revenue</h3>
              <p className="text-muted-foreground leading-relaxed">
                Providers earn from both job execution fees AND mining rewards.
                AI/ML workloads (transformer training etc.) naturally produce POUW
                certificates as a byproduct, making mining essentially free.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
