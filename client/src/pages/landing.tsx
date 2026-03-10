import { Button } from "@/components/ui/button";
import { useWallet } from "@/context/wallet-context";
import { useAppKit } from "@reown/appkit/react";
import { motion } from "framer-motion";
import {
  ArrowRight, Cpu, ShieldCheck, Server, Hash, BookOpen,
  ChevronRight, Globe, Monitor, HardDrive, Bot, BarChart3, Cloud,
  TrendingDown, Zap, DollarSign,
} from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i = 0) => ({ opacity: 1, y: 0, transition: { delay: i * 0.08, duration: 0.5 } }),
};

const SERVICES = [
  { icon: Globe,     color: "text-primary",    bg: "bg-primary/10",    title: "Web Hosting" },
  { icon: Monitor,   color: "text-blue-400",   bg: "bg-blue-500/10",   title: "VPS / VMs" },
  { icon: HardDrive, color: "text-purple-400", bg: "bg-purple-500/10", title: "Bare Metal" },
  { icon: Bot,       color: "text-green-400",  bg: "bg-green-500/10",  title: "AI & ML" },
  { icon: BarChart3, color: "text-yellow-400", bg: "bg-yellow-500/10", title: "Batch Jobs" },
  { icon: Cloud,     color: "text-red-400",    bg: "bg-red-500/10",    title: "Databases" },
];

const HOW_IT_WORKS = [
  {
    n: "01",
    title: "Browse available hardware",
    desc: "See every registered provider — GPU model, CPU, RAM, location, and live price per hour. Sorted by best value automatically.",
  },
  {
    n: "02",
    title: "Pick a plan, deploy instantly",
    desc: "Choose a provider that fits your workload. One click deploys your container, VPS, or service. No configuration, no sales calls.",
  },
  {
    n: "03",
    title: "Pay a fixed market rate",
    desc: "Prices are set by providers and shift with network supply and demand — always transparent, always on-chain. You see the exact CLD/hr before you commit.",
  },
];

