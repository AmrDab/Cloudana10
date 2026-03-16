import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useAccount } from "wagmi";
import { useLocation, useParams } from "wouter";
import { Plus, RefreshCw, Wallet as WalletIcon, Loader2, LayoutDashboard, Briefcase, Home, TrendingUp, Rocket, FileText, ArrowLeft, X, Check, Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { formatEther, parseEther } from "viem";
import { useAllTemplates, type Template, type TemplateCategory } from "./templates";
import { BalanceDisplay } from "@/components/payments/BalanceDisplay";

import { 
  useCLDTokenBalance,
  useRegisterWorkload,
} from "@/lib/contracts";
import { getAllProviders, uploadWorkloadManifestToIPFS } from "@/lib/api";
import { useUserJobs } from "@/hooks/useUserJobs";
import { useWorkloadDetails } from "@/hooks/useWorkloadDetails";
import { useWorkloadManifest } from "@/hooks/useWorkloadManifest";
import { DeploymentSpecs } from "@/components/deployment-specs";
import { TxLink } from "@/components/ui/tx-link";
import ProvidersExplorer from "@/pages/providers-explorer";
import NewDeployment from "@/pages/new-deployment/index";
import { devLoggers } from "@/lib/logger";
import { OnboardingModal } from "@/components/onboarding/OnboardingModal";

type ViewType = "home" | "deployments" | "templates" | "providers";
const log = devLoggers.deploy;

export default function UserDashboard() {
  const { address, isConnected } = useAccount();
  const [location, setLocation] = useLocation();
  const params = useParams<{ section?: string }>();
  const { toast } = useToast();

  // Support both /user/:section path and /user#section hash routing
  const pathSection = params.section;
  const hashView = typeof window !== "undefined" && window.location.hash ? window.location.hash.slice(1) : null;
  const sectionFromUrl = pathSection || hashView;
  const initialView = (sectionFromUrl && ["home", "deployments", "templates", "providers"].includes(sectionFromUrl)) ? sectionFromUrl as ViewType : "home";
  const [activeView, setActiveView] = useState<ViewType>(initialView);
  const [userMenuExpanded, setUserMenuExpanded] = useState(true); // User menu expanded by default
  const [showTemplateSelection, setShowTemplateSelection] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Show onboarding for first-time connected users
  useEffect(() => {
    if (isConnected && !localStorage.getItem("onboarding_complete")) {
      setShowOnboarding(true);
    }
  }, [isConnected]);

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
  const { register: registerWorkload, isPending: isCreating, isSuccess: isWorkloadCreated, hash: createHash, error: createError, reset: resetCreate } = useRegisterWorkload();

  // Single-step: upload manifest to IPFS then register workload with metadataUri. Orchestrator matches via WorkloadRegistered event.
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

  /** Upload manifest to IPFS then register workload with metadataUri (CID or URL). Requirements live in IPFS. */
  const handleCreateJob = async (template?: { deploy?: string; name?: string; summary?: string }) => {
    if (!address) {
      toast({
        title: "Error",
        description: "Wallet not connected",
        variant: "destructive"
      });
      return;
    }

    let manifestPayload: unknown;
    if (template?.deploy?.trim()) {
      try {
        manifestPayload = JSON.parse(template.deploy) as unknown;
      } catch (e) {
        toast({
          title: "Invalid deployment config",
          description: e instanceof Error ? e.message : "Failed to parse template deploy config",
          variant: "destructive"
        });
        return;
      }
    } else {
      manifestPayload = {
        name: template?.name,
        summary: template?.summary,
        requirements: { cpu: 1000, memory: 1073741824, storage: 10737418240 },
        createdAt: new Date().toISOString(),
      };
    }

    const metadataUri = await uploadWorkloadManifestToIPFS(manifestPayload);
    registerWorkload(metadataUri);
  };

  return (
    <div className="flex gap-6 animate-in fade-in duration-500">
      <OnboardingModal open={showOnboarding} onClose={() => setShowOnboarding(false)} />
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
            createHash={createHash}
            refetchJobs={refetchJobs}
            isConnected={isConnected}
            showTemplateSelection={showTemplateSelection}
            setShowTemplateSelection={setShowTemplateSelection}
            setActiveView={setActiveView}
            onRegistrationSuccess={async () => {
              // Hide template selection immediately
              setShowTemplateSelection(false);
              setActiveView("deployments");
              
              // Wait for RPC node to index the new workload, then refetch with retries
              // First quick refetch after 1s, then retry after 2.5s if needed
              setTimeout(async () => {
                await refetchJobs();
                // Second refetch to catch any indexing delays
                setTimeout(() => refetchJobs(), 1500);
              }, 1000);
            }}
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
  handleCreateJob: (template?: { deploy?: string; name?: string; summary?: string }) => void;
  isCreating: boolean;
  createHash?: `0x${string}`;
  setLocation: (path: string) => void;
  address?: `0x${string}`;
  setActiveView?: (view: ViewType) => void;
  isConnected: boolean;
}) {
  // WorkloadStatus (contract): 0 = Inactive, 1 = Active
  const activeDeploymentsCount = jobs.filter(j => j.status === 1).length; // Active workloads
  const totalSpentInDeployments = jobs.reduce((sum, job) => sum + parseFloat(formatEther(job.spent)), 0);
  
  // Estimated USD equivalent; CLD is a testnet token with no real value
  const cldToUsd = 0.1; // Estimated rate (testnet)
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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
              Estimated Cost
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" title="Estimated cost (testnet)">~${totalCostPerHour.toFixed(2)} / hr</div>
            <div className="text-xs text-muted-foreground mt-2" title="Estimated cost (testnet)">
              ~${totalCostPerMonth.toFixed(2)} / month
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Credit Balance + Add Funds */}
      <BalanceDisplay />
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
  createHash,
  refetchJobs,
  isConnected,
  showTemplateSelection,
  setShowTemplateSelection,
  setActiveView,
  onRegistrationSuccess,
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
  handleCreateJob: (template?: { deploy?: string; name?: string; summary?: string }) => void;
  isCreating: boolean;
  createHash?: `0x${string}`;
  refetchJobs: () => void;
  isConnected: boolean;
  showTemplateSelection: boolean;
  setShowTemplateSelection: (show: boolean) => void;
  setActiveView: (view: ViewType) => void;
  onRegistrationSuccess?: () => void;
}) {

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // WorkloadStatus: 0 = Pending, 1 = Active, 2 = Terminated
  const activeDeployments = jobs.filter(j => j.status === 1); // Active workloads
  const allDeployments = jobs;
  
  // Pagination calculations
  const totalPages = Math.ceil(allDeployments.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedDeployments = allDeployments.slice(startIndex, endIndex);

  // Reset to page 1 when deployments change significantly
  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(1);
    }
  }, [allDeployments.length, currentPage, totalPages]);

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
            <CardDescription>Register your workload in one step. The orchestrator will match a provider automatically.</CardDescription>
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
                log.log("Create Deployment button clicked");
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
          isConnected={isConnected}
          onBack={() => {
            setShowTemplateSelection(false);
          }}
          onRegistrationSuccess={onRegistrationSuccess}
        />
      )}

      {/* Transaction Links */}
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
                <TableHead className="text-center">Specs</TableHead>
                <TableHead className="text-center">Name</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-center">DSEQ</TableHead>
                <TableHead className="text-center">Est. cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobsLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-8 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  </TableRow>
                ))
              ) : allDeployments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                    No deployments yet. Create your first deployment to get started.
                  </TableCell>
                </TableRow>
              ) : paginatedDeployments.map((deployment) => (
                <DeploymentTableRow
                  key={deployment.jobId.toString()}
                  deployment={deployment}
                  onView={() => setLocation(`/job/${deployment.jobId}`)}
                />
              ))}
            </TableBody>
          </Table>
        </CardContent>
        {totalPages > 1 && (
          <CardFooter className="flex items-center justify-between border-t pt-4">
            <div className="text-sm text-muted-foreground">
              Showing {startIndex + 1}-{Math.min(endIndex, allDeployments.length)} of {allDeployments.length} deployments
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </Button>
              <div className="flex items-center gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                  <Button
                    key={page}
                    variant={page === currentPage ? "default" : "outline"}
                    size="sm"
                    onClick={() => setCurrentPage(page)}
                    className="w-8 h-8 p-0"
                  >
                    {page}
                  </Button>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
              >
                Next
              </Button>
            </div>
          </CardFooter>
        )}
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
  const { data: allTemplates, isLoading: templatesLoading } = useAllTemplates();

  type FlatTemplate = Template & { category: string };
  const allTemplatesFlat: FlatTemplate[] = allTemplates?.flatMap(category =>
    category.templates.map(template => ({ ...template, category: category.title }))
  ) ?? [];
  const [selectedTemplate, setSelectedTemplate] = useState<FlatTemplate | null>(null);

  // Get categories from API response (templates from backend DB)
  const templateCategories = (allTemplates || []).sort((a, b) =>
    a.title.localeCompare(b.title)
  );

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
          Browse ready-to-deploy workload templates. Pick one and deploy in a few clicks.
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
              <p className="text-sm text-muted-foreground">Templates are loaded from the server database.</p>
            </div>
          ) : allTemplatesFlat.length === 0 ? (
            <div className="flex min-h-[min(420px,65vh)] w-full flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-white/10 bg-muted/20 py-20">
              <FileText className="h-12 w-12 text-muted-foreground" />
              <p className="text-lg font-medium">No templates yet</p>
              <p className="text-sm text-muted-foreground text-center max-w-sm">
                Templates are served from the server database. Ask your administrator to run the fetch-templates script to populate templates.
              </p>
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

// Deployment Table Row Component
function DeploymentTableRow({
  deployment,
  onView,
}: {
  deployment: any;
  onView: () => void;
}) {
  const workloadId = deployment.jobId !== undefined && deployment.jobId !== null ? BigInt(deployment.jobId) : undefined;
  const { data: workloadDetails, isLoading: detailsLoading } = useWorkloadDetails(workloadId);
  const { data: manifestFromIPFS } = useWorkloadManifest(workloadId);
  const [copiedDseq, setCopiedDseq] = useState(false);

  // WorkloadStatus (contract): 0 = Inactive, 1 = Active
  const statusLabels = ['INACTIVE', 'ACTIVE'];
  const statusLabel = statusLabels[deployment.status] ?? 'UNKNOWN';
  const isActive = deployment.status === 1;

  // Requirements come from IPFS manifest (chain only has metadataUri)
  const requirements = manifestFromIPFS?.requirements;
  const cpuAmount = requirements && typeof requirements.cpu !== 'undefined' ? Number(requirements.cpu) : 0;
  const memoryAmount = requirements ? BigInt(Number(requirements.memory ?? (requirements as Record<string, unknown>).memoryBytes ?? 0) || 0) : BigInt(0);
  const storageAmount = requirements ? BigInt(Number(requirements.storage ?? (requirements as Record<string, unknown>).storageBytes ?? 0) || 0) : BigInt(0);
  const gpuAmount = requirements && (requirements as Record<string, unknown>).requiresGPU ? Number((requirements as Record<string, unknown>).gpuCount ?? 0) : 0;

  // Estimated cost; CLD is a testnet token with no real value
  const cldToUsd = 0.1; // Estimated rate (testnet)
  const hourlyCost = requirements
    ? (cpuAmount / 1000 * 0.01 + Number(memoryAmount) / (1024 * 1024 * 1024) * 0.001 + Number(storageAmount) / (1024 * 1024 * 1024) * 0.0001 + gpuAmount * 0.1) * cldToUsd
    : 0;

  // Deployment name from IPFS manifest (fallback to generic if not loaded yet)
  const deploymentName = manifestFromIPFS?.name || `Deployment-${deployment.jobId.toString().slice(-6)}`;

  // Extract Docker image from manifest (from services.*.image)
  let dockerImage = "Unknown";
  if (manifestFromIPFS?.manifest) {
    try {
      const manifestObj = typeof manifestFromIPFS.manifest === "string" 
        ? JSON.parse(manifestFromIPFS.manifest) 
        : manifestFromIPFS.manifest;
      const services = manifestObj?.services || {};
      const firstService = Object.values(services)[0] as Record<string, unknown> | undefined;
      dockerImage = (firstService?.image as string) || "Unknown";
    } catch {
      dockerImage = "Unknown";
    }
  }

  // DSEQ (Deployment Sequence ID) - using jobId
  const dseq = deployment.jobId.toString();

  const handleCopyDseq = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(dseq);
      setCopiedDseq(true);
      setTimeout(() => setCopiedDseq(false), 2000);
    } catch (err) {
      log.error('Failed to copy DSEQ:', err);
    }
  };

  return (
    <TableRow 
      className="hover:bg-white/5 border-white/10 transition-colors cursor-pointer"
      onClick={onView}
    >
      {/* Specs */}
      <TableCell>
        <div className="flex items-center justify-center">
          {detailsLoading ? (
            <Skeleton className="h-6 w-32" />
          ) : (
            <DeploymentSpecs
              cpuAmount={cpuAmount}
              memoryAmount={memoryAmount}
              storageAmount={storageAmount}
              gpuAmount={gpuAmount}
            />
          )}
        </div>
      </TableCell>

      {/* Name */}
      <TableCell className="text-center">
        <div className="font-medium">{deploymentName}</div>
        <div className="text-xs text-muted-foreground font-mono mt-0.5" title={dockerImage}>
          {dockerImage.length > 30 ? dockerImage.slice(0, 30) + '...' : dockerImage}
        </div>
      </TableCell>

      {/* Status */}
      <TableCell className="text-center">
        <Badge variant={isActive ? "default" : "secondary"} className={isActive ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-gray-500/20 text-gray-400 border-gray-500/30"}>
          {statusLabel}
        </Badge>
      </TableCell>

      {/* DSEQ */}
      <TableCell className="text-center">
        <div className="flex items-center justify-center gap-1">
          <span className="font-mono text-sm">{dseq}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleCopyDseq}
            title={copiedDseq ? "Copied!" : "Copy DSEQ"}
          >
            {copiedDseq ? (
              <Check className="h-3 w-3 text-green-500" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </Button>
        </div>
      </TableCell>

      {/* Est. cost (balance not tracked on-chain in MVP) */}
      <TableCell className="text-center">
        {hourlyCost > 0 ? (
          <div className="text-sm font-mono" title="Estimated cost (testnet)">~${hourlyCost.toFixed(2)} / hr</div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}

