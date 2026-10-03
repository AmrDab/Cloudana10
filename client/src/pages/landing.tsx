import { useWallet } from "@/context/wallet-context";
import { useAppKit } from "@reown/appkit/react";
import { motion } from "framer-motion";

/** Landing page renders outside the wouter Router — use plain <a> with /control prefix */
function Link({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  return <a href={`/control${href}`} className={className}>{children}</a>;
}
import { Server, ArrowRight, Cpu } from "lucide-react";

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

/* ─── SIGN-IN GATEWAY (brand tokens mirror public/landing.html) ─── */
const SANS = '"Space Grotesk", system-ui, sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, monospace';
const LINE = "rgba(148,163,184,.12)";
const GRID_MASK = "radial-gradient(90% 70% at 50% 30%, #000 20%, transparent 75%)";

export default function LandingPage() {
  const { isConnected } = useWallet();
  const { open } = useAppKit();

  if (isConnected) return <ConnectedView />;

  return (
    <div
      className="relative min-h-screen overflow-x-hidden flex items-center justify-center px-4"
      style={{ background: "#07090D", color: "#E6EAF0", fontFamily: SANS }}
    >
      {/* React 19 hoists this into <head>; falls back to system fonts if blocked */}
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500&family=IBM+Plex+Mono:wght@400;500&display=swap"
        precedence="default"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0"
        style={{
          opacity: 0.5,
          backgroundImage: `linear-gradient(${LINE} 1px, transparent 1px), linear-gradient(90deg, ${LINE} 1px, transparent 1px)`,
          backgroundSize: "64px 64px",
          maskImage: GRID_MASK,
          WebkitMaskImage: GRID_MASK,
        }}
      />

      <main className="relative z-10 w-full max-w-xl text-center">
        <svg className="mx-auto mb-6" width="44" height="44" viewBox="0 0 26 26" aria-hidden="true">
          <rect x="1" y="1" width="24" height="24" rx="6" fill="none" stroke="#3FD6C2" strokeWidth="1.5" />
          <rect x="6" y="6" width="6" height="6" rx="1.5" fill="#F2A93B" />
          <rect x="14" y="6" width="6" height="6" rx="1.5" fill="#3FD6C2" opacity=".5" />
          <rect x="6" y="14" width="6" height="6" rx="1.5" fill="#3FD6C2" opacity=".5" />
          <rect x="14" y="14" width="6" height="6" rx="1.5" fill="#3FD6C2" />
        </svg>

        <h1 className="text-[32px] sm:text-[40px] leading-tight tracking-[-0.02em] mb-3" style={{ fontWeight: 500 }}>
          Cloudana Console
        </h1>
        <p className="mb-8 text-[15px] leading-relaxed" style={{ color: "#8B95A7" }}>
          Connect a wallet to deploy workloads or register a provider node.
        </p>

        <button
          onClick={() => open()}
          className="px-6 py-3 rounded-lg text-sm font-medium transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          style={{ background: "#3FD6C2", color: "#07090D", outlineColor: "#3FD6C2" }}
        >
          Connect Wallet
        </button>

        <div
          className="mt-10 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-xs"
          style={{ fontFamily: MONO, color: "#8B95A7" }}
        >
          <a href="https://cloudana.io" className="hover:text-[#E6EAF0] transition-colors">← cloudana.io</a>
          <span aria-hidden="true">·</span>
          <a href="https://cloudana.io/litepaper" className="hover:text-[#E6EAF0] transition-colors">Litepaper</a>
          <span aria-hidden="true">·</span>
          <span
            className="rounded-full px-2.5 py-0.5"
            style={{ color: "#F2A93B", border: "1px solid rgba(242,169,59,.35)", background: "rgba(242,169,59,.08)" }}
          >
            Testnet · Base Sepolia
          </span>
        </div>
      </main>
    </div>
  );
}
