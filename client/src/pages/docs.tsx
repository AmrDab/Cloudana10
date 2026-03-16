import { useState } from "react";
import { FileText, ExternalLink, BookOpen, Wallet, Server, Code, Rocket, ChevronRight, Copy, Check, FlaskConical, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type DocSection = "testnet" | "getting-started" | "provider" | "contracts" | "api";

const CONTRACT_ADDRESSES = [
  { name: "CLDToken (ERC-20)", address: "0xcfd19DF5a3f963Dabf52aC7B46d4780Cc0E599e2" },
  { name: "WorkloadRegistry", address: "0x71a36e548a884019b4A60947551efB8229e2016a" },
  { name: "ProviderRegistry", address: "0x1e7b0039bdC27cB6B1e83d96D5Ad839fD15Af94a" },
  { name: "RewardContract", address: "0x427830A20C4752eb30C47e0d2572A457ebF4A8AD" },
  { name: "POUWVerifier", address: "0xE2791574413d2bdE5B84848A99Aeb3B9f4d80682" },
  { name: "StakingManager", address: "0xeEE91E1209995Fc9fE9183330b1872AfAb7C8661" },
  { name: "ChallengeManager", address: "0x54CA56081e358f89dafFd587F0241eA33BaEC597" },
];

const API_ENDPOINTS = [
  { method: "POST", path: "/v1/deploy", description: "Deploy a workload (manifest JSON/YAML)" },
  { method: "GET", path: "/v1/deployments", description: "List all tracked deployments" },
  { method: "GET", path: "/v1/deployments/:id", description: "Get deployment status by ID" },
  { method: "DELETE", path: "/v1/deployments/:id", description: "Close/terminate a deployment" },
  { method: "GET", path: "/v1/templates", description: "List all workload templates" },
  { method: "GET", path: "/v1/templates/:id", description: "Get a single template by ID" },
  { method: "POST", path: "/v1/payments/checkout-session", description: "Create Stripe checkout session" },
  { method: "GET", path: "/v1/payments/balance", description: "Get CLD credit balance" },
  { method: "POST", path: "/v1/payments/deposit-crypto", description: "Record on-chain crypto deposit" },
  { method: "GET", path: "/v1/payments/rate", description: "Get CLD/USD conversion rate" },
  { method: "POST", path: "/v1/build-provider", description: "Start provider node build" },
  { method: "GET", path: "/v1/build-provider-status", description: "Check provider build status" },
  { method: "GET", path: "/v1/orchestration/provider-stats", description: "Get real-time provider stats" },
];

const NAV_ITEMS: { id: DocSection; label: string; icon: React.ReactNode }[] = [
  { id: "testnet", label: "Testnet Overview", icon: <FlaskConical className="h-4 w-4" /> },
  { id: "getting-started", label: "Getting Started", icon: <Rocket className="h-4 w-4" /> },
  { id: "provider", label: "Provider Onboarding", icon: <Server className="h-4 w-4" /> },
  { id: "contracts", label: "Contract Addresses", icon: <FileText className="h-4 w-4" /> },
  { id: "api", label: "API Reference", icon: <Code className="h-4 w-4" /> },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6 shrink-0"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
    </Button>
  );
}

