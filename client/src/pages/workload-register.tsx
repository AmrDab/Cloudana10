import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { TxLink } from "@/components/ui/tx-link";
import { AddressDisplay } from "@/components/ui/address-display";
import { 
  Loader2, 
  Cpu, 
  HardDrive, 
  Network, 
  MapPin, 
  CheckCircle, 
  Server,
  Zap,
  Layers
} from "lucide-react";
import {
  useRegisterWorkload,
  useDeregisterWorkload,
  useActivateWorkload,
  useUserWorkloads,
  useWorkloadCount,
  useFundWorkload,
  useWorkloadDeposit,
  useCLDTokenAllowance,
  useApproveCLDToken,
  type ResourceRequirements,
  WORKLOAD_REGISTRY_ADDRESS,
  REWARD_CONTRACT_ADDRESS,
} from "@/lib/contracts";
import { parseEther } from "viem";
import { getPinataGatewayUrl } from "@/lib/api";

const REGIONS = ["us-east", "us-west", "eu-west", "eu-central", "asia-pacific", "global"] as const;
const STORAGE_CLASSES = ["ssd", "hdd", "nvme", "ephemeral"] as const;
const GPU_ATTRIBUTES = ["nvidia-a100", "nvidia-h100", "nvidia-rtx-4090", "amd-mi250"] as const;

interface WorkloadFormData {
  name: string;
  description: string;
  manifestHash: string;
  cpu: string;
  memory: string;
  storage: string;
  storageClasses: string[];
  requiresGPU: boolean;
  gpuCount: string;
  gpuAttributes: string[];
  requiresEdge: boolean;
  regions: string[];
  maxLatency: string;
}

