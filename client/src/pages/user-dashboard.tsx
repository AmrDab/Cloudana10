import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useAccount } from "wagmi";
import { useLocation } from "wouter";
import { Plus, ExternalLink, RefreshCw, Wallet as WalletIcon, Loader2, LayoutDashboard, Briefcase, Home, TrendingUp, Rocket, FileText, ArrowLeft, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { formatEther, parseEther } from "viem";
import { getAllTemplates, type Template, type TemplateCategory } from "./templates";

import { 
  useCLDTokenBalance,
  useCLDTokenAllowance,
  useApproveCLDToken,
  useCreateWorkload,
  WORKLOAD_REGISTRY_ADDRESS,
  hexToBytes32,
  type ResourceRequirements
} from "@/lib/contracts";
import { getAllProviders } from "@/lib/api";
import { useUserJobs } from "@/hooks/useUserJobs";
import { TxLink } from "@/components/ui/tx-link";
import ProvidersExplorer from "@/pages/providers-explorer";
import NewDeployment from "@/pages/new-deployment/index";

type ViewType = "home" | "deployments" | "templates" | "providers";

export default function UserDashboard() {
  const { address, isConnected } = useAccount();
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  
  // Check URL hash for view (e.g., /user#templates)
  const hashView = typeof window !== "undefined" && window.location.hash ? window.location.hash.slice(1) : null;
  const initialView = (hashView && ["home", "deployments", "templates", "providers"].includes(hashView)) ? hashView as ViewType : "home";
  const [activeView, setActiveView] = useState<ViewType>(initialView);
  const [userMenuExpanded, setUserMenuExpanded] = useState(true); // User menu expanded by default
  const [showTemplateSelection, setShowTemplateSelection] = useState(false);

  // Update view when hash changes; show deployments landing (Create card + My Deployments) when opening deployments
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1);
      if (hash && ["home", "deployments", "templates", "providers"].includes(hash)) {
        setActiveView(hash as ViewType);
        if (hash === "deployments") {
          setShowTemplateSelection(false);
        }
      }
    };
    handleHashChange();
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

  // Token approval
  const { approve, isPending: isApproving, isSuccess: isApproved, hash: approveHash, reset: resetApprove } = useApproveCLDToken();

  // Create workload hook
  const { create: createWorkload, isPending: isCreating, isSuccess: isWorkloadCreated, hash: createHash, error: createError, reset: resetCreate } = useCreateWorkload();

  // Check if approval is needed - only when connected
  const { data: allowance } = useCLDTokenAllowance(isConnected ? address : undefined, isConnected ? WORKLOAD_REGISTRY_ADDRESS : undefined);
  const needsApproval = isConnected && budget && allowance && typeof allowance === 'bigint' ? parseFloat(formatEther(allowance)) < parseFloat(budget) : true;

  // Show success/error messages
  useEffect(() => {
    if (isWorkloadCreated && createHash) {
      toast({
        title: "Workload Created Successfully",
        description: "Your workload has been created and registered.",
      });
      setSelectedProvider("");
      setBudget("");
      refetchJobs();
      resetCreate();
    }
  }, [isWorkloadCreated, createHash, toast, refetchJobs, resetCreate]);

  useEffect(() => {
    if (createError) {
      toast({
        title: "Failed to Create Workload",
        description: createError.message || "Transaction failed",
        variant: "destructive",
      });
      resetCreate();
    }
  }, [createError, toast, resetCreate]);

  // Dashboard is always visible, but interactive features require wallet connection

  // Helper function to generate manifestHash from deployment config
  const generateManifestHash = (providerPubKeyHash: string, budget: string): string => {
    // Generate a deterministic hash from provider and budget
    // In production, this should hash the actual deployment manifest
    const data = `${providerPubKeyHash}-${budget}-${Date.now()}`;
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    return Array.from(new Uint8Array(dataBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  };

  // Helper function to create ResourceRequirements from budget
  const createResourceRequirements = (budget: string): ResourceRequirements => {
    // Convert budget to resource requirements
    // These are default values - in production, these should come from the deployment manifest
    const budgetNum = parseFloat(budget) || 0;
    // Estimate resources based on budget (simplified - in production use actual manifest)
    const cpuUnits = BigInt(Math.floor(budgetNum * 100)); // Example: 1 CLD = 100 CPU units
    const memoryBytes = BigInt(Math.floor(budgetNum * 1024 * 1024 * 1024)); // Example: 1 CLD = 1GB
    const storageBytes = BigInt(Math.floor(budgetNum * 1024 * 1024 * 1024 * 2)); // Example: 1 CLD = 2GB storage

    return {
      cpu: cpuUnits,
      memory: memoryBytes,
      storage: storageBytes,
      storageClasses: ["default"],
      requiresGPU: false,
      gpuCount: BigInt(0),
      gpuAttributes: [],
      requiresEdge: false,
      regions: [],
      maxLatency: BigInt(0),
    };
  };

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
      approve(WORKLOAD_REGISTRY_ADDRESS, budget);
      return;
    }

    // Create workload with manifestHash and ResourceRequirements
    const providerPubKeyHash = selectedProvider;
    const manifestHash = generateManifestHash(providerPubKeyHash, budget);
    const requirements = createResourceRequirements(budget);
    
    createWorkload(manifestHash, requirements);
  };

  return (
    <div className="flex gap-6 animate-in fade-in duration-500">
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
            jobs={jobs}
            jobsLoading={jobsLoading}
            handleCreateJob={handleCreateJob}
            isCreating={isCreating}
            isApproving={isApproving}
            needsApproval={needsApproval}
            approveHash={approveHash}
            createHash={createHash}
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
            showTemplateSelection={showTemplateSelection}
            setShowTemplateSelection={setShowTemplateSelection}
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
  jobs,
  jobsLoading,
  handleCreateJob,
  isCreating,
  isApproving,
  needsApproval,
  approveHash,
  createHash,
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
  jobs: any[];
  jobsLoading: boolean;
  handleCreateJob: () => void;
  isCreating: boolean;
  isApproving: boolean;
  needsApproval: boolean;
  approveHash?: `0x${string}`;
  createHash?: `0x${string}`;
  setLocation: (path: string) => void;
  address?: `0x${string}`;
  setActiveView?: (view: ViewType) => void;
  isConnected: boolean;
}) {
  // WorkloadStatus: 0 = Pending, 1 = Active, 2 = Terminated
  const activeDeploymentsCount = jobs.filter(j => j.status === 1).length; // Active workloads
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
            if (typeof window !== "undefined") {
              window.location.hash = "deployments";
            }
            if (setActiveView) {
              setActiveView("deployments");
            }
            if (setLocation) {
              setLocation("/user#deployments");
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
  showTemplateSelection,
  setShowTemplateSelection,
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
  showTemplateSelection: boolean;
  setShowTemplateSelection: (show: boolean) => void;
}) {

  // WorkloadStatus: 0 = Pending, 1 = Active, 2 = Terminated
  const activeDeployments = jobs.filter(j => j.status === 1); // Active workloads
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

      {!showTemplateSelection ? (
        /* Create Deployment Card */
        <Card className="border-primary/20 glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-primary" /> Create New Deployment
            </CardTitle>
            <CardDescription>Provision compute resources by depositing CLD tokens.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!isConnected && (
              <div className="flex flex-col items-center justify-center py-12">
                <WalletIcon className="h-16 w-16 text-muted-foreground mb-4 opacity-50" />
                <p className="text-lg font-medium text-center mb-2">Wallet Not Connected</p>
                <p className="text-sm text-muted-foreground text-center max-w-md">
                  Please connect your wallet to create and manage deployments.
                </p>
              </div>
            )}
          </CardContent>
          <CardFooter className="flex justify-between border-t border-white/5 pt-6">
            <div className="text-sm text-muted-foreground">
              Balance: <span className="font-mono text-foreground">{isConnected ? balance.toFixed(2) : "—"} CLD</span>
            </div>
            <Button 
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log("Create Deployment button clicked");
                setShowTemplateSelection(true);
              }} 
              className="bg-primary hover:bg-primary/90 text-primary-foreground min-w-[160px] cursor-pointer"
              type="button"
            >
              <Plus className="mr-2 h-4 w-4" /> Create Deployment
            </Button>
          </CardFooter>
        </Card>
      ) : (
        /* Template Selection Page - Full Width */
        <NewDeployment
          providers={providers}
          providersLoading={providersLoading}
          selectedProvider={selectedProvider}
          setSelectedProvider={setSelectedProvider}
          budget={budget}
          setBudget={setBudget}
          isConnected={isConnected}
          handleCreateJob={handleCreateJob}
          isCreating={isCreating}
          isApproving={isApproving}
          needsApproval={needsApproval}
          onBack={() => {
            setShowTemplateSelection(false);
          }}
        />
      )}

      {/* Transaction Links */}
      {approveHash && (
        <Card className="border-white/5 bg-card/40 mt-6">
          <CardContent className="pt-6">
            <TxLink hash={approveHash} label="Approval transaction" />
          </CardContent>
        </Card>
      )}
      {createHash && (
        <Card className="border-white/5 bg-card/40 mt-6">
          <CardContent className="pt-6">
            <TxLink hash={createHash} label="Deployment creation transaction" />
          </CardContent>
        </Card>
      )}

      {/* Deployment List - Hide when showing template selection */}
      {!showTemplateSelection && (
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
                // WorkloadStatus: 0 = Pending, 1 = Active, 2 = Terminated
                const statusLabels = ['PENDING', 'ACTIVE', 'TERMINATED'];
                const statusLabel = statusLabels[deployment.status] || 'UNKNOWN';
                const isActive = deployment.status === 1; // Active status
                const isPending = deployment.status === 0;
                
                // For WorkloadRegistry, we don't have deposited/spent/remaining
                // Show N/A or use manifest hash for identification
                const manifestHashDisplay = deployment.manifestHash 
                  ? `${deployment.manifestHash.slice(0, 10)}...${deployment.manifestHash.slice(-8)}`
                  : 'N/A';
                
                return (
                  <TableRow key={deployment.jobId.toString()} className="hover:bg-white/5 border-white/10 transition-colors">
                    <TableCell className="font-mono font-medium text-primary">
                      <span className="cursor-pointer hover:underline" onClick={() => setLocation(`/job/${deployment.jobId}`)}>
                        #{deployment.jobId.toString()}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      {deployment.pubKeyHash ? (
                        `${deployment.pubKeyHash.slice(0, 10)}...${deployment.pubKeyHash.slice(-8)}`
                      ) : (
                        'No provider'
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">N/A</TableCell>
                    <TableCell className="text-muted-foreground">N/A</TableCell>
                    <TableCell className="text-muted-foreground">N/A</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={
                        isActive ? 'border-green-500/50 text-green-400 bg-green-500/10' :
                        isPending ? 'border-yellow-500/50 text-yellow-400 bg-yellow-500/10' :
                        'border-white/20 text-muted-foreground bg-white/5'
                      }>
                        {statusLabel}
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
      )}
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
  const [selectedTemplate, setSelectedTemplate] = useState<(typeof allTemplatesFlat)[number] | null>(null);

  // Fetch templates using async function
  const [allTemplates, setAllTemplates] = useState<Awaited<ReturnType<typeof getAllTemplates>>>(undefined);
  const [templatesLoading, setTemplatesLoading] = useState(true);

  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        setTemplatesLoading(true);
        const templates = await getAllTemplates();
        setAllTemplates(templates);
        
        // Debug: Show allTemplates
        console.log("allTemplates:", templates);
        console.log("allTemplates length:", templates?.length);
        if (templates && templates.length > 0) {
          console.log("First template:", templates[0]);
          console.log("All templates:", JSON.stringify(templates, null, 2));
        }
      } catch (error) {
        console.error("Failed to fetch templates:", error);
        setAllTemplates(undefined);
      } finally {
        setTemplatesLoading(false);
      }
    };

    fetchTemplates();
  }, []);

  // Get categories from API response (allTemplates is already TemplateCategory[])
  // Sort categories alphabetically by title
  const templateCategories = (allTemplates || []).sort((a, b) => 
    a.title.localeCompare(b.title)
  );

  // Flatten all templates from all categories into a single array
  const allTemplatesFlat = allTemplates?.flatMap(category => 
    category.templates.map(template => ({ ...template, category: category.title }))
  ) || [];

  // Filter templates based on category and search
  const filteredTemplates = allTemplatesFlat.filter(template => {
    const matchesCategory = !selectedCategory || template.category === selectedCategory;
    const matchesSearch = !searchTerms || 
      template.name.toLowerCase().includes(searchTerms.toLowerCase()) ||
      (template.summary && template.summary.toLowerCase().includes(searchTerms.toLowerCase()));
    return matchesCategory && matchesSearch;
  });


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
        {allTemplatesFlat.length > 0 && (
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
                All <span className="ml-2 text-xs text-muted-foreground">({allTemplatesFlat.length})</span>
              </Button>

              {templateCategories.map((category) => {
                const count = category.templates?.length || 0;
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

          {templatesLoading ? (
            <div className="flex min-h-[min(420px,65vh)] w-full flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-white/10 bg-muted/20 py-20">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <p className="text-lg font-medium">Loading templates...</p>
              <p className="text-sm text-muted-foreground">Please wait while we fetch available templates</p>
            </div>
          ) : selectedTemplate ? (
            /* Template Info Page */
            <div className="space-y-6">
              <Button
                variant="ghost"
                className="mb-4"
                onClick={() => setSelectedTemplate(null)}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Templates
              </Button>

              <Card className="border-white/5 bg-card/40">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-4">
                      <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                        <FileText className="h-8 w-8 text-primary" />
                      </div>
                      <div>
                        <CardTitle className="text-2xl mb-2">{selectedTemplate.name}</CardTitle>
                        <CardDescription className="text-base">
                          Category: {selectedTemplate.category}
                        </CardDescription>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  {selectedTemplate.summary && (
                    <div>
                      <h3 className="text-lg font-semibold mb-2">Summary</h3>
                      <p className="text-muted-foreground whitespace-pre-line">
                        {selectedTemplate.summary}
                      </p>
                    </div>
                  )}

                  {selectedTemplate.readme && (
                    <div>
                      <h3 className="text-lg font-semibold mb-2">Documentation</h3>
                      <div className="max-h-96 overflow-y-auto rounded-md border border-white/10 bg-background/60 p-4 text-sm text-muted-foreground whitespace-pre-wrap">
                        {selectedTemplate.readme}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-white/10">
                    <div>
                      <p className="text-sm font-medium mb-1">Template Path</p>
                      <p className="text-sm text-muted-foreground font-mono break-all">
                        {selectedTemplate.path}
                      </p>
                    </div>
                    {selectedTemplate.githubUrl && (
                      <div>
                        <p className="text-sm font-medium mb-1">GitHub Repository</p>
                        <a
                          href={selectedTemplate.githubUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm text-primary underline underline-offset-2 hover:text-primary/80 break-all"
                        >
                          {selectedTemplate.githubUrl}
                        </a>
                      </div>
                    )}
                    {selectedTemplate.logoUrl && (
                      <div>
                        <p className="text-sm font-medium mb-1">Logo</p>
                        <img 
                          src={selectedTemplate.logoUrl} 
                          alt={selectedTemplate.name}
                          className="h-16 w-16 object-contain"
                        />
                      </div>
                    )}
                    {selectedTemplate.persistentStorageEnabled !== undefined && (
                      <div>
                        <p className="text-sm font-medium mb-1">Persistent Storage</p>
                        <Badge variant={selectedTemplate.persistentStorageEnabled ? "default" : "secondary"}>
                          {selectedTemplate.persistentStorageEnabled ? "Enabled" : "Disabled"}
                        </Badge>
                      </div>
                    )}
                  </div>

                  {selectedTemplate.deploy && (
                    <div className="pt-4 border-t border-white/10">
                      <h3 className="text-lg font-semibold mb-2">Deploy Configuration</h3>
                      <div className="rounded-md border border-white/10 bg-background/60 p-4">
                        <pre className="text-xs text-muted-foreground whitespace-pre-wrap overflow-x-auto">
                          {selectedTemplate.deploy}
                        </pre>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredTemplates.map((template) => (
                  <Card 
                    key={template.id} 
                    className="border-white/5 bg-card/40 hover:border-primary/20 transition-colors cursor-pointer"
                    onClick={() => setSelectedTemplate(template)}
                  >
                    <CardHeader>
                      <div className="flex items-center gap-4">
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden">
                          {template.logoUrl ? (
                            <img 
                              src={template.logoUrl} 
                              alt={template.name}
                              className="h-full w-full object-contain p-1"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                                const fallback = e.currentTarget.parentElement?.querySelector('.fallback-icon');
                                if (fallback) fallback.classList.remove('hidden');
                              }}
                            />
                          ) : null}
                          <FileText className={`h-5 w-5 text-primary fallback-icon ${template.logoUrl ? 'hidden' : ''}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <CardTitle className="truncate">{template.name}</CardTitle>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <CardDescription className="line-clamp-2 mb-4">
                        {template.summary || "No description available"}
                      </CardDescription>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground">Budget:</span>
                        <span className="font-mono font-semibold">{(template as any).budget || "100"} CLD</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {filteredTemplates.length === 0 && !templatesLoading && (
                <div className="flex h-[200px] flex-col items-center justify-center border border-white/10 rounded-lg">
                  <FileText className="mb-4 h-12 w-12 text-muted-foreground" />
                  <p className="text-muted-foreground">No templates found. Try adjusting your filters.</p>
                </div>
              )}
            </>
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

