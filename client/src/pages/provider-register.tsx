import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Server, Copy, Loader2, Flame, Cpu, HardDrive, Network, MapPin, CheckCircle } from "lucide-react";
import {
  useCLDTokenBalance,
  useCLDTokenAllowance,
  useApproveCLDToken,
  useRegisterProvider,
  generatePubKeyHash,
  PROVIDER_REGISTRY_ADDRESS,
  CLD_TOKEN_ADDRESS,
  useProviderRegistryBondInfo,
  useMyProviders,
  useProviderInfo,
} from "@/lib/contracts";
import { uploadToIPFS, generatePubKeyHash as generatePubKey, type ProviderMetadata, type ProviderNode } from "@/lib/api";
import { formatEther } from "viem";
import { formatDistanceToNow } from "date-fns";

const REGIONS = ["Helsinki", "EU", "Global"] as const;
const HARDWARE_TIERS = [
  { value: 0, label: "CPU", multiplier: "1x" },
  { value: 1, label: "GPU-T1", multiplier: "3x" },
  { value: 2, label: "GPU-T2", multiplier: "5x" },
] as const;

export default function ProviderRegister() {
  const { address, isConnected } = useAccount();
  const { toast } = useToast();
  
  // Form state
  const [pubKeyHash, setPubKeyHash] = useState("");
  const [ipfsCID, setIpfsCID] = useState("");
  const [region, setRegion] = useState<"Helsinki" | "EU" | "Global">("Helsinki");
  const [hardwareTier, setHardwareTier] = useState(0);
  const [capacity, setCapacity] = useState([1]);
  
  // Full device info (for IPFS metadata)
  const [name, setName] = useState("High-Performance Compute Node");
  const [description, setDescription] = useState("Enterprise-grade compute server with GPU acceleration for AI/ML workloads and high-performance computing tasks.");
  const [cpuModel, setCpuModel] = useState("Intel Xeon E5-2686 v4");
  const [cpuCores, setCpuCores] = useState("16");
  const [cpuThreads, setCpuThreads] = useState("32");
  const [cpuClockSpeed, setCpuClockSpeed] = useState("2.3");
  const [gpuModel, setGpuModel] = useState("NVIDIA A100");
  const [gpuCount, setGpuCount] = useState("4");
  const [gpuMemory, setGpuMemory] = useState("40");
  const [gpuCudaCores, setGpuCudaCores] = useState("6912");
  const [ramTotal, setRamTotal] = useState("256");
  const [ramType, setRamType] = useState("DDR4");
  const [storageTotal, setStorageTotal] = useState("4 TB");
  const [storageType, setStorageType] = useState("NVMe SSD");
  const [storageSpeed, setStorageSpeed] = useState("7000 MB/s read, 5000 MB/s write");
  const [bandwidth, setBandwidth] = useState("10 Gbps");
  const [networkType, setNetworkType] = useState("Fiber");
  const [location, setLocation] = useState("Helsinki Data Center");
  const [country, setCountry] = useState("Finland");
  const [city, setCity] = useState("Helsinki");
  
  // Registration state
  const [isPreparingIPFS, setIsPreparingIPFS] = useState(false);
  const [isPrepared, setIsPrepared] = useState(false);
  const [myProviders, setMyProviders] = useState<any[]>([]);
  
  // Contract hooks
  const { data: balance, isLoading: balanceLoading } = useCLDTokenBalance(address);
  const { data: allowance, isLoading: allowanceLoading } = useCLDTokenAllowance(address, PROVIDER_REGISTRY_ADDRESS);
  const { approve, isPending: isApproving, isSuccess: isApproved } = useApproveCLDToken();
  const { register, hash, isPending: isRegistering, isSuccess: isRegistered, error } = useRegisterProvider();
  const { data: bondInfo } = useProviderRegistryBondInfo();
  const { data: myProviderKeys, refetch: refetchMyProviders } = useMyProviders(address);
  
  // Auto-generate pubKeyHash when name changes
  useEffect(() => {
    if (name && region) {
      const newKey = generatePubKeyHash();
      setPubKeyHash(newKey);
    }
  }, [name, region]);
  
  // Load my providers
  useEffect(() => {
    if (myProviderKeys && Array.isArray(myProviderKeys)) {
      setMyProviders(myProviderKeys.map((key: string) => ({ pubKeyHash: key })));
    }
  }, [myProviderKeys]);
  
  // Reload providers after successful registration
  useEffect(() => {
    if (isRegistered && address) {
      toast({
        title: "Registration Successful!",
        description: "Your provider has been registered on-chain.",
      });
      
      // Reload providers
      setTimeout(() => {
        refetchMyProviders();
      }, 2000);
      
      // Reset form
      resetForm();
    }
  }, [isRegistered, address]);
  
  const resetForm = () => {
    setName("");
    setDescription("");
    setPubKeyHash("");
    setIpfsCID("");
    setCpuModel("");
    setCpuCores("");
    setCpuThreads("");
    setCpuClockSpeed("");
    setGpuModel("");
    setGpuCount("");
    setGpuMemory("");
    setGpuCudaCores("");
    setRamTotal("");
    setRamType("");
    setStorageTotal("");
    setStorageType("");
    setStorageSpeed("");
    setBandwidth("");
    setNetworkType("");
    setLocation("");
    setCountry("");
    setCity("");
    setIsPrepared(false);
  };
  
  const handlePrepareIPFS = async () => {
    if (!name) {
      toast({
        title: "Missing Information",
        description: "Please provide at least a provider name.",
        variant: "destructive",
      });
      return;
    }
    
    setIsPreparingIPFS(true);
    try {
      // Prepare metadata for IPFS
      const metadata: ProviderMetadata = {
        name,
        description: description || undefined,
        region,
        hardwareTier,
        capacity: capacity[0],
        cpuModel: cpuModel || undefined,
        cpuCores: cpuCores ? parseInt(cpuCores) : undefined,
        cpuThreads: cpuThreads ? parseInt(cpuThreads) : undefined,
        cpuClockSpeed: cpuClockSpeed || undefined,
        gpuModel: gpuModel || undefined,
        gpuCount: gpuCount ? parseInt(gpuCount) : undefined,
        gpuMemory: gpuMemory || undefined,
        gpuCudaCores: gpuCudaCores || undefined,
        ramTotal: ramTotal || undefined,
        ramType: ramType || undefined,
        storageTotal: storageTotal || undefined,
        storageType: storageType || undefined,
        storageSpeed: storageSpeed || undefined,
        bandwidth: bandwidth || undefined,
        networkType: networkType || undefined,
        location: location || undefined,
        country: country || undefined,
        city: city || undefined,
        createdAt: new Date().toISOString(),
      };
      
      // Upload to IPFS
      const cid = await uploadToIPFS(metadata);
      setIpfsCID(cid);
      setIsPrepared(true);
      
      toast({
        title: "IPFS Upload Complete",
        description: `Metadata uploaded to IPFS: ${cid}`,
      });
    } catch (error: any) {
      toast({
        title: "IPFS Upload Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsPreparingIPFS(false);
    }
  };
  
  const handleApprove = () => {
    if (!bondInfo) return;
    const bondAmount = formatEther(bondInfo as bigint);
    approve(PROVIDER_REGISTRY_ADDRESS, bondAmount);
  };
  
  const handleRegister = () => {
    if (!pubKeyHash || !ipfsCID) return;
    register(pubKeyHash, ipfsCID);
  };
  
  const balanceValue = balance && typeof balance === 'bigint' ? parseFloat(formatEther(balance)) : 0;
  const allowanceValue = allowance && typeof allowance === 'bigint' ? parseFloat(formatEther(allowance)) : 0;
  const bondAmount = bondInfo && typeof bondInfo === 'bigint' ? parseFloat(formatEther(bondInfo)) : 1000;
  const needsApproval = allowanceValue < bondAmount;
  const hasEnoughBalance = balanceValue >= bondAmount;
  
  const canPrepare = name && !isPrepared;
  const canRegister = isPrepared && hasEnoughBalance && !needsApproval;
  const remainingQuota = 10 - myProviders.length;
  
  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center h-[50vh]">
        <h2 className="text-2xl font-bold mb-4">Connect Wallet</h2>
        <p className="text-muted-foreground mb-4">Please connect your wallet to register a provider.</p>
      </div>
    );
  }
  
  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500 pt-10">
      {/* Registration Form */}
      <Card className="glass-card border-primary/20">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Server className="h-6 w-6 text-primary" />
            </div>
            <div>
              <CardTitle className="text-2xl">Register DePIN Provider</CardTitle>
              <CardDescription>Register your compute node on-chain with IPFS metadata</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-8">
          {/* Prepared State Info */}
          {isPrepared && (
            <div className="space-y-4 p-4 rounded-lg bg-green-500/10 border border-green-500/20">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-500" />
                <h3 className="text-lg font-semibold">Ready to Register</h3>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Provider Name:</span>
                  <span className="font-medium">{name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Public Key Hash:</span>
                  <span className="font-mono text-xs">{pubKeyHash.slice(0, 20)}...</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">IPFS CID:</span>
                  <span className="font-mono text-xs">{ipfsCID}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Bond Amount:</span>
                  <span className="font-bold">{bondAmount} CLD</span>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setIsPrepared(false);
                  setIpfsCID("");
                }}
              >
                ← Back to Edit
              </Button>
            </div>
          )}

          {/* Provider Information Form */}
          {!isPrepared && (
            <>
              {/* Basic Information */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Basic Information</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Provider Name *</Label>
                    <Input
                      id="name"
                      placeholder="My Compute Node"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                    />
                  </div>
                  {pubKeyHash && (
                    <div className="space-y-2">
                      <Label>Auto-Generated Public Key Hash</Label>
                      <div className="flex gap-2">
                        <Input
                          value={pubKeyHash}
                          readOnly
                          className="font-mono text-sm bg-muted"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={async () => {
                            await navigator.clipboard.writeText(pubKeyHash);
                            toast({
                              title: "Copied!",
                              description: "Public key hash copied to clipboard.",
                            });
                          }}
                          title="Copy to clipboard"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="description">Description</Label>
                    <Textarea
                      id="description"
                      placeholder="Describe your compute node..."
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={3}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="region">Region *</Label>
                    <Select value={region} onValueChange={(v) => setRegion(v as typeof region)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {REGIONS.map((r) => (
                          <SelectItem key={r} value={r}>
                            {r}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="hardwareTier">Hardware Tier *</Label>
                    <Select
                      value={hardwareTier.toString()}
                      onValueChange={(v) => setHardwareTier(parseInt(v))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {HARDWARE_TIERS.map((tier) => (
                          <SelectItem key={tier.value} value={tier.value.toString()}>
                            {tier.label} ({tier.multiplier})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="capacity">Capacity: {capacity[0]} server{capacity[0] !== 1 ? "s" : ""} *</Label>
                    <Slider
                      value={capacity}
                      onValueChange={setCapacity}
                      min={1}
                      max={10}
                      step={1}
                      className="w-full"
                    />
                  </div>
                </div>
              </div>

              {/* CPU Information */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Cpu className="h-5 w-5 text-primary" />
                  <h3 className="text-lg font-semibold">CPU Information</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="cpuModel">CPU Model</Label>
                    <Input
                      id="cpuModel"
                      placeholder="e.g., Intel Xeon E5-2686 v4"
                      value={cpuModel}
                      onChange={(e) => setCpuModel(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cpuCores">CPU Cores</Label>
                    <Input
                      id="cpuCores"
                      type="number"
                      placeholder="e.g., 8"
                      value={cpuCores}
                      onChange={(e) => setCpuCores(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cpuThreads">CPU Threads</Label>
                    <Input
                      id="cpuThreads"
                      type="number"
                      placeholder="e.g., 16"
                      value={cpuThreads}
                      onChange={(e) => setCpuThreads(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cpuClockSpeed">Clock Speed (GHz)</Label>
                    <Input
                      id="cpuClockSpeed"
                      placeholder="e.g., 2.3"
                      value={cpuClockSpeed}
                      onChange={(e) => setCpuClockSpeed(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* GPU Information */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Cpu className="h-5 w-5 text-primary" />
                  <h3 className="text-lg font-semibold">GPU Information</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="gpuModel">GPU Model</Label>
                    <Input
                      id="gpuModel"
                      placeholder="e.g., NVIDIA A100"
                      value={gpuModel}
                      onChange={(e) => setGpuModel(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="gpuCount">GPU Count</Label>
                    <Input
                      id="gpuCount"
                      type="number"
                      placeholder="e.g., 4"
                      value={gpuCount}
                      onChange={(e) => setGpuCount(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="gpuMemory">GPU Memory (GB)</Label>
                    <Input
                      id="gpuMemory"
                      placeholder="e.g., 40"
                      value={gpuMemory}
                      onChange={(e) => setGpuMemory(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="gpuCudaCores">CUDA Cores</Label>
                    <Input
                      id="gpuCudaCores"
                      placeholder="e.g., 6912"
                      value={gpuCudaCores}
                      onChange={(e) => setGpuCudaCores(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Memory & Storage */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <HardDrive className="h-5 w-5 text-primary" />
                  <h3 className="text-lg font-semibold">Memory & Storage</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="ramTotal">Total RAM (GB)</Label>
                    <Input
                      id="ramTotal"
                      placeholder="e.g., 128"
                      value={ramTotal}
                      onChange={(e) => setRamTotal(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ramType">RAM Type</Label>
                    <Input
                      id="ramType"
                      placeholder="e.g., DDR4, DDR5"
                      value={ramType}
                      onChange={(e) => setRamType(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="storageTotal">Total Storage</Label>
                    <Input
                      id="storageTotal"
                      placeholder="e.g., 2 TB"
                      value={storageTotal}
                      onChange={(e) => setStorageTotal(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="storageType">Storage Type</Label>
                    <Input
                      id="storageType"
                      placeholder="e.g., NVMe SSD"
                      value={storageType}
                      onChange={(e) => setStorageType(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="storageSpeed">Storage Speed</Label>
                    <Input
                      id="storageSpeed"
                      placeholder="e.g., 7000 MB/s read, 5000 MB/s write"
                      value={storageSpeed}
                      onChange={(e) => setStorageSpeed(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Network Information */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Network className="h-5 w-5 text-primary" />
                  <h3 className="text-lg font-semibold">Network Information</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="bandwidth">Bandwidth</Label>
                    <Input
                      id="bandwidth"
                      placeholder="e.g., 10 Gbps"
                      value={bandwidth}
                      onChange={(e) => setBandwidth(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="networkType">Network Type</Label>
                    <Input
                      id="networkType"
                      placeholder="e.g., Fiber"
                      value={networkType}
                      onChange={(e) => setNetworkType(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Location Information */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <MapPin className="h-5 w-5 text-primary" />
                  <h3 className="text-lg font-semibold">Location Information</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="country">Country</Label>
                    <Input
                      id="country"
                      placeholder="e.g., Finland"
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="city">City</Label>
                    <Input
                      id="city"
                      placeholder="e.g., Helsinki"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="location">Full Location</Label>
                    <Input
                      id="location"
                      placeholder="e.g., Helsinki Data Center"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </>
          )}
          
          {/* Bond Info */}
          <div className="p-4 rounded-lg bg-muted/50 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Total Bond:</span>
              <span className="text-lg font-bold">{bondAmount} CLD</span>
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              <div>🏛️ Treasury (80%): {(bondAmount * 0.8).toFixed(0)} CLD</div>
              <div>👥 Team (20%): {(bondAmount * 0.2).toFixed(0)} CLD</div>
            </div>
          </div>
          
          {/* Balance & Allowance */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Your Balance:</span>
              <span className={hasEnoughBalance ? "text-green-500" : "text-red-500"}>
                {balanceLoading ? "Loading..." : `${balanceValue.toFixed(2)} CLD`}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Allowance:</span>
              <span className={!needsApproval ? "text-green-500" : "text-yellow-500"}>
                {allowanceLoading ? "Loading..." : `${allowanceValue.toFixed(2)} CLD`}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Remaining Quota:</span>
              <span>{remainingQuota} / 10 providers</span>
            </div>
          </div>
          
          {/* Actions */}
          <div className="flex gap-2">
            {!isPrepared && (
              <Button
                onClick={handlePrepareIPFS}
                disabled={isPreparingIPFS || !canPrepare}
                className="flex-1"
              >
                {isPreparingIPFS ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Uploading to IPFS...
                  </>
                ) : (
                  "Prepare & Upload to IPFS"
                )}
              </Button>
            )}
            
            {isPrepared && needsApproval && (
              <Button
                onClick={handleApprove}
                disabled={isApproving || isApproved}
                variant="outline"
                className="flex-1"
              >
                {isApproving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Approving...
                  </>
                ) : isApproved ? (
                  "Approved ✓"
                ) : (
                  "Approve Tokens"
                )}
              </Button>
            )}
            
            {canRegister && (
              <Button
                onClick={handleRegister}
                disabled={isRegistering}
                className="flex-1 bg-orange-600 hover:bg-orange-700"
              >
                {isRegistering ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Registering...
                  </>
                ) : (
                  <>
                    <Flame className="mr-2 h-4 w-4" />
                    Register Provider
                  </>
                )}
              </Button>
            )}
          </div>
          
          {error && (
            <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
              {error.message || "Registration failed"}
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* My Providers List */}
      {myProviders.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>My Registered Providers</CardTitle>
            <CardDescription>{myProviders.length} provider(s) registered</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {myProviders.map((provider, idx) => (
                <div
                  key={provider.pubKeyHash}
                  className="p-4 rounded-lg border bg-card space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">#{idx + 1}</Badge>
                      <span className="font-mono text-xs">
                        {provider.pubKeyHash.slice(0, 10)}...{provider.pubKeyHash.slice(-8)}
                      </span>
                    </div>
                    <Badge variant="secondary">Registered</Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
