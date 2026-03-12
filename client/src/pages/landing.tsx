import { Button } from "@/components/ui/button";
import { useWallet } from "@/context/wallet-context";
import { useAppKit } from "@reown/appkit/react";
import { motion } from "framer-motion";
import { 
  ArrowRight, 
  Cpu, 
  Layers, 
  ShieldCheck, 
  Zap, 
  Server, 
  Globe, 
  DollarSign, 
  Clock, 
  Lock,
  Gauge,
  Cloud,
  Database,
  Bot,
  BarChart3,
  Check
} from "lucide-react";
import { Link, useLocation } from "wouter";

const stats = [
  { value: "99.99%", label: "Uptime SLA", icon: Clock },
  { value: "200+", label: "Global Nodes", icon: Globe },
  { value: "70%", label: "Cost Savings", icon: DollarSign },
  { value: "<50ms", label: "Avg Latency", icon: Gauge },
];

const features = [
  {
    icon: Zap,
    title: "Instant Provisioning",
    description: "Deploy workloads in seconds. No waiting for VM spin-up — containers launch globally via smart contract coordination.",
  },
  {
    icon: ShieldCheck,
    title: "Verifiable Compute",
    description: "Proof of Useful Work ensures cryptographic verification. You only pay for compute that's provably executed.",
  },
  {
    icon: Layers,
    title: "Provider Agnostic",
    description: "Any hardware, anywhere. From enterprise GPUs to edge Raspberry Pis — all unified under one protocol.",
  },
  {
    icon: DollarSign,
    title: "70% Cheaper Than AWS",
    description: "No middleman markup. Providers set competitive rates, you bid for the best price. Transparent on-chain pricing.",
  },
  {
    icon: Lock,
    title: "No Vendor Lock-in",
    description: "Open protocol, portable workloads. Switch providers instantly without rewriting your stack.",
  },
  {
    icon: Globe,
    title: "Global Edge Network",
    description: "200+ nodes across 26 countries. Auto-scaling, geo-routing, and redundancy built into the protocol.",
  },
];

const useCases = [
  {
    icon: Bot,
    title: "AI/ML Inference",
    description: "Deploy LLMs and ML models at the edge. Access A100s, H100s, RTX 4090s on-demand with <50ms latency.",
    tag: "GPU Compute",
  },
  {
    icon: Cloud,
    title: "Web Hosting",
    description: "Edge-deployed, auto-scaling web apps. SSL and CDN auto-configured. One command deployment.",
    tag: "Edge",
  },
  {
    icon: Database,
    title: "Cloud Storage",
    description: "S3-compatible, globally replicated storage. No egress fees, no surprise bills.",
    tag: "Storage",
  },
  {
    icon: Server,
    title: "VPS & Containers",
    description: "Spin up Linux containers or full VMs. SSH access, persistent storage, static IPs available.",
    tag: "Compute",
  },
];

const comparisonPoints = [
  "No credit card required",
  "Pay only for what you use",
  "No minimum commitments",
  "Instant global deployment",
  "Cryptographic verification",
  "Open-source protocol",
];

