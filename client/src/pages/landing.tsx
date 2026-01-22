import { Button } from "@/components/ui/button";
import { useWallet } from "@/context/wallet-context";
import { useAppKit } from "@reown/appkit/react";
import { motion } from "framer-motion";
import { ArrowRight, Cpu, Layers, ShieldCheck, Zap, Server } from "lucide-react";
import { Link, useLocation } from "wouter";

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
          <Link href="/user">
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
    <div className="flex flex-col items-center justify-center min-h-[70vh] text-center">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-background to-background opacity-50" />
      
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="space-y-6 max-w-3xl px-4"
      >
        <div className="inline-block px-4 py-1.5 rounded-full border border-white/10 bg-white/5 backdrop-blur-sm text-sm font-medium text-muted-foreground mb-4">
          🚀 Cloudana MVP Testnet Live on Base Sepolia
        </div>

        <h1 className="text-5xl md:text-7xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-b from-white to-white/50 leading-[1.1]">
          Decentralized Compute <br />
          <span className="text-primary">Operating System</span>
        </h1>

        <p className="text-xl md:text-2xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
          Connect your wallet to provision verifiable compute resources or monetize your hardware.
        </p>

        <div className="pt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
          <Button 
            size="lg" 
            onClick={() => open()}
            className="h-14 px-8 text-lg rounded-full bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_0_40px_rgba(6,182,212,0.4)] hover:shadow-[0_0_60px_rgba(6,182,212,0.6)] transition-all duration-300 w-full sm:w-auto"
            data-testid="button-connect-wallet"
          >
            Connect Wallet to Start
          </Button>
          <Link href="/user#templates">
            <Button 
              variant="outline" 
              size="lg" 
              className="h-14 px-8 text-lg rounded-full border-white/10 hover:bg-white/5 hover:border-white/20 w-full sm:w-auto"
              data-testid="button-explore-jobs"
            >
              Explore Works
            </Button>
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-20 text-left">
          <div className="space-y-3 p-4 rounded-lg hover:bg-white/5 transition-colors">
            <Zap className="h-8 w-8 text-primary" />
            <h3 className="font-bold text-lg">Instant Provisioning</h3>
            <p className="text-sm text-muted-foreground">Access global compute resources in seconds via smart contract coordination.</p>
          </div>
          <div className="space-y-3 p-4 rounded-lg hover:bg-white/5 transition-colors">
            <ShieldCheck className="h-8 w-8 text-primary" />
            <h3 className="font-bold text-lg">Verifiable Compute</h3>
            <p className="text-sm text-muted-foreground">Cryptographic proofs ensure you get exactly what you pay for.</p>
          </div>
          <div className="space-y-3 p-4 rounded-lg hover:bg-white/5 transition-colors">
            <Layers className="h-8 w-8 text-primary" />
            <h3 className="font-bold text-lg">Provider Agnostic</h3>
            <p className="text-sm text-muted-foreground">Any hardware, anywhere. From bare metal to edge devices.</p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
