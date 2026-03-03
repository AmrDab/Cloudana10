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
  TrendingUp,
  Database,
  Sparkles,
  Activity,
  CheckCircle
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";

export default function LandingPage() {
  const { isConnected } = useWallet();
  const { open } = useAppKit();
  const [, setLocation] = useLocation();

  if (isConnected) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-indigo-900/20 to-gray-900">
        {/* Animated Background */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl animate-float" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-cyan-600/10 rounded-full blur-3xl animate-float" style={{ animationDelay: '2s' }} />
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-72 h-72 bg-purple-600/10 rounded-full blur-3xl animate-float" style={{ animationDelay: '4s' }} />
        </div>

        <div className="relative flex flex-col items-center justify-center min-h-screen px-4 text-center">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-8 max-w-4xl"
          >
            {/* Status Badge */}
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2 }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 mb-6"
            >
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-sm font-medium tracking-wide">WALLET CONNECTED</span>
              <CheckCircle className="w-4 h-4" />
            </motion.div>

            {/* Hero Text */}
            <div className="space-y-6">
              <motion.h1 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="text-5xl md:text-7xl lg:text-8xl font-bold tracking-tight"
                style={{ fontFamily: 'Space Grotesk, sans-serif' }}
              >
                <span className="bg-gradient-to-r from-white via-gray-200 to-gray-400 bg-clip-text text-transparent">
                  Welcome to the
                </span>
                <br />
                <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent animate-gradient">
                  Future
                </span>
              </motion.h1>
              
              <motion.p 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="text-xl md:text-2xl text-gray-300 max-w-3xl mx-auto leading-relaxed"
              >
                Your wallet is connected. Choose your path in the decentralized compute revolution.
              </motion.p>
            </div>

            {/* Dashboard Cards */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-12 max-w-4xl mx-auto"
            >
              {/* User Dashboard Card */}
              <Link href="/user#home">
                <motion.div 
                  whileHover={{ scale: 1.02, y: -5 }}
                  whileTap={{ scale: 0.98 }}
                  className="card-glass card-hover-lift p-8 cursor-pointer group relative overflow-hidden"
                >
                  {/* Gradient Overlay */}
                  <div className="absolute inset-0 bg-gradient-to-br from-indigo-600/10 via-transparent to-purple-600/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  
                  <div className="relative">
                    <div className="flex items-center justify-between mb-6">
                      <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center group-hover:shadow-[0_0_30px_rgba(99,102,241,0.4)] transition-all duration-300">
                        <Cpu className="h-7 w-7 text-white" />
                      </div>
                      <ArrowRight className="h-6 w-6 text-indigo-400 opacity-0 group-hover:opacity-100 group-hover:translate-x-2 transition-all duration-300" />
                    </div>
                    
                    <h3 className="text-2xl font-bold mb-3 text-white group-hover:text-indigo-300 transition-colors">
                      User Dashboard
                    </h3>
                    <p className="text-gray-400 mb-6 leading-relaxed">
                      Deploy AI workloads, manage compute budgets, and track job progress across the decentralized network.
                    </p>
                    
                    {/* Feature Pills */}
                    <div className="flex flex-wrap gap-2">
                      <span className="px-3 py-1 bg-indigo-500/20 text-indigo-300 text-xs rounded-full border border-indigo-500/30">
                        Job Management
                      </span>
                      <span className="px-3 py-1 bg-purple-500/20 text-purple-300 text-xs rounded-full border border-purple-500/30">
                        AI/ML Workloads
                      </span>
                      <span className="px-3 py-1 bg-cyan-500/20 text-cyan-300 text-xs rounded-full border border-cyan-500/30">
                        Cost Tracking
                      </span>
                    </div>
                  </div>
                </motion.div>
              </Link>

              {/* Provider Dashboard Card */}
              <Link href="/providers">
                <motion.div 
                  whileHover={{ scale: 1.02, y: -5 }}
                  whileTap={{ scale: 0.98 }}
                  className="card-glass card-hover-lift p-8 cursor-pointer group relative overflow-hidden"
                >
                  {/* Gradient Overlay */}
                  <div className="absolute inset-0 bg-gradient-to-br from-cyan-600/10 via-transparent to-emerald-600/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  
                  <div className="relative">
                    <div className="flex items-center justify-between mb-6">
                      <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-cyan-500 to-emerald-600 flex items-center justify-center group-hover:shadow-[0_0_30px_rgba(6,182,212,0.4)] transition-all duration-300">
                        <Server className="h-7 w-7 text-white" />
                      </div>
                      <ArrowRight className="h-6 w-6 text-cyan-400 opacity-0 group-hover:opacity-100 group-hover:translate-x-2 transition-all duration-300" />
                    </div>
                    
                    <h3 className="text-2xl font-bold mb-3 text-white group-hover:text-cyan-300 transition-colors">
                      Provider Dashboard
                    </h3>
                    <p className="text-gray-400 mb-6 leading-relaxed">
                      Register your hardware, earn CLD tokens, and contribute to the global compute network.
                    </p>
                    
                    {/* Feature Pills */}
                    <div className="flex flex-wrap gap-2">
                      <span className="px-3 py-1 bg-cyan-500/20 text-cyan-300 text-xs rounded-full border border-cyan-500/30">
                        Hardware Registration
                      </span>
                      <span className="px-3 py-1 bg-emerald-500/20 text-emerald-300 text-xs rounded-full border border-emerald-500/30">
                        Earn CLD
                      </span>
                      <span className="px-3 py-1 bg-amber-500/20 text-amber-300 text-xs rounded-full border border-amber-500/30">
                        Global Network
                      </span>
                    </div>
                  </div>
                </motion.div>
              </Link>
            </motion.div>

            {/* Quick Stats */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-16 max-w-3xl mx-auto"
            >
              <div className="metric-card text-center">
                <Activity className="h-8 w-8 text-indigo-400 mx-auto mb-3" />
                <div className="text-2xl font-bold text-white mb-1">100+</div>
                <div className="text-sm text-gray-400">Global Providers</div>
              </div>
              
              <div className="metric-card text-center">
                <TrendingUp className="h-8 w-8 text-emerald-400 mx-auto mb-3" />
                <div className="text-2xl font-bold text-white mb-1">60-85%</div>
                <div className="text-sm text-gray-400">Cost Savings</div>
              </div>
              
              <div className="metric-card text-center">
                <Sparkles className="h-8 w-8 text-purple-400 mx-auto mb-3" />
                <div className="text-2xl font-bold text-white mb-1">24/7</div>
                <div className="text-sm text-gray-400">Availability</div>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-indigo-900/20 to-gray-900 relative overflow-hidden">
      {/* Animated Background Elements */}
      <div className="absolute inset-0">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl animate-float" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-cyan-600/10 rounded-full blur-3xl animate-float" style={{ animationDelay: '2s' }} />
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-72 h-72 bg-purple-600/10 rounded-full blur-3xl animate-float" style={{ animationDelay: '4s' }} />
        
        {/* Floating GPU Cards */}
        <div className="absolute top-20 left-20 opacity-10">
          <motion.div
            animate={{ y: [0, -20, 0], rotate: [0, 5, 0] }}
            transition={{ duration: 8, repeat: Infinity }}
            className="w-16 h-10 bg-gradient-to-r from-indigo-500 to-purple-600 rounded transform rotate-12"
          />
        </div>
        <div className="absolute bottom-20 right-20 opacity-10">
          <motion.div
            animate={{ y: [0, -15, 0], rotate: [0, -3, 0] }}
            transition={{ duration: 6, repeat: Infinity, delay: 2 }}
            className="w-20 h-12 bg-gradient-to-r from-cyan-500 to-emerald-600 rounded transform -rotate-12"
          />
        </div>
      </div>

      <div className="relative flex flex-col items-center justify-center min-h-screen px-4 text-center">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8 }}
          className="space-y-8 max-w-6xl"
        >
          {/* Status Badge */}
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="inline-block px-6 py-3 rounded-full border border-indigo-500/30 bg-indigo-500/10 backdrop-blur-sm text-sm font-medium text-indigo-300 mb-8"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              🚀 Cloudana Enterprise Testnet • Base Sepolia • Live
            </div>
          </motion.div>

          {/* Hero Text */}
          <div className="space-y-8">
            <motion.h1 
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="text-6xl md:text-8xl lg:text-9xl font-bold tracking-tight leading-[1.1]"
              style={{ fontFamily: 'Space Grotesk, sans-serif' }}
            >
              <span className="block bg-gradient-to-r from-white via-gray-200 to-gray-400 bg-clip-text text-transparent">
                Decentralized
              </span>
              <span className="block bg-gradient-to-r from-indigo-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent animate-gradient">
                Compute
              </span>
              <span className="block bg-gradient-to-r from-cyan-400 via-emerald-400 to-indigo-400 bg-clip-text text-transparent">
                Revolution
              </span>
            </motion.h1>

            <motion.p 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              className="text-xl md:text-2xl lg:text-3xl text-gray-300 max-w-4xl mx-auto leading-relaxed font-light"
            >
              Enterprise-grade decentralized infrastructure for AI/ML workloads. 
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-cyan-400 font-medium">
                60-85% cost savings
              </span> vs traditional cloud.
            </motion.p>
          </div>

          {/* CTA Buttons */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-6 pt-8"
          >
            <Button 
              size="lg" 
              onClick={() => open()}
              className="btn-primary-glow h-16 px-8 text-lg font-semibold w-full sm:w-auto min-w-[200px]"
              data-testid="button-connect-wallet"
            >
              <Zap className="mr-2 h-5 w-5" />
              Connect Wallet
            </Button>
            
            <Link href="/user#templates">
              <Button 
                variant="outline" 
                size="lg" 
                className="btn-ghost-enterprise h-16 px-8 text-lg font-semibold w-full sm:w-auto min-w-[200px]"
                data-testid="button-explore-jobs"
              >
                <Globe className="mr-2 h-5 w-5" />
                Explore Network
              </Button>
            </Link>
          </motion.div>

          {/* Feature Grid */}
          <motion.div 
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.0 }}
            className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-20 max-w-5xl mx-auto"
          >
            {[
              {
                icon: Zap,
                title: "Instant Provisioning",
                description: "Deploy AI workloads to 100+ global providers in seconds via smart contracts",
                color: "indigo"
              },
              {
                icon: ShieldCheck,
                title: "Cryptographic Verification", 
                description: "Mathematical proofs ensure compute integrity and trustless execution",
                color: "emerald"
              },
              {
                icon: Layers,
                title: "Multi-Tier Architecture",
                description: "From web hosting to GPU-accelerated ML training, all workloads supported",
                color: "purple"
              }
            ].map((feature, index) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.2 + index * 0.1 }}
                className="card-glass p-8 text-left hover:scale-105 transition-all duration-300 group"
              >
                <div className={`h-12 w-12 rounded-xl mb-6 flex items-center justify-center bg-gradient-to-br ${
                  feature.color === 'indigo' ? 'from-indigo-500 to-purple-600' :
                  feature.color === 'emerald' ? 'from-emerald-500 to-cyan-600' :
                  'from-purple-500 to-pink-600'
                } group-hover:shadow-lg transition-all duration-300`}>
                  <feature.icon className="h-6 w-6 text-white" />
                </div>
                <h3 className="text-xl font-bold text-white mb-4">{feature.title}</h3>
                <p className="text-gray-400 leading-relaxed">{feature.description}</p>
              </motion.div>
            ))}
          </motion.div>

          {/* Live Stats */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.4 }}
            className="grid grid-cols-2 md:grid-cols-4 gap-6 pt-16 max-w-4xl mx-auto"
          >
            {[
              { label: "Global Providers", value: "100+", icon: Server },
              { label: "Jobs Processed", value: "1.2K+", icon: Activity },
              { label: "Cost Savings", value: "85%", icon: TrendingUp },
              { label: "Uptime", value: "99.9%", icon: Database }
            ].map((stat, index) => (
              <div key={stat.label} className="metric-card text-center group">
                <stat.icon className="h-6 w-6 text-indigo-400 mx-auto mb-2 group-hover:scale-110 transition-transform duration-200" />
                <div className="text-xl md:text-2xl font-bold text-white mb-1">{stat.value}</div>
                <div className="text-xs text-gray-400 uppercase tracking-wide">{stat.label}</div>
              </div>
            ))}
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}