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
  Activity,
  Copy,
  Check,
  ExternalLink,
} from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import { useWallet } from "@/context/wallet-context";
import { getAddressExplorerUrl } from "@/lib/transaction-utils";
import { useCLDTokenBalance} from "@/lib/contracts";
import { formatEther } from "viem";
import { useUserJobs } from "@/hooks/useUserJobs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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
  const [currentHash, setCurrentHash] = useState<string>("");
  const { isConnected, userAddress } = useWallet();
  const [copied, setCopied] = useState(false);
  
  // Get CLD token balance for wallet tooltip
  const { data: tokenBalance } = useCLDTokenBalance(isConnected ? (userAddress as `0x${string}`) : undefined);
  
  const cldBalance = tokenBalance && typeof tokenBalance === 'bigint' ? parseFloat(formatEther(tokenBalance)) : 0;
  
  const displayAddress = userAddress 
    ? `${userAddress.slice(0, 6)}...${userAddress.slice(-10)}`
    : "";

  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!userAddress) return;
    
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(userAddress);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = userAddress;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        textArea.remove();
      }
      
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy address:', err);
    }
  };

  const handleOpenExplorer = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (userAddress) {
      window.open(getAddressExplorerUrl(userAddress), "_blank", "noopener,noreferrer");
    }
  };

  const rawLocation = location;
  const currentPath = location.split("#")[0];
  // Normalize hash for comparison: strip leading "#" so "home" and "#home" both match
  const currentHashNormalized = (currentHash || (typeof window !== "undefined" ? window.location.hash : "")).replace(/^#/, "");
  // When on /job/:id or /workload/register, treat as User > Deployments for sidebar active state
  const effectivePath = currentPath.startsWith("/job") || currentPath === "/workload/register" ? "/user" : currentPath;
  const effectiveHash = currentPath.startsWith("/job") || currentPath === "/workload/register"
    ? "deployments"
    : currentPath === "/user" && !currentHashNormalized
      ? "home"
      : currentHashNormalized;
  const showQuickStats =
    currentPath.startsWith("/user") ||
    currentPath === "/provider" ||
    currentPath.startsWith("/providers") ||
    currentPath.startsWith("/pricing");

  const { jobs } = useUserJobs({
    enabled: showQuickStats && !!isConnected,
  });
  const openJobsCount = jobs.filter((j) => j.status === 0).length;
  const closedJobsCount = jobs.filter((j) => j.status === 1).length;
  const totalSpent = jobs.reduce((sum, job) => sum + parseFloat(formatEther(job.spent)), 0);

  // Sync hash with state to trigger re-renders when hash changes
  useEffect(() => {
    const updateHash = () => {
      setCurrentHash(typeof window !== "undefined" ? window.location.hash : "");
    };
    
    // Set initial hash
    updateHash();
    
    // Listen to hash changes
    window.addEventListener("hashchange", updateHash);
    
    return () => {
      window.removeEventListener("hashchange", updateHash);
    };
  }, []);

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
        { label: "Browse Providers", path: "/user#providers", icon: Briefcase, show: false },
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
    const itemPath = item.path.split('#')[0];
    const itemHash = item.path.includes('#') ? item.path.split('#')[1] : null;
    
    const pathMatches = effectivePath === itemPath;
    
    if (itemHash) {
      return pathMatches && effectiveHash === itemHash;
    }
    return pathMatches && !effectiveHash;
  };

  const hasActiveDescendant = (item: NavItem): boolean => {
    if (!item.children) return false;
    return item.children.some((child) => {
      const childPath = child.path.split('#')[0];
      const childHash = child.path.includes('#') ? child.path.split('#')[1] : null;
      const pathMatches = effectivePath === childPath;
      if (childHash) {
        return pathMatches && effectiveHash === childHash;
      }
      return pathMatches && !effectiveHash;
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
                    setCurrentHash(`#${hash}`);
                  });
                } else {
                  // Use setLocation for normal paths
                  setLocation(item.path);
                  setCurrentHash("");
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

        {/* Quick Stats - at sidebar bottom when User, Provider, or Pricing selected */}
        {showQuickStats && (
          <div className="flex-shrink-0 border-t border-white/5 p-3">
            <Card className="border-white/5 bg-card/40 shadow-lg">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Quick Stats
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {!isConnected && (
                  <div className="pt-2 border-t border-white/5">
                    <p className="text-xs text-muted-foreground/70">Connect wallet to view your stats</p>
                  </div>
                )}
                {isConnected && (
                  <div className="pt-2 border-t border-white/5 space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-muted-foreground">Open Jobs</span>
                      <Badge variant="outline" className="border-green-500/50 text-green-400 bg-green-500/10">
                        {openJobsCount}
                      </Badge>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-muted-foreground">Closed Jobs</span>
                      <Badge variant="outline" className="border-white/20 text-muted-foreground bg-white/5">
                        {closedJobsCount}
                      </Badge>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-muted-foreground">Total Spent</span>
                      <span className="text-sm font-mono font-semibold">{totalSpent.toFixed(2)} CLD</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
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
              {isConnected ? (
                <HoverCard>
                  <HoverCardTrigger asChild>
                    <div className="cursor-pointer">
                      <appkit-button />
                    </div>
                  </HoverCardTrigger>
                  <HoverCardContent side="top" align="end" className="w-72">
                    <div className="space-y-4">
                      {/* CLD Balance and Refund Credits */}
                      <div className="space-y-3">
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">CLD Balance</div>
                          <div className="text-lg font-bold">{cldBalance.toFixed(2)}</div>
                        </div>
                      </div>
                      
                      {/* Divider */}
                      <div className="border-t border-white/5" />
                      
                      {/* Account Header */}
                      <div className="flex items-center gap-2">
                        <Activity className="h-4 w-4" />
                        <span className="font-medium">Account</span>
                      </div>
                      
                      {/* Wallet Address */}
                      <div className="space-y-2">
                        <div className="text-xs text-muted-foreground">Wallet Address</div>
                        <div className="flex items-center gap-2">
                          <code className="font-mono text-sm bg-muted px-2 py-1 rounded flex-1">
                            {displayAddress}
                          </code>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={handleCopy}
                            title={copied ? "Copied!" : "Copy address"}
                          >
                            {copied ? (
                              <Check className="h-4 w-4 text-green-500" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={handleOpenExplorer}
                            title="View on Base Sepolia explorer"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                      
                      {/* Connected Status */}
                      <div className="flex items-center gap-2 pt-2 border-t border-white/5">
                        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                        <span className="text-sm text-muted-foreground">Connected</span>
                      </div>
                    </div>
                  </HoverCardContent>
                </HoverCard>
              ) : (
                <appkit-button />
              )}
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
                              const childPath = child.path.split('#')[0];
                              const childHash = child.path.includes('#') ? child.path.split('#')[1] : null;
                              const isChildActive = childHash
                                ? effectivePath === childPath && effectiveHash === childHash
                                : effectivePath === childPath && !effectiveHash;
                              
                              return (
                                <div
                                  key={child.path}
                                  onClick={() => {
                                    if (hash) {
                                      setLocation(path);
                                      requestAnimationFrame(() => {
                                        window.location.hash = hash;
                                        setCurrentHash(`#${hash}`);
                                      });
                                    } else {
                                      setLocation(child.path);
                                      setCurrentHash("");
                                    }
                                    setMobileMenuOpen(false);
                                  }}
                                  className={cn(
                                    "p-3 rounded-lg flex items-center gap-3 transition-colors cursor-pointer",
                                    isChildActive
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
