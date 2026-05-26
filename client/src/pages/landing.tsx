import { useWallet } from "@/context/wallet-context";
import { useAppKit } from "@reown/appkit/react";
import { motion } from "framer-motion";

/** Landing page renders outside the wouter Router — use plain <a> with /control prefix */
function Link({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  return <a href={`/control${href}`} className={className}>{children}</a>;
}
import {
  Shield,
  Container,
  Eye,
  Zap,
  Server,
  LinkIcon,
  ArrowRight,
  ExternalLink,
  Terminal,
  Cpu,
  Coins,
} from "lucide-react";
import NetworkBackground from "@/components/NetworkBackground";

/* ─── CONTRACTS ─── */
const CONTRACTS = [
  { name: "CLDToken", address: "0xcfd19DF5a3f963Dabf52aC7B46d4780Cc0E599e2", purpose: "ERC-20 utility token minted through Proof of Useful Work" },
  { name: "WorkloadRegistry", address: "0x71a36e548a884019b4A60947551efB8229e2016a", purpose: "Tracks active deployments and their lifecycle" },
  { name: "ProviderRegistry", address: "0x1e7b0039bdC27cB6B1e83d96D5Ad839fD15Af94a", purpose: "Provider enrollment, hardware specs, and availability" },
  { name: "RewardContract", address: "0x427830A20C4752eb30C47e0d2572A457ebF4A8AD", purpose: "Distributes CLD rewards to providers for verified work" },
  { name: "POUWVerifier", address: "0xE2791574413d2bdE5B84848A99Aeb3B9f4d80682", purpose: "Validates Proof of Useful Work submissions" },
  { name: "StakingManager", address: "0xeEE91E1209995Fc9fE9183330b1872AfAb7C8661", purpose: "Manages provider stake deposits and slashing" },
  { name: "ChallengeManager", address: "0x54CA56081e358f89dafFd587F0241eA33BaEC597", purpose: "Handles dispute resolution between users and providers" },
];

const truncateAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.08 } },
};

/* ─── CONNECTED STATE ─── */
function ConnectedView() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="max-w-2xl w-full"
      >
        <h1 className="text-3xl font-bold text-slate-900 mb-2">Welcome back</h1>
        <p className="text-slate-600 mb-8">Pick up where you left off.</p>
        <div className="grid md:grid-cols-2 gap-4">
          <Link href="/user">
            <div className="bg-white border border-slate-200 rounded-xl p-6 hover:border-cyan-300 transition-colors cursor-pointer group">
              <Cpu className="w-5 h-5 text-cyan-600 mb-3" />
              <h3 className="font-semibold text-slate-900 mb-1">User Dashboard</h3>
              <p className="text-sm text-slate-600 mb-4">Manage deployments, monitor workloads.</p>
              <span className="text-cyan-600 text-sm font-medium group-hover:translate-x-1 inline-block transition-transform">
                Open Dashboard <ArrowRight className="w-3.5 h-3.5 inline ml-1" />
              </span>
            </div>
          </Link>
          <Link href="/provider">
            <div className="bg-white border border-slate-200 rounded-xl p-6 hover:border-cyan-300 transition-colors cursor-pointer group">
              <Server className="w-5 h-5 text-cyan-600 mb-3" />
              <h3 className="font-semibold text-slate-900 mb-1">Provider Dashboard</h3>
              <p className="text-sm text-slate-600 mb-4">View earnings, manage hardware, monitor POUW activity.</p>
              <span className="text-cyan-600 text-sm font-medium group-hover:translate-x-1 inline-block transition-transform">
                Open Provider <ArrowRight className="w-3.5 h-3.5 inline ml-1" />
              </span>
            </div>
          </Link>
        </div>
      </motion.div>
    </div>
  );
}

