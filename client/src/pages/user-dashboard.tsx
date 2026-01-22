import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useAccount } from "wagmi";
import { useLocation } from "wouter";
import { Plus, ExternalLink, RefreshCw, Wallet as WalletIcon, Loader2, LayoutDashboard, Briefcase, Home, TrendingUp, Activity, Rocket, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { formatEther, parseEther } from "viem";
import { 
  useCLDTokenBalance,
  useCLDTokenAllowance,
  useUserRefundCredit, 
  useCreateJob, 
  useWithdrawUserRefund,
  useCloseJob,
  useDepositToJob,
  useApproveCLDToken,
  JOB_ESCROW_ADDRESS,
  hexToBytes32
} from "@/lib/contracts";
import { getAllProviders } from "@/lib/api";
import { useUserJobs } from "@/hooks/useUserJobs";
import { AddressDisplay } from "@/components/ui/address-display";
import { TxLink } from "@/components/ui/tx-link";
import ProvidersExplorer from "@/pages/providers-explorer";

type ViewType = "home" | "deployments" | "templates" | "providers";

export default function UserDashboard() {
  const { address, isConnected } = useAccount();
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  
  // Check URL hash for view (e.g., /user#templates)
  const hashView = typeof window !== "undefined" && window.location.hash ? window.location.hash.slice(1) : null;
  const initialView = (hashView && ["home", "deployments", "templates", "providers"].includes(hashView)) ? hashView as ViewType : "home";
  const [activeView, setActiveView] = useState<ViewType>(initialView);
  
  // Update view when hash changes
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1);
      if (hash && ["home", "deployments", "templates", "providers"].includes(hash)) {
        setActiveView(hash as ViewType);
      }
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);
  const [selectedProvider, setSelectedProvider] = useState("");
  const [budget, setBudget] = useState("");

  // Fetch available providers - this should work even when not connected (public data)
  const { data: providers = [], isLoading: providersLoading } = useQuery({
    queryKey: ["allProviders"],
    queryFn: getAllProviders,
    // Don't require connection for public provider list
  });

  // Fetch user jobs from blockchain events
  const { jobs, loading: jobsLoading, refetch: refetchJobs } = useUserJobs({
    enabled: isConnected,
  });

  // Get CLD token balance - only when connected
  const { data: tokenBalance } = useCLDTokenBalance(isConnected ? address : undefined);
  const balance = tokenBalance && typeof tokenBalance === 'bigint' ? parseFloat(formatEther(tokenBalance)) : 0;

  // Get user refund credit - only when connected
  const { data: refundCredit } = useUserRefundCredit(isConnected ? address : undefined);
  const refundAmount = refundCredit && typeof refundCredit === 'bigint' ? parseFloat(formatEther(refundCredit)) : 0;

  // Token approval
  const { approve, isPending: isApproving, isSuccess: isApproved, hash: approveHash } = useApproveCLDToken();

  // Create job
  const { create, hash: createHash, isPending: isCreating, isSuccess: isJobCreated, error: createError, reset: resetCreate } = useCreateJob();

  // Withdraw refund
  const { withdraw: withdrawRefund, hash: withdrawHash, isPending: isWithdrawing, isSuccess: isWithdrawn, error: withdrawError, reset: resetWithdraw } = useWithdrawUserRefund();

  // Check if approval is needed - only when connected
  const { data: allowance } = useCLDTokenAllowance(isConnected ? address : undefined, isConnected ? JOB_ESCROW_ADDRESS : undefined);
  const needsApproval = isConnected && budget && allowance && typeof allowance === 'bigint' ? parseFloat(formatEther(allowance)) < parseFloat(budget) : true;

  // Show success/error messages
  useEffect(() => {
    if (isJobCreated && createHash) {
      toast({
        title: "Job Created Successfully",
        description: "Your job has been created and funded.",
      });
      setSelectedProvider("");
      setBudget("");
      refetchJobs();
      resetCreate();
    }
  }, [isJobCreated, createHash, toast, refetchJobs, resetCreate]);

  useEffect(() => {
    if (createError) {
      toast({
        title: "Failed to Create Job",
        description: createError.message || "Transaction failed",
        variant: "destructive",
      });
      resetCreate();
    }
  }, [createError, toast, resetCreate]);

  useEffect(() => {
    if (isWithdrawn && withdrawHash) {
      toast({
        title: "Withdrawal Successful!",
        description: "Your refund has been transferred to your wallet.",
      });
      resetWithdraw();
    }
  }, [isWithdrawn, withdrawHash, toast, resetWithdraw]);

  useEffect(() => {
    if (withdrawError) {
      toast({
        title: "Withdrawal Failed",
        description: withdrawError.message || "Failed to withdraw refund",
        variant: "destructive",
      });
      resetWithdraw();
    }
  }, [withdrawError, toast, resetWithdraw]);

  // Dashboard is always visible, but interactive features require wallet connection

  const handleCreateJob = async () => {
    if (!selectedProvider || !budget) {
      toast({
        title: "Validation Error",
        description: "Please select a provider and enter a budget.",
        variant: "destructive"
      });
      return;
    }

    if (!address) {
      toast({
        title: "Error",
        description: "Wallet not connected",
        variant: "destructive"
      });
      return;
    }

    // Check if approval is needed
    if (needsApproval) {
      approve(JOB_ESCROW_ADDRESS, budget);
      return;
    }

    // Create job
    const providerPubKeyHash = selectedProvider; // Assuming selectedProvider is the pubKeyHash
    create(providerPubKeyHash, budget);
  };

  const handleWithdrawRefund = () => {
    if (refundAmount === 0) {
      toast({
        title: "No Refund Available",
        description: "You don't have any refund credits to withdraw.",
        variant: "destructive",
      });
      return;
    }
    resetWithdraw();
    withdrawRefund();
  };

  const openJobsCount = jobs.filter(j => j.status === 0).length;
  const closedJobsCount = jobs.filter(j => j.status === 1).length;
  const totalSpent = jobs.reduce((sum, job) => sum + parseFloat(formatEther(job.spent)), 0);

  return (
    <div className="flex gap-6 animate-in fade-in duration-500">
      {/* Left Sidebar */}
      <aside className="w-64 flex-shrink-0 hidden lg:block">
        <div className="sticky top-24 space-y-6">
          {/* Navigation */}
          <Card className="border-white/5 bg-card/40">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <LayoutDashboard className="h-5 w-5" />
                Navigation
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                variant={activeView === "home" ? "secondary" : "ghost"}
                className="w-full justify-start"
                onClick={() => setActiveView("home")}
              >
                <Home className="mr-2 h-4 w-4" />
                Home
              </Button>
              <Button
                variant={activeView === "deployments" ? "secondary" : "ghost"}
                className="w-full justify-start"
                onClick={() => setActiveView("deployments")}
              >
                <Rocket className="mr-2 h-4 w-4" />
                Deployments
              </Button>
              <Button
                variant={activeView === "templates" ? "secondary" : "ghost"}
                className="w-full justify-start"
                onClick={() => setActiveView("templates")}
              >
                <FileText className="mr-2 h-4 w-4" />
                Templates
              </Button>
              <Button
                variant={activeView === "providers" ? "secondary" : "ghost"}
                className="w-full justify-start"
                onClick={() => setActiveView("providers")}
              >
                <Briefcase className="mr-2 h-4 w-4" />
                Browse Providers
              </Button>
            </CardContent>
          </Card>

          {/* Quick Stats */}
          <Card className="border-white/5 bg-card/40">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Quick Stats
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">CLD Balance</div>
                <div className="text-2xl font-bold font-mono">{isConnected ? balance.toFixed(2) : "—"}</div>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Refund Credits</div>
                <div className="text-2xl font-bold font-mono text-green-400">{isConnected ? refundAmount.toFixed(2) : "—"}</div>
              </div>
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

          {/* Account Info */}
          <Card className="border-white/5 bg-card/40">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Account
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Wallet Address</div>
                {isConnected && address ? (
                  <AddressDisplay address={address} truncate={true} truncateLength={6} />
                ) : (
                  <div className="text-sm text-muted-foreground/60">Not connected</div>
                )}
              </div>
              <div className="pt-2 border-t border-white/5">
                <div className="flex items-center gap-2 text-xs">
                  <div className={`w-2 h-2 rounded-full ${isConnected ? "bg-green-500 animate-pulse" : "bg-muted-foreground/40"}`} />
                  <span className="text-muted-foreground">{isConnected ? "Connected" : "Not Connected"}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 space-y-8 min-w-0">
        {activeView === "home" && (
          <HomeViewContent
            selectedProvider={selectedProvider}
            setSelectedProvider={setSelectedProvider}
            budget={budget}
            setBudget={setBudget}
            providers={providers}
            providersLoading={providersLoading}
            balance={balance}
            refundAmount={refundAmount}
            jobs={jobs}
            jobsLoading={jobsLoading}
            handleCreateJob={handleCreateJob}
            handleWithdrawRefund={handleWithdrawRefund}
            isCreating={isCreating}
            isApproving={isApproving}
            isWithdrawing={isWithdrawing}
            needsApproval={needsApproval}
            approveHash={approveHash}
            createHash={createHash}
            withdrawHash={withdrawHash}
            setLocation={setLocation}
            address={address}
            setActiveView={setActiveView}
            isConnected={isConnected}
          />
        )}

        {activeView === "deployments" && (
          <DeploymentsView 
            jobs={jobs}
            jobsLoading={jobsLoading}
            setLocation={setLocation}
            providers={providers}
            providersLoading={providersLoading}
            selectedProvider={selectedProvider}
            setSelectedProvider={setSelectedProvider}
            budget={budget}
            setBudget={setBudget}
            balance={balance}
            handleCreateJob={handleCreateJob}
            isCreating={isCreating}
            isApproving={isApproving}
            needsApproval={needsApproval}
            approveHash={approveHash}
            createHash={createHash}
            refetchJobs={refetchJobs}
            isConnected={isConnected}
          />
        )}

        {activeView === "templates" && (
          <TemplatesView 
            providers={providers}
            providersLoading={providersLoading}
            onCreateFromTemplate={(providerPubKeyHash: string, budget: string) => {
              setSelectedProvider(providerPubKeyHash);
              setBudget(budget);
              setActiveView("home");
            }}
          />
        )}

        {activeView === "providers" && (
          <ProvidersView />
        )}
      </div>
    </div>
  );
}

