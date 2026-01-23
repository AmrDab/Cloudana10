import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Server,
  Terminal,
  Menu,
  X,
  ChevronRight,
  ChevronDown,
  Home,
  Users,
  DollarSign,
  Cpu,
  Calculator,
  TrendingUp,
  Rocket,
  FileText,
  Briefcase,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const SIDEBAR_WIDTH = "14rem";

interface NavItem {
  label: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  show: boolean;
  children?: NavItem[];
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const navItems: NavItem[] = [
    { label: "Home", path: "/", icon: Home, show: true },
    {
      label: "User",
      path: "/user",
      icon: Users,
      show: true,
      children: [
        { label: "Get Started", path: "/user#home", icon: Home, show: true },
        { label: "Deployments", path: "/user#deployments", icon: Rocket, show: true },
        { label: "Templates", path: "/user#templates", icon: FileText, show: true },
        { label: "Browse Providers", path: "/user#providers", icon: Briefcase, show: true },
      ],
    },
    {
      label: "Provider",
      path: "/provider",
      icon: Server,
      show: true,
      children: [
        { label: "Dashboard", path: "/providers", icon: LayoutDashboard, show: true },
        { label: "Register", path: "/provider", icon: Server, show: true },
      ],
    },
    {
      label: "Pricing",
      path: "/pricing/gpus",
      icon: DollarSign,
      show: true,
      children: [
        { label: "GPU Pricing", path: "/pricing/gpus", icon: Cpu, show: true },
        { label: "Usage Calculator", path: "/pricing/usage", icon: Calculator, show: true },
        { label: "Provider Calculator", path: "/pricing/provider", icon: TrendingUp, show: true },
      ],
    },
    { label: "Debug", path: "/debug", icon: Terminal, show: true },
  ];

  const toggleExpanded = (path: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  // Only the exact matching item is selected. Parents are never selected when a child matches.
  const isItemActive = (item: NavItem): boolean => {
    if (item.children) return false;
    const currentPath = location.split('#')[0];
    const currentHash = typeof window !== "undefined" ? window.location.hash : "";
    const itemPath = item.path.split('#')[0];
    const itemHash = item.path.includes('#') ? item.path.split('#')[1] : null;
    
    if (itemHash) {
      return currentPath === itemPath && currentHash === `#${itemHash}`;
    }
    return location === item.path;
  };

  const hasActiveDescendant = (item: NavItem): boolean => {
    if (!item.children) return false;
    return item.children.some((child) => {
      const currentPath = location.split('#')[0];
      const currentHash = typeof window !== "undefined" ? window.location.hash : "";
      const childPath = child.path.split('#')[0];
      const childHash = child.path.includes('#') ? child.path.split('#')[1] : null;
      
      if (childHash) {
        return currentPath === childPath && currentHash === `#${childHash}`;
      }
      return location === child.path || hasActiveDescendant(child);
    });
  };

  const isItemExpanded = (item: NavItem): boolean => {
    return expandedItems.has(item.path) || hasActiveDescendant(item);
  };

  const renderNavItem = (item: NavItem, level: number = 0) => {
    if (!item.show) return null;

    const isActive = isItemActive(item);
    const isExpanded = isItemExpanded(item);
    const hasChildren = item.children && item.children.length > 0;

    const baseClasses = "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 w-full text-left min-w-0";
    const activeClasses = isActive
      ? "bg-primary/10 text-primary border border-primary/20"
      : "text-muted-foreground hover:text-foreground hover:bg-white/5";
    const rightSlotW = "w-6 shrink-0 flex justify-end";

    return (
      <div key={item.path}>
        <div className="flex items-center w-full" style={level > 0 ? { paddingLeft: `${level * 1}rem` } : undefined}>
          {hasChildren ? (
            <button
              onClick={() => toggleExpanded(item.path)}
              className={cn(baseClasses, activeClasses)}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span className="flex-1 min-w-0 truncate">{item.label}</span>
              <span className={rightSlotW}>
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 opacity-50" />
                ) : (
                  <ChevronRight className="h-4 w-4 opacity-50" />
                )}
              </span>
            </button>
          ) : (
            <div 
              className="block w-full min-w-0 flex-1"
              onClick={() => {
                const [path, hash] = item.path.split('#');
                if (hash) {
                  // For hash paths, navigate to path and set hash to trigger hashchange event
                  setLocation(path);
                  // Use requestAnimationFrame to ensure route change happens first
                  requestAnimationFrame(() => {
                    window.location.hash = hash;
                  });
                } else {
                  // Use setLocation for normal paths
                  setLocation(item.path);
                }
              }}
            >
              <div className={cn(baseClasses, activeClasses, "cursor-pointer")}>
                <item.icon className="h-4 w-4 shrink-0" />
                <span className="flex-1 min-w-0 truncate">{item.label}</span>
              </div>
            </div>
          )}
        </div>
        {hasChildren && isExpanded && (
          <div className="ml-4 mt-1 space-y-1 border-l border-white/5 pl-2">
            {item.children?.map((child) => renderNavItem(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

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
          {navItems.map((item) => renderNavItem(item))}
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
              {navItems.map((item) => {
                if (!item.show) return null;
                const hasChildren = item.children && item.children.length > 0;
                const isExpanded = expandedItems.has(item.path) || (hasChildren && hasActiveDescendant(item));
                
                return (
                  <div key={item.path}>
                    {hasChildren ? (
                      <>
                        <button
                          onClick={() => toggleExpanded(item.path)}
                          className={cn(
                            "w-full p-4 rounded-lg flex items-center gap-3 transition-colors text-left",
                            isItemActive(item)
                              ? "bg-primary/10 text-primary border border-primary/20"
                              : "bg-card hover:bg-white/5"
                          )}
                        >
                          <item.icon className="h-5 w-5" />
                          <span className="font-medium flex-1">{item.label}</span>
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 opacity-50" />
                          ) : (
                            <ChevronRight className="h-4 w-4 opacity-50" />
                          )}
                        </button>
                        {isExpanded && item.children && (
                          <div className="ml-4 mt-1 space-y-1">
                            {item.children.map((child) => {
                              const [path, hash] = child.path.split('#');
                              return (
                              <div
                                key={child.path}
                                onClick={() => {
                                  if (hash) {
                                    setLocation(path);
                                    requestAnimationFrame(() => {
                                      window.location.hash = hash;
                                    });
                                  } else {
                                    setLocation(child.path);
                                  }
                                  setMobileMenuOpen(false);
                                }}
                                className={cn(
                                  "p-3 rounded-lg flex items-center gap-3 transition-colors cursor-pointer",
                                  (() => {
                                    const currentPath = location.split('#')[0];
                                    const currentHash = typeof window !== "undefined" ? window.location.hash : "";
                                    const childPath = child.path.split('#')[0];
                                    const childHash = child.path.includes('#') ? child.path.split('#')[1] : null;
                                    
                                    if (childHash) {
                                      return currentPath === childPath && currentHash === `#${childHash}`;
                                    }
                                    return location === child.path;
                                  })()
                                    ? "bg-primary/10 text-primary border border-primary/20"
                                    : "bg-card/50 hover:bg-white/5"
                                )}
                              >
                                <child.icon className="h-4 w-4" />
                                <span className="font-medium text-sm">{child.label}</span>
                              </div>
                              );
                            })}
                          </div>
                        )}
                      </>
                    ) : (
                      <Link href={item.path} onClick={() => setMobileMenuOpen(false)}>
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
                        </div>
                      </Link>
                    )}
                  </div>
                );
              })}
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