export default function WorkloadRegister() {
  const { address, isConnected } = useAccount();
  const { toast } = useToast();
  
  // Form state
  const [formData, setFormData] = useState<WorkloadFormData>({
    name: "",
    description: "",
    manifestHash: "",
    cpu: "1000", // millicores
    memory: "1073741824", // 1GB in bytes
    storage: "10737418240", // 10GB in bytes
    storageClasses: [],
    requiresGPU: false,
    gpuCount: "0",
    gpuAttributes: [],
    requiresEdge: false,
    regions: [],
    maxLatency: "100", // ms
  });
  
  const [manifestContent, setManifestContent] = useState("");
  const [isUploadingIPFS, setIsUploadingIPFS] = useState(false);
  const [ipfsCID, setIpfsCID] = useState("");
  const [fundWorkloadId, setFundWorkloadId] = useState("");
  const [fundAmount, setFundAmount] = useState("");
  
  // Contract hooks
  const { register, hash, isPending, isSuccess, error, reset } = useRegisterWorkload();
  const { deregister, isPending: isDeregistering, isSuccess: isDeregistered, reset: resetDeregister } = useDeregisterWorkload();
  const { activate, isPending: isActivating, isSuccess: isActivated, reset: resetActivate } = useActivateWorkload();
  const { data: userWorkloads, refetch: refetchUserWorkloads } = useUserWorkloads(address);
  const { data: workloadCount, refetch: refetchWorkloadCount } = useWorkloadCount();
  const { fund, isPending: isFundPending, isSuccess: isFundSuccess, reset: resetFund } = useFundWorkload();
  const fundWid = fundWorkloadId !== "" && /^\d+$/.test(fundWorkloadId) ? BigInt(fundWorkloadId) : undefined;
  const { data: workloadDeposit } = useWorkloadDeposit(fundWid);
  const { data: cldAllowance } = useCLDTokenAllowance(address, REWARD_CONTRACT_ADDRESS);
  const { approve: approveCLD, isPending: isApprovePending } = useApproveCLDToken();
  // Upload manifest to IPFS automatically
  const uploadToIPFS = async (): Promise<string> => {
    console.log('[Workload Register] Starting IPFS upload...');
    
    const PINATA_JWT = import.meta.env.VITE_PINATA_JWT;
    if (!PINATA_JWT) {
      console.error('[Workload Register] ERROR: PINATA_JWT not set');
      throw new Error('PINATA_JWT environment variable is not set');
    }
    
    if (!manifestContent.trim()) {
      console.error('[Workload Register] ERROR: Manifest content is empty');
      throw new Error('Manifest content is required');
    }
    
    console.log('[Workload Register] Manifest content length:', manifestContent.length);
    console.log('[Workload Register] Manifest preview:', manifestContent.slice(0, 200));
    
    const workloadMetadata = {
      name: formData.name || "workload-manifest",
      description: formData.description || "",
      manifest: manifestContent,
      requirements: {
        cpu: formData.cpu,
        memory: formData.memory,
        storage: formData.storage,
        storageClasses: formData.storageClasses,
        requiresGPU: formData.requiresGPU,
        gpuCount: formData.gpuCount,
        gpuAttributes: formData.gpuAttributes,
        requiresEdge: formData.requiresEdge,
        regions: formData.regions,
        maxLatency: formData.maxLatency,
      },
      createdAt: new Date().toISOString(),
    };
    
    console.log('[Workload Register] Metadata prepared:', {
      name: workloadMetadata.name,
      descriptionLength: workloadMetadata.description.length,
      manifestLength: workloadMetadata.manifest.length,
      requirements: workloadMetadata.requirements,
    });
    
    console.log('[Workload Register] Sending request to Pinata...');
    const response = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${PINATA_JWT}`,
      },
      body: JSON.stringify({
        pinataContent: workloadMetadata,
        pinataMetadata: {
          name: `workload-${formData.name || 'manifest'}-${Date.now()}`,
          keyvalues: {
            type: 'workload-manifest',
            network: 'cloudana',
            timestamp: new Date().toISOString(),
          }
        },
        pinataOptions: {
          cidVersion: 1,
        }
      }),
    });
    
    if (!response.ok) {
      const errorData = await response.text();
      console.error('[Workload Register] ERROR: Pinata API error');
      console.error('[Workload Register] Status:', response.status);
      console.error('[Workload Register] Response:', errorData);
      throw new Error(`Pinata API error (${response.status}): ${errorData}`);
    }
    
    const result = await response.json();
    console.log('[Workload Register] ✓ IPFS upload successful');
    console.log('[Workload Register] CID:', result.IpfsHash);
    return result.IpfsHash;
  };
  
  // Handle form submission - automatically uploads to IPFS then registers
  const handleSubmit = async () => {
    console.log('[Workload Register] ═══════════════════════════════════════');
    console.log('[Workload Register] WORKLOAD REGISTRATION STARTED');
    console.log('[Workload Register] ═══════════════════════════════════════');
    
    if (!isConnected || !address) {
      console.error('[Workload Register] ERROR: Wallet not connected');
      toast({
        title: "Error",
        description: "Please connect your wallet",
        variant: "destructive",
      });
      return;
    }
    
    console.log('[Workload Register] Wallet connected:', address);
    
    if (!manifestContent.trim()) {
      console.error('[Workload Register] ERROR: Manifest content is empty');
      toast({
        title: "Error",
        description: "Please provide manifest content",
        variant: "destructive",
      });
      return;
    }
    
    if (parseInt(formData.cpu) <= 0) {
      console.error('[Workload Register] ERROR: Invalid CPU value:', formData.cpu);
      toast({
        title: "Error",
        description: "CPU must be greater than 0",
        variant: "destructive",
      });
      return;
    }
    
    if (parseInt(formData.memory) <= 0) {
      console.error('[Workload Register] ERROR: Invalid memory value:', formData.memory);
      toast({
        title: "Error",
        description: "Memory must be greater than 0",
        variant: "destructive",
      });
      return;
    }
    
    console.log('[Workload Register] Validation passed');
    console.log('[Workload Register] Form data:', {
      name: formData.name,
      cpu: formData.cpu,
      memory: formData.memory,
      storage: formData.storage,
    });
    
    setIsUploadingIPFS(true);
    
    try {
      // Step 1: Upload to IPFS automatically
      console.log('[Workload Register] ─── Step 1: Upload to IPFS ───');
      toast({
        title: "Uploading to IPFS...",
        description: "Please wait while we upload your workload metadata to IPFS",
      });
      
      const cid = await uploadToIPFS();
      setIpfsCID(cid);
      console.log('[Workload Register] ✓ IPFS upload complete. CID:', cid);

      // Step 2: Register workload on-chain with metadataUri (IPFS CID). Requirements are in the IPFS payload.
      console.log('[Workload Register] ─── Step 2: Register on-chain ───');
      toast({
        title: "Registering workload...",
        description: `Metadata URI: ${cid.slice(0, 20)}...`,
      });

      register(cid);
      console.log('[Workload Register] Contract registration initiated');
    } catch (err: any) {
      console.error('[Workload Register] ═══════════════════════════════════════');
      console.error('[Workload Register] REGISTRATION FAILED');
      console.error('[Workload Register] ═══════════════════════════════════════');
      console.error('[Workload Register] Error:', err);
      console.error('[Workload Register] Error message:', err.message);
      console.error('[Workload Register] Error stack:', err.stack);
      
      setIsUploadingIPFS(false);
      toast({
        title: "Error",
        description: err.message || "Failed to upload to IPFS or register workload",
        variant: "destructive",
      });
    }
  };
  
  useEffect(() => {
    if (isDeregistered || isActivated) {
      refetchUserWorkloads();
      refetchWorkloadCount();
      toast({
        title: isActivated ? "Workload activated" : "Workload deregistered",
        description: isActivated ? "Workload is active and can be placed." : "Workload is inactive.",
      });
      resetDeregister();
      resetActivate();
    }
  }, [isDeregistered, isActivated, refetchUserWorkloads, refetchWorkloadCount, toast, resetDeregister, resetActivate]);

  // Show success message
  useEffect(() => {
    if (!isSuccess || !hash) return;
    refetchWorkloadCount();
    refetchUserWorkloads();
    setIsUploadingIPFS(false);
    toast({
      title: "Success",
      description: "Workload registered successfully!",
    });
    reset();
    setFormData({
      name: "",
      description: "",
      manifestHash: "",
      cpu: "1000",
      memory: "1073741824",
      storage: "10737418240",
      storageClasses: [],
      requiresGPU: false,
      gpuCount: "0",
      gpuAttributes: [],
      requiresEdge: false,
      regions: [],
      maxLatency: "100",
    });
    setManifestContent("");
    setIpfsCID("");
  }, [isSuccess, hash, toast, reset, refetchWorkloadCount, refetchUserWorkloads]);
  
  // Show error message
  useEffect(() => {
    if (error) {
      console.error('[Workload Register] ═══════════════════════════════════════');
      console.error('[Workload Register] CONTRACT ERROR');
      console.error('[Workload Register] ═══════════════════════════════════════');
      console.error('[Workload Register] Error object:', error);
      console.error('[Workload Register] Error message:', error.message);
      console.error('[Workload Register] Error details:', JSON.stringify(error, null, 2));
      
      toast({
        title: "Error",
        description: error.message || "Failed to register workload",
        variant: "destructive",
      });
    }
  }, [error, toast]);
  
  const formatBytes = (bytes: string) => {
    const num = parseInt(bytes);
    if (num >= 1024 * 1024 * 1024) {
      return `${(num / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    } else if (num >= 1024 * 1024) {
      return `${(num / (1024 * 1024)).toFixed(2)} MB`;
    } else if (num >= 1024) {
      return `${(num / 1024).toFixed(2)} KB`;
    }
    return `${num} B`;
  };
  
  const formatMillicores = (millicores: string) => {
    const num = parseInt(millicores);
    if (num >= 1000) {
      return `${(num / 1000).toFixed(2)} cores`;
    }
    return `${num} millicores`;
  };
  
  if (!isConnected) {
    return (
      <div className="container mx-auto py-8 px-4">
        <Card>
          <CardHeader>
            <CardTitle>Register Workload</CardTitle>
            <CardDescription>Connect your wallet to register a new workload</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">Please connect your wallet to continue.</p>
          </CardContent>
        </Card>
      </div>
    );
  }
  
  return (
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Register Workload</h1>
        <p className="text-muted-foreground">
          Register a new workload to the Cloudana OS network
        </p>
      </div>
      
      <div className="grid gap-6">
        {/* Basic Information */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5" />
              Basic Information
            </CardTitle>
            <CardDescription>Provide basic information about your workload</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="name">Workload Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="My Workload"
              />
            </div>
            
            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Describe your workload..."
                rows={3}
              />
            </div>
            
            <div>
              <Label htmlFor="manifest">Manifest Content (YAML/JSON)</Label>
              <Textarea
                id="manifest"
                value={manifestContent}
                onChange={(e) => setManifestContent(e.target.value)}
                placeholder="Paste your workload manifest here..."
                rows={8}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground mt-2">
                Manifest will be automatically uploaded to IPFS when you register the workload
              </p>
              {ipfsCID && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    IPFS CID: {ipfsCID}
                  </span>
                  <a
                    href={getPinataGatewayUrl(ipfsCID)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-500 hover:underline"
                    title="View metadata on IPFS"
                  >
                    View on IPFS
                  </a>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        
        {/* Resource Requirements */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-5 w-5" />
              Resource Requirements
            </CardTitle>
            <CardDescription>Specify the resources your workload needs</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="cpu" className="flex items-center gap-2">
                  <Cpu className="h-4 w-4" />
                  CPU (millicores)
                </Label>
                <Input
                  id="cpu"
                  type="number"
                  value={formData.cpu}
                  onChange={(e) => setFormData(prev => ({ ...prev, cpu: e.target.value }))}
                  placeholder="1000"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {formatMillicores(formData.cpu)}
                </p>
              </div>
              
              <div>
                <Label htmlFor="memory" className="flex items-center gap-2">
                  <HardDrive className="h-4 w-4" />
                  Memory (bytes)
                </Label>
                <Input
                  id="memory"
                  type="number"
                  value={formData.memory}
                  onChange={(e) => setFormData(prev => ({ ...prev, memory: e.target.value }))}
                  placeholder="1073741824"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {formatBytes(formData.memory)}
                </p>
              </div>
              
              <div>
                <Label htmlFor="storage" className="flex items-center gap-2">
                  <HardDrive className="h-4 w-4" />
                  Storage (bytes)
                </Label>
                <Input
                  id="storage"
                  type="number"
                  value={formData.storage}
                  onChange={(e) => setFormData(prev => ({ ...prev, storage: e.target.value }))}
                  placeholder="10737418240"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {formatBytes(formData.storage)}
                </p>
              </div>
            </div>
            
            <div>
              <Label>Storage Classes</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {STORAGE_CLASSES.map((sc) => (
                  <Button
                    key={sc}
                    type="button"
                    variant={formData.storageClasses.includes(sc) ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      setFormData(prev => ({
                        ...prev,
                        storageClasses: prev.storageClasses.includes(sc)
                          ? prev.storageClasses.filter(c => c !== sc)
                          : [...prev.storageClasses, sc],
                      }));
                    }}
                  >
                    {sc}
                  </Button>
                ))}
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="requiresGPU"
                checked={formData.requiresGPU}
                onChange={(e) => setFormData(prev => ({ ...prev, requiresGPU: e.target.checked }))}
                className="rounded"
              />
              <Label htmlFor="requiresGPU">Requires GPU</Label>
            </div>
            
            {formData.requiresGPU && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="gpuCount">GPU Count</Label>
                  <Input
                    id="gpuCount"
                    type="number"
                    value={formData.gpuCount}
                    onChange={(e) => setFormData(prev => ({ ...prev, gpuCount: e.target.value }))}
                    placeholder="1"
                  />
                </div>
                
                <div>
                  <Label>GPU Attributes</Label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {GPU_ATTRIBUTES.map((attr) => (
                      <Button
                        key={attr}
                        type="button"
                        variant={formData.gpuAttributes.includes(attr) ? "default" : "outline"}
                        size="sm"
                        onClick={() => {
                          setFormData(prev => ({
                            ...prev,
                            gpuAttributes: prev.gpuAttributes.includes(attr)
                              ? prev.gpuAttributes.filter(a => a !== attr)
                              : [...prev.gpuAttributes, attr],
                          }));
                        }}
                      >
                        {attr}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="requiresEdge"
                checked={formData.requiresEdge}
                onChange={(e) => setFormData(prev => ({ ...prev, requiresEdge: e.target.checked }))}
                className="rounded"
              />
              <Label htmlFor="requiresEdge">Requires Edge Computing</Label>
            </div>
            
            <div>
              <Label>Preferred Regions</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {REGIONS.map((region) => (
                  <Button
                    key={region}
                    type="button"
                    variant={formData.regions.includes(region) ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      setFormData(prev => ({
                        ...prev,
                        regions: prev.regions.includes(region)
                          ? prev.regions.filter(r => r !== region)
                          : [...prev.regions, region],
                      }));
                    }}
                  >
                    <MapPin className="h-3 w-3 mr-1" />
                    {region}
                  </Button>
                ))}
              </div>
            </div>
            
            <div>
              <Label htmlFor="maxLatency" className="flex items-center gap-2">
                <Network className="h-4 w-4" />
                Max Latency (ms)
              </Label>
              <Input
                id="maxLatency"
                type="number"
                value={formData.maxLatency}
                onChange={(e) => setFormData(prev => ({ ...prev, maxLatency: e.target.value }))}
                placeholder="100"
              />
            </div>
          </CardContent>
        </Card>
        
        {/* My Workloads: register / deregister / activate */}
        <Card>
          <CardHeader>
            <CardTitle>My Workloads</CardTitle>
            <CardDescription>
              Your registered workloads. Deregister to set inactive; Activate to make them available for placement again.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {Array.isArray(userWorkloads) && userWorkloads.length > 0 ? (
              <ul className="space-y-2">
                {userWorkloads.map((wid: bigint) => (
                  <li key={wid.toString()} className="flex items-center justify-between rounded-lg border px-4 py-2">
                    <span className="font-mono text-sm">Workload #{wid.toString()}</span>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => deregister(wid)}
                        disabled={isDeregistering}
                      >
                        {isDeregistering ? <Loader2 className="h-4 w-4 animate-spin" /> : "Deregister"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => activate(wid)}
                        disabled={isActivating}
                      >
                        {isActivating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Activate"}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No workloads yet. Register one above.</p>
            )}
          </CardContent>
        </Card>

        {/* Summary */}
        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Your Address:</span>
                <AddressDisplay address={address || ""} />
              </div>
              <div>
                <span className="text-muted-foreground">Total Workloads:</span>
                <span className="ml-2 font-medium">
                  {workloadCount ? workloadCount.toString() : "0"}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Your Workloads:</span>
                <span className="ml-2 font-medium">
                  {Array.isArray(userWorkloads) ? userWorkloads.length : 0}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Contract:</span>
                <AddressDisplay address={WORKLOAD_REGISTRY_ADDRESS} />
              </div>
            </div>
            
            {hash && (
              <div className="pt-4 border-t">
                <p className="text-sm text-muted-foreground mb-2">Transaction:</p>
                <TxLink hash={hash} />
              </div>
            )}
          </CardContent>
        </Card>
        
        {/* Submit Button */}
        <div className="flex justify-end gap-4">
          <Button
            variant="outline"
            onClick={() => {
              setFormData({
                name: "",
                description: "",
                manifestHash: "",
                cpu: "1000",
                memory: "1073741824",
                storage: "10737418240",
                storageClasses: [],
                requiresGPU: false,
                gpuCount: "0",
                gpuAttributes: [],
                requiresEdge: false,
                regions: [],
                maxLatency: "100",
              });
              setManifestContent("");
              setIpfsCID("");
              reset();
            }}
            disabled={isPending}
          >
            Reset
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending || !manifestContent.trim() || WORKLOAD_REGISTRY_ADDRESS === "0x0000000000000000000000000000000000000000"}
            size="lg"
          >
            {isPending || isUploadingIPFS ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {isUploadingIPFS ? "Uploading to IPFS..." : "Registering..."}
              </>
            ) : (
              <>
                <CheckCircle className="h-4 w-4 mr-2" />
                Register Workload
              </>
            )}
          </Button>
        </div>

        {/* Fund workload (Reward contract) */}
        {REWARD_CONTRACT_ADDRESS !== "0x0000000000000000000000000000000000000000" && (
          <Card className="mt-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5" />
                Fund Workload
              </CardTitle>
              <CardDescription>
                Approve CLD and fund a workload so the orchestrator can reward providers when they run it.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="fundWorkloadId">Workload ID</Label>
                  <Input
                    id="fundWorkloadId"
                    type="number"
                    min={0}
                    value={fundWorkloadId}
                    onChange={(e) => setFundWorkloadId(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div>
                  <Label htmlFor="fundAmount">Amount (CLD)</Label>
                  <Input
                    id="fundAmount"
                    type="text"
                    value={fundAmount}
                    onChange={(e) => setFundAmount(e.target.value)}
                    placeholder="10"
                  />
                </div>
              </div>
              {fundWorkloadId && (
                <p className="text-sm text-muted-foreground">
                  Current deposit for workload {fundWorkloadId}:{" "}
                  {workloadDeposit != null ? `${(Number(workloadDeposit) / 1e18).toFixed(4)} CLD` : "—"}
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  disabled={!fundAmount || isApprovePending}
                  onClick={() => approveCLD(REWARD_CONTRACT_ADDRESS, fundAmount || "0")}
                >
                  {isApprovePending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Approve CLD"}
                </Button>
                <Button
                  disabled={
                    !fundWorkloadId ||
                    !fundAmount ||
                    isFundPending ||
                    (cldAllowance != null && cldAllowance < parseEther(fundAmount || "0"))
                  }
                  onClick={() => {
                    fund(BigInt(fundWorkloadId), fundAmount || "0");
                  }}
                >
                  {isFundPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Fund Workload"}
                </Button>
              </div>
              {isFundSuccess && (
                <p className="text-sm text-green-600">Workload funded successfully.</p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
