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
  useCreateWorkload,
  useUserWorkloads,
  useWorkloadCount,
  type ResourceRequirements,
  WORKLOAD_REGISTRY_ADDRESS,
} from "@/lib/contracts";
import { getPinataGatewayUrl } from "@/lib/api";
import { keccak256, toHex } from "viem";

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
  
  // Contract hooks
  const { create, hash, isPending, isSuccess, error, reset } = useCreateWorkload();
  const { data: userWorkloads } = useUserWorkloads(address);
  const { data: workloadCount } = useWorkloadCount();
  
  // Generate manifest hash from content
  useEffect(() => {
    if (manifestContent) {
      try {
        const hash = keccak256(toHex(manifestContent));
        setFormData(prev => ({ ...prev, manifestHash: hash }));
      } catch (err) {
        console.error("Error generating manifest hash:", err);
      }
    }
  }, [manifestContent]);
  
  // Upload manifest to IPFS
  const handleUploadToIPFS = async () => {
    if (!manifestContent.trim()) {
      toast({
        title: "Error",
        description: "Please provide manifest content",
        variant: "destructive",
      });
      return;
    }
    
    setIsUploadingIPFS(true);
    try {
      const PINATA_JWT = import.meta.env.VITE_PINATA_JWT;
      if (!PINATA_JWT) {
        throw new Error('PINATA_JWT environment variable is not set');
      }
      
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
        throw new Error(`Pinata API error (${response.status}): ${errorData}`);
      }
      
      const result = await response.json();
      const cid = result.IpfsHash;
      
      setIpfsCID(cid);
      toast({
        title: "Success",
        description: "Manifest uploaded to IPFS",
      });
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to upload to IPFS",
        variant: "destructive",
      });
    } finally {
      setIsUploadingIPFS(false);
    }
  };
  
  // Handle form submission
  const handleSubmit = async () => {
    if (!isConnected || !address) {
      toast({
        title: "Error",
        description: "Please connect your wallet",
        variant: "destructive",
      });
      return;
    }
    
    if (!formData.manifestHash) {
      toast({
        title: "Error",
        description: "Please provide manifest content or hash",
        variant: "destructive",
      });
      return;
    }
    
    if (parseInt(formData.cpu) <= 0) {
      toast({
        title: "Error",
        description: "CPU must be greater than 0",
        variant: "destructive",
      });
      return;
    }
    
    if (parseInt(formData.memory) <= 0) {
      toast({
        title: "Error",
        description: "Memory must be greater than 0",
        variant: "destructive",
      });
      return;
    }
    
    // Convert form data to ResourceRequirements
    const requirements: ResourceRequirements = {
      cpu: BigInt(formData.cpu),
      memory: BigInt(formData.memory),
      storage: BigInt(formData.storage),
      storageClasses: formData.storageClasses,
      requiresGPU: formData.requiresGPU,
      gpuCount: BigInt(formData.gpuCount || "0"),
      gpuAttributes: formData.gpuAttributes,
      requiresEdge: formData.requiresEdge,
      regions: formData.regions,
      maxLatency: BigInt(formData.maxLatency),
    };
    
    try {
      create(formData.manifestHash, requirements);
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to create workload",
        variant: "destructive",
      });
    }
  };
  
  // Show success message
  useEffect(() => {
    if (isSuccess && hash) {
      toast({
        title: "Success",
        description: "Workload registered successfully!",
      });
      reset();
      // Reset form
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
    }
  }, [isSuccess, hash, toast, reset]);
  
  // Show error message
  useEffect(() => {
    if (error) {
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
              <div className="mt-2 flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleUploadToIPFS}
                  disabled={isUploadingIPFS || !manifestContent.trim()}
                >
                  {isUploadingIPFS ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    "Upload to IPFS"
                  )}
                </Button>
                {ipfsCID && (
                  <span className="text-sm text-muted-foreground">
                    IPFS CID: {ipfsCID}
                  </span>
                )}
              </div>
              {formData.manifestHash && (
                <p className="text-xs text-muted-foreground mt-1">
                  Manifest Hash: {formData.manifestHash.slice(0, 20)}...
                </p>
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
            disabled={isPending || !formData.manifestHash || WORKLOAD_REGISTRY_ADDRESS === "0x0000000000000000000000000000000000000000"}
            size="lg"
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Registering...
              </>
            ) : (
              <>
                <CheckCircle className="h-4 w-4 mr-2" />
                Register Workload
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