/* ─── LANDING PAGE ─── */
export default function LandingPage() {
  const { isConnected } = useWallet();
  const { open } = useAppKit();

  if (isConnected) return <ConnectedView />;

  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* ═══ 1. NAVIGATION ═══ */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-lg border-b border-slate-200/60">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-cyan-600 rounded-lg flex items-center justify-center">
              <span className="text-white text-sm font-bold">C</span>
            </div>
            <span className="text-[1.35rem] font-semibold tracking-[-0.04em]">cloudana</span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm text-slate-600">
            <Link href="/docs" className="hover:text-slate-900 transition-colors">Platform</Link>
            <Link href="/providers" className="hover:text-slate-900 transition-colors">Providers</Link>
            <Link href="/pricing/gpus" className="hover:text-slate-900 transition-colors">Pricing</Link>
            <Link href="/docs" className="hover:text-slate-900 transition-colors">Docs</Link>
          </div>
          <button
            onClick={() => open()}
            className="text-sm font-medium px-4 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors"
          >
            Connect Wallet
          </button>
        </div>
      </nav>

      {/* ═══ 2. HERO ═══ */}
      <section className="pt-28 pb-20 px-6 relative overflow-hidden">
        <NetworkBackground />
        <div className="relative z-10 max-w-6xl mx-auto grid lg:grid-cols-[55%_45%] gap-12 items-center">
          <motion.div initial="hidden" animate="visible" variants={stagger}>
            <motion.div variants={fadeUp} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-200 text-xs font-medium text-slate-600 mb-6">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Live on Base Sepolia
            </motion.div>
            <motion.h1 variants={fadeUp} className="text-4xl md:text-5xl font-bold tracking-[-0.03em] leading-[1.1] mb-5">
              Deploy to a global mesh of verified compute providers.
            </motion.h1>
            <motion.p variants={fadeUp} className="text-lg text-slate-600 leading-relaxed mb-8 max-w-lg">
              Cloudana is a decentralized compute marketplace. You write a manifest, the orchestrator
              finds the cheapest provider that fits, and every cycle of work is verified on-chain
              through Proof of Useful Work. No middlemen. No markup opacity.
            </motion.p>
            <motion.div variants={fadeUp} className="flex flex-wrap gap-3 mb-4">
              <button
                onClick={() => open()}
                className="px-5 py-2.5 rounded-lg bg-cyan-600 text-white font-medium text-sm hover:bg-cyan-700 transition-colors"
              >
                Start Deploying
              </button>
              <Link href="/docs">
                <span className="px-5 py-2.5 rounded-lg border border-slate-200 text-slate-700 font-medium text-sm hover:border-slate-300 transition-colors inline-block">
                  Read the Docs
                </span>
              </Link>
            </motion.div>
            <motion.p variants={fadeUp} className="text-xs text-slate-400">
              No credit card needed. Pay with crypto or fiat.
            </motion.p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="hidden lg:block"
          >
            <div className="bg-slate-900 rounded-xl overflow-hidden shadow-2xl shadow-slate-900/10">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-700/50">
                <div className="w-3 h-3 rounded-full bg-red-400" />
                <div className="w-3 h-3 rounded-full bg-yellow-400" />
                <div className="w-3 h-3 rounded-full bg-green-400" />
                <span className="text-xs text-slate-500 ml-2 font-mono">terminal</span>
              </div>
              <div className="p-5 font-mono text-[13px] leading-relaxed text-slate-300">
                <p className="text-slate-500">$ cat deploy.yaml</p>
                <p className="text-cyan-400">services:</p>
                <p className="pl-4">api:</p>
                <p className="pl-8">image: <span className="text-emerald-400">"my-app:latest"</span></p>
                <p className="pl-8">expose:</p>
                <p className="pl-12">- port: 80</p>
                <p className="pl-14">as: 80</p>
                <p className="pl-8">resources:</p>
                <p className="pl-12">cpu: 2</p>
                <p className="pl-12">memory: 4Gi</p>
                <p className="pl-12">gpu: 1</p>
                <p className="mt-4 text-slate-500">$ cloudana deploy deploy.yaml</p>
                <p className="text-emerald-400">&#10003; Manifest parsed (3 services)</p>
                <p className="text-emerald-400">&#10003; Querying ProviderRegistry...</p>
                <p className="text-emerald-400">&#10003; 3 providers matched — selecting best bid</p>
                <p className="text-emerald-400">&#10003; Workload placed → tx: 0x7a3f...e291</p>
                <p className="text-cyan-400">→ https://api.provider-12.cloudana.net</p>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ═══ 3. NETWORK STATS RIBBON ═══ */}
      <section className="border-y border-slate-200 bg-slate-50">
        <div className="max-w-6xl mx-auto px-6 py-5 grid grid-cols-2 md:grid-cols-4 gap-6">
          {[
            { value: "7", label: "Smart Contracts" },
            { value: "Base L2", label: "Settlement Layer" },
            { value: "POUW", label: "Consensus" },
            { value: "~50%", label: "Avg Savings vs Cloud" },
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="font-mono text-lg font-semibold text-slate-900">{stat.value}</div>
              <div className="text-xs text-slate-500 mt-0.5">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ═══ 4. HOW IT WORKS ═══ */}
      <section className="py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeUp}
          >
            <h2 className="text-3xl font-bold tracking-tight mb-2">From manifest to running workload</h2>
            <p className="text-slate-600 mb-12">Three steps. No dashboards to click through.</p>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="grid md:grid-cols-3 gap-8 relative"
          >
            {/* Connecting line */}
            <div className="hidden md:block absolute top-10 left-[20%] right-[20%] h-px bg-slate-200" />

            {[
              {
                step: "01",
                title: "Define",
                desc: "Write a standard SDL manifest describing your services, ports, and resource requirements.",
                code: `resources:\n  cpu: 2\n  memory: 4Gi\n  gpu: 1`,
              },
              {
                step: "02",
                title: "Match",
                desc: "The orchestrator queries ProviderRegistry on-chain, ranks bids by price and proximity, and selects the optimal provider.",
                code: `ProviderRegistry.query(\n  { cpu: 2, gpu: 1 }\n) → [0x1e7b..., 0x71a3...]`,
              },
              {
                step: "03",
                title: "Execute",
                desc: "Provider spins up OCI containers and begins work. POUWVerifier checks proofs on-chain — you only pay for verified cycles.",
                code: `POUWVerifier.verify(\n  workloadId, proof\n) → tx confirmed ✓`,
              },
            ].map((item) => (
              <motion.div key={item.step} variants={fadeUp} className="relative">
                <div className="w-8 h-8 rounded-full bg-cyan-600 text-white text-xs font-bold flex items-center justify-center mb-4 relative z-10">
                  {item.step}
                </div>
                <h3 className="text-lg font-semibold mb-2">{item.title}</h3>
                <p className="text-sm text-slate-600 mb-4">{item.desc}</p>
                <div className="bg-slate-900 rounded-lg p-3 font-mono text-xs text-slate-300 whitespace-pre">
                  {item.code}
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ═══ 5. PROTOCOL ARCHITECTURE ═══ */}
      <section className="py-20 px-6 bg-slate-50">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeUp}
          >
            <h2 className="text-3xl font-bold tracking-tight mb-2">Built on Base. Verified on-chain.</h2>
            <p className="text-slate-600 mb-10">Seven contracts handle the full lifecycle — from provider registration to dispute resolution.</p>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="space-y-2"
          >
            {CONTRACTS.map((c, i) => (
              <motion.div
                key={c.name}
                variants={fadeUp}
                className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 bg-white border border-slate-200 rounded-lg px-5 py-3"
              >
                <span className="text-xs text-slate-400 font-mono w-5">{String(i + 1).padStart(2, "0")}</span>
                <span className="font-semibold text-sm w-40 shrink-0">{c.name}</span>
                <a
                  href={`https://sepolia.basescan.org/address/${c.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-cyan-600 hover:text-cyan-700 shrink-0"
                >
                  {truncateAddress(c.address)}
                  <ExternalLink className="w-3 h-3 inline ml-1" />
                </a>
                <span className="text-sm text-slate-500 ml-auto hidden md:block">{c.purpose}</span>
              </motion.div>
            ))}
          </motion.div>

          <div className="mt-6">
            <a
              href="https://sepolia.basescan.org"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-cyan-600 hover:text-cyan-700 font-medium"
            >
              View all on BaseScan <ExternalLink className="w-3.5 h-3.5 inline ml-0.5" />
            </a>
          </div>
        </div>
      </section>

      {/* ═══ 6. FEATURES ═══ */}
      <section className="py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeUp}
          >
            <h2 className="text-3xl font-bold tracking-tight mb-2">What makes Cloudana different</h2>
            <p className="text-slate-600 mb-12">Not another wrapper on hyperscaler APIs.</p>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="grid md:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            {[
              {
                icon: Shield,
                title: "Proof of Useful Work",
                desc: "Every cycle is verified. Providers prove real computation, not wasted hashes.",
              },
              {
                icon: Container,
                title: "No Vendor Lock-in",
                desc: "Standard OCI containers. Move between providers without code changes.",
              },
              {
                icon: Eye,
                title: "Open Pricing",
                desc: "Providers set rates on-chain. No opaque markup. You see exactly what you pay.",
              },
              {
                icon: Zap,
                title: "Instant Deployments",
                desc: "Orchestrator matches your workload to the best provider in seconds.",
              },
              {
                icon: Server,
                title: "Any Hardware Welcome",
                desc: "Datacenter GPUs to home servers. Linux + Docker is all you need.",
              },
              {
                icon: LinkIcon,
                title: "On-chain Settlement",
                desc: "Payments, placement, and verification — all recorded on Base.",
              },
            ].map((feature) => (
              <motion.div
                key={feature.title}
                variants={fadeUp}
                className="border border-slate-200 rounded-xl p-6 hover:border-slate-300 transition-colors"
              >
                <feature.icon className="w-5 h-5 text-cyan-600 mb-3" />
                <h3 className="font-semibold text-slate-900 mb-1.5">{feature.title}</h3>
                <p className="text-sm text-slate-600 leading-relaxed">{feature.desc}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ═══ 7. COST COMPARISON ═══ */}
      <section className="py-20 px-6 bg-slate-50">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeUp}
          >
            <h2 className="text-3xl font-bold tracking-tight mb-2">How pricing compares</h2>
            <p className="text-slate-600 mb-10">Provider bids compete for your workload. The result: dramatically lower costs.</p>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeUp}
            className="overflow-x-auto"
          >
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-3 px-4 font-medium text-slate-500">Spec</th>
                  <th className="text-left py-3 px-4 font-medium text-slate-500">AWS EC2</th>
                  <th className="text-left py-3 px-4 font-medium text-slate-500">Google Cloud</th>
                  <th className="text-left py-3 px-4 font-medium text-cyan-700 bg-cyan-50 rounded-t-lg">Cloudana</th>
                </tr>
              </thead>
              <tbody className="text-slate-700">
                {[
                  ["2 vCPU / 4 GB RAM", "$30/mo", "$28/mo", "~$9/mo"],
                  ["GPU (T4 equivalent)", "$526/mo", "$350/mo", "~$120/mo"],
                  ["Lock-in Period", "1-3 years", "1-3 years", "None"],
                  ["Payment", "Credit card", "Credit card", "Crypto or card"],
                  ["Audit Trail", "None", "None", "On-chain"],
                  ["Open Source", "No", "No", "Yes"],
                ].map(([spec, aws, gcp, cld], i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-3 px-4 font-medium">{spec}</td>
                    <td className="py-3 px-4 font-mono text-slate-500">{aws}</td>
                    <td className="py-3 px-4 font-mono text-slate-500">{gcp}</td>
                    <td className="py-3 px-4 font-mono font-medium text-slate-900 bg-cyan-50">{cld}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </motion.div>

          <p className="text-xs text-slate-400 mt-4">
            Prices vary by provider bids. Based on testnet provider rates.
          </p>
        </div>
      </section>

      {/* ═══ 8. FOR PROVIDERS ═══ */}
      <section className="py-20 px-6">
        <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
          >
            <motion.h2 variants={fadeUp} className="text-3xl font-bold tracking-tight mb-2">
              Earn by providing compute
            </motion.h2>
            <motion.p variants={fadeUp} className="text-slate-600 mb-6 leading-relaxed">
              Got idle hardware? Register as a provider and start earning CLD through
              computation. Your machine runs matrix multiplication tasks, the POUW verifier
              confirms the work on-chain, and CLD is minted to your wallet automatically.
            </motion.p>
            <motion.p variants={fadeUp} className="text-slate-600 mb-6 leading-relaxed">
              Rewards scale with work done — larger matrices and higher difficulty mean more CLD.
              Every submission is re-verified by the orchestrator. Invalid proofs are rejected.
              Unreliable providers receive warnings, then suspensions — keeping the network stable.
            </motion.p>
            <motion.div variants={fadeUp}>
              <Link href="/provider">
                <span className="inline-block px-5 py-2.5 rounded-lg bg-cyan-600 text-white font-medium text-sm hover:bg-cyan-700 transition-colors">
                  Register as Provider
                </span>
              </Link>
            </motion.div>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeUp}
            className="bg-white border border-slate-200 rounded-xl p-6"
          >
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Terminal className="w-4 h-4 text-cyan-600" />
              Requirements
            </h3>
            <ul className="space-y-3 text-sm text-slate-600">
              {[
                "Linux server (Ubuntu 20.04+ recommended)",
                "Docker or K3s installed",
                "Stable internet connection (100 Mbps+)",
                "Wallet connected to Base Sepolia",
                "Public IP or reverse proxy for workload ingress",
              ].map((req) => (
                <li key={req} className="flex items-start gap-2">
                  <span className="text-emerald-600 mt-0.5 text-xs">&#10003;</span>
                  {req}
                </li>
              ))}
            </ul>
            <div className="mt-6 pt-4 border-t border-slate-100">
              <p className="text-xs text-slate-400">
                No upfront cost. All CLD is earned through useful work.
              </p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ═══ 9. CTA ═══ */}
      <section className="py-20 px-6 bg-cyan-50/50">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={fadeUp}
          className="max-w-2xl mx-auto text-center"
        >
          <h2 className="text-3xl font-bold tracking-tight mb-3">Try the testnet</h2>
          <p className="text-slate-600 mb-8 leading-relaxed">
            Connect your wallet, claim free CLD from the faucet, and deploy your first workload.
            The whole loop takes under two minutes.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <button
              onClick={() => open()}
              className="px-5 py-2.5 rounded-lg bg-cyan-600 text-white font-medium text-sm hover:bg-cyan-700 transition-colors"
            >
              Connect Wallet
            </button>
            <Link href="/faucet">
              <span className="px-5 py-2.5 rounded-lg border border-slate-200 bg-white text-slate-700 font-medium text-sm hover:border-slate-300 transition-colors inline-block">
                Get Testnet Tokens
              </span>
            </Link>
          </div>
        </motion.div>
      </section>

      {/* ═══ 10. FOOTER ═══ */}
      <footer className="bg-slate-50 border-t border-slate-200 py-12 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-4 gap-8 mb-10">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-6 h-6 bg-cyan-600 rounded-md flex items-center justify-center">
                  <span className="text-white text-xs font-bold">C</span>
                </div>
                <span className="text-[1.35rem] font-semibold tracking-[-0.04em]">cloudana</span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Decentralized compute marketplace on Base.
              </p>
            </div>

            <div>
              <h4 className="text-sm font-semibold mb-3 text-slate-900">Platform</h4>
              <ul className="space-y-2 text-sm text-slate-600">
                <li><Link href="/dashboard" className="hover:text-slate-900">Dashboard</Link></li>
                <li><Link href="/pricing/gpus" className="hover:text-slate-900">Pricing</Link></li>
                <li><Link href="/provider" className="hover:text-slate-900">Provider Portal</Link></li>
                <li><Link href="/faucet" className="hover:text-slate-900">Faucet</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="text-sm font-semibold mb-3 text-slate-900">Resources</h4>
              <ul className="space-y-2 text-sm text-slate-600">
                <li><Link href="/docs" className="hover:text-slate-900">Documentation</Link></li>
                <li>
                  <a href="https://sepolia.basescan.org" target="_blank" rel="noopener noreferrer" className="hover:text-slate-900">
                    Block Explorer
                  </a>
                </li>
                <li><Link href="/docs" className="hover:text-slate-900">API Reference</Link></li>
                <li><Link href="/docs" className="hover:text-slate-900">SDL Spec</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="text-sm font-semibold mb-3 text-slate-900">Network</h4>
              <ul className="space-y-2 text-sm text-slate-500">
                <li className="font-mono text-xs">Chain: Base Sepolia (84532)</li>
                <li className="font-mono text-xs">Consensus: POUW</li>
                <li className="font-mono text-xs">Token: CLD (ERC-20)</li>
                <li className="font-mono text-xs">Status: Testnet</li>
              </ul>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-xs text-slate-400">&copy; 2026 Cloudana</p>
            <div className="flex items-center gap-4">
              <span className="font-mono text-xs text-slate-400 border border-slate-200 rounded px-2 py-0.5">
                Base Sepolia (84532)
              </span>
              <a href="https://x.com/cloudana10" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-slate-600">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
              </a>
              <a href="https://github.com/cloudana10" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-slate-600">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>
              </a>
              <a href="https://discord.com" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-slate-600">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189z"/></svg>
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
