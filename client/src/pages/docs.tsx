/**
 * Cloudana Docs -- full architecture documentation + litepaper.
 * Route: /docs
 */

import { useState } from "react";
import { motion } from "framer-motion";
import {
  BookOpen,
  Cpu,
  Server,
  Shield,
  Zap,
  Layers,
  ChevronRight,
  Hash,
  Trophy,
  Code2,
  Network,
  FileText,
  Lock,
  Activity,
  Database,
  Calculator,
  DollarSign,
  Globe,
  Eye,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// --- Section types ------------------------------------------------------------

interface DocSection {
  id: string;
  label: string;
  icon: React.ElementType;
}

const SECTIONS: DocSection[] = [
  { id: "overview", label: "Overview", icon: BookOpen },
  { id: "architecture", label: "Architecture", icon: Layers },
  { id: "pouw", label: "Proof of Useful Work", icon: Cpu },
  { id: "cupow", label: "cuPOW Algorithm", icon: Calculator },
  { id: "rewards", label: "Reward System", icon: Trophy },
  { id: "pricing", label: "Hardware Pricing", icon: DollarSign },
  { id: "clusters", label: "Contributor Clusters", icon: Globe },
  { id: "peer-verification", label: "Peer Verification", icon: Eye },
  { id: "contracts", label: "Smart Contracts", icon: Code2 },
  { id: "network", label: "Network & Chain", icon: Network },
  { id: "litepaper", label: "Litepaper", icon: FileText },
];

// --- Sub-components -----------------------------------------------------------

function SectionHeader({ icon: Icon, title, subtitle, color = "text-primary" }: {
  icon: React.ElementType;
  title: string;
  subtitle?: string;
  color?: string;
}) {
  return (
    <div className="flex items-start gap-4 mb-8">
      <div className={`p-3 rounded-xl bg-white/5 border border-white/10`}>
        <Icon className={`h-6 w-6 ${color}`} />
      </div>
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
        {subtitle && <p className="text-muted-foreground mt-1">{subtitle}</p>}
      </div>
    </div>
  );
}

function InfoBox({ title, children, accent = "primary" }: {
  title?: string;
  children: React.ReactNode;
  accent?: "primary" | "green" | "purple" | "blue" | "yellow";
}) {
  const colors = {
    primary: "border-primary/20 bg-primary/5 text-primary",
    green: "border-green-500/20 bg-green-500/5 text-green-400",
    purple: "border-purple-500/20 bg-purple-500/5 text-purple-400",
    blue: "border-blue-500/20 bg-blue-500/5 text-blue-400",
    yellow: "border-yellow-500/20 bg-yellow-500/5 text-yellow-400",
  };
  return (
    <div className={`rounded-lg border p-4 ${colors[accent]}`}>
      {title && <p className="font-semibold text-sm mb-2">{title}</p>}
      <div className="text-sm text-muted-foreground">{children}</div>
    </div>
  );
}

function CodeBlock({ code, lang = "text" }: { code: string; lang?: string }) {
  return (
    <pre className="bg-black/40 border border-white/10 rounded-lg p-4 overflow-x-auto text-xs font-mono text-green-400 leading-relaxed">
      {code.trim()}
    </pre>
  );
}

function DiagramBox({ label, items, color = "border-primary/20" }: {
  label: string;
  items: string[];
  color?: string;
}) {
  return (
    <div className={`rounded-xl border ${color} bg-white/2 p-4`}>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">{label}</p>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Section: Overview --------------------------------------------------------

function SectionOverview() {
  return (
    <div className="space-y-8">
      <SectionHeader icon={BookOpen} title="What is Cloudana?" subtitle="A decentralized physical infrastructure network powered by verifiable compute" />

      <div className="prose prose-invert max-w-none space-y-4 text-muted-foreground leading-relaxed">
        <p className="text-foreground text-lg">
          Cloudana is an <strong className="text-primary">open cloud marketplace</strong> -- providers list
          their hardware at a price, users pick the best deal and deploy instantly. No accounts, no approval
          queues, no hidden fees. Just a wallet, CLD tokens, and a workload manifest.
        </p>
        <p>
          Run <strong className="text-foreground">anything you'd run on AWS, GCP, or Azure</strong>: web hosting,
          VPS and VMs, bare metal, databases, AI inference, batch jobs, and more. Prices are set by providers
          and adjust with network supply and demand -- always fixed per hour, always visible on-chain before
          you commit. Smart contracts escrow payment and release it only when work is confirmed. Providers
          earn from both hosting fees and continuous{" "}
          <strong className="text-primary">Proof of Useful Work (POUW)</strong> mining.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-white/10 bg-card/40">
          <CardContent className="pt-6 space-y-3">
            <Zap className="h-7 w-7 text-primary" />
            <h3 className="font-bold">For Users</h3>
            <p className="text-sm text-muted-foreground">Host websites, run VPS/VMs, deploy APIs, process data, train AI models -- anything you'd run on a cloud provider, on Cloudana instead.</p>
          </CardContent>
        </Card>
        <Card className="border-white/10 bg-card/40">
          <CardContent className="pt-6 space-y-3">
            <Server className="h-7 w-7 text-green-400" />
            <h3 className="font-bold">For Providers</h3>
            <p className="text-sm text-muted-foreground">Register any hardware -- gaming PCs, workstations, rack servers, edge nodes. Earn CLD from both workload hosting and continuous POUW mining.</p>
          </CardContent>
        </Card>
        <Card className="border-white/10 bg-card/40">
          <CardContent className="pt-6 space-y-3">
            <Shield className="h-7 w-7 text-purple-400" />
            <h3 className="font-bold">No Gatekeepers</h3>
            <p className="text-sm text-muted-foreground">Open marketplace, transparent on-chain pricing, no egress fees, no deplatforming. Smart contracts enforce agreements -- no central authority can interfere.</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {[
          { label: "Web Hosting", desc: "Static sites, dynamic apps, reverse proxies" },
          { label: "VPS / VMs", desc: "Full virtual machines, SSH access, custom OS" },
          { label: "Bare Metal", desc: "Dedicated hardware, no virtualisation overhead" },
          { label: "AI & ML", desc: "GPU inference, fine-tuning, training runs" },
          { label: "Batch Jobs", desc: "Data pipelines, rendering, simulations" },
          { label: "Databases", desc: "Postgres, Redis, object storage, persistent volumes" },
        ].map(({ label, desc }) => (
          <div key={label} className="p-3 rounded-lg bg-white/3 border border-white/8 text-sm">
            <p className="font-medium mb-0.5">{label}</p>
            <p className="text-xs text-muted-foreground">{desc}</p>
          </div>
        ))}
      </div>

      <InfoBox title="Testnet Status" accent="yellow">
        Cloudana is currently live on <strong>Base Sepolia (chainId: 84532)</strong> testnet. The core contracts are deployed
        and POUW mining is active. Mainnet launch with zkSNARK verification and CUDA GPU acceleration is on the roadmap.
      </InfoBox>
    </div>
  );
}

// --- Section: Architecture ----------------------------------------------------

function SectionArchitecture() {
  return (
    <div className="space-y-8">
      <SectionHeader icon={Layers} title="System Architecture" subtitle="How the components connect" />

      <div className="space-y-4 text-muted-foreground leading-relaxed">
        <p>
          Cloudana has four layers that work together: the <strong className="text-foreground">on-chain layer</strong> for
          trust-minimized coordination, the <strong className="text-foreground">orchestrator API</strong> for job routing and verification,
          the <strong className="text-foreground">provider nodes</strong> for actual compute, and the <strong className="text-foreground">frontend</strong> for users.
        </p>
      </div>

      {/* Architecture diagram */}
      <div className="relative">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <DiagramBox
            label="Layer 1 -- On-Chain"
            color="border-yellow-500/20"
            items={[
              "WorkloadManager.sol",
              "RewardContract.sol",
              "POUWVerifier.sol",
              "CLD Token (ERC-20)",
              "Base Sepolia L2",
            ]}
          />
          <DiagramBox
            label="Layer 2 -- Orchestrator"
            color="border-primary/20"
            items={[
              "REST API (Hono.js)",
              "POUW verifier service",
              "Certificate store",
              "Mining reward dist.",
              "Chain seed provider",
            ]}
          />
          <DiagramBox
            label="Layer 3 -- Providers"
            color="border-green-500/20"
            items={[
              "Provider Node Server",
              "POUW Miner daemon",
              "Rust GPU miner",
              "CUDA acceleration",
              "Job execution engine",
            ]}
          />
          <DiagramBox
            label="Layer 4 -- Frontend"
            color="border-purple-500/20"
            items={[
              "React + Vite SPA",
              "Wagmi / Viem",
              "AppKit wallet UI",
              "Mining Dashboard",
              "Docs (this page)",
            ]}
          />
        </div>
        <div className="hidden md:flex absolute inset-y-0 left-0 right-0 items-center pointer-events-none">
          <div className="w-full flex justify-around px-16">
            {[0, 1, 2].map((i) => (
              <ChevronRight key={i} className="h-6 w-6 text-muted-foreground/30" />
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="font-semibold text-lg">Data Flow</h3>
        <div className="space-y-3 text-sm text-muted-foreground">
          {[
            { step: "1", label: "User posts workload", desc: "User calls WorkloadManager.fundWorkload() with CLD deposit. Workload is visible to all registered providers." },
            { step: "2", label: "Provider picks up job", desc: "Provider node polls orchestrator API, receives a job assignment. Executes the workload (e.g. ML inference, batch compute)." },
            { step: "3", label: "POUW mining (parallel)", desc: "While idle or between jobs, the provider runs cuPOW -- matrix multiply with transcript hashing. Valid certificates are submitted to orchestrator." },
            { step: "4", label: "Orchestrator verifies", desc: "Orchestrator re-executes the computation to validate the certificate. On success, triggers on-chain RewardContract.rewardProvider()." },
            { step: "5", label: "CLD distributed", desc: "Provider receives CLD from: job execution fees (80% of user payment) and POUW mining rewards (minted on mainnet, pool on testnet). 15% of fees are burned; 5% go to the treasury." },
          ].map(({ step, label, desc }) => (
            <div key={step} className="flex gap-4">
              <div className="shrink-0 w-7 h-7 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-xs font-bold text-primary">
                {step}
              </div>
              <div>
                <p className="font-medium text-foreground">{label}</p>
                <p className="mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- Section: POUW ------------------------------------------------------------

function SectionPOUW() {
  return (
    <div className="space-y-8">
      <SectionHeader icon={Cpu} title="Proof of Useful Work" subtitle="Mining that generates real computational value" color="text-green-400" />

      <div className="space-y-4 text-muted-foreground leading-relaxed">
        <p>
          Traditional Proof of Work (SHA-256, Ethash) wastes energy on arbitrary hash computations.
          Cloudana's <strong className="text-primary">POUW</strong> repurposes this work to perform
          matrix multiplications -- the core operation of AI/ML, scientific computing, and data processing.
        </p>
        <p>
          When providers run real user workloads (transformer training, inference, simulations),
          the matrix multiply operations they perform naturally produce POUW certificates as a byproduct.
          <strong className="text-foreground"> Mining becomes essentially free</strong> -- compute that would
          have happened anyway now also earns mining rewards.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <InfoBox title="Traditional PoW Problem" accent="yellow">
          SHA-256 / scrypt mining produces nothing useful. Energy and hardware are consumed
          purely to secure the chain. Billions of dollars of compute capacity generates
          zero real-world value.
        </InfoBox>
        <InfoBox title="POUW Solution" accent="green">
          Cloudana's PoUW repurposes the same computational effort to run matrix multiplications.
          Every mining attempt simultaneously advances AI/ML workloads -- the "waste" becomes value.
        </InfoBox>
      </div>

      <div className="space-y-4">
        <h3 className="font-semibold text-lg">Security Guarantees</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-muted-foreground">
          <div className="space-y-2">
            <p className="font-medium text-foreground flex items-center gap-2"><Shield className="h-4 w-4 text-primary" /> Freshness</p>
            <p>Each mining round seeds from the latest Base Sepolia block hash (σ). Certificates older than 5 minutes are rejected. No pre-computation attacks.</p>
          </div>
          <div className="space-y-2">
            <p className="font-medium text-foreground flex items-center gap-2"><Lock className="h-4 w-4 text-primary" /> Replay Protection</p>
            <p>Certificate ID (z-hash) is checked against both in-memory store and on-chain mapping. Each proof can only be claimed once.</p>
          </div>
          <div className="space-y-2">
            <p className="font-medium text-foreground flex items-center gap-2"><Hash className="h-4 w-4 text-primary" /> Transcript Integrity</p>
            <p>All nb^3 intermediate partial sums during blocked MatMul are hashed. Skipping any block changes the transcript hash -- no shortcuts.</p>
          </div>
          <div className="space-y-2">
            <p className="font-medium text-foreground flex items-center gap-2"><Activity className="h-4 w-4 text-primary" /> Difficulty Scaling</p>
            <p>Leading zero bits in z = SHA-256(σ || transcript || H(A) || H(B)). Each extra bit doubles expected work (2^n trials).</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Section: cuPOW Algorithm -------------------------------------------------

function SectionCuPOW() {
  return (
    <div className="space-y-8">
      <SectionHeader icon={Calculator} title="cuPOW Algorithm" subtitle="Based on Komargodski & Weinstein IACR 2025/685" color="text-blue-400" />

      <div className="space-y-4 text-muted-foreground leading-relaxed">
        <p>
          cuPOW implements Algorithm 6.4 from the academic paper "Proof of Useful Work" by
          Komargodski & Weinstein (2025). It uses blocked matrix multiplication with low-rank
          noise injection to create an unforgeable proof of having performed n^3 arithmetic operations.
        </p>
      </div>

      <div className="space-y-6">
        <h3 className="font-semibold text-lg">Algorithm Steps</h3>

        {[
          {
            title: "1. Setup",
            desc: "Choose n*n matrices and block size r = max(4, ⌊n^0.3⌋), rounded to a divisor of n.",
            code: `r = max(4, floor(n^0.3))  // block size
nb = n / r               // blocks per dimension
// nb^3 intermediate partial sums will be recorded`,
          },
          {
            title: "2. Noise Injection",
            desc: "Generate low-rank noise matrices E, F (rank r) from σ. Encode: A' = A + E, B' = B + F.",
            code: `E = E_L * E_R  // n*r times r*n = n*n, rank ≤ r
F = F_L * F_R
A' = A + E mod p
B' = B + F mod p
// F_p = 1,000,000,007`,
          },
          {
            title: "3. Block MatMul with Transcript",
            desc: "Run blocked A'*B' recording every intermediate partial sum into a rolling SHA-256.",
            code: `for bi in 0..nb:
  for bj in 0..nb:
    C_ij = 0
    for bl in 0..nb:
      C_ij += A'[bi,bl] * B'[bl,bj]
      transcript_hash.update(C_ij)  // nb^3 updates`,
          },
          {
            title: "4. Difficulty Check",
            desc: "Compute z = SHA-256(σ || transcript_hash || H(A) || H(B)). Accept if z has ≥ difficulty leading zero bits.",
            code: `z = SHA-256(sigma || transcript_hash || H(A) || H(B))
if leading_zeros(z) >= difficulty:
  return certificate(sigma, n, r, H(A), H(B), transcript_hash, z)`,
          },
          {
            title: "5. Verification",
            desc: "Verifier re-runs steps 2-4 with the same σ and submitted A, B matrices. All hashes must match.",
            code: `verify(cert):
  check H(A) == SHA-256(cert.matrix_a)
  check H(B) == SHA-256(cert.matrix_b)
  re-run noise + blocked matmul
  check transcript_hash matches
  check z meets difficulty`,
          },
        ].map(({ title, desc, code }) => (
          <div key={title} className="space-y-3">
            <h4 className="font-semibold text-foreground">{title}</h4>
            <p className="text-sm text-muted-foreground">{desc}</p>
            <CodeBlock code={code} lang="pseudocode" />
          </div>
        ))}
      </div>

      <InfoBox title="Reward Formula (Whitepaper §4.3)" accent="primary">
        <CodeBlock code={`R_mining = 10 CLD * (n/64)^1.5 * 2^(max(0, difficulty - 8) / 4)

// At difficulty=12 (4096 expected attempts):
//   n=64  → 10 * 1.00 * 2 =  20 CLD per certificate
//   n=128 → 10 * 2.83 * 2 =  56 CLD per certificate
//   n=256 → 10 * 8.00 * 2 = 160 CLD per certificate`} />
      </InfoBox>

      <div className="space-y-3">
        <h3 className="font-semibold text-lg">Performance (Rust GPU Miner)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-muted-foreground border-collapse">
            <thead>
              <tr className="border-b border-white/10 text-foreground">
                <th className="text-left py-2 pr-6">Mode</th>
                <th className="text-left py-2 pr-6">n=64</th>
                <th className="text-left py-2 pr-6">n=128</th>
                <th className="text-left py-2 pr-6">n=256</th>
                <th className="text-left py-2">n=512</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              <tr>
                <td className="py-2 pr-6 font-medium text-foreground">CPU (Rust, release)</td>
                <td className="py-2 pr-6">~5ms</td>
                <td className="py-2 pr-6">~40ms</td>
                <td className="py-2 pr-6">~320ms</td>
                <td className="py-2">~2.5s</td>
              </tr>
              <tr>
                <td className="py-2 pr-6 font-medium text-green-400">CUDA (RTX 4090)</td>
                <td className="py-2 pr-6">--</td>
                <td className="py-2 pr-6">--</td>
                <td className="py-2 pr-6">~0.5ms</td>
                <td className="py-2">~2ms</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">At difficulty=12: expected ~4,096 attempts per certificate. CPU can find ~1 cert/200s at n=64; GPU finds certs continuously.</p>
      </div>
    </div>
  );
}

// --- Section: Rewards ---------------------------------------------------------

function SectionRewards() {
  return (
    <div className="space-y-8">
      <SectionHeader icon={Trophy} title="Reward System" subtitle="Dual revenue streams for infrastructure providers" color="text-yellow-400" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="border-green-500/20 bg-green-500/5">
          <CardHeader>
            <CardTitle className="text-lg text-green-400 flex items-center gap-2">
              <Zap className="h-5 w-5" /> Job Execution Rewards
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-3">
            <p>When a provider completes a user's workload, they call <code className="text-green-400 bg-black/30 px-1 rounded">WorkloadManager.reportCompletion()</code>.</p>
            <p>The contract releases the user's escrowed CLD deposit to the provider, proportional to compute units delivered.</p>
            <p>Providers set their own pricing when registering -- market competition drives rates.</p>
          </CardContent>
        </Card>
        <Card className="border-purple-500/20 bg-purple-500/5">
          <CardHeader>
            <CardTitle className="text-lg text-purple-400 flex items-center gap-2">
              <Hash className="h-5 w-5" /> Mining Rewards (POUW)
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-3">
            <p>For each verified POUW certificate, the orchestrator calls <code className="text-purple-400 bg-black/30 px-1 rounded">RewardContract.rewardProvider()</code> on-chain.</p>
            <p><strong className="text-purple-300">Testnet:</strong> Rewards are released from a pre-funded treasury pool (1,000,000 CLD, seeded at deployment). This is a staging mechanism -- not the long-term model.</p>
            <p><strong className="text-purple-300">Mainnet:</strong> Inflationary minting -- <code className="text-purple-400 bg-black/30 px-1 rounded">CLDToken.mint()</code> is called directly upon valid proof. No pre-mine. Every CLD in existence is earned by a provider proving useful work.</p>
            <p>Reward scales with matrix size and difficulty. Emission decays asymptotically toward a permanent floor -- the network never has a subsidy cliff.</p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <h3 className="font-semibold text-lg">CLD Token</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          {[
            { label: "Standard", value: "ERC-20" },
            { label: "Decimals", value: "18" },
            { label: "Supply Model", value: "Inflationary*" },
            { label: "Hard Cap", value: "None" },
          ].map(({ label, value }) => (
            <div key={label} className="p-3 rounded-lg bg-white/5 border border-white/10 text-center">
              <p className="text-muted-foreground text-xs mb-1">{label}</p>
              <p className="font-bold text-foreground">{value}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">* Testnet uses a pre-funded pool. Mainnet uses inflationary minting with asymptotic tail emission and fee burning -- net supply may be deflationary at high usage.</p>
      </div>

      <div className="space-y-3">
        <h3 className="font-semibold text-lg">Emission Schedule (Mainnet)</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div className="p-4 rounded-lg bg-white/3 border border-white/8 space-y-2">
            <p className="font-medium text-foreground">POUW Minting</p>
            <p className="text-muted-foreground text-xs">Starts at 10 CLD/proof. Halves every ~4M proofs. Asymptotes to a permanent floor of ~0.1 CLD/proof -- never reaches zero. Providers always have a baseline subsidy.</p>
          </div>
          <div className="p-4 rounded-lg bg-white/3 border border-white/8 space-y-2">
            <p className="font-medium text-foreground">Fee Distribution</p>
            <p className="text-muted-foreground text-xs">User compute fees split: 80% to provider, 15% burned (deflationary pressure), 5% to protocol treasury (DAO-governed grants and emergency subsidies).</p>
          </div>
          <div className="p-4 rounded-lg bg-white/3 border border-white/8 space-y-2">
            <p className="font-medium text-foreground">Net Supply</p>
            <p className="text-muted-foreground text-xs">At low usage: inflationary (minting outpaces burn -- bootstraps provider income). At high usage: deflationary (burn outpaces tail emission). Self-balancing.</p>
          </div>
        </div>
      </div>

      <InfoBox title="Mining Parameters" accent="blue">
        <div className="grid grid-cols-2 gap-2 mt-2 text-xs font-mono">
          <span className="text-muted-foreground">Base Reward:</span><span>10 CLD (at n=64, diff=12)</span>
          <span className="text-muted-foreground">Emission Floor:</span><span>~0.1 CLD/proof (permanent)</span>
          <span className="text-muted-foreground">Halving Interval:</span><span>Every ~4M proofs</span>
          <span className="text-muted-foreground">Min Difficulty:</span><span>8 leading zero bits</span>
          <span className="text-muted-foreground">Seed Refresh:</span><span>Every 10 seconds (block hash)</span>
          <span className="text-muted-foreground">Cert Freshness:</span><span>5 minute max age</span>
          <span className="text-muted-foreground">Replay Guard:</span><span>In-memory + on-chain z-hash set</span>
          <span className="text-muted-foreground">Fee Burn:</span><span>15% of all compute fees</span>
        </div>
      </InfoBox>
    </div>
  );
}

// --- Section: Hardware Pricing ------------------------------------------------

function SectionPricing() {
  const tiers = [
    { tier: "T1", label: "Edge Node", examples: "Raspberry Pi, NUC, mini PC, ARM SBC", cpu: "2-8 cores", gpu: "None", ram: "2-16 GB", net: "100 Mbps - 1 Gbps", use: "Web hosting, static sites, IoT, CDN nodes, small APIs", price: "$0.001 - $0.05/hr", color: "border-white/10", badge: "text-muted-foreground border-white/20" },
    { tier: "T2", label: "Consumer", examples: "Gaming PCs, home workstations", cpu: "8-16 cores", gpu: "RTX 2060 - 4060, RX 6600-6700", ram: "16-64 GB", net: "1 Gbps", use: "VPS, VMs, databases, light ML inference, rendering", price: "$0.05 - $0.50/hr", color: "border-blue-500/15", badge: "text-blue-400 border-blue-500/30" },
    { tier: "T3", label: "Prosumer", examples: "High-end gaming PC, content creator rigs", cpu: "16-32 cores", gpu: "RTX 3090, 4080, 4090, RX 7900", ram: "64-256 GB", net: "1-10 Gbps", use: "AI inference, LLM serving (small-mid models), video rendering, simulation", price: "$0.50 - $1.50/hr", color: "border-green-500/15", badge: "text-green-400 border-green-500/30" },
    { tier: "T4", label: "Professional", examples: "Datacenter GPU servers, AI workstations", cpu: "32-128 cores", gpu: "A100, L40S, A40, H100 PCIe", ram: "256 GB - 1 TB ECC", net: "10-100 Gbps", use: "LLM fine-tuning, large inference, HPC, training runs, professional rendering", price: "$1.50 - $5.00/hr", color: "border-purple-500/15", badge: "text-purple-400 border-purple-500/30" },
    { tier: "T5", label: "Enterprise", examples: "Full racks, DGX systems, private datacenters", cpu: "128+ cores (multi-socket)", gpu: "H100 SXM clusters, B100/B200, AMD Instinct", ram: "1-8 TB ECC DDR5", net: "100-400 Gbps InfiniBand/RoCE", use: "Foundation model training, large-scale inference, HPC clusters, enterprise SLA workloads", price: "$5.00 - $100+/hr", color: "border-yellow-500/15", badge: "text-yellow-400 border-yellow-500/30" },
  ];

  return (
    <div className="space-y-8">
      <SectionHeader icon={DollarSign} title="Hardware Pricing Model" subtitle="From Raspberry Pi to H100 clusters -- one unified marketplace" color="text-green-400" />

      <div className="space-y-4 text-muted-foreground leading-relaxed">
        <p>
          Cloudana is designed to accept any hardware -- a hobbyist edge node running on a mini PC
          earns just as legitimately as a private datacenter with 8x H100s. Providers list their
          hardware, and the market determines whether the price is competitive. No gatekeeping.
        </p>
        <p>
          Pricing is calculated from a <strong className="text-foreground">Compute Score (CS)</strong> derived
          from benchmarks run at registration -- not from self-reported specs. This prevents gaming
          the system and ensures prices reflect real performance.
        </p>
      </div>

      <InfoBox title="For private datacenters" accent="green">
        Cloudana eliminates the hardest part of running a private datacenter: finding clients.
        Connect your hardware once. The marketplace routes workloads automatically based on
        price, performance, and availability. No sales team. No contracts. No idle racks.
        You focus on uptime -- Cloudana handles the rest.
      </InfoBox>

      <div className="space-y-4">
        <h3 className="font-semibold text-lg">Hardware Tiers</h3>
        <div className="space-y-3">
          {tiers.map(({ tier, label, examples, cpu, gpu, ram, net, use, price, color, badge }) => (
            <div key={tier} className={`rounded-xl border ${color} bg-white/1 p-4`}>
              <div className="flex items-start justify-between gap-4 mb-3">
                <div className="flex items-center gap-3">
                  <Badge variant="outline" className={`font-mono font-bold ${badge}`}>{tier}</Badge>
                  <div>
                    <p className="font-semibold text-foreground">{label}</p>
                    <p className="text-xs text-muted-foreground">{examples}</p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-foreground">{price}</p>
                  <p className="text-xs text-muted-foreground">market range</p>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-muted-foreground mb-2">
                <span><span className="text-foreground/60">CPU:</span> {cpu}</span>
                <span><span className="text-foreground/60">GPU:</span> {gpu}</span>
                <span><span className="text-foreground/60">RAM:</span> {ram}</span>
                <span><span className="text-foreground/60">Net:</span> {net}</span>
              </div>
              <p className="text-xs text-muted-foreground"><span className="text-foreground/60">Workloads:</span> {use}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="font-semibold text-lg">Compute Score Formula</h3>
        <p className="text-sm text-muted-foreground">
          Every provider gets a Compute Score (CS) calculated from benchmarked hardware at registration.
          This is the single normalized indicator used to compare hardware across tiers.
        </p>
        <CodeBlock code={`CS = (GPU_TFLOPS * 10) + (VRAM_GB * 2) + (CPU_threads * 4) + (RAM_GB * 0.8)

// Examples (approximate):
// RPi 4 (4 threads, 4GB, no GPU):           CS ~  19   T1 Edge
// Gaming PC (RTX 4060, 12t, 32GB):          CS ~ 225   T2 Consumer
// Gaming PC (RTX 4090, 16t, 64GB):          CS ~ 845   T3 Prosumer
// A100 80GB server (128t, 512GB):           CS ~1875   T4 Professional
// 8x H100 SXM (192t, 2TB):                  CS ~24k+   T5 Enterprise`} />
      </div>

      <div className="space-y-4">
        <h3 className="font-semibold text-lg">Pricing Formula</h3>
        <p className="text-sm text-muted-foreground">
          The listed hourly rate is calculated from component market rates plus a provider multiplier.
          The multiplier lets providers compete on price or charge a premium for reliability.
        </p>
        <CodeBlock code={`Base hourly rate =
  GPU_TFLOPS^0.6 * 0.050           // GPU compute (scales sub-linearly)
  + VRAM_GB * 0.008                // VRAM premium (critical for large models)
  + CPU_threads * 0.0022           // CPU contribution
  + RAM_GB * 0.0011                // RAM contribution
  + NET_Gbps * 0.007               // Network bandwidth

Listed price = Base * Provider_multiplier   (0.5x = aggressive, 1.0x = market, 2x = premium SLA)

// Verified benchmark rates (early 2026 spot):
// RTX 4090 gaming PC (4090 + 16t + 64GB + 1Gbps):  ~$0.95/hr
// A100 80GB server  (A100 + 64t + 512GB + 25Gbps): ~$2.10/hr
// H100 SXM (single) (H100 + 64t + 512GB + 100Gbps): ~$3.00/hr
// Edge node (no GPU + 8t + 16GB + 1Gbps):           ~$0.025/hr`} />
      </div>

      <div className="space-y-4">
        <h3 className="font-semibold text-lg">GPU Market Reference</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-muted-foreground border-collapse">
            <thead>
              <tr className="border-b border-white/10 text-foreground">
                <th className="text-left py-2 pr-4">GPU</th>
                <th className="text-left py-2 pr-4">TFLOPS (FP32)</th>
                <th className="text-left py-2 pr-4">VRAM</th>
                <th className="text-left py-2 pr-4">Tier</th>
                <th className="text-left py-2">~$/hr</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {[
                ["RTX 3060", "12.7", "12 GB", "T2", "$0.32"],
                ["RTX 4070 Ti", "40.0", "12 GB", "T3", "$0.65"],
                ["RTX 4090", "82.6", "24 GB", "T3", "$0.95"],
                ["A10G", "31.2", "24 GB", "T4", "$0.75"],
                ["L40S", "91.6", "48 GB", "T4", "$1.40"],
                ["A100 80GB", "77.4", "80 GB", "T4", "$2.10"],
                ["H100 PCIe", "204", "80 GB", "T4", "$2.49"],
                ["H100 SXM", "267", "80 GB", "T5", "$3.00"],
                ["B100/B200", "700+", "192 GB", "T5", "$5.00+"],
              ].map(([gpu, tflops, vram, tier, price]) => (
                <tr key={gpu}>
                  <td className="py-2 pr-4 font-medium text-foreground">{gpu}</td>
                  <td className="py-2 pr-4">{tflops}</td>
                  <td className="py-2 pr-4">{vram}</td>
                  <td className="py-2 pr-4">
                    <Badge variant="outline" className="text-xs border-white/20 text-muted-foreground">{tier}</Badge>
                  </td>
                  <td className="py-2 font-medium text-green-400">{price}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">Rates are per GPU per hour at 100% utilisation. CPU and RAM are billed separately. Actual provider prices may vary based on their multiplier setting.</p>
      </div>

      <div className="space-y-4">
        <h3 className="font-semibold text-lg">POUW as Hardware Verification</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Providers cannot fake their hardware specs. The POUW mining rate is a fraud-resistant
          on-chain proof of GPU performance -- a provider claiming an H100 but mining at RTX 3060
          rates will be flagged immediately. The benchmark is the proof.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <InfoBox title="At registration" accent="blue">
            The provider agent runs a 60-second POUW benchmark. The mining rate is submitted
            on-chain as a certificate. This establishes the hardware baseline and sets the
            initial Compute Score -- immutably recorded.
          </InfoBox>
          <InfoBox title="Ongoing verification" accent="green">
            Continuous POUW mining produces a stream of on-chain certificates. If mining rate
            drops significantly below the registered baseline, the orchestrator flags the provider
            for review. Hardware degradation is automatically detected.
          </InfoBox>
        </div>
      </div>

      <InfoBox title="Plug-and-play for enterprise" accent="purple">
        Private datacenters integrate with Cloudana by running provider nodes on their existing
        hardware. No re-provisioning. No BIOS flashing. No custom firmware. The agent runs
        alongside existing workloads and fills idle capacity with Cloudana jobs automatically.
        Rack owners keep their existing clients -- Cloudana adds a second revenue stream on top.
      </InfoBox>
    </div>
  );
}

// --- Section: Contributor Clusters --------------------------------------------

function SectionClusters() {
  return (
    <div className="space-y-8">
      <SectionHeader icon={Globe} title="Contributor Cluster Architecture" subtitle="Fault-tolerant, multi-node execution substrate" color="text-cyan-400" />

      <div className="space-y-4 text-muted-foreground leading-relaxed">
        <p>
          In a single-node model, workloads are tied to one contributor's machine. If it disconnects,
          the workload fails. This fragility prevents decentralized networks from competing with
          centralized cloud providers.
        </p>
        <p>
          Cloudana solves this with <strong className="text-foreground">Contributor Clusters (CCC)</strong> --
          micro-regional pools of heterogeneous nodes that collectively provide compute, storage,
          GPU acceleration, bandwidth, and failover. The cluster behaves as a single logical machine
          from the perspective of the scheduler.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <InfoBox title="Single-Node Problem" accent="yellow">
          <ul className="space-y-1 list-disc list-inside text-xs">
            <li>Single point of failure -- node disconnects kill workloads</li>
            <li>No storage redundancy -- data lives on one disk</li>
            <li>No IP stability -- home IPs change, no failover</li>
            <li>Weak SLAs -- cannot guarantee uptime</li>
          </ul>
        </InfoBox>
        <InfoBox title="Cluster Solution" accent="green">
          <ul className="space-y-1 list-disc list-inside text-xs">
            <li>Multi-node redundancy -- workloads survive node churn</li>
            <li>Replicated storage -- data survives failures</li>
            <li>Stable endpoints via ingress proxy layer</li>
            <li>Cloud-grade reliability from distributed hardware</li>
          </ul>
        </InfoBox>
      </div>

      <div className="space-y-4">
        <h3 className="font-semibold text-lg">Resource Pooling Model</h3>
        <p className="text-sm text-muted-foreground">
          All resources except RAM are pooled across cluster nodes. RAM is local to each node --
          a workload must fit within a single node's RAM. This is identical to how Kubernetes,
          Nomad, and all cloud schedulers work.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "CPU", desc: "Cores aggregated into unified scheduling pool", pooled: true },
            { label: "Storage", desc: "Replicated with erasure coding across nodes", pooled: true },
            { label: "GPU", desc: "Workloads routed to best available GPU", pooled: true },
            { label: "Bandwidth", desc: "Multiple nodes serve traffic via load balancer", pooled: true },
            { label: "Endpoints", desc: "Stable ingress proxy survives node failover", pooled: true },
            { label: "State", desc: "Checkpoints replicated for instant recovery", pooled: true },
            { label: "Cache", desc: "Shared model/image cache reduces cold starts", pooled: true },
            { label: "RAM", desc: "Local only -- workload must fit single node", pooled: false },
          ].map(({ label, desc, pooled }) => (
            <div key={label} className={`p-3 rounded-lg border text-sm ${pooled ? "border-green-500/15 bg-green-500/3" : "border-red-500/15 bg-red-500/3"}`}>
              <div className="flex items-center gap-2 mb-1">
                <span className={`w-2 h-2 rounded-full ${pooled ? "bg-green-400" : "bg-red-400"}`} />
                <p className="font-medium text-foreground text-xs">{label}</p>
              </div>
              <p className="text-xs text-muted-foreground">{desc}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="font-semibold text-lg">Failover Sequence</h3>
        <div className="space-y-3 text-sm text-muted-foreground">
          {[
            { step: "1", label: "Failure detected", desc: "Cluster heartbeat detects node offline within 10-30 seconds." },
            { step: "2", label: "Replica selected", desc: "Scheduler identifies the closest replica or checkpoint of the workload." },
            { step: "3", label: "Workload restarted", desc: "Container or VM restored from checkpoint on a healthy node." },
            { step: "4", label: "Endpoint reassigned", desc: "Ingress proxy routes traffic to the new node. No DNS change needed." },
            { step: "5", label: "Traffic resumes", desc: "User-facing downtime: seconds for stateless, minutes for stateful workloads." },
          ].map(({ step, label, desc }) => (
            <div key={step} className="flex gap-4">
              <div className="shrink-0 w-7 h-7 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-xs font-bold text-cyan-400">
                {step}
              </div>
              <div>
                <p className="font-medium text-foreground">{label}</p>
                <p className="mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="font-semibold text-lg">Implementation Roadmap</h3>
        <div className="space-y-3">
          {[
            { phase: "Phase 1 (now)", label: "Single-node execution", desc: "Each provider is a 'cluster of 1'. Scheduler interface supports N nodes but starts with 1.", status: "live" },
            { phase: "Phase 2", label: "Ingress proxy layer", desc: "Stable endpoints via Cloudflare Tunnel or WireGuard mesh. Workloads get persistent URLs.", status: "next" },
            { phase: "Phase 3", label: "Multi-node scheduling", desc: "Route workloads to best available node. Basic failover: restart on another node if one dies.", status: "planned" },
            { phase: "Phase 4", label: "Full cluster model", desc: "Storage replication, checkpointing, GPU scheduling, and contributor trust scoring.", status: "planned" },
          ].map(({ phase, label, desc, status }) => (
            <div key={phase} className="flex gap-4">
              <div className={`shrink-0 px-2 py-1 rounded text-xs font-mono ${
                status === "live" ? "bg-green-500/10 text-green-400 border border-green-500/20" :
                status === "next" ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20" :
                "bg-white/5 text-muted-foreground border border-white/10"
              }`}>
                {status === "live" ? "LIVE" : status === "next" ? "NEXT" : "PLANNED"}
              </div>
              <div className="text-sm">
                <p className="font-medium text-foreground">{phase} -- {label}</p>
                <p className="text-muted-foreground mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <InfoBox title="Design Principle" accent="blue">
        Build the <strong>abstractions now</strong>, defer the hard distributed systems to later.
        Even with single-node execution, the scheduler thinks in terms of clusters. The verification
        protocol is defined now even if only 1 node verifies itself. This prevents a full rewrite
        when multi-node support ships.
      </InfoBox>
    </div>
  );
}

// --- Section: Peer Verification -----------------------------------------------

function SectionPeerVerification() {
  return (
    <div className="space-y-8">
      <SectionHeader icon={Eye} title="PoUW Peer Verification" subtitle="How clusters make Proof of Useful Work trustless" color="text-orange-400" />

      <div className="space-y-4 text-muted-foreground leading-relaxed">
        <p>
          In a single-node model, PoUW has a fundamental trust problem: the provider who executes
          the work is the same entity who reports and signs the proof. They could lie, under-report,
          over-report, fake execution, or tamper with results.
        </p>
        <p>
          The <strong className="text-foreground">Contributor Cluster model</strong> solves this
          by turning peer nodes into verifiers -- creating a decentralized auditor network where
          every node is simultaneously a worker, a witness, and a verifier.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="border-red-500/15 bg-red-500/3">
          <CardHeader>
            <CardTitle className="text-lg text-red-400 flex items-center gap-2">
              <Shield className="h-5 w-5" /> Single-Node Trust Model
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="p-2 rounded bg-red-500/10 border border-red-500/15">
                <p className="font-bold text-red-400">Trust</p>
                <p>Single entity</p>
              </div>
              <div className="p-2 rounded bg-red-500/10 border border-red-500/15">
                <p className="font-bold text-red-400">Verification</p>
                <p>None (self-report)</p>
              </div>
              <div className="p-2 rounded bg-red-500/10 border border-red-500/15">
                <p className="font-bold text-red-400">Risk</p>
                <p>High</p>
              </div>
            </div>
            <ul className="space-y-1 list-disc list-inside text-xs">
              <li>Provider could fabricate execution results</li>
              <li>Provider could misreport resource usage</li>
              <li>No independent verification of compute</li>
              <li>Cryptography helps, but trust bottleneck remains</li>
            </ul>
          </CardContent>
        </Card>

        <Card className="border-green-500/15 bg-green-500/3">
          <CardHeader>
            <CardTitle className="text-lg text-green-400 flex items-center gap-2">
              <Eye className="h-5 w-5" /> Cluster Trust Model
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="p-2 rounded bg-green-500/10 border border-green-500/15">
                <p className="font-bold text-green-400">Trust</p>
                <p>Distributed</p>
              </div>
              <div className="p-2 rounded bg-green-500/10 border border-green-500/15">
                <p className="font-bold text-green-400">Verification</p>
                <p>Continuous</p>
              </div>
              <div className="p-2 rounded bg-green-500/10 border border-green-500/15">
                <p className="font-bold text-green-400">Risk</p>
                <p>Low</p>
              </div>
            </div>
            <ul className="space-y-1 list-disc list-inside text-xs">
              <li>No single node can lie -- peers cross-check</li>
              <li>No single node can fake work -- multiple witnesses</li>
              <li>No single node can tamper -- erasure coding</li>
              <li>Cluster acts as a decentralized trust fabric</li>
            </ul>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <h3 className="font-semibold text-lg">How Peer Verification Works</h3>
        <div className="space-y-3 text-sm text-muted-foreground">
          {[
            { role: "Executor", icon: "⚡", desc: "Node A runs the workload and produces the PoUW certificate with matrix data, transcript hash, and z-proof." },
            { role: "Output Verifier", icon: "🔍", desc: "Node B independently re-runs the computation on the same inputs and compares the output hash. Mismatch = fraud flag." },
            { role: "Resource Auditor", icon: "📊", desc: "Node C monitors claimed resource usage (CPU cores, RAM, bandwidth) against its own observation of the executor's behavior." },
            { role: "State Witness", icon: "🔐", desc: "Node D verifies checkpoint hashes, comparing state transitions against expected execution traces." },
          ].map(({ role, icon, desc }) => (
            <div key={role} className="flex gap-4 p-4 rounded-lg bg-white/3 border border-white/5">
              <span className="text-xl shrink-0">{icon}</span>
              <div>
                <p className="font-semibold text-foreground mb-1">{role}</p>
                <p>{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="font-semibold text-lg">Verification Protocol</h3>
        <CodeBlock code={`// Peer Verification Flow
1. Executor submits certificate: { sigma, n, H(A), H(B), transcriptHash, z }
2. Cluster selects K random verifiers (K = min(3, cluster_size - 1))
3. Each verifier independently:
   a. Re-derives noise matrices from sigma
   b. Re-runs blocked MatMul with transcript
   c. Compares transcriptHash -- must match exactly
   d. Verifies z = SHA-256(sigma || transcript || H(A) || H(B))
4. If >= ceil(K/2 + 1) verifiers agree: certificate accepted
5. If majority disagree: executor flagged, reputation penalty
6. Verified certificate submitted to POUWVerifier.sol on-chain`} />
      </div>

      <div className="space-y-4">
        <h3 className="font-semibold text-lg">Security Properties</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-muted-foreground">
          <div className="space-y-2">
            <p className="font-medium text-foreground flex items-center gap-2"><Shield className="h-4 w-4 text-orange-400" /> Collusion Resistance</p>
            <p>Verifiers are randomly selected from the cluster pool. Colluding requires controlling a majority of randomly-chosen peers -- economically infeasible at scale.</p>
          </div>
          <div className="space-y-2">
            <p className="font-medium text-foreground flex items-center gap-2"><Lock className="h-4 w-4 text-orange-400" /> Reputation Staking</p>
            <p>Verifiers who falsely reject valid proofs lose reputation. Executors who submit fraudulent proofs are slashed. Both sides have skin in the game.</p>
          </div>
          <div className="space-y-2">
            <p className="font-medium text-foreground flex items-center gap-2"><Activity className="h-4 w-4 text-orange-400" /> Continuous Monitoring</p>
            <p>Peer verification happens on every certificate, not just randomly sampled ones. The cluster maintains a continuous audit trail of all compute.</p>
          </div>
          <div className="space-y-2">
            <p className="font-medium text-foreground flex items-center gap-2"><Hash className="h-4 w-4 text-orange-400" /> On-Chain Finality</p>
            <p>Only certificates verified by peer consensus are recorded on-chain. The POUWVerifier contract stores the final, undisputed proof permanently.</p>
          </div>
        </div>
      </div>

      <InfoBox title="Same Principle, Proven at Scale" accent="purple">
        This is the same shift that made Bitcoin secure, Ethereum reliable, and Kubernetes HA clusters
        fault-tolerant. Cloudana applies distributed consensus to <strong>useful compute</strong> --
        every node is both a worker and a validator. The cluster is the trust fabric.
      </InfoBox>
    </div>
  );
}

// --- Section: Contracts -------------------------------------------------------

function SectionContracts() {
  const contracts = [
    {
      name: "CLDToken",
      addr: "0xcfd19DF5a3f963Dabf52aC7B46d4780Cc0E599e2",
      desc: "ERC-20 utility and reward token. Minted by RewardContract for provider payouts. Burn mechanics create deflationary pressure as network usage grows.",
      fns: ["mint(address, uint256)", "burn(uint256)", "burnFrom(address, uint256)", "balanceOf(address) view"],
    },
    {
      name: "ProviderRegistry",
      addr: "0x1e7b0039bdC27cB6B1e83d96D5Ad839fD15Af94a",
      desc: "On-chain identity registry for compute provider devices. IPFS CID stored on-chain; full hardware specs live on IPFS. One wallet can own multiple deviceId entries.",
      fns: ["registerProvider(bytes32 deviceId, string metadataUri)", "updateProvider(bytes32, string)", "deregisterProvider(bytes32)", "getActiveProviders() view"],
    },
    {
      name: "WorkloadRegistry",
      addr: "0x71a36e548a884019b4A60947551efB8229e2016a",
      desc: "Workload lifecycle management. Auto-increments workload IDs. Orchestrator holds ORCHESTRATOR_ROLE to call recordPlacement(). On-chain stores only IPFS CID.",
      fns: ["registerWorkload(string metadataUri)", "recordPlacement(uint256 workloadId, address provider, uint256 instanceId)", "getWorkload(uint256) view", "getActiveWorkloadIds() view"],
    },
    {
      name: "RewardContract",
      addr: "0x427830A20C4752eb30C47e0d2572A457ebF4A8AD",
      desc: "Escrow and CLD distribution for compute workloads. Users fund workloads by depositing CLD. Orchestrator calls rewardProvider() to release payment as compute is delivered.",
      fns: ["rewardProvider(address, uint256 workloadId, uint256 amount)", "workloadDeposits(uint256) view"],
    },
    {
      name: "POUWVerifier",
      addr: "0xE2791574413d2bdE5B84848A99Aeb3B9f4d80682",
      desc: "Immutable on-chain ledger of all accepted mining certificates. Maintains usedZ mapping for replay protection. Emits CertificateRecorded events for full auditability.",
      fns: ["recordCertificate(address provider, bytes32 deviceId, uint32 n, uint8 difficulty, bytes32 transcriptHash, bytes32 z, uint256 timestamp)", "getMinerStats(address) view", "minerCount() view", "isZUsed(bytes32) view"],
    },
  ];

  return (
    <div className="space-y-8">
      <SectionHeader icon={Code2} title="Smart Contracts" subtitle="On-chain coordination on Base Sepolia" color="text-blue-400" />

      <div className="space-y-4">
        {contracts.map((c) => (
          <Card key={c.name} className="border-white/10">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-base text-primary font-mono">{c.name}.sol</CardTitle>
                  <code className="text-xs text-muted-foreground font-mono mt-1 block">{c.addr}</code>
                </div>
                <Badge variant="outline" className="border-white/20 text-xs shrink-0">Base Sepolia</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">{c.desc}</p>
              <div className="flex flex-wrap gap-2">
                {c.fns.map((fn) => (
                  <code key={fn} className="text-xs bg-black/30 border border-white/10 px-2 py-1 rounded text-green-400">{fn}</code>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <InfoBox title="Testnet Deployment -- Base Sepolia (84532)" accent="primary">
        <div className="grid grid-cols-1 gap-1.5 mt-2 font-mono text-xs">
          <div className="flex gap-2"><span className="text-muted-foreground w-36 shrink-0">CLDToken:</span><span>0xcfd19DF5a3f963Dabf52aC7B46d4780Cc0E599e2</span></div>
          <div className="flex gap-2"><span className="text-muted-foreground w-36 shrink-0">ProviderRegistry:</span><span>0x1e7b0039bdC27cB6B1e83d96D5Ad839fD15Af94a</span></div>
          <div className="flex gap-2"><span className="text-muted-foreground w-36 shrink-0">WorkloadRegistry:</span><span>0x71a36e548a884019b4A60947551efB8229e2016a</span></div>
          <div className="flex gap-2"><span className="text-muted-foreground w-36 shrink-0">RewardContract:</span><span>0x427830A20C4752eb30C47e0d2572A457ebF4A8AD</span></div>
          <div className="flex gap-2"><span className="text-muted-foreground w-36 shrink-0">POUWVerifier:</span><span>0xE2791574413d2bdE5B84848A99Aeb3B9f4d80682</span></div>
        </div>
      </InfoBox>
    </div>
  );
}

// --- Section: Network ---------------------------------------------------------

function SectionNetwork() {
  return (
    <div className="space-y-8">
      <SectionHeader icon={Network} title="Network & Chain" subtitle="Infrastructure details and chain configuration" color="text-purple-400" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <h3 className="font-semibold">Chain Configuration</h3>
          <div className="space-y-2 text-sm">
            {[
              ["Network", "Base Sepolia"],
              ["Chain ID", "84532"],
              ["RPC", "https://sepolia.base.org"],
              ["Explorer", "https://sepolia.basescan.org"],
              ["Currency", "ETH (testnet)"],
              ["Block Time", "~2 seconds"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between py-2 border-b border-white/5">
                <span className="text-muted-foreground">{k}</span>
                <code className="text-xs font-mono text-foreground">{v}</code>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="font-semibold">Provider Requirements</h3>
          <div className="space-y-3 text-sm text-muted-foreground">
            <div className="flex items-start gap-3">
              <Cpu className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-foreground">CPU (Testnet)</p>
                <p>Any modern CPU. TypeScript POUW miner runs on Node.js. Recommended: 4+ cores, 8GB RAM.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Zap className="h-4 w-4 text-green-400 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-foreground">GPU (Mainnet)</p>
                <p>NVIDIA GPU with CUDA support. Rust miner with cudarc feature. RTX 3080+ recommended.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Database className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-foreground">Connectivity</p>
                <p>Stable internet connection. Providers poll orchestrator every 10s for seed refresh.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="font-semibold">Mainnet Roadmap</h3>
        <div className="space-y-3">
          {[
            { phase: "Phase 1 (now)", label: "Testnet POUW", desc: "CPU mining, TypeScript verifier, orchestrator-trusted verification, Base Sepolia.", status: "live" },
            { phase: "Phase 2", label: "Rust GPU Miner", desc: "Rust miner with CUDA, 640x speedup, production-grade performance.", status: "ready" },
            { phase: "Phase 3", label: "zkSNARK Verification", desc: "Circom/Groth16 circuit for O(1) on-chain proof verification -- no re-execution needed.", status: "planned" },
            { phase: "Phase 4", label: "Mainnet Launch", desc: "Full mainnet deployment with GPU-accelerated mining and trustless zkSNARK proofs.", status: "planned" },
          ].map(({ phase, label, desc, status }) => (
            <div key={phase} className="flex gap-4">
              <div className={cn(
                "shrink-0 px-2 py-1 rounded text-xs font-mono",
                status === "live" ? "bg-green-500/10 text-green-400 border border-green-500/20" :
                status === "ready" ? "bg-blue-500/10 text-blue-400 border border-blue-500/20" :
                "bg-white/5 text-muted-foreground border border-white/10"
              )}>
                {status === "live" ? "LIVE" : status === "ready" ? "READY" : "PLANNED"}
              </div>
              <div className="text-sm">
                <p className="font-medium text-foreground">{phase} -- {label}</p>
                <p className="text-muted-foreground mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- Section: Litepaper -------------------------------------------------------

function SectionLitepaper() {
  return (
    <div className="space-y-8">
      <SectionHeader icon={FileText} title="Cloudana Litepaper" subtitle="Technical overview for builders and investors" color="text-primary" />

      <div className="border border-white/10 rounded-2xl overflow-hidden">
        {/* Litepaper header */}
        <div className="bg-gradient-to-br from-primary/10 via-card to-card p-8 border-b border-white/10">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-mono mb-4">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              CLOUDANA LITEPAPER v0.1 -- TESTNET
            </div>
            <h1 className="text-3xl font-bold mb-3">Cloudana: A Decentralized Compute Network with Proof of Useful Work</h1>
            <p className="text-muted-foreground">
              Cloudana is a permissionless infrastructure layer that coordinates heterogeneous compute hardware
              through on-chain smart contracts, rewards providers via a novel Proof of Useful Work mechanism,
              and delivers verifiable compute guarantees to users.
            </p>
          </div>
        </div>

        {/* Litepaper body */}
        <div className="p-8 space-y-10">

          {/* Abstract */}
          <section className="space-y-4">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <span className="text-primary font-mono text-sm">§1</span> Abstract
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              Cloud computing is dominated by a handful of centralized providers who set prices, enforce geographic
              restrictions, and create single points of failure. Cloudana addresses this by creating a decentralized
              marketplace where any hardware owner can monetize idle compute resources, and any user can access
              global compute capacity without centralized gatekeeping.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              The key innovation is <strong className="text-foreground">Proof of Useful Work (POUW)</strong> -- a mining
              mechanism that repurposes energy expenditure to perform matrix multiplications, the fundamental operation
              of modern AI/ML workloads. Unlike Bitcoin's purposeless SHA-256 mining, every POUW computation generates
              real economic value.
            </p>
          </section>

          {/* Problem */}
          <section className="space-y-4">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <span className="text-primary font-mono text-sm">§2</span> The Problem
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              {[
                { title: "Centralization Risk", desc: "AWS, Azure, GCP control >65% of cloud infrastructure. A single policy change or outage can shut down global applications." },
                { title: "Idle Hardware", desc: "Billions of GPUs and CPUs sit idle globally -- gaming PCs at night, workstations on weekends, data centers at 40% utilization." },
                { title: "Wasted PoW", desc: "Bitcoin miners consume ~150 TWh/year performing hash computations that produce zero computational value for the real world." },
              ].map(({ title, desc }) => (
                <div key={title} className="p-4 rounded-lg bg-red-500/5 border border-red-500/10 space-y-2">
                  <p className="font-semibold text-red-400 text-sm">{title}</p>
                  <p className="text-muted-foreground text-xs leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Solution */}
          <section className="space-y-4">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <span className="text-primary font-mono text-sm">§3</span> The Solution
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              Cloudana combines three innovations:
            </p>
            <div className="space-y-3">
              {[
                { n: "3.1", title: "On-Chain Coordination", desc: "Smart contracts handle job posting, provider selection, payment escrow, and reward distribution -- all without a trusted intermediary." },
                { n: "3.2", title: "Proof of Useful Work", desc: "Providers earn mining rewards by performing matrix multiplications (cuPOW Algorithm 6.4). The proofs are verifiable, fresh, and unforgeable." },
                { n: "3.3", title: "Dual Revenue Streams", desc: "Providers earn from both direct job execution fees AND continuous POUW mining rewards, creating sustainable economics for hardware operators." },
              ].map(({ n, title, desc }) => (
                <div key={n} className="flex gap-4 p-4 rounded-lg bg-white/3 border border-white/5">
                  <span className="font-mono text-primary text-sm shrink-0">{n}</span>
                  <div className="text-sm">
                    <p className="font-semibold text-foreground mb-1">{title}</p>
                    <p className="text-muted-foreground">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Token Economics */}
          <section className="space-y-4">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <span className="text-primary font-mono text-sm">§4</span> Token Economics
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              CLD is a <strong className="text-foreground">utility token</strong>, not a currency. Its purpose is to
              coordinate resource allocation on the network -- paying for compute, rewarding providers, and
              governing the protocol. Cloudana is not building a decentralized currency; it is building
              a decentralized compute marketplace, and tokenomics must reflect that.
            </p>

            <div className="space-y-3">
              <p className="font-semibold text-foreground">Why no hard cap?</p>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Bitcoin can survive after its 21M supply is mined because transaction fees alone sustain miners --
                but Bitcoin had 130 years to build sufficient fee volume, and its only job is moving value.
                Cloudana providers run real hardware with real operating costs. A hard cap would create a
                subsidy cliff: the moment minting stops, providers who cannot survive on fees alone leave,
                reducing network capacity, reducing utility, reducing demand -- a death spiral. A utility
                network that needs to run forever requires perpetual provider incentives.
              </p>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Instead, CLD uses <strong className="text-foreground">asymptotic tail emission</strong>: rewards
                decay toward a permanent floor (~0.1 CLD/proof) that never reaches zero. This floor provides
                a perpetual baseline subsidy -- small enough to be negligible at scale, large enough to keep
                providers online during low-demand periods. Combined with fee burning, net supply self-regulates.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div className="p-4 rounded-lg bg-primary/5 border border-primary/10 space-y-2">
                <p className="font-semibold text-primary">POUW Minting</p>
                <p className="text-muted-foreground text-xs">Inflationary minting on proof submission. Starts 10 CLD/proof, halves every ~4M proofs, permanent floor ~0.1 CLD. No pre-mine -- every CLD is earned by proven useful work.</p>
              </div>
              <div className="p-4 rounded-lg bg-green-500/5 border border-green-500/10 space-y-2">
                <p className="font-semibold text-green-400">User Fees</p>
                <p className="text-muted-foreground text-xs">80% of compute fees go directly to the provider. The primary long-term revenue source as the network matures. Fee volume growth offsets declining minting rewards.</p>
              </div>
              <div className="p-4 rounded-lg bg-red-500/5 border border-red-500/10 space-y-2">
                <p className="font-semibold text-red-400">Fee Burn</p>
                <p className="text-muted-foreground text-xs">15% of all compute fees are permanently burned. At high network usage, burn rate exceeds tail emission -- CLD becomes net deflationary as Cloudana succeeds.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-muted-foreground">
              <div className="space-y-2">
                <p className="font-medium text-foreground">CLD sinks (demand)</p>
                <ul className="space-y-1 list-disc list-inside">
                  <li>Users fund compute workloads with CLD</li>
                  <li>Fee burn (15% of all compute fees)</li>
                  <li>Provider registration stake (planned)</li>
                  <li>Governance voting weight (planned)</li>
                </ul>
              </div>
              <div className="space-y-2">
                <p className="font-medium text-foreground">CLD sources (supply)</p>
                <ul className="space-y-1 list-disc list-inside">
                  <li>POUW proof minting (inflationary, decaying to floor)</li>
                  <li>Fee redistribution to providers (not new supply)</li>
                  <li>5% treasury cut for protocol sustainability</li>
                </ul>
              </div>
            </div>

            <InfoBox accent="primary">
              <strong>Reward Formula:</strong> R = 10 CLD * (n/64)^1.5 * 2^((d-8)/4), decaying to floor ~0.1 CLD/proof<br />
              where n = matrix size, d = difficulty. Larger, harder proofs earn proportionally more.
              Emission decays with total proof count but never reaches zero -- the network runs forever.
            </InfoBox>

            <div className="p-4 rounded-lg bg-white/3 border border-white/8 text-sm space-y-2">
              <p className="font-semibold text-foreground">Testnet vs Mainnet Mechanics</p>
              <p className="text-muted-foreground text-xs">Testnet uses a pre-funded pool (1M CLD) to test reward mechanics without tokenomic risk -- this is a staging mechanism, not representative of mainnet. At mainnet launch, the pool is replaced by inflationary minting: RewardContract receives MINTER_ROLE on CLDToken and calls mint() directly upon proof verification. No pre-mine. No genesis allocation. Every CLD in existence was earned by a provider proving useful work.</p>
            </div>
          </section>

          {/* Security */}
          <section className="space-y-4">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <span className="text-primary font-mono text-sm">§5</span> Security Model
            </h2>
            <div className="space-y-3 text-sm text-muted-foreground">
              <p><strong className="text-foreground">Testnet:</strong> The orchestrator is a trusted verifier -- it re-executes POUW computations to validate certificates. This is centralized but sufficient for testnet.</p>
              <p><strong className="text-foreground">Mainnet:</strong> A Circom/Groth16 zkSNARK circuit compresses the O(n^3) verification into a constant-size proof. Anyone can verify a certificate in O(1) on-chain without re-executing the full computation.</p>
              <p>The underlying hardness assumption is that blocked matrix multiplication with transcript recording has no sub-cubic shortcuts -- consistent with the best known algorithms for general matrix multiply.</p>
            </div>
          </section>

          {/* Roadmap */}
          <section className="space-y-4">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <span className="text-primary font-mono text-sm">§6</span> Roadmap
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
              {[
                { q: "Q1 2026", items: ["Testnet POUW live", "CPU TypeScript miner", "Orchestrator API", "Mining Dashboard"], status: "done" },
                { q: "Q2 2026", items: ["Rust GPU miner", "CUDA acceleration", "Provider CLI tools", "Performance testing"], status: "done" },
                { q: "Q3 2026", items: ["Circom zkSNARK circuit", "Groth16 verifier", "Trusted setup ceremony", "Audit"], status: "next" },
                { q: "Q4 2026", items: ["Mainnet launch", "Inflationary minting live", "DEX listing", "DAO governance + treasury"], status: "planned" },
              ].map(({ q, items, status }) => (
                <div key={q} className={cn(
                  "p-4 rounded-lg border space-y-3",
                  status === "done" ? "border-green-500/20 bg-green-500/5" :
                  status === "next" ? "border-primary/20 bg-primary/5" :
                  "border-white/10 bg-white/2"
                )}>
                  <div className="flex items-center justify-between">
                    <p className="font-bold text-foreground">{q}</p>
                    <Badge variant="outline" className={cn(
                      "text-xs",
                      status === "done" ? "border-green-500/30 text-green-400" :
                      status === "next" ? "border-primary/30 text-primary" :
                      "border-white/20 text-muted-foreground"
                    )}>
                      {status === "done" ? "Done" : status === "next" ? "Next" : "Planned"}
                    </Badge>
                  </div>
                  <ul className="space-y-1">
                    {items.map((item) => (
                      <li key={item} className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <span className={status === "done" ? "text-green-400" : "text-muted-foreground/30"}>✓</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>

        </div>

        {/* Footer */}
        <div className="bg-white/3 border-t border-white/10 px-8 py-4 flex items-center justify-between text-xs text-muted-foreground">
          <span>Cloudana Litepaper v0.1 -- Testnet -- March 2025</span>
          <div className="flex items-center gap-4">
            <span>Base Sepolia: 84532</span>
            <span>cuPOW: IACR 2025/685</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Sidebar navigation -------------------------------------------------------

function DocsSidebar({ active, onSelect }: { active: string; onSelect: (id: string) => void }) {
  return (
    <nav className="sticky top-24 space-y-1">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 mb-3">Contents</p>
      {SECTIONS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => onSelect(id)}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all",
            active === id
              ? "bg-primary/10 text-primary border border-primary/20"
              : "text-muted-foreground hover:text-foreground hover:bg-white/5"
          )}
        >
          <Icon className="h-4 w-4 shrink-0" />
          {label}
        </button>
      ))}
    </nav>
  );
}

// --- Main Page ----------------------------------------------------------------

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState("overview");

  const renderSection = () => {
    switch (activeSection) {
      case "overview": return <SectionOverview />;
      case "architecture": return <SectionArchitecture />;
      case "pouw": return <SectionPOUW />;
      case "cupow": return <SectionCuPOW />;
      case "rewards": return <SectionRewards />;
      case "pricing": return <SectionPricing />;
      case "clusters": return <SectionClusters />;
      case "peer-verification": return <SectionPeerVerification />;
      case "contracts": return <SectionContracts />;
      case "network": return <SectionNetwork />;
      case "litepaper": return <SectionLitepaper />;
      default: return <SectionOverview />;
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      {/* Page header */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mb-10"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/20">
            <BookOpen className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Documentation</h1>
            <p className="text-muted-foreground text-sm">Architecture, algorithms, and technical reference</p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Badge variant="outline" className="border-green-500/30 text-green-400 bg-green-500/5 text-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse mr-1.5" />
            Testnet Live
          </Badge>
          <Badge variant="outline" className="border-white/20 text-muted-foreground text-xs">Base Sepolia (84532)</Badge>
          <Badge variant="outline" className="border-primary/30 text-primary text-xs">cuPOW v1.0</Badge>
        </div>
      </motion.div>

      {/* Content */}
      <div className="flex gap-8">
        {/* Sidebar */}
        <aside className="hidden lg:block w-52 shrink-0">
          <DocsSidebar active={activeSection} onSelect={setActiveSection} />
        </aside>

        {/* Mobile section selector */}
        <div className="lg:hidden w-full mb-6">
          <div className="flex flex-wrap gap-2">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveSection(id)}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border",
                  activeSection === id
                    ? "bg-primary/10 text-primary border-primary/20"
                    : "text-muted-foreground border-white/10 hover:bg-white/5"
                )}
              >
                <Icon className="h-3 w-3" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Main content */}
        <motion.div
          key={activeSection}
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3 }}
          className="flex-1 min-w-0"
        >
          {renderSection()}

          {/* Next section navigation */}
          <div className="mt-12 pt-8 border-t border-white/10 flex items-center justify-between">
            {(() => {
              const idx = SECTIONS.findIndex((s) => s.id === activeSection);
              const prev = SECTIONS[idx - 1];
              const next = SECTIONS[idx + 1];
              return (
                <>
                  {prev ? (
                    <button onClick={() => setActiveSection(prev.id)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                      <ChevronRight className="h-4 w-4 rotate-180" />
                      {prev.label}
                    </button>
                  ) : <div />}
                  {next ? (
                    <button onClick={() => setActiveSection(next.id)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                      {next.label}
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  ) : <div />}
                </>
              );
            })()}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
