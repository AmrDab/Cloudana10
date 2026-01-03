import { Link, useLocation } from "wouter";
import { useWallet } from "@/context/wallet-context";
import { 
  LayoutDashboard, 
  Server, 
  Briefcase, 
  Search, 
  Terminal, 
  Menu,
  X,
  ChevronRight
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { isConnected, address, balance } = useWallet();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems = [
    { label: "User Dashboard", path: "/user", icon: LayoutDashboard, show: isConnected },
    { label: "Provider Dashboard", path: "/provider", icon: Server, show: isConnected },
    { label: "Jobs Explorer", path: "/jobs", icon: Briefcase, show: true },
    { label: "Providers", path: "/providers", icon: Search, show: true },
    { label: "Debug", path: "/debug", icon: Terminal, show: true },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans selection:bg-primary/20 selection:text-primary">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b border-white/5 bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href="/" className="flex items-center gap-2 group">
              <div className="h-8 w-8 rounded bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center shadow-[0_0_15px_rgba(6,182,212,0.3)] group-hover:shadow-[0_0_25px_rgba(6,182,212,0.5)] transition-all duration-300">
                <span className="font-bold text-black text-lg">C</span>
              </div>
              <span className="font-bold text-xl tracking-tight hidden sm:block">Cloudana <span className="text-xs font-mono text-primary/80 ml-1 px-1.5 py-0.5 rounded bg-primary/10 border border-primary/20">TESTNET</span></span>
            </Link>
          </div>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-1">
            {navItems.filter(item => item.show).map((item) => {
              const isActive = location === item.path;
              return (
                <Link key={item.path} href={item.path}>
                  <div className={cn(
                    "px-3 py-2 rounded-md text-sm font-medium transition-all duration-200 flex items-center gap-2 cursor-pointer",
                    isActive 
                      ? "bg-primary/10 text-primary shadow-[0_0_10px_rgba(6,182,212,0.1)] border border-primary/20" 
                      : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                  )}>
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </div>
                </Link>
              );
            })}
          </nav>

          {/* Wallet / Actions */}
          <div className="flex items-center gap-3">
            <appkit-button />

            {/* Mobile Menu Toggle */}
            <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>
      </header>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 top-16 z-40 bg-background/95 backdrop-blur-xl border-b border-white/10 animate-in slide-in-from-top-5">
          <nav className="p-4 flex flex-col gap-2">
            {navItems.filter(item => item.show).map((item) => (
              <Link key={item.path} href={item.path} onClick={() => setMobileMenuOpen(false)}>
                <div className={cn(
                  "p-4 rounded-lg flex items-center gap-3 transition-colors",
                  location === item.path ? "bg-primary/10 text-primary border border-primary/20" : "bg-card hover:bg-white/5"
                )}>
                  <item.icon className="h-5 w-5" />
                  <span className="font-medium">{item.label}</span>
                  {location === item.path && <ChevronRight className="ml-auto h-4 w-4 opacity-50" />}
                </div>
              </Link>
            ))}
          </nav>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-4 py-8">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/5 bg-black/20 py-8 mt-auto">
        <div className="container mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-4 text-xs text-muted-foreground">
          <div className="flex flex-col gap-1">
            <span className="font-semibold text-foreground">Cloudana MVP Testnet</span>
            <span>Current Network: <span className="text-primary/80">Base Sepolia (84532)</span></span>
            <span className="opacity-50">Contracts: 0x71...9A21</span>
          </div>
          <div className="flex items-center gap-6">
            <a href="#" className="hover:text-primary transition-colors">Documentation</a>
            <a href="#" className="hover:text-primary transition-colors">Explorer</a>
            <a href="#" className="hover:text-primary transition-colors">Status</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