export default function LandingPage() {
  const { isConnected } = useWallet();
  const { open } = useAppKit();

  if (isConnected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-8">
        <motion.div initial="hidden" animate="visible" variants={fadeUp} className="space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-green-500/10 text-green-500 border border-green-500/20 mb-4">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs font-mono uppercase tracking-wider">Wallet Connected</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Welcome to Cloudana</h1>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto">
            Deploy to the best-value provider or register your hardware to start earning.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-2xl">
          <Link href="/user#home">
            <motion.div
              whileHover={{ scale: 1.02 }}
              className="p-6 rounded-xl bg-card border border-white/10 cursor-pointer hover:border-primary/40 hover:shadow-[0_0_30px_rgba(6,182,212,0.1)] transition-all group text-left"
            >
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                <Cpu className="h-5 w-5 text-primary" />
              </div>
              <h3 className="text-lg font-bold mb-1">Deploy a Workload</h3>
              <p className="text-sm text-muted-foreground mb-4">Browse providers by price, pick the best deal, deploy in one click.</p>
              <div className="flex items-center text-primary text-sm font-medium">
                Open Dashboard <ArrowRight className="ml-1.5 h-4 w-4 group-hover:translate-x-1 transition-transform" />
              </div>
            </motion.div>
          </Link>
          <Link href="/providers">
            <motion.div
              whileHover={{ scale: 1.02 }}
              className="p-6 rounded-xl bg-card border border-white/10 cursor-pointer hover:border-white/20 hover:shadow-[0_0_30px_rgba(255,255,255,0.04)] transition-all group text-left"
            >
              <div className="h-10 w-10 rounded-lg bg-white/5 flex items-center justify-center mb-4 group-hover:bg-white/10 transition-colors">
                <Server className="h-5 w-5" />
              </div>
              <h3 className="text-lg font-bold mb-1">List Your Hardware</h3>
              <p className="text-sm text-muted-foreground mb-4">Set your price, register your node, earn from hosting and POUW mining.</p>
              <div className="flex items-center text-sm font-medium">
                Become a Provider <ArrowRight className="ml-1.5 h-4 w-4 group-hover:translate-x-1 transition-transform" />
              </div>
            </motion.div>
          </Link>
        </div>

        <div className="flex items-center gap-4 flex-wrap justify-center">
          <Link href="/pricing/gpus">
            <Button variant="outline" size="sm" className="border-white/10 hover:bg-white/5 gap-2">
              <DollarSign className="h-4 w-4 text-primary" /> View Pricing
            </Button>
          </Link>
          <Link href="/mining">
            <Button variant="outline" size="sm" className="border-white/10 hover:bg-white/5 gap-2">
              <Hash className="h-4 w-4 text-green-400" /> Mining
            </Button>
          </Link>
          <Link href="/docs">
            <Button variant="outline" size="sm" className="border-white/10 hover:bg-white/5 gap-2">
              <BookOpen className="h-4 w-4 text-muted-foreground" /> Docs
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col items-center">
      {/* Background glow */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-primary/7 rounded-full blur-[140px]" />
      </div>

      {/* Hero */}
      <div className="flex flex-col items-center text-center pt-12 pb-14 px-4 max-w-4xl w-full">
        <motion.div initial="hidden" animate="visible" custom={0} variants={fadeUp}>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-white/10 bg-white/5 text-xs font-mono text-muted-foreground mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            Testnet live · Base Sepolia
          </div>
        </motion.div>

        <motion.h1
          initial="hidden" animate="visible" custom={1} variants={fadeUp}
          className="text-5xl md:text-7xl font-bold tracking-tight leading-[1.06] mb-5"
        >
          <span className="bg-clip-text text-transparent bg-gradient-to-b from-white to-white/55">
            The open cloud<br />
            <span className="text-primary">marketplace</span>
          </span>
        </motion.h1>

        <motion.p
          initial="hidden" animate="visible" custom={2} variants={fadeUp}
          className="text-lg md:text-xl text-muted-foreground max-w-2xl leading-relaxed mb-3"
        >
          Providers list their hardware at a price. You pick the best deal and deploy — VPS, web hosting,
          AI compute, databases, batch jobs. Prices are market-driven, fully transparent, fixed per hour.
        </motion.p>

        <motion.p
          initial="hidden" animate="visible" custom={3} variants={fadeUp}
          className="text-sm text-muted-foreground/60 max-w-lg leading-relaxed mb-10"
        >
          No sales calls. No hidden fees. No egress charges. You see the exact CLD/hr before you commit.
        </motion.p>

        <motion.div
          initial="hidden" animate="visible" custom={4} variants={fadeUp}
          className="flex flex-col sm:flex-row items-center gap-3 mb-8"
        >
          <Button
            size="lg"
            onClick={() => open()}
            className="h-12 px-8 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_0_40px_rgba(6,182,212,0.35)] hover:shadow-[0_0_60px_rgba(6,182,212,0.5)] transition-all duration-300"
          >
            Start Deploying
          </Button>
          <Link href="/pricing/gpus">
            <Button
              variant="outline"
              size="lg"
              className="h-12 px-8 rounded-full border-white/10 hover:bg-white/5 hover:border-white/20 gap-2"
            >
              <DollarSign className="h-4 w-4" /> See Live Prices
            </Button>
          </Link>
        </motion.div>

        {/* Price preview chips */}
        <motion.div
          initial="hidden" animate="visible" custom={5} variants={fadeUp}
          className="flex flex-wrap justify-center gap-2"
        >
          {[
            { label: "RTX 4090", price: "~$1.20/hr" },
            { label: "A100 80GB", price: "~$2.80/hr" },
            { label: "VPS 4vCPU", price: "~$0.08/hr" },
            { label: "H100 SXM", price: "~$3.50/hr" },
          ].map(({ label, price }) => (
            <div key={label} className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-mono font-semibold text-primary">{price}</span>
            </div>
          ))}
          <div className="flex items-center px-3 py-1.5 rounded-full bg-white/3 border border-white/8 text-xs text-muted-foreground/60">
            +hundreds more
          </div>
        </motion.div>
      </div>

      {/* How it works */}
      <motion.div
        initial="hidden" animate="visible" custom={6} variants={fadeUp}
        className="w-full max-w-4xl px-4 pb-14"
      >
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest text-center mb-8">
          How it works
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {HOW_IT_WORKS.map(({ n, title, desc }) => (
            <div key={n} className="p-5 rounded-xl bg-card/50 border border-white/8 hover:border-white/14 transition-all">
              <span className="font-mono text-2xl font-bold text-primary/30 mb-3 block">{n}</span>
              <h3 className="font-semibold mb-2 text-sm">{title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Run anything */}
      <motion.div
        initial="hidden" animate="visible" custom={7} variants={fadeUp}
        className="w-full max-w-4xl px-4 pb-14"
      >
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest text-center mb-6">
          Run anything
        </p>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          {SERVICES.map(({ icon: Icon, color, bg, title }) => (
            <div key={title} className="flex flex-col items-center gap-2 p-4 rounded-xl bg-card/40 border border-white/8 hover:border-white/15 hover:bg-card/60 transition-all cursor-default">
              <div className={`h-9 w-9 rounded-lg ${bg} flex items-center justify-center`}>
                <Icon className={`h-4 w-4 ${color}`} />
              </div>
              <span className="text-xs font-medium text-center leading-tight">{title}</span>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Key benefits */}
      <motion.div
        initial="hidden" animate="visible" custom={8} variants={fadeUp}
        className="w-full max-w-4xl px-4 pb-14"
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-5 rounded-xl bg-card/40 border border-white/8 space-y-3">
            <div className="h-9 w-9 rounded-lg bg-green-500/10 flex items-center justify-center">
              <TrendingDown className="h-5 w-5 text-green-400" />
            </div>
            <h3 className="font-semibold">Market-driven pricing</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Providers compete. Supply and demand set rates automatically. You always get the market
              price — never an inflated AWS markup.
            </p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {["Fixed hourly rate", "No egress fees", "No minimums"].map(f => (
                <Badge key={f} variant="outline" className="text-xs border-white/10 text-muted-foreground">{f}</Badge>
              ))}
            </div>
          </div>

          <div className="p-5 rounded-xl bg-card/40 border border-white/8 space-y-3">
            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <Zap className="h-5 w-5 text-primary" />
            </div>
            <h3 className="font-semibold">Plug and play</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Choose a provider, submit your workload, deploy. No account approval,
              no credit card, no onboarding call. Just a wallet and CLD tokens.
            </p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {["One-click deploy", "SDL manifest", "Instant provisioning"].map(f => (
                <Badge key={f} variant="outline" className="text-xs border-white/10 text-muted-foreground">{f}</Badge>
              ))}
            </div>
          </div>

          <div className="p-5 rounded-xl bg-card/40 border border-white/8 space-y-3">
            <div className="h-9 w-9 rounded-lg bg-purple-500/10 flex items-center justify-center">
              <ShieldCheck className="h-5 w-5 text-purple-400" />
            </div>
            <h3 className="font-semibold">Verifiable & censorship-free</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Smart contracts escrow payment and release only when work is confirmed.
              No central authority can deplatform your workload or change pricing retroactively.
            </p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {["On-chain escrow", "POUW proofs", "No deplatforming"].map(f => (
                <Badge key={f} variant="outline" className="text-xs border-white/10 text-muted-foreground">{f}</Badge>
              ))}
            </div>
          </div>
        </div>
      </motion.div>

      {/* Provider CTA */}
      <motion.div
        initial="hidden" animate="visible" custom={9} variants={fadeUp}
        className="w-full max-w-4xl px-4 pb-10"
      >
        <div className="rounded-xl border border-white/10 bg-gradient-to-br from-primary/8 via-card/40 to-card/30 p-7 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2 mb-1">
              <Server className="h-4 w-4 text-primary" />
              <span className="text-xs font-semibold text-primary uppercase tracking-widest">For providers</span>
            </div>
            <h3 className="font-bold text-lg">Turn idle hardware into income</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              Set your price, register your node. Earn CLD from hosting user workloads
              and POUW mining — both streams run simultaneously with zero extra effort.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              {["Web hosting", "VPS", "GPU compute", "Bare metal", "Any hardware"].map(t => (
                <Badge key={t} variant="outline" className="text-xs border-primary/20 text-primary/70">{t}</Badge>
              ))}
            </div>
          </div>
          <div className="flex gap-3 shrink-0">
            <Link href="/docs">
              <Button variant="outline" size="sm" className="border-white/10 hover:bg-white/5">
                Learn More
              </Button>
            </Link>
            <Button size="sm" onClick={() => open()} className="bg-primary text-primary-foreground hover:bg-primary/90">
              List Hardware <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