export default function LandingPage() {
  const { isConnected } = useWallet();
  const { open } = useAppKit();
  const [, setLocation] = useLocation();

  if (isConnected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-8">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-green-500/10 text-green-500 border border-green-500/20 mb-4">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs font-mono uppercase tracking-wider">Wallet Connected</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Welcome to the Testnet</h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Your wallet is connected. Choose a dashboard to proceed.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-3xl">
          <Link href="/user#home">
            <motion.div 
              whileHover={{ scale: 1.02, borderColor: "hsl(var(--primary))" }}
              className="p-8 rounded-xl bg-card border border-white/5 cursor-pointer hover:shadow-[0_0_30px_rgba(6,182,212,0.15)] transition-all group"
            >
              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                <Cpu className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-2xl font-bold mb-2">User Dashboard</h3>
              <p className="text-muted-foreground mb-4">Create jobs, manage compute budgets, and track progress.</p>
              <div className="flex items-center text-primary font-medium">
                Enter Dashboard <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
              </div>
            </motion.div>
          </Link>

          <Link href="/providers">
            <motion.div 
              whileHover={{ scale: 1.02, borderColor: "hsl(var(--secondary-foreground))" }}
              className="p-8 rounded-xl bg-card border border-white/5 cursor-pointer hover:shadow-[0_0_30px_rgba(255,255,255,0.05)] transition-all group"
            >
              <div className="h-12 w-12 rounded-lg bg-white/5 flex items-center justify-center mb-4 group-hover:bg-white/10 transition-colors">
                <Server className="h-6 w-6 text-foreground" />
              </div>
              <h3 className="text-2xl font-bold mb-2">Provider Dashboard</h3>
              <p className="text-muted-foreground mb-4">Register your node, view assigned jobs, and withdraw earnings.</p>
              <div className="flex items-center text-foreground font-medium">
                Manage Node <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
              </div>
            </motion.div>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center">
      {/* Hero Section */}
      <div className="relative w-full flex flex-col items-center justify-center min-h-[85vh] text-center">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/20 via-background to-background" />
        <div className="absolute inset-0 -z-10 bg-[url('/grid.svg')] bg-center [mask-image:linear-gradient(180deg,white,rgba(255,255,255,0))]" />
        
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="space-y-6 max-w-4xl px-4"
        >
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/30 bg-primary/10 backdrop-blur-sm text-sm font-medium text-primary mb-4">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            MVP Testnet Live on Base Sepolia
          </div>

          <h1 className="text-5xl md:text-7xl font-bold tracking-tight leading-[1.1]">
            <span className="bg-clip-text text-transparent bg-gradient-to-b from-white to-white/60">
              The Decentralized
            </span>
            <br />
            <span className="text-primary">Cloud Platform</span>
          </h1>

          <p className="text-xl md:text-2xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Deploy AI models, web apps, and workloads to a global network of providers.
            <span className="text-foreground font-medium"> 70% cheaper than AWS.</span>
            {" "}Cryptographically verified.
          </p>

          {/* Stats Bar */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-8 pb-4 max-w-3xl mx-auto">
            {stats.map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 * i }}
                className="flex flex-col items-center p-4 rounded-lg bg-white/5 border border-white/10"
              >
                <stat.icon className="h-5 w-5 text-primary mb-2" />
                <div className="text-2xl md:text-3xl font-bold text-foreground">{stat.value}</div>
                <div className="text-xs text-muted-foreground uppercase tracking-wider">{stat.label}</div>
              </motion.div>
            ))}
          </div>

          <div className="pt-6 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button 
              size="lg" 
              onClick={() => open()}
              className="h-14 px-8 text-lg rounded-full bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_0_40px_rgba(6,182,212,0.4)] hover:shadow-[0_0_60px_rgba(6,182,212,0.6)] transition-all duration-300 w-full sm:w-auto"
              data-testid="button-connect-wallet"
            >
              Start Deploying — Free
            </Button>
            <Link href="/pricing">
              <Button 
                variant="outline" 
                size="lg" 
                className="h-14 px-8 text-lg rounded-full border-white/10 hover:bg-white/5 hover:border-white/20 w-full sm:w-auto"
              >
                See Pricing
              </Button>
            </Link>
          </div>

          <p className="text-sm text-muted-foreground pt-2">
            No credit card required • Pay with crypto • Cancel anytime
          </p>
        </motion.div>
      </div>

      {/* Features Grid */}
      <section className="w-full max-w-6xl px-4 py-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Everything you need to deploy at scale
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Built for developers who want cloud infrastructure without the complexity, lock-in, or surprise bills.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, i) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 * i }}
              className="p-6 rounded-xl bg-card border border-white/5 hover:border-primary/20 hover:bg-white/5 transition-all group"
            >
              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                <feature.icon className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-xl font-bold mb-2">{feature.title}</h3>
              <p className="text-muted-foreground">{feature.description}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Use Cases */}
      <section className="w-full bg-gradient-to-b from-background via-primary/5 to-background py-20">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Deploy anything, anywhere
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              From AI inference to web hosting, Cloudana handles your workloads with enterprise reliability.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {useCases.map((useCase, i) => (
              <motion.div
                key={useCase.title}
                initial={{ opacity: 0, x: i % 2 === 0 ? -20 : 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                className="p-6 rounded-xl bg-card/50 border border-white/5 hover:border-primary/20 transition-all"
              >
                <div className="flex items-start gap-4">
                  <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <useCase.icon className="h-6 w-6 text-primary" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="text-xl font-bold">{useCase.title}</h3>
                      <span className="px-2 py-0.5 text-xs rounded-full bg-primary/10 text-primary border border-primary/20">
                        {useCase.tag}
                      </span>
                    </div>
                    <p className="text-muted-foreground">{useCase.description}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Comparison Section */}
      <section className="w-full max-w-6xl px-4 py-20">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Why developers choose Cloudana
            </h2>
            <p className="text-lg text-muted-foreground mb-8">
              We're not just another cloud provider. We're building the infrastructure layer for a decentralized internet.
            </p>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {comparisonPoints.map((point) => (
                <div key={point} className="flex items-center gap-2">
                  <div className="h-5 w-5 rounded-full bg-green-500/20 flex items-center justify-center">
                    <Check className="h-3 w-3 text-green-500" />
                  </div>
                  <span className="text-foreground">{point}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card rounded-xl border border-white/10 p-6">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              Cost Comparison (Monthly)
            </h3>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-muted-foreground">AWS EC2 (t3.medium)</span>
                  <span className="font-mono">$30.00</span>
                </div>
                <div className="h-3 bg-red-500/20 rounded-full">
                  <div className="h-full bg-red-500 rounded-full" style={{ width: "100%" }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-muted-foreground">Google Cloud (e2-medium)</span>
                  <span className="font-mono">$28.00</span>
                </div>
                <div className="h-3 bg-yellow-500/20 rounded-full">
                  <div className="h-full bg-yellow-500 rounded-full" style={{ width: "93%" }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-primary font-medium">Cloudana (equivalent)</span>
                  <span className="font-mono text-primary font-bold">$9.00</span>
                </div>
                <div className="h-3 bg-primary/20 rounded-full">
                  <div className="h-full bg-primary rounded-full" style={{ width: "30%" }} />
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              * Based on 2 vCPU, 4GB RAM, 50GB storage. Actual prices vary by provider bids.
            </p>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="w-full bg-gradient-to-r from-primary/10 via-primary/20 to-primary/10 py-20">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Ready to deploy?
          </h2>
          <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
            Join the testnet today. Connect your wallet and deploy your first workload in under 5 minutes.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button 
              size="lg" 
              onClick={() => open()}
              className="h-14 px-8 text-lg rounded-full bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_0_40px_rgba(6,182,212,0.4)] transition-all"
            >
              Connect Wallet to Start
            </Button>
            <Link href="/docs">
              <Button 
                variant="outline" 
                size="lg" 
                className="h-14 px-8 text-lg rounded-full border-white/20 hover:bg-white/5"
              >
                Read the Docs
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer Stats */}
      <section className="w-full max-w-6xl px-4 py-16">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          <div>
            <div className="text-4xl font-bold text-foreground">200+</div>
            <div className="text-muted-foreground">Nodes Online</div>
          </div>
          <div>
            <div className="text-4xl font-bold text-foreground">26</div>
            <div className="text-muted-foreground">Countries</div>
          </div>
          <div>
            <div className="text-4xl font-bold text-foreground">99.99%</div>
            <div className="text-muted-foreground">Uptime</div>
          </div>
          <div>
            <div className="text-4xl font-bold text-foreground">$0.002</div>
            <div className="text-muted-foreground">Per Request</div>
          </div>
        </div>
      </section>
    </div>
  );
}
