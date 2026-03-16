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
  { value: "Live", label: "Base Sepolia", icon: Clock },
  { value: "Open", label: "Provider Signups", icon: Globe },
  { value: "~70%", label: "vs. AWS Pricing", icon: DollarSign },
  { value: "POUW", label: "Consensus", icon: Gauge },
];

const features = [
  {
    icon: Zap,
    title: "Fast Deployments",
    description: "Pick a template or bring your own container. The orchestrator matches you to a provider and deploys in seconds.",
  },
  {
    icon: ShieldCheck,
    title: "Proof of Useful Work",
    description: "Providers prove they're doing real computation. Every workload is verified on-chain before rewards are paid out.",
  },
  {
    icon: Layers,
    title: "Any Hardware",
    description: "Datacenter GPUs, home servers, spare laptops. If it runs Linux, it can join the network as a provider.",
  },
  {
    icon: DollarSign,
    title: "Cheaper Compute",
    description: "No middleman markup. Providers set their own rates. On-chain pricing means no surprise bills.",
  },
  {
    icon: Lock,
    title: "No Lock-in",
    description: "Standard containers, open protocol. Move your workloads between providers without changing your code.",
  },
  {
    icon: Globe,
    title: "Decentralized Network",
    description: "Providers run their own nodes. No single point of failure, no central authority controlling your infrastructure.",
  },
];

const useCases = [
  {
    icon: Bot,
    title: "AI/ML Inference",
    description: "Run LLMs and ML models on GPU providers. Access consumer and enterprise GPUs on-demand.",
    tag: "GPU Compute",
  },
  {
    icon: Cloud,
    title: "Web Apps",
    description: "Deploy web applications and APIs. Containers are placed on the closest available provider.",
    tag: "Edge",
  },
  {
    icon: Database,
    title: "Databases",
    description: "Run PostgreSQL, MongoDB, Redis, or any database as a container with persistent storage.",
    tag: "Storage",
  },
  {
    icon: Server,
    title: "Containers",
    description: "Any Docker container works. Bring your own image or pick from the template gallery.",
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
            Deploy containers to a decentralized network of providers.
            <span className="text-foreground font-medium"> Pay less than AWS.</span>
            {" "}Every workload verified on-chain.
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
              Start Deploying
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
            How it works
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Providers supply hardware. Users deploy workloads. Smart contracts handle the rest.
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
              Anything that runs in a Docker container can run on Cloudana.
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
              Traditional cloud locks you in. Cloudana is an open marketplace where anyone can provide or consume compute.
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
            <div className="text-4xl font-bold text-foreground">7</div>
            <div className="text-muted-foreground">Smart Contracts</div>
          </div>
          <div>
            <div className="text-4xl font-bold text-foreground">Base</div>
            <div className="text-muted-foreground">Sepolia Testnet</div>
          </div>
          <div>
            <div className="text-4xl font-bold text-foreground">POUW</div>
            <div className="text-muted-foreground">Verified Compute</div>
          </div>
          <div>
            <div className="text-4xl font-bold text-foreground">Free</div>
            <div className="text-muted-foreground">Testnet Tokens</div>
          </div>
        </div>
      </section>
    </div>
  );
}
