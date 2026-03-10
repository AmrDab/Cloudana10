import { CheckCircle, ExternalLink, Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const CONTRACT_ADDRESSES = [
  { name: "CLD Token", address: "0xcfd19DF5a3f963Dabf52aC7B46d4780Cc0E599e2" },
  { name: "Workload Registry", address: "0x71a36e548a884019b4A60947551efB8229e2016a" },
  { name: "Provider Registry", address: "0x1e7b0039bdC27cB6B1e83d96D5Ad839fD15Af94a" },
  { name: "Reward Contract", address: "0x427830A20C4752eb30C47e0d2572A457ebF4A8AD" },
  { name: "POUW Verifier", address: "0xE2791574413d2bdE5B84848A99Aeb3B9f4d80682" },
  { name: "Staking Manager", address: "0xeEE91E1209995Fc9fE9183330b1872AfAb7C8661" },
  { name: "Challenge Manager", address: "0x54CA56081e358f89dafFd587F0241eA33BaEC597" },
];

const EXPLORER_BASE = "https://sepolia.basescan.org/address/";

function StatusIndicator({ label, healthy = true }: { label: string; healthy?: boolean }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-white/5 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <Badge
        variant="outline"
        className={
          healthy
            ? "border-green-500/40 text-green-400 bg-green-500/10"
            : "border-yellow-500/40 text-yellow-400 bg-yellow-500/10"
        }
      >
        <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current" />
        {healthy ? "Operational" : "Degraded"}
      </Badge>
    </div>
  );
}

export default function StatusPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-8 py-8">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded bg-green-500/10 border border-green-500/20 flex items-center justify-center">
            <Activity className="h-5 w-5 text-green-400" />
          </div>
          <h1 className="text-3xl font-bold">System Status</h1>
        </div>
        <p className="text-muted-foreground text-lg">
          Live status of the Cloudana network and smart contracts.
        </p>
      </div>

      {/* Overall status */}
      <Card className="border-green-500/20 bg-green-500/5">
        <CardContent className="py-5">
          <div className="flex items-center gap-4">
            <CheckCircle className="h-8 w-8 text-green-400 shrink-0" />
            <div>
              <p className="font-semibold text-foreground text-lg">All Systems Operational</p>
              <p className="text-sm text-muted-foreground">
                Cloudana Testnet is running normally on Base Sepolia.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Services */}
      <Card className="border-white/10">
        <CardHeader>
          <CardTitle className="text-base">Services</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <StatusIndicator label="Web App" />
          <StatusIndicator label="Provider Network" />
          <StatusIndicator label="Workload Scheduler" />
          <StatusIndicator label="POUW Verification" />
          <StatusIndicator label="Reward Distribution" />
        </CardContent>
      </Card>

      {/* Network info */}
      <Card className="border-white/10">
        <CardHeader>
          <CardTitle className="text-base">Network</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <div className="flex items-center justify-between py-2 border-b border-white/5">
            <span className="text-sm text-muted-foreground">Chain</span>
            <span className="text-sm font-medium">Base Sepolia</span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-muted-foreground">Chain ID</span>
            <span className="text-sm font-mono">84532</span>
          </div>
        </CardContent>
      </Card>

      {/* Contract addresses */}
      <Card className="border-white/10">
        <CardHeader>
          <CardTitle className="text-base">Contract Addresses</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-2">
          {CONTRACT_ADDRESSES.map(({ name, address }) => (
            <div
              key={address}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 py-2 border-b border-white/5 last:border-0"
            >
              <span className="text-sm text-muted-foreground shrink-0">{name}</span>
              <div className="flex items-center gap-2">
                <code className="text-xs font-mono text-foreground/80 truncate">
                  {address}
                </code>
                <a
                  href={`${EXPLORER_BASE}${address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary/60 hover:text-primary transition-colors shrink-0"
                  title="View on explorer"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
