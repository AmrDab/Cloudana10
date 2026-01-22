import { Link, useLocation } from "wouter";
import { useWallet } from "@/context/wallet-context";
import {
  LayoutDashboard,
  Server,
  Search,
  Terminal,
  Menu,
  X,
  ChevronRight,
  Home,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const SIDEBAR_WIDTH = "14rem";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { isConnected } = useWallet();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems = [
    { label: "Home", path: "/", icon: Home, show: true },
    { label: "User Dashboard", path: "/user", icon: LayoutDashboard, show: true },
    { label: "Provider Dashboard", path: "/provider", icon: Server, show: isConnected },
    { label: "Register Provider", path: "/provider/register", icon: Server, show: isConnected },
    { label: "Providers", path: "/providers", icon: Search, show: true },
    { label: "Debug", path: "/debug", icon: Terminal, show: true },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground flex font-sans selection:bg-primary/20 selection:text-primary">
      {/* Left Sidebar - Desktop */}
      <aside
        className="hidden md:flex md:flex-col md:fixed md:inset-y-0 md:left-0 z-40 border-r border-white/5 bg-card/30"
        style={{ width: SIDEBAR_WIDTH }}
      >
        <div className="flex h-16 items-center gap-2 border-b border-white/5 px-4">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="h-8 w-8 rounded bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center shadow-[0_0_15px_rgba(6,182,212,0.3)] group-hover:shadow-[0_0_25px_rgba(6,182,212,0.5)] transition-all duration-300">
              <span className="font-bold text-black text-lg">C</span>
            </div>
            <span className="font-bold text-lg tracking-tight">Cloudana</span>
          </Link>
        </div>
        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {navItems.filter((item) => item.show).map((item) => {
            const isActive =
              location === item.path || (item.path !== "/" && location.startsWith(item.path + "/"));
            return (
              <Link key={item.path} href={item.path}>
                <div
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 cursor-pointer",
                    isActive
                      ? "bg-primary/10 text-primary border border-primary/20"
                      : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                  {isActive ? <ChevronRight className="ml-auto h-4 w-4 opacity-50" /> : null}
                </div>
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 md:pl-[14rem]">
        <header className="sticky top-0 z-30 w-full border-b border-white/5 bg-background/80 backdrop-blur-xl">
          <div className="container mx-auto px-4 h-16 flex items-center justify-between">
            <div className="md:hidden flex items-center gap-2">
              <Link href="/" className="flex items-center gap-2 group">
                <div className="h-8 w-8 rounded bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center">
                  <span className="font-bold text-black text-lg">C</span>
                </div>
                <span className="font-bold text-xl tracking-tight">Cloudana</span>
              </Link>
            </div>
            <div className="flex-1" />
            <div className="flex items-center gap-3">
              <appkit-button />
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              >
                {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </Button>
            </div>
          </div>
        </header>

        {mobileMenuOpen && (
          <div className="md:hidden fixed inset-0 top-16 z-40 bg-background/95 backdrop-blur-xl border-b border-white/10 animate-in slide-in-from-top-5">
            <nav className="p-4 flex flex-col gap-2">
              {navItems.filter((item) => item.show).map((item) => (
                <Link key={item.path} href={item.path} onClick={() => setMobileMenuOpen(false)}>
                  <div
                    className={cn(
                      "p-4 rounded-lg flex items-center gap-3 transition-colors",
                      location === item.path
                        ? "bg-primary/10 text-primary border border-primary/20"
                        : "bg-card hover:bg-white/5"
                    )}
                  >
                    <item.icon className="h-5 w-5" />
                    <span className="font-medium">{item.label}</span>
                    {location === item.path ? (
                      <ChevronRight className="ml-auto h-4 w-4 opacity-50" />
                    ) : null}
                  </div>
                </Link>
              ))}
            </nav>
          </div>
        )}

        <main className="flex-1 container mx-auto px-4 py-8">{children}</main>

        <footer className="border-t border-white/5 bg-black/20 py-8 mt-auto">
          <div className="container mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-4 text-xs text-muted-foreground">
            <div className="flex flex-col gap-1">
              <span className="font-semibold text-foreground">Cloudana MVP Testnet</span>
              <span>
                Current Network: <span className="text-primary/80">Base Sepolia (84532)</span>
              </span>
            </div>
            <div className="flex items-center gap-6">
              <a href="#" className="hover:text-primary transition-colors">
                Documentation
              </a>
              <a href="#" className="hover:text-primary transition-colors">
                Explorer
              </a>
              <a href="#" className="hover:text-primary transition-colors">
                Status
              </a>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