// Home View Component (User Dashboard)
function HomeViewContent({
  selectedProvider,
  setSelectedProvider,
  budget,
  setBudget,
  providers,
  providersLoading,
  balance,
  refundAmount,
  jobs,
  jobsLoading,
  handleCreateJob,
  handleWithdrawRefund,
  isCreating,
  isApproving,
  isWithdrawing,
  needsApproval,
  approveHash,
  createHash,
  withdrawHash,
  setLocation,
  address,
  setActiveView,
  isConnected,
}: {
  selectedProvider: string;
  setSelectedProvider: (v: string) => void;
  budget: string;
  setBudget: (v: string) => void;
  providers: any[];
  providersLoading: boolean;
  balance: number;
  refundAmount: number;
  jobs: any[];
  jobsLoading: boolean;
  handleCreateJob: () => void;
  handleWithdrawRefund: () => void;
  isCreating: boolean;
  isApproving: boolean;
  isWithdrawing: boolean;
  needsApproval: boolean;
  approveHash?: `0x${string}`;
  createHash?: `0x${string}`;
  withdrawHash?: `0x${string}`;
  setLocation: (path: string) => void;
  address?: `0x${string}`;
  setActiveView?: (view: ViewType) => void;
  isConnected: boolean;
}) {
  const activeDeploymentsCount = jobs.filter(j => j.status === 0).length;
  const totalSpentInDeployments = jobs.reduce((sum, job) => sum + parseFloat(formatEther(job.spent)), 0);
  
  // Calculate USD equivalent (mock - in production, fetch from price oracle)
  const cldToUsd = 0.1; // Mock conversion rate
  const balanceUsd = balance * cldToUsd;
  // Calculate cost per hour (rough estimate based on total spent)
  // Assuming average deployment runs for some time, calculate hourly cost
  const totalCostPerHour = activeDeploymentsCount > 0 
    ? (totalSpentInDeployments * cldToUsd) / (activeDeploymentsCount * 720) // Rough estimate
    : 0;
  const totalCostPerMonth = totalCostPerHour * 720;

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Your account</h1>
        <Button 
          onClick={() => {
            // Switch to deployments view to create deployment
            if (setActiveView) {
              setActiveView("deployments");
            }
          }}
          disabled={!isConnected}
          className="bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          <Rocket className="mr-2 h-4 w-4" />
          {isConnected ? "Deploy" : "Connect Wallet to Deploy"}
        </Button>
      </div>

      {/* Account Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Available Balance (CLD) */}
        <Card className="bg-card/50 border-white/5 relative overflow-hidden">
          <div className="absolute top-4 right-4 opacity-20">
            <WalletIcon className="h-8 w-8" />
          </div>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Available Balance (CLD)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline justify-between mb-1">
              <div className="text-3xl font-bold font-mono">{isConnected ? balance.toFixed(2) : "—"}</div>
              <div className="text-sm text-muted-foreground">{isConnected ? `$${balanceUsd.toFixed(2)}` : "—"}</div>
            </div>
            <div className="text-xs text-muted-foreground mt-2">
              {isConnected ? `${totalSpentInDeployments.toFixed(2)} CLD used in deployments` : "Connect wallet to view"}
            </div>
          </CardContent>
        </Card>

        {/* Refund Credits */}
        <Card className="bg-card/50 border-white/5 relative overflow-hidden">
          <div className="absolute top-4 right-4 opacity-20">
            <WalletIcon className="h-8 w-8 text-green-400" />
          </div>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Refund Credits (CLD)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline justify-between mb-1">
              <div className="text-3xl font-bold font-mono text-green-400">{isConnected ? refundAmount.toFixed(2) : "—"}</div>
              <div className="text-sm text-muted-foreground">{isConnected ? `$${(refundAmount * cldToUsd).toFixed(2)}` : "—"}</div>
            </div>
            <div className="text-xs text-muted-foreground mt-2">
              {isConnected ? "Available to withdraw" : "Connect wallet to view"}
            </div>
          </CardContent>
        </Card>

        {/* Active Deployments */}
        <Card className="bg-card/50 border-white/5 relative overflow-hidden">
          <div className="absolute top-4 right-4 opacity-20">
            <Rocket className="h-8 w-8" />
          </div>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active Deployments
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{activeDeploymentsCount}</div>
            <div className="text-xs text-muted-foreground mt-2">
              {jobs.length} total deployments
            </div>
          </CardContent>
        </Card>

        {/* Total Cost */}
        <Card className="bg-card/50 border-white/5 relative overflow-hidden">
          <div className="absolute top-4 right-4 opacity-20">
            <TrendingUp className="h-8 w-8" />
          </div>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Cost
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono">${totalCostPerHour.toFixed(2)} / hour</div>
            <div className="text-xs text-muted-foreground mt-2">
              ${totalCostPerMonth.toFixed(2)} / month
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

// Deployments View Component
function DeploymentsView({
  jobs,
  jobsLoading,
  setLocation,
  providers,
  providersLoading,
  selectedProvider,
  setSelectedProvider,
  budget,
  setBudget,
  balance,
  handleCreateJob,
  isCreating,
  isApproving,
  needsApproval,
  approveHash,
  createHash,
  refetchJobs,
  isConnected,
}: {
  jobs: any[];
  jobsLoading: boolean;
  setLocation: (path: string) => void;
  providers: any[];
  providersLoading: boolean;
  selectedProvider: string;
  setSelectedProvider: (v: string) => void;
  budget: string;
  setBudget: (v: string) => void;
  balance: number;
  handleCreateJob: () => void;
  isCreating: boolean;
  isApproving: boolean;
  needsApproval: boolean;
  approveHash?: `0x${string}`;
  createHash?: `0x${string}`;
  refetchJobs: () => void;
  isConnected: boolean;
}) {
  const activeDeployments = jobs.filter(j => j.status === 0);
  const allDeployments = jobs;

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Rocket className="h-8 w-8 text-primary" />
            Deployments
          </h1>
          <p className="text-muted-foreground">Create and manage your compute deployments.</p>
        </div>
      </div>

      {/* Create Deployment Card */}
      <Card className="border-primary/20 glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-primary" /> Create New Deployment
          </CardTitle>
          <CardDescription>Provision compute resources by depositing CLD tokens.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="deployment-provider">Select Provider</Label>
              <Select value={selectedProvider} onValueChange={setSelectedProvider} disabled={!isConnected}>
                <SelectTrigger id="deployment-provider" className="bg-background/50 border-white/10" disabled={!isConnected}>
                  <SelectValue placeholder={isConnected ? "Choose a provider..." : "Connect wallet to select provider"} />
                </SelectTrigger>
                <SelectContent>
                  {(providers || [])
                    .filter(p => p.status === 1) // Only show Active providers
                    .map(p => (
                      <SelectItem key={p.pubKeyHash} value={p.pubKeyHash}>
                        {p.name || `Provider ${p.pubKeyHash.slice(0, 8)}...`}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="deployment-budget">Budget (CLD)</Label>
              <div className="relative">
                <Input 
                  id="deployment-budget" 
                  placeholder={isConnected ? "e.g. 100" : "Connect wallet to enter budget"} 
                  type="number" 
                  className="bg-background/50 border-white/10 pr-12"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  disabled={!isConnected}
                />
                <span className="absolute right-3 top-2.5 text-xs text-muted-foreground font-mono">CLD</span>
              </div>
            </div>
          </div>
          {!isConnected && (
            <div className="mt-4 p-3 rounded-lg bg-muted/50 border border-muted-foreground/20">
              <p className="text-sm text-muted-foreground">
                <WalletIcon className="inline h-4 w-4 mr-2" />
                Connect your wallet to create deployments
              </p>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex justify-between border-t border-white/5 pt-6">
          <div className="text-sm text-muted-foreground">
            Balance: <span className="font-mono text-foreground">{isConnected ? balance.toFixed(2) : "—"} CLD</span>
          </div>
          <Button 
            onClick={handleCreateJob} 
            disabled={!isConnected || isCreating || isApproving || providersLoading || !selectedProvider || !budget} 
            className="bg-primary hover:bg-primary/90 text-primary-foreground min-w-[160px]"
          >
            {isApproving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Approving...
              </>
            ) : isCreating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating...
              </>
            ) : needsApproval && budget ? (
              "Approve & Create"
            ) : (
              "Create Deployment"
            )}
          </Button>
        </CardFooter>
        {approveHash && (
          <div className="px-6 pb-4">
            <TxLink hash={approveHash} label="Approval transaction" />
          </div>
        )}
        {createHash && (
          <div className="px-6 pb-4">
            <TxLink hash={createHash} label="Deployment creation transaction" />
          </div>
        )}
      </Card>

      {/* Deployment List */}
      <Card className="border-white/5 bg-card/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Rocket className="h-5 w-5" />
            My Deployments ({allDeployments.length})
          </CardTitle>
          <CardDescription>All your compute deployments</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-white/5 border-white/10">
                <TableHead>Deployment ID</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Deposited</TableHead>
                <TableHead>Spent</TableHead>
                <TableHead>Remaining</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobsLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-20" /></TableCell>
                  </TableRow>
                ))
              ) : allDeployments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                    No deployments yet. Create your first deployment to get started.
                  </TableCell>
                </TableRow>
              ) : allDeployments.map((deployment) => {
                const deposited = parseFloat(formatEther(deployment.deposited));
                const spent = parseFloat(formatEther(deployment.spent));
                const remaining = parseFloat(formatEther(deployment.remaining));
                const isActive = deployment.status === 0;
                
                return (
                  <TableRow key={deployment.jobId.toString()} className="hover:bg-white/5 border-white/10 transition-colors">
                    <TableCell className="font-mono font-medium text-primary">
                      <span className="cursor-pointer hover:underline" onClick={() => setLocation(`/job/${deployment.jobId}`)}>
                        #{deployment.jobId.toString()}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      {deployment.pubKeyHash.slice(0, 10)}...{deployment.pubKeyHash.slice(-8)}
                    </TableCell>
                    <TableCell>{deposited.toFixed(2)} CLD</TableCell>
                    <TableCell>{spent.toFixed(2)} CLD</TableCell>
                    <TableCell>{remaining.toFixed(2)} CLD</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={
                        isActive ? 'border-green-500/50 text-green-400 bg-green-500/10' :
                        'border-white/20 text-muted-foreground bg-white/5'
                      }>
                        {isActive ? 'ACTIVE' : 'CLOSED'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setLocation(`/job/${deployment.jobId}`)}>
                        View <ExternalLink className="ml-2 h-3 w-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

// Templates View Component (based on Akash TemplateGallery)
function TemplatesView({
  providers,
  providersLoading,
  onCreateFromTemplate,
}: {
  providers: any[];
  providersLoading: boolean;
  onCreateFromTemplate: (providerPubKeyHash: string, budget: string) => void;
}) {
  const [searchTerms, setSearchTerms] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // Template categories and templates (matching Akash structure)
  const templateCategories = [
    { title: "Web Applications", templates: ["WordPress", "Next.js", "React App"] },
    { title: "Databases", templates: ["PostgreSQL", "MySQL", "MongoDB"] },
    { title: "Development Tools", templates: ["VS Code Server", "Jupyter Notebook", "GitLab"] },
    { title: "Media & Streaming", templates: ["Plex Server", "Jellyfin", "OBS Studio"] },
  ];

  const allTemplates = [
    { id: "wordpress", name: "WordPress", category: "Web Applications", description: "Popular CMS for blogs and websites", budget: "50", logoUrl: null },
    { id: "nextjs", name: "Next.js", category: "Web Applications", description: "React framework for production", budget: "60", logoUrl: null },
    { id: "react-app", name: "React App", category: "Web Applications", description: "Standard React application", budget: "40", logoUrl: null },
    { id: "postgresql", name: "PostgreSQL", category: "Databases", description: "Advanced open-source relational database", budget: "80", logoUrl: null },
    { id: "mysql", name: "MySQL", category: "Databases", description: "Popular relational database management system", budget: "70", logoUrl: null },
    { id: "mongodb", name: "MongoDB", category: "Databases", description: "NoSQL document database", budget: "75", logoUrl: null },
    { id: "vscode", name: "VS Code Server", category: "Development Tools", description: "Browser-based code editor", budget: "45", logoUrl: null },
    { id: "jupyter", name: "Jupyter Notebook", category: "Development Tools", description: "Interactive data science environment", budget: "55", logoUrl: null },
    { id: "gitlab", name: "GitLab", category: "Development Tools", description: "DevOps platform and Git repository", budget: "100", logoUrl: null },
    { id: "plex", name: "Plex Server", category: "Media & Streaming", description: "Media server for streaming content", budget: "65", logoUrl: null },
    { id: "jellyfin", name: "Jellyfin", category: "Media & Streaming", description: "Open-source media server", budget: "60", logoUrl: null },
    { id: "obs", name: "OBS Studio", category: "Media & Streaming", description: "Streaming and recording software", budget: "50", logoUrl: null },
  ];

  // Filter templates based on category and search
  const filteredTemplates = allTemplates.filter(template => {
    const matchesCategory = !selectedCategory || template.category === selectedCategory;
    const matchesSearch = !searchTerms || 
      template.name.toLowerCase().includes(searchTerms.toLowerCase()) ||
      template.description.toLowerCase().includes(searchTerms.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const handleDeployFromTemplate = (template: typeof allTemplates[0]) => {
    const activeProvider = (providers || []).find(p => p.status === 1);
    if (activeProvider) {
      onCreateFromTemplate(activeProvider.pubKeyHash, template.budget);
    }
  };

  return (
    <>
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Find your Template</h1>
        <p className="text-muted-foreground">
          Jumpstart your app development process with our pre-built solutions.
        </p>
      </div>

      <div className="flex gap-6">
        {/* Sidebar Filters */}
        {allTemplates.length > 0 && (
          <div className="hidden md:block w-[222px] flex-shrink-0">
            <p className="mb-4 font-bold">Filter Templates</p>

            <div className="mb-6">
              <Input
                value={searchTerms}
                onChange={(e) => setSearchTerms(e.target.value)}
                placeholder="Search templates..."
                className="w-full"
              />
            </div>

            <div className="space-y-1">
              <Button
                variant={selectedCategory === null ? "secondary" : "ghost"}
                className="w-full justify-start h-8"
                onClick={() => setSelectedCategory(null)}
              >
                All <span className="ml-2 text-xs text-muted-foreground">({allTemplates.length})</span>
              </Button>

              {templateCategories.map((category) => {
                const count = allTemplates.filter(t => t.category === category.title).length;
                return (
                  <Button
                    key={category.title}
                    variant={selectedCategory === category.title ? "secondary" : "ghost"}
                    className="w-full justify-start h-8"
                    onClick={() => setSelectedCategory(category.title)}
                  >
                    {category.title} <span className="ml-2 text-xs text-muted-foreground">({count})</span>
                  </Button>
                );
              })}
            </div>
          </div>
        )}

        {/* Main Content */}
        <div className="flex-1 min-w-0">
          {searchTerms && (
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-white/5">
              <p className="text-muted-foreground">
                Searching for: "{searchTerms}" - {filteredTemplates.length} results
              </p>
              <Button variant="ghost" size="sm" onClick={() => setSearchTerms("")}>
                Clear
              </Button>
            </div>
          )}

          {selectedCategory && !searchTerms && (
            <p className="mb-4 font-bold">{selectedCategory}</p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredTemplates.map((template) => (
              <Card 
                key={template.id} 
                className="border-white/5 bg-card/40 hover:border-primary/20 transition-colors cursor-pointer"
                onClick={() => handleDeployFromTemplate(template)}
              >
                <CardHeader>
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <FileText className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <CardTitle className="truncate">{template.name}</CardTitle>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <CardDescription className="line-clamp-2 mb-4">
                    {template.description}
                  </CardDescription>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Budget:</span>
                    <span className="font-mono font-semibold">{template.budget} CLD</span>
                  </div>
                </CardContent>
                <CardFooter>
                  <Button 
                    className="w-full"
                    disabled={providersLoading || !(providers || []).find(p => p.status === 1)}
                  >
                    <Rocket className="mr-2 h-4 w-4" />
                    Deploy from Template
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>

          {filteredTemplates.length === 0 && (
            <div className="flex h-[200px] flex-col items-center justify-center border border-white/10 rounded-lg">
              <FileText className="mb-4 h-12 w-12 text-muted-foreground" />
              <p className="text-muted-foreground">No templates found. Try adjusting your filters.</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// Providers View Component (uses ProvidersExplorer)
function ProvidersView() {
  return <ProvidersExplorer />;
}

