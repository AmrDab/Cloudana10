/**
 * Cloudana Litepaper — concise, web-native summary of the protocol economics and architecture.
 * Route: /litepaper
 */

import { motion } from "framer-motion";
import {
  BookOpen,
  Cpu,
  Server,
  Layers,
  Coins,
  Users,
  Calendar,
  FileText,
  ExternalLink,
  AlertTriangle,
  Flame,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } },
};

const CONTRACTS = [
  { name: "CLDToken", address: "0xcfd19DF5a3f963Dabf52aC7B46d4780Cc0E599e2", desc: "ERC-20 utility token minted through Proof of Useful Work" },
  { name: "WorkloadRegistry", address: "0x71a36e548a884019b4A60947551efB8229e2016a", desc: "Tracks active deployments and their lifecycle" },
  { name: "ProviderRegistry", address: "0x1e7b0039bdC27cB6B1e83d96D5Ad839fD15Af94a", desc: "Provider enrollment, hardware specs, and availability" },
  { name: "RewardContract", address: "0x427830A20C4752eb30C47e0d2572A457ebF4A8AD", desc: "Distributes CLD rewards to providers for verified work" },
  { name: "POUWVerifier", address: "0xE2791574413d2bdE5B84848A99Aeb3B9f4d80682", desc: "Validates Proof of Useful Work submissions on-chain" },
  { name: "StakingManager", address: "0xeEE91E1209995Fc9fE9183330b1872AfAb7C8661", desc: "Manages provider stake deposits and slashing" },
  { name: "ChallengeManager", address: "0x54CA56081e358f89dafFd587F0241eA33BaEC597", desc: "Handles dispute resolution between users and providers" },
];

