import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { AddressDisplay } from "@/components/ui/address-display";
import { TxLink } from "@/components/ui/tx-link";
import { useWallet } from "@/context/wallet-context";
import { useLocation } from "wouter";
import { ArrowLeft, CheckCircle2, Clock, XCircle, Loader2, Edit, Save, X, Trash2, Copy, ExternalLink, AlertCircle, Download, Terminal } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { Spinner } from "@/components/ui/spinner";
import { useWorkloadDetails } from "@/hooks/useWorkloadDetails";
import { useWorkloadManifest } from "@/hooks/useWorkloadManifest";
import { useWorkloadExecutionStatus, useWorkloadLogs } from "@/hooks/useWorkloadExecutionStatus";
import { DeploymentSpecs } from "@/components/deployment-specs";
import { useUpdateWorkload, useDeregisterWorkload, useActivateWorkload, useDeleteWorkload, type ResourceRequirements } from "@/lib/contracts";
import { useAccount } from "wagmi";
import { Textarea } from "@/components/ui/textarea";
import { uploadWorkloadManifestToIPFS } from "@/lib/api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface JobDetailPageProps {
  params?: { id?: string };
}

export default function JobDetailPage({ params }: JobDetailPageProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { address, isConnected } = useAccount();
  
  // Handle case when route params are not yet available (e.g., on refresh)
  if (!params || !params.id || params.id === "") {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner className="h-10 w-10 text-primary" />
      </div>
    );
  }

  const workloadId = BigInt(params.id);
  const { data: workloadDetails, isLoading: detailsLoading, error: detailsError } = useWorkloadDetails(workloadId);
  const { data: manifestFromIPFS, isLoading: manifestLoading } = useWorkloadManifest(workloadId);
  const instanceId = workloadDetails?.placementInstanceId;
  const { data: executionStatus, isLoading: statusLoading } = useWorkloadExecutionStatus(workloadId, instanceId);
  const { logs: workloadLogs, isLoading: logsLoading, refresh: refreshLogs } = useWorkloadLogs(workloadId, instanceId);
  const [isEditing, setIsEditing] = useState(false);
  const [editedManifest, setEditedManifest] = useState("");
  const [editedRequirements, setEditedRequirements] = useState<ResourceRequirements | null>(null);

  const { update: updateWorkload, isPending: isUpdating, isSuccess: isUpdated, hash: updateHash, error: updateError, reset: resetUpdate } = useUpdateWorkload();
  const { deregister, isPending: isDeregistering, isSuccess: isDeregistered, hash: deregisterHash, error: deregisterError, reset: resetDeregister } = useDeregisterWorkload();
  const { activate, isPending: isActivating, isSuccess: isActivated, hash: activateHash, error: activateError, reset: resetActivate } = useActivateWorkload();
  const { deleteWorkload, isPending: isDeleting, isSuccess: isDeleted, hash: deleteHash, error: deleteError, reset: resetDelete } = useDeleteWorkload();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [urlStatus, setUrlStatus] = useState<Record<string, 'checking' | 'online' | 'offline'>>({});

  // Helper to extract IP from provider endpoint
  const extractProviderIP = (endpoint: string): string | null => {
    try {
      const url = new URL(endpoint.startsWith('http') ? endpoint : `http://${endpoint}`);
      return url.hostname;
    } catch {
      // Fallback: simple regex extraction
      const match = endpoint.match(/(\d+\.\d+\.\d+\.\d+)/);
      return match ? match[1] : null;
    }
  };

  // Helper to build service URL
  const buildServiceUrl = (providerEndpoint: string, nodePort: number, protocol: string): string => {
    const ip = extractProviderIP(providerEndpoint);
    if (!ip) return '';
    
    // Use http:// for standard ports, could detect https in future
    const scheme = protocol.toLowerCase() === 'https' ? 'https' : 'http';
    return `${scheme}://${ip}:${nodePort}`;
  };

  // Helper to copy to clipboard
  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: "Copied!",
        description: "URL copied to clipboard",
      });
    } catch (err) {
      toast({
        title: "Copy failed",
        description: "Please copy manually",
        variant: "destructive",
      });
    }
  };

  // Function to check URL reachability
  const checkUrlStatus = async (url: string) => {
    setUrlStatus(prev => ({ ...prev, [url]: 'checking' }));
    
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      
      await fetch(url, { 
        method: 'HEAD', 
        mode: 'no-cors', // Allow checking cross-origin
        signal: controller.signal 
      });
      
      clearTimeout(timeout);
      setUrlStatus(prev => ({ ...prev, [url]: 'online' }));
    } catch {
      setUrlStatus(prev => ({ ...prev, [url]: 'offline' }));
    }
  };

  // Initialize edited values from IPFS manifest (requirements live on IPFS)
  useEffect(() => {
    if (workloadDetails && !isEditing) {
      if (manifestFromIPFS?.manifest) {
        setEditedManifest(manifestFromIPFS.manifest);
      } else {
        setEditedManifest("");
      }
      const req = manifestFromIPFS?.requirements as Record<string, unknown> | undefined;
      if (req && typeof req === "object") {
        setEditedRequirements({
          cpu: BigInt(Number(req.cpu ?? 1000)),
          memory: BigInt(Number(req.memory ?? req.memoryBytes ?? 1073741824)),
          storage: BigInt(Number(req.storage ?? req.storageBytes ?? 10737418240)),
          storageClasses: Array.isArray(req.storageClasses) ? (req.storageClasses as string[]) : [],
          requiresGPU: Boolean(req.requiresGPU),
          gpuCount: BigInt(Number(req.gpuCount ?? 0)),
          gpuAttributes: Array.isArray(req.gpuAttributes) ? (req.gpuAttributes as string[]) : [],
          requiresEdge: Boolean(req.requiresEdge),
          regions: Array.isArray(req.regions) ? (req.regions as string[]) : [],
          maxLatency: BigInt(Number(req.maxLatency ?? 0)),
        });
      }
    }
  }, [workloadDetails, manifestFromIPFS, isEditing]);

  // Handle update success
  useEffect(() => {
    if (isUpdated && updateHash) {
      toast({
        title: "Deployment Updated",
        description: "Your deployment has been updated successfully.",
      });
      setIsEditing(false);
      resetUpdate();
    }
  }, [isUpdated, updateHash, toast, resetUpdate]);

  // Handle update error
  useEffect(() => {
    if (updateError) {
      toast({
        title: "Update Failed",
        description: (
          <div className="max-w-full">
            <p className="break-words whitespace-pre-wrap">{updateError.message || "Failed to update deployment"}</p>
          </div>
        ),
        variant: "destructive",
      });
      resetUpdate();
    }
  }, [updateError, toast, resetUpdate]);

  // Handle deregister success
  useEffect(() => {
    if (isDeregistered && deregisterHash) {
      toast({
        title: "Deployment Deactivated",
        description: "Your deployment has been deactivated successfully.",
      });
      resetDeregister();
      setTimeout(() => window.location.reload(), 1000);
    }
  }, [isDeregistered, deregisterHash, toast, resetDeregister]);

  // Handle deregister error
  useEffect(() => {
    if (deregisterError) {
      toast({
        title: "Deactivation Failed",
        description: deregisterError.message || "Failed to deactivate deployment",
        variant: "destructive",
      });
      resetDeregister();
    }
  }, [deregisterError, toast, resetDeregister]);

  // Handle activate success
  useEffect(() => {
    if (isActivated && activateHash) {
      toast({
        title: "Deployment Activated",
        description: "Your deployment has been activated successfully.",
      });
      resetActivate();
      setTimeout(() => window.location.reload(), 1000);
    }
  }, [isActivated, activateHash, toast, resetActivate]);

  // Handle activate error
  useEffect(() => {
    if (activateError) {
      toast({
        title: "Activation Failed",
        description: activateError.message || "Failed to activate deployment",
        variant: "destructive",
      });
      resetActivate();
    }
  }, [activateError, toast, resetActivate]);

  // Handle delete success
  useEffect(() => {
    if (isDeleted && deleteHash) {
      toast({
        title: "Deployment Deleted",
        description: "Your deployment has been permanently deleted.",
      });
      resetDelete();
      setTimeout(() => setLocation("/user#deployments"), 1500);
    }
  }, [isDeleted, deleteHash, toast, resetDelete, setLocation]);

  // Handle delete error
  useEffect(() => {
    if (deleteError) {
      toast({
        title: "Deletion Failed",
        description: deleteError.message || "Failed to delete deployment. Make sure it's deactivated first.",
        variant: "destructive",
      });
      resetDelete();
    }
  }, [deleteError, toast, resetDelete]);

  const handleSave = async () => {
    if (!editedManifest || !editedRequirements || !isConnected) {
      toast({
        title: "Error",
        description: "Please fill in all fields and connect your wallet",
        variant: "destructive",
      });
      return;
    }

    try {
      // Convert BigInt requirements to JSON-serializable format
      const requirementsSerializable = editedRequirements ? {
        cpu: String(editedRequirements.cpu),
        memory: String(editedRequirements.memory),
        storage: String(editedRequirements.storage),
        storageClasses: editedRequirements.storageClasses,
        requiresGPU: editedRequirements.requiresGPU,
        gpuCount: String(editedRequirements.gpuCount),
        gpuAttributes: editedRequirements.gpuAttributes,
        requiresEdge: editedRequirements.requiresEdge,
        regions: editedRequirements.regions,
        maxLatency: String(editedRequirements.maxLatency),
      } : undefined;
      const payload = { manifest: editedManifest, requirements: requirementsSerializable, updatedAt: new Date().toISOString() };
      const metadataUri = await uploadWorkloadManifestToIPFS(payload);
      updateWorkload(workloadId, metadataUri);
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to upload to IPFS or update deployment",
        variant: "destructive",
      });
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    if (workloadDetails) {
      setEditedManifest(manifestFromIPFS?.manifest ?? JSON.stringify({
        version: "2.0",
        services: { web: { image: "nginx:latest" } },
        profiles: { compute: { web: { resources: {} } } }
      }, null, 2));
      const req = manifestFromIPFS?.requirements as Record<string, unknown> | undefined;
      if (req && typeof req === "object") {
        setEditedRequirements({
          cpu: BigInt(Number(req.cpu ?? 1000)),
          memory: BigInt(Number(req.memory ?? req.memoryBytes ?? 1073741824)),
          storage: BigInt(Number(req.storage ?? req.storageBytes ?? 10737418240)),
          storageClasses: Array.isArray(req.storageClasses) ? (req.storageClasses as string[]) : [],
          requiresGPU: Boolean(req.requiresGPU),
          gpuCount: BigInt(Number(req.gpuCount ?? 0)),
          gpuAttributes: Array.isArray(req.gpuAttributes) ? (req.gpuAttributes as string[]) : [],
          requiresEdge: Boolean(req.requiresEdge),
          regions: Array.isArray(req.regions) ? (req.regions as string[]) : [],
          maxLatency: BigInt(Number(req.maxLatency ?? 0)),
        });
      }
    }
  };

  if (detailsLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner className="h-10 w-10 text-primary" />
      </div>
    );
  }

  if (detailsError || !workloadDetails) {
    return (
      <div className="flex flex-col items-center justify-center py-16 max-w-md text-center space-y-4">
        <p className="text-muted-foreground font-medium">Failed to load deployment details</p>
        <p className="text-sm text-muted-foreground">
          This usually means the workload was not found on-chain for this network (wrong chain or invalid workload ID).
          It is not related to IPFS — manifest is loaded only after the deployment record is found.
        </p>
        {detailsError && (
          <p className="text-sm text-destructive font-mono break-all">{detailsError.message}</p>
        )}
        <p className="text-xs text-muted-foreground">Workload ID: {params?.id}. Ensure your wallet is on the same network you used when registering.</p>
        <Button variant="outline" onClick={() => setLocation("/user#deployments")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Deployments
        </Button>
      </div>
    );
  }

  const statusLabels = ['INACTIVE', 'ACTIVE'];
  const statusLabel = statusLabels[workloadDetails.status] ?? 'UNKNOWN';
  const isActive = workloadDetails.status === 1;
  const isPending = workloadDetails.status === 0;

  const requirements = manifestFromIPFS?.requirements as Record<string, unknown> | undefined;
  const cpuAmount = requirements && typeof requirements.cpu === 'number' ? requirements.cpu : (requirements && typeof requirements.cpu === 'string' ? parseInt(String(requirements.cpu), 10) : 0);
  const memoryAmount = requirements ? BigInt(Number(requirements.memory ?? requirements.memoryBytes ?? 0)) : BigInt(0);
  const storageAmount = requirements ? BigInt(Number(requirements.storage ?? requirements.storageBytes ?? 0)) : BigInt(0);
  const gpuAmount = requirements && (requirements.requiresGPU || Number(requirements.gpuCount) > 0) ? Number(requirements.gpuCount ?? 0) : 0;


  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => setLocation("/user#deployments")} className="pl-0 hover:pl-2 transition-all">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Deployments
        </Button>
        {!isEditing && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setIsEditing(true)} disabled={!isConnected}>
              <Edit className="mr-2 h-4 w-4" /> Edit Deployment
            </Button>
            {isActive ? (
              <Button
                variant="outline"
                onClick={() => deregister(workloadId)}
                disabled={isDeregistering || !isConnected}
                className="border-destructive/30 text-destructive hover:bg-destructive/10"
              >
                {isDeregistering ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Deactivating...
                  </>
                ) : (
                  <>
                    <XCircle className="mr-2 h-4 w-4" />
                    Deactivate
                  </>
                )}
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => activate(workloadId)}
                  disabled={isActivating || !isConnected}
                  className="border-green-500/30 text-green-400 hover:bg-green-500/10"
                >
                  {isActivating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Activating...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      Activate
                    </>
                  )}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={!isConnected}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Top Summary */}
          <Card className="glass-card border-white/10">
            <CardHeader>
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="text-2xl font-mono">DSEQ: {workloadDetails.id.toString()}</CardTitle>
                  <CardDescription>
                    Registered {new Date(Number(workloadDetails.registeredAt) * 1000).toLocaleDateString()}
                  </CardDescription>
                </div>
                <Badge variant="outline" className={
                  isActive ? 'border-green-500/50 text-green-400 bg-green-500/10 text-sm px-3 py-1' :
                  isPending ? 'border-yellow-500/50 text-yellow-400 bg-yellow-500/10 text-sm px-3 py-1' :
                  'border-white/20 text-muted-foreground bg-white/5 text-sm px-3 py-1'
                }>
                  {statusLabel}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Resource Specs */}
              <div>
                <Label className="text-sm text-muted-foreground mb-2 block">Resource Specifications</Label>
                <DeploymentSpecs
                  cpuAmount={cpuAmount}
                  memoryAmount={memoryAmount}
                  storageAmount={storageAmount}
                  gpuAmount={gpuAmount}
                />
              </div>

              <Separator />

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground block mb-2">Owner</span>
                  <AddressDisplay address={workloadDetails.owner} truncate={true} truncateLength={6} />
                </div>
                <div>
                  <span className="text-muted-foreground block mb-2">Provider</span>
                  {workloadDetails.placementProvider && workloadDetails.placementProvider !== "0x0000000000000000000000000000000000000000" ? (
                    <AddressDisplay address={workloadDetails.placementProvider as `0x${string}`} truncate={true} truncateLength={6} />
                  ) : (
                    <div className="space-y-1">
                      <span className="text-muted-foreground">No provider assigned</span>
                      {isPending && (
                        <p className="text-xs text-muted-foreground">
                          Orchestrator will assign a provider when one is available.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Manifest content from IPFS */}
              <div>
                <span className="text-muted-foreground block mb-2 text-sm">Manifest</span>
                {manifestLoading ? (
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading manifest from IPFS...
                  </div>
                ) : manifestFromIPFS ? (
                  <div className="space-y-2">
                    {manifestFromIPFS.name && (
                      <div className="text-sm font-medium">{manifestFromIPFS.name}</div>
                    )}
                    {manifestFromIPFS.description && (
                      <p className="text-xs text-muted-foreground">{manifestFromIPFS.description}</p>
                    )}
                    {manifestFromIPFS.manifest && (
                      <pre className="text-xs font-mono bg-muted/50 p-3 rounded overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap break-words">
                        {manifestFromIPFS.manifest}
                      </pre>
                    )}
                    {manifestFromIPFS.requirements && (
                      <DeploymentSpecs
                        cpuAmount={cpuAmount}
                        memoryAmount={memoryAmount}
                        storageAmount={storageAmount}
                        gpuAmount={gpuAmount}
                        className="mt-2"
                      />
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Manifest not available (IPFS content not found for this workload)</p>
                )}
              </div>

              {/* Debug Info - Show why execution status might not be visible */}
              {!isActive && workloadDetails.placementProvider && workloadDetails.placementProvider !== "0x0000000000000000000000000000000000000000" && (
                <Card className="border-amber-500/50 bg-amber-500/5">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2 text-amber-600">
                      <AlertCircle className="h-4 w-4" />
                      Workload Not Active
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    <p>This workload has a provider assigned but is not in active status.</p>
                    <p className="mt-2">Provider: <code className="text-xs bg-muted px-1 py-0.5 rounded">{workloadDetails.placementProvider.slice(0, 10)}...{workloadDetails.placementProvider.slice(-8)}</code></p>
                    {instanceId && <p className="mt-1">Instance ID: <code className="text-xs bg-muted px-1 py-0.5 rounded">{instanceId.toString()}</code></p>}
                  </CardContent>
                </Card>
              )}

              {isActive && (!workloadDetails.placementProvider || workloadDetails.placementProvider === "0x0000000000000000000000000000000000000000") && (
                <Card className="border-blue-500/50 bg-blue-500/5">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2 text-blue-600">
                      <Clock className="h-4 w-4" />
                      Waiting for Provider Assignment
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    <p>This workload is active but waiting for the orchestrator to assign a provider.</p>
                    <p className="mt-2 text-xs">The orchestrator will automatically place this workload on a suitable provider.</p>
                  </CardContent>
                </Card>
              )}

              {/* Workload Execution Status - only shown when deployed */}
              {isActive && workloadDetails.placementProvider && workloadDetails.placementProvider !== "0x0000000000000000000000000000000000000000" && (
                <Card className="border-primary/20 bg-card/50">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      Workload Execution Status
                      {statusLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                    </CardTitle>
                    <CardDescription>
                      Live status from provider node
                      {instanceId && <span className="ml-2 text-xs">(Instance #{instanceId.toString()})</span>}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {!executionStatus && !statusLoading && instanceId ? (
                      <Card className="border-amber-500/50 bg-amber-500/5">
                        <CardContent className="pt-6">
                          <div className="flex items-start gap-3">
                            <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                            <div className="space-y-2 text-sm">
                              <p className="font-medium text-amber-600">Status Not Available</p>
                              <p className="text-muted-foreground">
                                The orchestrator is polling the provider for status updates. This usually takes 15-30 seconds after deployment.
                              </p>
                              <div className="mt-3 pt-3 border-t border-border/50 space-y-1 text-xs text-muted-foreground">
                                <p>• Workload ID: {workloadId.toString()}</p>
                                <p>• Instance ID: {instanceId.toString()}</p>
                                <p>• Provider: {workloadDetails.placementProvider.slice(0, 10)}...{workloadDetails.placementProvider.slice(-8)}</p>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ) : !executionStatus && !statusLoading && !instanceId ? (
                      <div className="text-sm text-destructive">
                        Error: Instance ID is not available. The workload may not have been properly placed.
                      </div>
                    ) : executionStatus?.error ? (
                      <Card className="border-destructive/50 bg-destructive/5">
                        <CardContent className="pt-6">
                          <div className="flex items-start gap-3">
                            <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                            <div className="space-y-2 text-sm">
                              <p className="font-medium text-destructive">Failed to Fetch Status</p>
                              <p className="text-muted-foreground">
                                Error: {executionStatus.error}
                              </p>
                              <p className="text-xs text-muted-foreground mt-2">
                                This could mean the provider node is offline or not responding. Contact the provider or try deploying to a different provider.
                              </p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ) : executionStatus ? (
                      <>
                        {/* Action buttons */}
                        {/* <div className="flex gap-2 mb-4 flex-wrap">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                              const filePath = prompt("Enter file path to download (e.g., /data/output.txt):");
                              if (!filePath) return;
                              
                              try {
                                const baseUrl = executionStatus.providerEndpoint.replace(/\/+$/, "");
                                const url = `${baseUrl}/workload/${workloadId}/${instanceId}/download?path=${encodeURIComponent(filePath)}`;
                                
                                // Trigger download
                                const a = document.createElement("a");
                                a.href = url;
                                a.download = filePath.split("/").pop() || "download";
                                document.body.appendChild(a);
                                a.click();
                                document.body.removeChild(a);
                              } catch (error) {
                                console.error("Download failed:", error);
                                alert("Failed to download file. Check console for details.");
                              }
                            }}
                          >
                            <Download className="h-4 w-4 mr-2" />
                            Download File
                          </Button>
                          
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                              const command = prompt("Enter command to execute (e.g., ls -la /data):");
                              if (!command) return;
                              
                              try {
                                const baseUrl = executionStatus.providerEndpoint.replace(/\/+$/, "");
                                const url = `${baseUrl}/workload/${workloadId}/${instanceId}/exec`;
                                
                                const response = await fetch(url, {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ command: command.split(" ") }),
                                });
                                
                                if (!response.ok) {
                                  throw new Error(`Failed to execute: ${response.statusText}`);
                                }
                                
                                const result = await response.json();
                                alert(`Output:\n\n${result.output || "(no output)"}`);
                              } catch (error) {
                                console.error("Exec failed:", error);
                                alert("Failed to execute command. Check console for details.");
                              }
                            }}
                          >
                            <Terminal className="h-4 w-4 mr-2" />
                            Execute Command
                          </Button>
                          
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={async () => {
                              if (!confirm("Are you sure you want to terminate this workload? This will delete all Kubernetes resources.")) {
                                return;
                              }
                              
                              try {
                                const baseUrl = executionStatus.providerEndpoint.replace(/\/+$/, "");
                                const url = `${baseUrl}/workload/${workloadId}/${instanceId}`;
                                
                                const response = await fetch(url, {
                                  method: "DELETE",
                                });
                                
                                if (!response.ok) {
                                  throw new Error(`Failed to terminate: ${response.statusText}`);
                                }
                                
                                alert("Workload terminated successfully!");
                                // Refresh status after termination
                                window.location.reload();
                              } catch (error) {
                                console.error("Terminate failed:", error);
                                alert("Failed to terminate workload. Check console for details.");
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Terminate
                          </Button>
                        </div> */}
                        
                        <Tabs defaultValue="status" className="w-full">
                          <TabsList className="grid w-full grid-cols-3">
                            <TabsTrigger value="status">Status</TabsTrigger>
                            <TabsTrigger value="logs">Logs</TabsTrigger>
                            <TabsTrigger value="endpoints">Endpoints</TabsTrigger>
                          </TabsList>

                        <TabsContent value="status" className="space-y-4 mt-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <span className="text-xs text-muted-foreground block mb-1">Instance Status</span>
                              <Badge variant={
                                executionStatus.status.instanceStatus === "running" ? "default" :
                                executionStatus.status.instanceStatus === "failed" ? "destructive" :
                                "secondary"
                              }>
                                {executionStatus.status.instanceStatus.toUpperCase()}
                              </Badge>
                            </div>
                            {executionStatus.status.k8sStatus && (
                              <>
                                <div>
                                  <span className="text-xs text-muted-foreground block mb-1">K8s Phase</span>
                                  <Badge variant={
                                    executionStatus.status.k8sStatus.phase === "Running" ? "default" :
                                    executionStatus.status.k8sStatus.phase === "Failed" ? "destructive" :
                                    "secondary"
                                  }>
                                    {executionStatus.status.k8sStatus.phase}
                                  </Badge>
                                </div>
                                <div>
                                  <span className="text-xs text-muted-foreground block mb-1">Pods</span>
                                  <span className="text-sm font-medium">
                                    {executionStatus.status.k8sStatus.readyPods}/{executionStatus.status.k8sStatus.podCount} ready
                                  </span>
                                </div>
                                <div>
                                  <span className="text-xs text-muted-foreground block mb-1">Details</span>
                                  <span className="text-sm">{executionStatus.status.k8sStatus.details}</span>
                                </div>
                              </>
                            )}
                            {executionStatus.status.namespace && (
                              <div className="col-span-2">
                                <span className="text-xs text-muted-foreground block mb-1">Namespace</span>
                                <code className="text-xs bg-muted px-2 py-1 rounded">{executionStatus.status.namespace}</code>
                              </div>
                            )}
                          </div>
                          {executionStatus.status.deployedAt && (
                            <div className="text-xs text-muted-foreground pt-2 border-t">
                              Deployed {new Date(executionStatus.status.deployedAt).toLocaleString()}
                            </div>
                          )}
                        </TabsContent>

                        <TabsContent value="logs" className="mt-4">
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-muted-foreground">Container Logs (last 100 lines)</span>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={refreshLogs}
                                disabled={logsLoading}
                              >
                                {logsLoading ? (
                                  <Loader2 className="h-3 w-3 animate-spin mr-2" />
                                ) : null}
                                Refresh
                              </Button>
                            </div>
                            {workloadLogs && Object.keys(workloadLogs).length > 0 ? (
                              <div className="space-y-4">
                                {Object.entries(workloadLogs).map(([podName, logText]) => (
                                  <div key={podName} className="space-y-1">
                                    <div className="text-xs font-medium text-muted-foreground">Pod: {podName}</div>
                                    <pre className="text-xs font-mono bg-black/90 text-green-400 p-3 rounded overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap break-words">
                                      {logText || "[No logs available]"}
                                    </pre>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-sm text-muted-foreground py-4 text-center">
                                No logs available yet
                              </div>
                            )}
                          </div>
                        </TabsContent>

                        <TabsContent value="endpoints" className="mt-4">
                          {/* HostUri / public URLs from provider (shown first so users see access URL immediately) */}
                          {executionStatus.urls && executionStatus.urls.length > 0 && (
                            <Card className="border-primary/30 bg-primary/5 mb-4">
                              <CardHeader className="pb-2">
                                <CardTitle className="text-sm">Access URL (HostUri)</CardTitle>
                                <CardDescription className="text-xs">
                                  Public URL(s) from provider — open in browser to use the workload. No port-forward needed (NodePort).
                                </CardDescription>
                              </CardHeader>
                              <CardContent className="space-y-3">
                                {executionStatus.urls.map((serviceUrl, idx) => (
                                  <div key={idx} className="space-y-2">
                                    <div className="flex items-center gap-2">
                                      <code className="flex-1 text-xs bg-muted px-3 py-2 rounded break-all font-mono">
                                        {serviceUrl}
                                      </code>
                                      <Button variant="outline" size="sm" className="shrink-0" onClick={() => copyToClipboard(serviceUrl)}>
                                        <Copy className="h-3 w-3" />
                                      </Button>
                                      <Button variant="default" size="sm" className="shrink-0" onClick={() => window.open(serviceUrl, '_blank')}>
                                        Open <ExternalLink className="h-3 w-3 ml-1" />
                                      </Button>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      {urlStatus[serviceUrl] === 'checking' && (
                                        <Badge variant="secondary" className="text-xs"><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Checking...</Badge>
                                      )}
                                      {urlStatus[serviceUrl] === 'online' && (
                                        <Badge variant="default" className="text-xs bg-green-600"><CheckCircle2 className="h-3 w-3 mr-1" /> Online</Badge>
                                      )}
                                      {urlStatus[serviceUrl] === 'offline' && (
                                        <Badge variant="destructive" className="text-xs"><XCircle className="h-3 w-3 mr-1" /> Unreachable</Badge>
                                      )}
                                      {!urlStatus[serviceUrl] && (
                                        <Button variant="ghost" size="sm" className="text-xs h-6" onClick={() => checkUrlStatus(serviceUrl)}>
                                          Test Connection
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                                <p className="text-xs text-muted-foreground pt-1">
                                  If the link does not work, ensure the provider server allows inbound traffic on the NodePort (typically 30000–32767).
                                </p>
                              </CardContent>
                            </Card>
                          )}

                          {executionStatus.endpoints && executionStatus.endpoints.length > 0 ? (
                            <div className="space-y-3">
                              {executionStatus.endpoints.map((endpoint, idx) => (
                                <Card key={idx} className="border-border/50">
                                  <CardHeader className="pb-3">
                                    <CardTitle className="text-sm">{endpoint.name}</CardTitle>
                                    <CardDescription className="text-xs">Type: {endpoint.type}</CardDescription>
                                  </CardHeader>
                                  <CardContent>
                                    <div className="space-y-2">
                                      {endpoint.ports.map((port, pidx) => (
                                        <div key={pidx} className="flex items-center justify-between text-sm">
                                          <span className="text-muted-foreground">
                                            Port {port.port} ({port.protocol})
                                          </span>
                                          {port.nodePort && (
                                            <Badge variant="outline">NodePort: {port.nodePort}</Badge>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                    {endpoint.type === "NodePort" && endpoint.ports[0]?.nodePort && (
                                      <div className="mt-3 pt-3 border-t space-y-3">
                                        {endpoint.ports.map((port, pidx) => {
                                          if (!port.nodePort) return null;
                                          const providerUrl = executionStatus.urls?.find((u) => u.includes(`:${port.nodePort}`));
                                          const serviceUrl = providerUrl || buildServiceUrl(
                                            executionStatus.providerEndpoint,
                                            port.nodePort,
                                            port.protocol
                                          );
                                          if (!serviceUrl) {
                                            return (
                                              <div key={pidx} className="text-xs text-destructive">
                                                ⚠️ Unable to extract provider IP from endpoint
                                              </div>
                                            );
                                          }
                                          return (
                                            <div key={pidx} className="space-y-2">
                                              <div className="flex items-center justify-between">
                                                <span className="text-xs font-medium text-muted-foreground">
                                                  Service URL (Port {port.port}):
                                                </span>
                                                <Badge variant="secondary" className="text-xs">
                                                  {port.protocol}
                                                </Badge>
                                              </div>
                                              <div className="flex items-center gap-2">
                                                <code className="flex-1 text-xs bg-muted px-3 py-2 rounded break-all font-mono">
                                                  {serviceUrl}
                                                </code>
                                                <Button variant="outline" size="sm" className="shrink-0" onClick={() => copyToClipboard(serviceUrl)}>
                                                  <Copy className="h-3 w-3" />
                                                </Button>
                                                <Button variant="default" size="sm" className="shrink-0" onClick={() => window.open(serviceUrl, '_blank')}>
                                                  Open <ExternalLink className="h-3 w-3 ml-1" />
                                                </Button>
                                              </div>
                                              <div className="flex items-center gap-2 mt-1">
                                                <span className="text-xs text-muted-foreground">Status:</span>
                                                {urlStatus[serviceUrl] === 'checking' && (
                                                  <Badge variant="secondary" className="text-xs">
                                                    <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Checking...
                                                  </Badge>
                                                )}
                                                {urlStatus[serviceUrl] === 'online' && (
                                                  <Badge variant="default" className="text-xs bg-green-600">
                                                    <CheckCircle2 className="h-3 w-3 mr-1" /> Online
                                                  </Badge>
                                                )}
                                                {urlStatus[serviceUrl] === 'offline' && (
                                                  <Badge variant="destructive" className="text-xs">
                                                    <XCircle className="h-3 w-3 mr-1" /> Unreachable
                                                  </Badge>
                                                )}
                                                {!urlStatus[serviceUrl] && (
                                                  <Button variant="ghost" size="sm" className="text-xs h-6" onClick={() => checkUrlStatus(serviceUrl)}>
                                                    Test Connection
                                                  </Button>
                                                )}
                                              </div>
                                              <p className="text-xs text-muted-foreground">
                                                💡 NodePort {port.nodePort} — ensure provider firewall allows inbound on this port
                                              </p>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </CardContent>
                                </Card>
                              ))}
                            </div>
                          ) : (
                            <div className="text-sm text-muted-foreground py-4 text-center">
                              No exposed endpoints
                            </div>
                          )}
                        </TabsContent>
                      </Tabs>
                      </>
                    ) : null}
                  </CardContent>
                </Card>
              )}

              {isEditing && editedRequirements && (
                <Card className="border-primary/20 bg-card/50">
                  <CardHeader>
                    <CardTitle className="text-lg">Edit Deployment Configuration</CardTitle>
                    <CardDescription>Update resource requirements and manifest</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>CPU (millicores)</Label>
                        <Input
                          type="number"
                          value={Number(editedRequirements.cpu)}
                          onChange={(e) => setEditedRequirements({
                            ...editedRequirements,
                            cpu: BigInt(parseInt(e.target.value) || 0)
                          })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Memory (GB)</Label>
                        <Input
                          type="number"
                          value={Number(editedRequirements.memory) / (1024 * 1024 * 1024)}
                          onChange={(e) => setEditedRequirements({
                            ...editedRequirements,
                            memory: BigInt(Math.floor((parseFloat(e.target.value) || 0) * 1024 * 1024 * 1024))
                          })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Storage (GB)</Label>
                        <Input
                          type="number"
                          value={Number(editedRequirements.storage) / (1024 * 1024 * 1024)}
                          onChange={(e) => setEditedRequirements({
                            ...editedRequirements,
                            storage: BigInt(Math.floor((parseFloat(e.target.value) || 0) * 1024 * 1024 * 1024))
                          })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>GPU Count</Label>
                        <Input
                          type="number"
                          value={Number(editedRequirements.gpuCount)}
                          onChange={(e) => setEditedRequirements({
                            ...editedRequirements,
                            gpuCount: BigInt(parseInt(e.target.value) || 0),
                            requiresGPU: parseInt(e.target.value) > 0
                          })}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Manifest (JSON)</Label>
                      <Textarea
                        value={editedManifest}
                        onChange={(e) => setEditedManifest(e.target.value)}
                        className="font-mono text-xs min-h-[200px]"
                        placeholder="Deployment manifest JSON..."
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={handleSave}
                        disabled={isUpdating || !isConnected}
                        className="bg-primary hover:bg-primary/90"
                      >
                        {isUpdating ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Updating...
                          </>
                        ) : (
                          <>
                            <Save className="mr-2 h-4 w-4" />
                            Save Changes
                          </>
                        )}
                      </Button>
                      <Button variant="outline" onClick={handleCancel} disabled={isUpdating}>
                        <X className="mr-2 h-4 w-4" />
                        Cancel
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </CardContent>
          </Card>

          {/* Placement (one provider/instance per workload) */}
          {workloadDetails.placementProvider && workloadDetails.placementProvider !== "0x0000000000000000000000000000000000000000" && (
            <Card className="border-white/10 bg-card/40">
              <CardHeader>
                <CardTitle className="text-lg">Placement</CardTitle>
                <CardDescription>Assigned provider and instance</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between p-3 rounded-lg border border-white/5">
                  <div>
                    <div className="font-medium text-sm">Instance #{workloadDetails.placementInstanceId?.toString() ?? "—"}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Provider: <code className="font-mono">{workloadDetails.placementProvider.slice(0, 10)}...{workloadDetails.placementProvider.slice(-8)}</code>
                    </div>
                  </div>
                  <Badge variant="outline" className="border-green-500/50 text-green-400 bg-green-500/10">Placed</Badge>
                </div>
              </CardContent>
            </Card>
          )}

        </div>

        {/* Timeline Column */}
        <div className="space-y-6">
          <Card className="h-full border-white/5 bg-card/40">
            <CardHeader>
              <CardTitle className="text-lg">Deployment Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Registered At</Label>
                <div className="text-sm font-mono">
                  {new Date(Number(workloadDetails.registeredAt) * 1000).toLocaleString()}
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Last Updated</Label>
                <div className="text-sm font-mono">
                  {new Date(Number(workloadDetails.updatedAt) * 1000).toLocaleString()}
                </div>
              </div>
              {updateHash && (
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">Update Transaction</Label>
                  <TxLink hash={updateHash} variant="inline" />
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Deployment Permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the deployment
              from the blockchain. All deployment data will be removed.
              <br /><br />
              <strong>Note:</strong> Only inactive deployments can be deleted. This is different from
              deactivating — deletion is permanent, while deactivation allows reactivation later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                deleteWorkload(workloadId);
                setShowDeleteConfirm(false);
              }}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete Permanently"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