function TestnetSection() {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-2xl font-bold">Testnet Overview</h2>
          <Badge variant="outline" className="text-yellow-400 border-yellow-500/30 text-xs">Live Now</Badge>
        </div>
        <p className="text-muted-foreground">Where Cloudana is today, and where it's heading.</p>
      </div>

      {/* Current state */}
      <Card className="border-white/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-yellow-400" />
            Phase 1: Testnet (Now)
          </CardTitle>
          <CardDescription>Base Sepolia · Chain ID 84532</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-3">
          <p>Cloudana is live on testnet. You can connect a wallet, deploy workloads, and register as a provider today, using testnet CLD tokens with no real value.</p>

          <div className="space-y-2">
            <p className="font-medium text-foreground">What's working:</p>
            <ul className="space-y-1 ml-2">
              <li className="flex items-center gap-2"><Check className="h-3 w-3 text-green-500 shrink-0" /> Wallet connect (MetaMask, Coinbase, social login)</li>
              <li className="flex items-center gap-2"><Check className="h-3 w-3 text-green-500 shrink-0" /> Workload deployment via Akash Network backend</li>
              <li className="flex items-center gap-2"><Check className="h-3 w-3 text-green-500 shrink-0" /> Provider registration (datacenter)</li>
              <li className="flex items-center gap-2"><Check className="h-3 w-3 text-green-500 shrink-0" /> On-chain contracts (CLD token, staking, registry)</li>
              <li className="flex items-center gap-2"><Check className="h-3 w-3 text-green-500 shrink-0" /> Credit balance system (USD → CLD via Stripe)</li>
              <li className="flex items-center gap-2"><Check className="h-3 w-3 text-green-500 shrink-0" /> Template gallery (Minecraft, WordPress, and more)</li>
            </ul>
          </div>

          <div className="space-y-2">
            <p className="font-medium text-foreground">Testnet limitations:</p>
            <ul className="space-y-1 ml-2">
              <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-yellow-500/60 shrink-0 inline-block" /> CLD tokens have no real monetary value</li>
              <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-yellow-500/60 shrink-0 inline-block" /> Stripe payments are in test mode (no real charges)</li>
              <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-yellow-500/60 shrink-0 inline-block" /> Compute is routed through Akash Network (not native Cloudana providers yet)</li>
              <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-yellow-500/60 shrink-0 inline-block" /> Home provider setup is in preview (coming soon)</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Mainnet roadmap */}
      <Card className="border-white/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Rocket className="h-4 w-4 text-primary" />
            Phase 2: Mainnet
          </CardTitle>
          <CardDescription>Target: Base Mainnet · Real CLD · Real compute</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-3">
          <p>Mainnet launches on Base with real CLD token value and live provider earnings.</p>

          <div className="space-y-2">
            <p className="font-medium text-foreground">What's coming:</p>
            <ul className="space-y-1 ml-2">
              <li className="flex items-center gap-2"><ArrowRight className="h-3 w-3 text-primary shrink-0" /> Native Cloudana provider network (no Akash dependency)</li>
              <li className="flex items-center gap-2"><ArrowRight className="h-3 w-3 text-primary shrink-0" /> Real CLD token on Base Mainnet (chain ID 8453)</li>
              <li className="flex items-center gap-2"><ArrowRight className="h-3 w-3 text-primary shrink-0" /> POUW (Proof of Useful Work) reward verification live</li>
              <li className="flex items-center gap-2"><ArrowRight className="h-3 w-3 text-primary shrink-0" /> Home provider onboarding (Cloudana Relay, no Cloudflare dependency)</li>
              <li className="flex items-center gap-2"><ArrowRight className="h-3 w-3 text-primary shrink-0" /> Fiat on-ramp (USD → CLD, no crypto knowledge needed)</li>
              <li className="flex items-center gap-2"><ArrowRight className="h-3 w-3 text-primary shrink-0" /> SLA tiers and uptime-based reward multipliers</li>
              <li className="flex items-center gap-2"><ArrowRight className="h-3 w-3 text-primary shrink-0" /> GPU marketplace with live bidding</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Phase 3 teaser */}
      <Card className="border-white/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Server className="h-4 w-4 text-purple-400" />
            Phase 3: Sovereign Chain
          </CardTitle>
          <CardDescription>Long-term vision</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>Cloudana migrates to its own sovereign L1 chain purpose-built for compute workloads, with sub-second finality, native POUW consensus, and direct hardware attestation. Base remains a settlement layer for CLD liquidity.</p>
        </CardContent>
      </Card>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-4 text-sm flex items-start gap-2">
          <ExternalLink className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
          <span>
            Follow progress on{" "}
            <a href="https://twitter.com/Cloudana10" target="_blank" rel="noopener noreferrer" className="text-primary underline">@Cloudana10</a>
            {" "}or join the{" "}
            <a href="https://discord.gg/cloudana" target="_blank" rel="noopener noreferrer" className="text-primary underline">Discord</a>.
          </span>
        </CardContent>
      </Card>
    </div>
  );
}