export default function LitepaperPage() {
  return (
    <div className="max-w-4xl mx-auto py-10 px-6 space-y-12">
      {/* ═══ HEADER ═══ */}
      <motion.div initial="hidden" animate="visible" variants={fadeUp} className="text-center">
        <h1 className="text-4xl font-bold tracking-tight text-slate-900 mb-2">Cloudana Litepaper</h1>
        <p className="text-lg text-slate-600">Decentralized Compute with Proof of Useful Work</p>
        <p className="text-xs text-slate-400 mt-2">v1.0 — May 2026</p>
      </motion.div>

      {/* ═══ ABSTRACT ═══ */}
      <Section id="abstract" title="Abstract" icon={BookOpen}>
        <p>
          Cloudana is a decentralized compute marketplace built on Base (Ethereum L2) where providers
          earn CLD tokens by performing verifiable useful computation. Unlike traditional Proof of Work
          systems that waste energy on meaningless hashes, Cloudana's Proof of Useful Work (POUW)
          mechanism rewards providers for matrix multiplication — work that is both economically useful
          and cryptographically verifiable. The protocol creates a two-sided marketplace: users deploy
          workloads at a fraction of cloud costs, and providers earn dual revenue from job fees and
          mining rewards.
        </p>
      </Section>

      {/* ═══ THE PROBLEM ═══ */}
      <Section id="problem" title="The Problem" icon={AlertTriangle}>
        <div className="space-y-4">
          <p>Three systemic failures in today's compute landscape:</p>
          <ul className="space-y-3 list-none pl-0">
            <li className="flex items-start gap-3">
              <span className="text-red-500 font-bold text-sm mt-0.5">1.</span>
              <div>
                <strong className="text-slate-900">Wasteful mining.</strong>{" "}
                Bitcoin's SHA-256 and Ethereum's former Ethash consume massive energy producing
                computations with zero economic utility beyond consensus.
              </div>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-red-500 font-bold text-sm mt-0.5">2.</span>
              <div>
                <strong className="text-slate-900">Centralized cloud.</strong>{" "}
                AWS, GCP, and Azure control 65% of cloud compute. Pricing is opaque, lock-in is
                enforced through proprietary APIs, and outages affect millions.
              </div>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-red-500 font-bold text-sm mt-0.5">3.</span>
              <div>
                <strong className="text-slate-900">No verification.</strong>{" "}
                Existing decentralized compute networks (Akash, Render) lack mathematical proof that
                work was performed correctly. Users must trust providers blindly.
              </div>
            </li>
          </ul>
        </div>
      </Section>

      {/* ═══ POUW MECHANISM ═══ */}
      <Section id="pouw" title="Proof of Useful Work (POUW)" icon={Cpu}>
        <div className="space-y-4">
          <p>
            Cloudana's POUW is based on the <strong>cuPOW Algorithm 6.4</strong> from Komargodski &
            Weinstein (2025). The core insight: matrix multiplication over finite fields has a proven
            lower bound of O(n&#179;) operations. No shortcut exists — you cannot fake the result
            without doing the work.
          </p>

          <Card className="bg-slate-50 border-slate-200">
            <CardContent className="pt-5">
              <h4 className="font-semibold text-sm text-slate-900 mb-2">How it works:</h4>
              <ol className="list-decimal pl-5 space-y-2 text-sm text-slate-700">
                <li>
                  The network issues a <strong>challenge</strong>: two random matrices A and B over a
                  finite field F_p, plus a target difficulty d.
                </li>
                <li>
                  The provider computes C = A x B (matrix multiplication), which requires O(n&#179;)
                  operations — provably unavoidable.
                </li>
                <li>
                  The provider submits a <strong>POUW certificate</strong>: the result C plus a
                  compact proof (random row/column spot-checks that verify in O(n) time).
                </li>
                <li>
                  The <strong>POUWVerifier</strong> contract validates the spot-checks on-chain. If
                  valid, CLD is minted to the provider.
                </li>
              </ol>
            </CardContent>
          </Card>

          <Card className="bg-slate-50 border-slate-200">
            <CardContent className="pt-5">
              <h4 className="font-semibold text-sm text-slate-900 mb-2">Why it's secure:</h4>
              <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700">
                <li>O(n&#179;) lower bound is unconditional — no quantum or classical shortcut</li>
                <li>Verification is O(n) per spot-check — cheap enough for on-chain execution</li>
                <li>False positives are exponentially unlikely with multiple spot-checks</li>
                <li>The work product (matrix multiplication) has direct utility for ML inference,
                  scientific simulation, and linear algebra workloads</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </Section>

      {/* ═══ ARCHITECTURE ═══ */}
      <Section id="architecture" title="Architecture" icon={Layers}>
        <div className="space-y-4">
          <p>The protocol operates as a four-stage pipeline:</p>

          <div className="grid gap-3">
            {[
              {
                step: "1",
                title: "Submit",
                desc: "Users submit workloads as SDL manifests describing services, ports, and resource requirements. The manifest is registered on-chain via WorkloadRegistry.",
              },
              {
                step: "2",
                title: "Match",
                desc: "The orchestrator queries ProviderRegistry, ranks eligible providers by price, hardware fit, and uptime history, then assigns the workload.",
              },
              {
                step: "3",
                title: "Execute",
                desc: "The matched provider spins up OCI containers and executes the workload. Simultaneously, it performs POUW matrix computations and generates certificates.",
              },
              {
                step: "4",
                title: "Verify",
                desc: "POUW certificates are submitted to the POUWVerifier contract on Base. Valid proofs trigger CLD minting. Invalid proofs are rejected and the provider is penalized.",
              },
            ].map((item) => (
              <div key={item.step} className="flex items-start gap-4 bg-slate-50 border border-slate-200 rounded-lg p-4">
                <div className="w-7 h-7 rounded-full bg-cyan-600 text-white text-xs font-bold flex items-center justify-center shrink-0">
                  {item.step}
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-slate-900">{item.title}</h4>
                  <p className="text-sm text-slate-600 mt-0.5">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <Card className="bg-slate-50 border-slate-200">
            <CardContent className="pt-5">
              <h4 className="font-semibold text-sm text-slate-900 mb-2">Verification tiers:</h4>
              <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700">
                <li><strong>Standard</strong> — Challenger-based: random nodes re-execute and compare results</li>
                <li><strong>Optimistic</strong> — Fraud proofs: results accepted unless challenged within a window</li>
                <li><strong>POUW-Verified</strong> — Mathematical proofs: spot-check verification on-chain (highest security)</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </Section>

      {/* ═══ TOKEN ECONOMICS ═══ */}
      <Section id="tokenomics" title="Token Economics" icon={Coins}>
        <div className="space-y-4">
          <p>
            CLD is an ERC-20 token on Base. It is <strong>never pre-minted</strong> — every token in
            circulation was created by a provider performing verified useful work.
          </p>

          <Card className="bg-slate-50 border-slate-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Block Reward Schedule</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="text-left py-2 pr-4 font-medium text-slate-500">Period</th>
                      <th className="text-left py-2 pr-4 font-medium text-slate-500">Reward</th>
                      <th className="text-left py-2 font-medium text-slate-500">Annual Mint</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-700">
                    <tr className="border-b border-slate-100">
                      <td className="py-2 pr-4">Years 1-4</td>
                      <td className="py-2 pr-4 font-mono">100 CLD/block</td>
                      <td className="py-2 font-mono">~52.6M CLD</td>
                    </tr>
                    <tr className="border-b border-slate-100">
                      <td className="py-2 pr-4">Years 5-8</td>
                      <td className="py-2 pr-4 font-mono">50 CLD/block</td>
                      <td className="py-2 font-mono">~26.3M CLD</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4">Years 9+</td>
                      <td className="py-2 pr-4 font-mono">25 CLD/block</td>
                      <td className="py-2 font-mono">~13.1M CLD (permanent floor)</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-400 mt-3">Block time: 1 block per 60 seconds (1,440 blocks/day).</p>
            </CardContent>
          </Card>

          <Card className="bg-slate-50 border-slate-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Fee Split</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-2xl font-bold text-cyan-600">75%</div>
                  <div className="text-xs text-slate-500 mt-1">Provider</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-orange-500">20%</div>
                  <div className="text-xs text-slate-500 mt-1 flex items-center justify-center gap-1">
                    <Flame className="w-3 h-3" /> Burned
                  </div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-slate-700">5%</div>
                  <div className="text-xs text-slate-500 mt-1">Treasury</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-2 text-sm text-slate-700">
            <p>
              <strong>Dual revenue:</strong> Providers earn from both POUW mining rewards and job
              execution fees. This creates sustainable income even when one revenue stream fluctuates.
            </p>
            <p>
              <strong>No staking:</strong> Cloudana does not require providers to lock capital.
              Accountability is enforced through progressive penalties: warning, then 3-month
              suspension, then 1-year suspension.
            </p>
            <p>
              <strong>Deflationary by design:</strong> The 20% fee burn permanently removes CLD from
              circulation. As network usage scales, burn rate exceeds the mint rate from block rewards,
              creating deflationary pressure.
            </p>
          </div>
        </div>
      </Section>

      {/* ═══ PROVIDER MODEL ═══ */}
      <Section id="providers" title="Provider Model" icon={Server}>
        <div className="space-y-4">
          <ul className="space-y-3 text-sm text-slate-700">
            <li className="flex items-start gap-2">
              <span className="text-cyan-600 font-bold">-</span>
              <span><strong>Any hardware welcome.</strong> Linux + Docker is all you need. Datacenter GPUs, home servers, repurposed gaming rigs — all eligible.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-cyan-600 font-bold">-</span>
              <span><strong>Dual earnings.</strong> Providers earn CLD from both block rewards (POUW mining) and job execution fees paid by users.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-cyan-600 font-bold">-</span>
              <span><strong>Penalty-based accountability.</strong> No slashing of locked funds. Instead: first offense = warning, second = 3-month suspension, third = 1-year suspension. Clean records reset after 6 months of good behavior.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-cyan-600 font-bold">-</span>
              <span><strong>Natural pool economics.</strong> More providers joining means less reward per individual provider, naturally incentivizing geographic and hardware diversity without protocol-level caps.</span>
            </li>
          </ul>
        </div>
      </Section>

      {/* ═══ ROADMAP ═══ */}
      <Section id="roadmap" title="Roadmap" icon={Calendar}>
        <div className="space-y-3">
          {[
            {
              phase: "Phase 1",
              title: "Testnet",
              when: "Now",
              items: ["Smart contracts deployed on Base Sepolia", "Provider registration and workload placement", "Basic reward distribution", "Console and faucet live"],
            },
            {
              phase: "Phase 2",
              title: "POUW Verification",
              when: "Q4 2026",
              items: ["On-chain POUW spot-check verification", "cuPOW Algorithm 6.4 integration", "Multi-tier verification (Standard, Optimistic, POUW-Verified)", "Challenge and dispute resolution"],
            },
            {
              phase: "Phase 3",
              title: "Mining Integration",
              when: "Q2 2027",
              items: ["Provider mining client (GPU-optimized matrix multiplication)", "Block reward halving schedule activation", "Fee burn mechanism", "Provider reputation system"],
            },
            {
              phase: "Phase 4",
              title: "Mainnet + Scaling",
              when: "Q4 2027+",
              items: ["Migration to Base Mainnet", "Cross-chain bridge for CLD", "Global provider mesh (100+ nodes)", "Enterprise SLA tiers"],
            },
          ].map((phase) => (
            <Card key={phase.phase} className="border-slate-200">
              <CardContent className="pt-5">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-xs font-bold text-cyan-600 bg-cyan-50 px-2 py-0.5 rounded">{phase.phase}</span>
                  <span className="font-semibold text-sm text-slate-900">{phase.title}</span>
                  <span className="text-xs text-slate-400 ml-auto">{phase.when}</span>
                </div>
                <ul className="list-disc pl-5 space-y-1 text-sm text-slate-600">
                  {phase.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </Section>

      {/* ═══ SMART CONTRACTS ═══ */}
      <Section id="contracts" title="Smart Contracts" icon={FileText}>
        <div className="space-y-2">
          <p className="text-sm text-slate-600 mb-4">
            All contracts are deployed on Base Sepolia (Chain ID 84532) and verified on BaseScan.
          </p>
          {CONTRACTS.map((c) => (
            <div key={c.name} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
              <span className="font-semibold text-sm text-slate-900 w-44 shrink-0">{c.name}</span>
              <a
                href={`https://sepolia.basescan.org/address/${c.address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs text-cyan-600 hover:text-cyan-700 shrink-0"
              >
                {c.address}
                <ExternalLink className="w-3 h-3 inline ml-1" />
              </a>
              <span className="text-xs text-slate-500 sm:ml-auto hidden md:block">{c.desc}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* ═══ REFERENCES ═══ */}
      <Section id="references" title="References" icon={BookOpen}>
        <ol className="list-decimal pl-5 space-y-2 text-sm text-slate-700">
          <li>
            Komargodski, I. & Weinstein, O. (2025).{" "}
            <em>Proof of Useful Work from Matrix Multiplication.</em>{" "}
            IACR ePrint 2025/685.{" "}
            <a
              href="https://eprint.iacr.org/2025/685"
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-600 hover:text-cyan-700"
            >
              https://eprint.iacr.org/2025/685
              <ExternalLink className="w-3 h-3 inline ml-1" />
            </a>
          </li>
          <li>
            Base (Coinbase L2).{" "}
            <a
              href="https://base.org"
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-600 hover:text-cyan-700"
            >
              https://base.org
              <ExternalLink className="w-3 h-3 inline ml-1" />
            </a>
          </li>
          <li>
            ERC-20 Token Standard. Ethereum Improvement Proposals.{" "}
            <a
              href="https://eips.ethereum.org/EIPS/eip-20"
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-600 hover:text-cyan-700"
            >
              https://eips.ethereum.org/EIPS/eip-20
              <ExternalLink className="w-3 h-3 inline ml-1" />
            </a>
          </li>
        </ol>
      </Section>

      {/* ═══ FOOTER NOTE ═══ */}
      <div className="text-center text-xs text-slate-400 pt-4 border-t border-slate-200">
        <p>Cloudana Protocol — Built on Base</p>
        <p className="mt-1">This document is for informational purposes. The protocol is under active development on testnet.</p>
      </div>
    </div>
  );
}

/* ─── Section helper ─── */
function Section({
  id,
  title,
  icon: Icon,
  children,
}: {
  id: string;
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      id={id}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-50px" }}
      variants={fadeUp}
    >
      <div className="flex items-center gap-2 mb-4">
        <Icon className="w-5 h-5 text-cyan-600" />
        <h2 className="text-2xl font-bold text-slate-900">{title}</h2>
      </div>
      <div className="text-slate-700 leading-relaxed">{children}</div>
    </motion.section>
  );
}
