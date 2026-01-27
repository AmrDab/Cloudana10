import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { AddressDisplay } from "@/components/ui/address-display";
import { TxLink } from "@/components/ui/tx-link";
import { useWallet } from "@/context/wallet-context";
import { MOCK_JOBS, MOCK_LOGS } from "@/lib/mock-data";
import { useLocation } from "wouter";
import { ArrowLeft, CheckCircle2, Clock, XCircle, Loader2, Edit, Save, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { Spinner } from "@/components/ui/spinner";
import { useWorkloadDetails } from "@/hooks/useWorkloadDetails";
import { useWorkloadManifest } from "@/hooks/useWorkloadManifest";
import { DeploymentSpecs } from "@/components/deployment-specs";
import { useUpdateWorkload, type ResourceRequirements } from "@/lib/contracts";
import { useAccount } from "wagmi";
import { keccak256, toHex } from "viem";
import { Textarea } from "@/components/ui/textarea";

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

  const [isEditing, setIsEditing] = useState(false);
  const [editedManifest, setEditedManifest] = useState("");
  const [editedRequirements, setEditedRequirements] = useState<ResourceRequirements | null>(null);

  const { update: updateWorkload, isPending: isUpdating, isSuccess: isUpdated, hash: updateHash, error: updateError, reset: resetUpdate } = useUpdateWorkload();

  // Initialize edited values when workload details or IPFS manifest are loaded
  useEffect(() => {
    if (workloadDetails && !isEditing) {
      if (manifestFromIPFS?.manifest) {
        setEditedManifest(manifestFromIPFS.manifest);
      } else {
        setEditedManifest("");
      }
      if (workloadDetails.requirements) {
        setEditedRequirements({
          cpu: workloadDetails.requirements.cpu,
          memory: workloadDetails.requirements.memoryBytes,
          storage: workloadDetails.requirements.storageBytes,
          storageClasses: workloadDetails.requirements.storageClasses,
          requiresGPU: workloadDetails.requirements.requiresGPU,
          gpuCount: workloadDetails.requirements.gpuCount,
          gpuAttributes: workloadDetails.requirements.gpuAttributes,
          requiresEdge: workloadDetails.requirements.requiresEdge,
          regions: workloadDetails.requirements.regions,
          maxLatency: workloadDetails.requirements.maxLatency,
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
        description: updateError.message || "Failed to update deployment",
        variant: "destructive",
      });
      resetUpdate();
    }
  }, [updateError, toast, resetUpdate]);

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
      const manifestHash = keccak256(toHex(editedManifest));
      updateWorkload(workloadId, manifestHash, editedRequirements);
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to update deployment",
        variant: "destructive",
      });
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    // Reset to original values
    if (workloadDetails) {
      setEditedManifest(JSON.stringify({
        version: "2.0",
        services: { web: { image: "nginx:latest" } },
        profiles: { compute: { web: { resources: {} } } }
      }, null, 2));
      if (workloadDetails.requirements) {
        setEditedRequirements({
          cpu: workloadDetails.requirements.cpu,
          memory: workloadDetails.requirements.memoryBytes,
          storage: workloadDetails.requirements.storageBytes,
          storageClasses: workloadDetails.requirements.storageClasses,
          requiresGPU: workloadDetails.requirements.requiresGPU,
          gpuCount: workloadDetails.requirements.gpuCount,
          gpuAttributes: workloadDetails.requirements.gpuAttributes,
          requiresEdge: workloadDetails.requirements.requiresEdge,
          regions: workloadDetails.requirements.regions,
          maxLatency: workloadDetails.requirements.maxLatency,
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
      <div className="flex flex-col items-center justify-center py-16">
        <p className="text-muted-foreground mb-4">Failed to load deployment details</p>
        <Button variant="outline" onClick={() => setLocation("/user#deployments")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Deployments
        </Button>
      </div>
    );
  }

  const statusLabels = ['PENDING', 'ACTIVE', 'TERMINATED'];
  const statusLabel = statusLabels[workloadDetails.status] || 'UNKNOWN';
  const isActive = workloadDetails.status === 1;
  const isPending = workloadDetails.status === 0;

  const requirements = workloadDetails.requirements;
  const cpuAmount = requirements ? Number(requirements.cpu) : 0;
  const memoryAmount = requirements ? requirements.memoryBytes : BigInt(0);
  const storageAmount = requirements ? requirements.storageBytes : BigInt(0);
  const gpuAmount = requirements && requirements.requiresGPU ? Number(requirements.gpuCount) : 0;


  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => setLocation("/user#deployments")} className="pl-0 hover:pl-2 transition-all">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Deployments
        </Button>
        {!isEditing && (
          <Button variant="outline" onClick={() => setIsEditing(true)} disabled={!isConnected || isPending}>
            <Edit className="mr-2 h-4 w-4" /> Edit Deployment
          </Button>
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
                    Created {new Date(Number(workloadDetails.createdAt) * 1000).toLocaleDateString()}
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
                  {workloadDetails.instances && workloadDetails.instances.length > 0 ? (
                    <AddressDisplay address={workloadDetails.instances[0].provider} truncate={true} truncateLength={6} />
                  ) : (
                    <span className="text-muted-foreground">No provider assigned</span>
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
                      <div className="text-xs text-muted-foreground">
                        CPU: {manifestFromIPFS.requirements.cpu} · Memory: {manifestFromIPFS.requirements.memory} · Storage: {manifestFromIPFS.requirements.storage}
                        {manifestFromIPFS.requirements.requiresGPU && ` · GPU: ${manifestFromIPFS.requirements.gpuCount}`}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Manifest not available (IPFS content not found for this workload)</p>
                )}
              </div>

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

          {/* Instance Information */}
          {workloadDetails.instances && workloadDetails.instances.length > 0 && (
            <Card className="border-white/10 bg-card/40">
              <CardHeader>
                <CardTitle className="text-lg">Instances</CardTitle>
                <CardDescription>Deployment instances and their status</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {workloadDetails.instances.map((instance, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 rounded-lg border border-white/5">
                      <div>
                        <div className="font-medium text-sm">Instance #{instance.id.toString()}</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          Provider: <code className="font-mono">{instance.provider.slice(0, 10)}...{instance.provider.slice(-8)}</code>
                        </div>
                      </div>
                      <Badge variant="outline" className={
                        instance.status === 1 ? 'border-green-500/50 text-green-400 bg-green-500/10' :
                        instance.status === 0 ? 'border-yellow-500/50 text-yellow-400 bg-yellow-500/10' :
                        'border-white/20 text-muted-foreground bg-white/5'
                      }>
                        {instance.status === 1 ? 'Active' : instance.status === 0 ? 'Pending' : 'Terminated'}
                      </Badge>
                    </div>
                  ))}
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
                <Label className="text-xs text-muted-foreground mb-1 block">Replicas</Label>
                <div className="text-sm font-medium">{workloadDetails.replicas.toString()}</div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Created At</Label>
                <div className="text-sm font-mono">
                  {new Date(Number(workloadDetails.createdAt) * 1000).toLocaleString()}
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
    </div>
  );
}