function GettingStartedSection() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Getting Started</h2>
        <p className="text-muted-foreground">Deploy your first workload on Cloudana in 3 steps.</p>
      </div>

      <div className="space-y-4">
        <Card className="border-white/10">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-3">
              <span className="h-7 w-7 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-sm font-bold text-primary">1</span>
              Connect Your Wallet
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>Click <strong>Connect Wallet</strong> in the top-right corner. Cloudana supports:</p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>MetaMask, Coinbase Wallet, WalletConnect-compatible wallets</li>
              <li>Social logins (Google, Apple, Discord, GitHub, X)</li>
              <li>Email-based login</li>
            </ul>
            <p>Make sure you're on <strong>Base Sepolia</strong> testnet (chain ID 84532). The app will prompt you to switch if needed.</p>
          </CardContent>
        </Card>

        <Card className="border-white/10">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-3">
              <span className="h-7 w-7 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-sm font-bold text-primary">2</span>
              Get Testnet Funds
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>You need two tokens to use Cloudana on testnet:</p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li><strong>Base Sepolia ETH</strong>, for gas fees. Get from the <a href="https://www.alchemy.com/faucets/base-sepolia" target="_blank" rel="noopener noreferrer" className="text-primary underline">Alchemy faucet</a> or <a href="https://faucet.quicknode.com/base/sepolia" target="_blank" rel="noopener noreferrer" className="text-primary underline">QuickNode faucet</a>.</li>
              <li><strong>CLD tokens</strong>, for workload deployment. Add funds via the dashboard using Stripe (card) or crypto deposit.</li>
            </ul>
          </CardContent>
        </Card>

        <Card className="border-white/10">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-3">
              <span className="h-7 w-7 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-sm font-bold text-primary">3</span>
              Deploy a Workload
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>Go to <a href="/user#deployments" className="text-primary underline">Dashboard &rarr; Deployments</a> and click <strong>Create Deployment</strong>.</p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>Pick a template (e.g. Minecraft, WordPress) or paste a custom manifest</li>
              <li>Confirm the on-chain transaction to register your workload</li>
              <li>The orchestrator automatically matches a provider and deploys</li>
            </ul>
            <p>Your deployment status will update in real time on the dashboard.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ProviderSection() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Provider Onboarding</h2>
        <p className="text-muted-foreground">Earn CLD by contributing compute resources to the Cloudana network.</p>
      </div>

      <div className="space-y-4">
        <Card className="border-white/10">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Requirements</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>A Linux server (Ubuntu 22.04+ recommended) with a public IP</li>
              <li>Minimum: 4 CPU cores, 8 GB RAM, 100 GB SSD</li>
              <li>Open ports: 8443 (K3s API), 80/443 (ingress), 4040 (provider node)</li>
              <li>A funded Base Sepolia wallet with 1,000 CLD for the provider bond</li>
            </ul>
          </CardContent>
        </Card>

        <Card className="border-white/10">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Steps</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-3">
            <div className="space-y-2">
              <p><strong>1. Start the registration wizard</strong></p>
              <p className="ml-4">Go to <a href="/provider/register" className="text-primary underline">Become a Provider</a> and connect your wallet.</p>
            </div>
            <div className="space-y-2">
              <p><strong>2. Enter your server details</strong></p>
              <p className="ml-4">Provide your server's public IP, SSH credentials, and domain name. The wizard will verify port accessibility and DNS.</p>
            </div>
            <div className="space-y-2">
              <p><strong>3. Build your provider node</strong></p>
              <p className="ml-4">The platform installs K3s and the provider node software on your server. This takes 5-10 minutes.</p>
            </div>
            <div className="space-y-2">
              <p><strong>4. Register on-chain</strong></p>
              <p className="ml-4">Confirm the bond transaction (1,000 CLD). Your provider metadata is uploaded to IPFS and registered on the ProviderRegistry contract.</p>
            </div>
            <div className="space-y-2">
              <p><strong>5. Start earning</strong></p>
              <p className="ml-4">The orchestrator will now route workloads to your provider. You earn CLD for each workload executed.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ContractsSection() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Contract Addresses</h2>
        <p className="text-muted-foreground">
          All contracts are deployed on <strong>Base Sepolia</strong> (chain ID 84532).
        </p>
      </div>

      <Card className="border-white/10 overflow-hidden">
        <CardContent className="p-0">
          <div className="divide-y divide-white/5">
            {CONTRACT_ADDRESSES.map((c) => (
              <div key={c.address} className="flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground font-mono truncate">{c.address}</p>
                </div>
                <div className="flex items-center gap-1 ml-2">
                  <CopyButton text={c.address} />
                  <a
                    href={`https://sepolia.basescan.org/address/${c.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button variant="ghost" size="icon" className="h-6 w-6">
                      <ExternalLink className="h-3 w-3" />
                    </Button>
                  </a>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="border-white/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">ABI & Source</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>Contract ABIs are available in the <code className="bg-muted px-1 rounded">shared/abi/</code> directory of the repository. Solidity source is in <code className="bg-muted px-1 rounded">contract/contracts/</code>.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function ApiSection() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">API Reference</h2>
        <p className="text-muted-foreground">
          The orchestrator API runs on port 7002. All endpoints are prefixed with <code className="bg-muted px-1 rounded">/v1</code>.
        </p>
      </div>

      <Card className="border-white/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Authentication</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>Pass your wallet address in the <code className="bg-muted px-1 rounded">Authorization</code> header:</p>
          <pre className="mt-2 bg-muted/30 border border-white/10 rounded p-3 text-xs overflow-x-auto">Authorization: Bearer 0xYourWalletAddress</pre>
        </CardContent>
      </Card>

      <Card className="border-white/10 overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Endpoints</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-white/5">
            {API_ENDPOINTS.map((ep) => (
              <div key={`${ep.method}-${ep.path}`} className="flex items-start gap-3 px-4 py-3 hover:bg-white/5 transition-colors">
                <Badge
                  variant="outline"
                  className={cn(
                    "shrink-0 mt-0.5 font-mono text-xs w-16 justify-center",
                    ep.method === "GET" && "text-green-400 border-green-500/30",
                    ep.method === "POST" && "text-blue-400 border-blue-500/30",
                    ep.method === "DELETE" && "text-red-400 border-red-500/30",
                  )}
                >
                  {ep.method}
                </Badge>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-mono">{ep.path}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{ep.description}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState<DocSection>("testnet");

  return (
    <div className="max-w-5xl mx-auto py-8">
      {/* Header */}
      <div className="space-y-2 mb-8">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded bg-primary/10 border border-primary/20 flex items-center justify-center">
            <BookOpen className="h-5 w-5 text-primary" />
          </div>
          <h1 className="text-3xl font-bold">Documentation</h1>
        </div>
        <p className="text-muted-foreground text-lg">
          Guides for users and providers on the Cloudana network.
        </p>
      </div>

      <div className="flex gap-8">
        {/* Sidebar Nav */}
        <nav className="hidden md:block w-56 shrink-0">
          <div className="sticky top-8 space-y-1">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={cn(
                  "flex items-center gap-2 w-full rounded-md px-3 py-2 text-sm transition-colors text-left",
                  activeSection === item.id
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                )}
              >
                {item.icon}
                {item.label}
                {activeSection === item.id && <ChevronRight className="h-3 w-3 ml-auto" />}
              </button>
            ))}

            <div className="border-t border-white/10 pt-4 mt-4 space-y-1">
              <a href="https://github.com/AmrDab/Cloudana10" target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 w-full rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors">
                <ExternalLink className="h-4 w-4" /> GitHub
              </a>
              <a href="https://sepolia.basescan.org" target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 w-full rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors">
                <ExternalLink className="h-4 w-4" /> Block Explorer
              </a>
            </div>
          </div>
        </nav>

        {/* Mobile Nav */}
        <div className="md:hidden flex gap-2 mb-6 overflow-x-auto pb-2">
          {NAV_ITEMS.map((item) => (
            <Button
              key={item.id}
              variant={activeSection === item.id ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveSection(item.id)}
              className="shrink-0"
            >
              {item.icon}
              <span className="ml-1">{item.label}</span>
            </Button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {activeSection === "testnet" && <TestnetSection />}
          {activeSection === "getting-started" && <GettingStartedSection />}
          {activeSection === "provider" && <ProviderSection />}
          {activeSection === "contracts" && <ContractsSection />}
          {activeSection === "api" && <ApiSection />}
        </div>
      </div>
    </div>
  );
}
