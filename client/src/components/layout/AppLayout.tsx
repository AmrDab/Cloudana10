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
  Droplets,
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
  // When on /providers/:owner (provider detail), treat as Provider > Dashboard for sidebar selection
  const effectivePath =
    currentPath.startsWith("/job") || currentPath === "/workload/register"
      ? "/user"
      : currentPath.startsWith("/providers/")
        ? "/providers"
        : currentPath;
  const effectiveHash = currentPath.startsWith("/job") || currentPath === "/workload/register"
    ? "deployments"
    : currentPath === "/user" && !currentHashNormalized
      ? "home"
      : currentHashNormalized;
  const showQuickStats =
    currentPath.startsWith("/user") ||
    currentPath === "/provider" ||
    currentPath.startsWith("/provider/") ||
    currentPath.startsWith("/providers") ||
    currentPath.startsWith("/pricing");

  const { jobs } = useUserJobs({
    enabled: showQuickStats && !!isConnected,
  });
  const openJobsCount = jobs.filter((j) => j.status === 1).length;   // Active workloads
  const closedJobsCount = jobs.filter((j) => j.status === 0).length; // Inactive workloads
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
    { label: "Faucet", path: "/faucet", icon: Droplets, show: true },
    { label: "Status", path: "/status", icon: Activity, show: true },
    { label: "Debug", path: "/debug", icon: Terminal, show: import.meta.env.DEV },
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

  const isItemActive = (item: NavItem): boolean => {
    if (item.children) return false;
    const itemPath = item.path.split('#')[0];
    const itemHash = item.path.includes('#') ? item.path.split('#')[1] : null;
    const pathMatches =
      itemPath === "/provider"
        ? currentPath === "/provider" || currentPath.startsWith("/provider/")
        : effectivePath === itemPath;
    if (itemHash) {
      return pathMatches && effectiveHash === itemHash;
    }
    return pathMatches && !effectiveHash;
  };

  /** Parent is considered active when it or any of its children is active (for same selection styling). */
  const isParentOrSelfActive = (item: NavItem): boolean => {
    return isItemActive(item) || (!!item.children && hasActiveDescendant(item));
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
    const isActiveOrChildActive = isParentOrSelfActive(item);
    const isExpanded = isItemExpanded(item);
    const hasChildren = item.children && item.children.length > 0;

    const baseClasses = "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 w-full text-left min-w-0";
    const isChild = level > 0;
    const activeClasses = isActiveOrChildActive
      ? isChild
        ? "text-primary/90"
        : "bg-primary/10 text-primary border border-primary/20"
      : isChild
        ? "text-muted-foreground/90 hover:text-foreground"
        : "text-muted-foreground hover:text-foreground hover:bg-white/5";
    const rightSlotW = "w-6 shrink-0 flex justify-end";
    const indentStyle = isChild ? { paddingLeft: "0.75rem" } : undefined;

    return (
      <div key={item.path} className="w-full min-w-0">
        <div className="flex items-center w-full min-w-0">
          {hasChildren ? (
            <button
              onClick={() => toggleExpanded(item.path)}
              className={cn(baseClasses, activeClasses)}
              style={indentStyle}
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
              className="block w-full min-w-0"
              onClick={() => {
                const [path, hash] = item.path.split('#');
                if (hash) {
                  setLocation(path);
                  requestAnimationFrame(() => {
                    window.location.hash = hash;
                    setCurrentHash(`#${hash}`);
                  });
                } else {
                  setLocation(item.path);
                  setCurrentHash("");
                }
              }}
            >
              <div className={cn(baseClasses, activeClasses, "cursor-pointer")} style={indentStyle}>
                <item.icon className="h-4 w-4 shrink-0" />
                <span className="flex-1 min-w-0 truncate">{item.label}</span>
              </div>
            </div>
          )}
        </div>
        {hasChildren && isExpanded && (
          <div className="mt-1 space-y-1 ml-3 w-[calc(100%-0.75rem)] min-w-0">
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
                    <div className="flex justify-between items-center" title="Spent is tracked when provider rewards are paid on-chain">
                      <span className="text-xs text-muted-foreground">Total Spent</span>
                      <span className="text-sm font-mono font-semibold">{totalSpent > 0 ? `${totalSpent.toFixed(2)} CLD` : "0.00 CLD"}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-muted-foreground">CLD Balance</span>
                      <span className={cn("text-sm font-mono font-semibold", cldBalance === 0 && "text-amber-400")}>
                        {cldBalance.toFixed(2)} CLD
                      </span>
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
                <>
                  {/* CLD Balance Badge - always visible */}
                  <Link href={cldBalance === 0 ? "/faucet" : "/user"}>
                    <div className={cn(
                      "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer",
                      cldBalance === 0
                        ? "border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                        : "border-white/10 bg-card/50 text-foreground hover:bg-card/80"
                    )}>
                      {cldBalance === 0 ? (
                        <Droplets className="h-3.5 w-3.5" />
                      ) : null}
                      <span className="font-mono">{cldBalance.toFixed(2)}</span>
                      <span className="text-xs text-muted-foreground">CLD</span>
                    </div>
                  </Link>
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
                            <div className="text-lg font-bold">{cldBalance.toFixed(2)} CLD</div>
                          </div>
                          {cldBalance === 0 && (
                            <Link href="/faucet">
                              <Button variant="outline" size="sm" className="w-full gap-1 border-amber-500/30 text-amber-400 hover:bg-amber-500/10">
                                <Droplets className="h-3 w-3" /> Get Free Testnet CLD
                              </Button>
                            </Link>
                          )}
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
                </>
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
                  <div key={item.path} className="w-full">
                    {hasChildren ? (
                      <>
                        <button
                          onClick={() => toggleExpanded(item.path)}
                          className={cn(
                            "w-full p-4 rounded-lg flex items-center gap-3 transition-colors text-left",
                            isParentOrSelfActive(item)
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
                          <div className="mt-1 space-y-1 ml-4 w-[calc(100%-1rem)] min-w-0">
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
                                    "w-full p-3 rounded-lg flex items-center gap-3 transition-colors cursor-pointer",
                                    isChildActive
                                      ? "text-primary/90"
                                      : "text-muted-foreground hover:text-foreground"
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
          <div className="container mx-auto px-4 space-y-4 text-xs text-muted-foreground">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div className="flex flex-col gap-1">
                <span className="font-semibold text-foreground">Cloudana Testnet</span>
                <span>
                  Current Network: <span className="text-primary/80">Base Sepolia (84532)</span>
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <Link href="/docs" className="hover:text-primary transition-colors">
                  Documentation
                </Link>
                <a href="https://sepolia.basescan.org" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">
                  Explorer
                </a>
                <Link href="/status" className="hover:text-primary transition-colors">
                  Status
                </Link>
                <a href="https://twitter.com/Cloudana10" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">
                  Twitter
                </a>
                <a href="https://github.com/cloudana-io" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">
                  GitHub
                </a>
                <a href="https://discord.gg/cloudana" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">
                  Discord
                </a>
              </div>
            </div>
            <div className="border-t border-white/5 pt-4 text-center md:text-left">
              <span>© 2026 Cloudana. All rights reserved.</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
