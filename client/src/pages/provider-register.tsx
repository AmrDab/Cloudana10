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
import { Server, Copy, Check, Loader2, Flame, Cpu, HardDrive, Network, MapPin } from "lucide-react";
import {
  useCLDTokenBalance,
  useCLDTokenAllowance,
  useApproveCLDToken,
  useRegisterNodeProvider,
  generateproviderkey,
  PROVIDER_REGISTRY_ADDRESS,
} from "@/lib/contracts";
import { getBondInfo, validateAndPrepareRegistration, getMyProviders, type ProviderNode, type ValidateAndPrepareResponse } from "@/lib/api";
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
  
  // Basic form state (on-chain data)
  const [providerkey, setproviderkey] = useState("");
  const [region, setRegion] = useState<"Helsinki" | "EU" | "Global">("Helsinki");
  const [hardwareTier, setHardwareTier] = useState(0);
  const [capacity, setCapacity] = useState([1]);
  
  // Full device info (DB data)
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cpuModel, setCpuModel] = useState("");
  const [cpuCores, setCpuCores] = useState("");
  const [cpuThreads, setCpuThreads] = useState("");
  const [cpuClockSpeed, setCpuClockSpeed] = useState("");
  const [gpuModel, setGpuModel] = useState("");
  const [gpuCount, setGpuCount] = useState("");
  const [gpuMemory, setGpuMemory] = useState("");
  const [gpuCudaCores, setGpuCudaCores] = useState("");
  const [ramTotal, setRamTotal] = useState("");
  const [ramType, setRamType] = useState("");
  const [storageTotal, setStorageTotal] = useState("");
  const [storageType, setStorageType] = useState("");
  const [storageSpeed, setStorageSpeed] = useState("");
  const [bandwidth, setBandwidth] = useState("");
  const [networkType, setNetworkType] = useState("");
  const [location, setLocation] = useState("");
  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");
  
  // Registration state
  const [isValidating, setIsValidating] = useState(false);
  const [validationData, setValidationData] = useState<ValidateAndPrepareResponse | null>(null);
  const [myProviders, setMyProviders] = useState<ProviderNode[]>([]);
  const [bondInfo, setBondInfo] = useState<any>(null);
  const [showTransactionInfo, setShowTransactionInfo] = useState(false);
  
  // Contract hooks
  const { data: balance } = useCLDTokenBalance(address);
  const { data: allowance } = useCLDTokenAllowance(address, PROVIDER_REGISTRY_ADDRESS);
  const { approve, isPending: isApproving, isSuccess: isApproved } = useApproveCLDToken();
  const { register, hash, isPending: isRegistering, isSuccess: isRegistered, error } = useRegisterNodeProvider();
  
  // Load bond info and providers on mount
  useEffect(() => {
    if (isConnected && address) {
      loadBondInfo();
      loadMyProviders();
    }
  }, [isConnected, address]);
  
  // Auto-generate providerkey when all required fields are filled
  useEffect(() => {
    if (name && region && !providerkey) {
      const newKey = generateproviderkey();
      setproviderkey(newKey);
    }
  }, [name, region, providerkey]);

  // Reload providers after successful registration
  // Backend will automatically update status via event listener
  useEffect(() => {
    if (isRegistered && address) {
      toast({
        title: "Transaction Submitted!",
        description: "Your provider registration is being processed. The status will update automatically once confirmed on-chain.",
      });
      
      // Reload providers to show updated status
      setTimeout(() => {
        loadMyProviders();
      }, 3000); // Wait 3 seconds for event to be processed
      
      // Reset form after successful registration
      setName("");
      setDescription("");
      setproviderkey("");
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
      setValidationData(null);
      setShowTransactionInfo(false);
    }
  }, [isRegistered, address]);
  
  const loadBondInfo = async () => {
    try {
      const info = await getBondInfo();
      setBondInfo(info);
    } catch (error: any) {
      console.error("Failed to load bond info:", error);
    }
  };
  
  const loadMyProviders = async () => {
    if (!address) return;
    try {
      const providers = await getMyProviders(address);
      setMyProviders(providers);
    } catch (error: any) {
      console.error("Failed to load providers:", error);
    }
  };
  
  const handleValidateAndPrepare = async () => {
    if (!address || !providerkey || !name) return;
    
    setIsValidating(true);
    try {
      const data = await validateAndPrepareRegistration({
        ownerAddress: address,
        providerkey,
        region,
        hardwareTier,
        capacity: capacity[0],
        name,
        description: description || undefined,
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
      });
      
      setValidationData(data);
      setShowTransactionInfo(true);
      
      toast({
        title: "Validation Successful",
        description: "Provider info validated. Review transaction details and click Register to proceed.",
      });
    } catch (error: any) {
      toast({
        title: "Validation Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsValidating(false);
    }
  };
  
  const handleApprove = () => {
    if (!bondInfo) return;
    approve(PROVIDER_REGISTRY_ADDRESS, bondInfo.bondAmount);
  };
  
  const handleRegister = () => {
    if (!validationData || !providerkey) return;
    // Use validated data from backend
    const { validated, transaction } = validationData;
    register(validated.providerkey, validated.region, validated.hardwareTier, validated.capacity);
  };
  
  
  const balanceValue = balance && typeof balance === 'bigint' ? parseFloat(formatEther(balance)) : 0;
  const allowanceValue = allowance && typeof allowance === 'bigint' ? parseFloat(formatEther(allowance)) : 0;
  const bondAmount = bondInfo ? parseFloat(bondInfo.bondAmount) : 1000;
  const needsApproval = allowanceValue < bondAmount;
  const hasEnoughBalance = balanceValue >= bondAmount;
  
  // Check if all required fields are filled for auto-generating providerkey
  const hasRequiredFields = name && region;
  const canValidateAndPrepare = hasEnoughBalance && hasRequiredFields && !showTransactionInfo;
  const canRegister = showTransactionInfo && validationData && hasEnoughBalance && !needsApproval;
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
              <CardDescription>Register your compute node with full device details</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-8">
          {/* Transaction Info (shown after validation) */}
          {showTransactionInfo && validationData && (
            <div className="space-y-4 p-4 rounded-lg bg-muted/50 border">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Transaction Details</h3>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowTransactionInfo(false);
                    setValidationData(null);
                  }}
                >
                  ← Back to Edit
                </Button>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Provider Name:</span>
                  <span className="font-medium">{validationData.validated.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Node Key:</span>
                  <span className="font-mono text-xs">{validationData.validated.providerkey.slice(0, 20)}...</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Region:</span>
                  <span>{validationData.validated.region}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Hardware Tier:</span>
                  <span>{HARDWARE_TIERS[validationData.validated.hardwareTier]?.label}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Capacity:</span>
                  <span>{validationData.validated.capacity} server(s)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Bond Amount:</span>
                  <span className="font-bold">{parseFloat(validationData.bondInfo.totalBond) / 1e18} CLD</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Gas Estimate:</span>
                  <span>{validationData.gasEstimate}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Contract Address:</span>
                  <span className="font-mono text-xs">{validationData.transaction.to.slice(0, 20)}...</span>
                </div>
              </div>
            </div>
          )}

          {/* Provider Information Form (hidden after validation) */}
          {!showTransactionInfo && (
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
              {providerkey && (
                <div className="space-y-2">
                  <Label>Auto-Generated Node Key</Label>
                  <div className="flex gap-2">
                    <Input
                      value={providerkey}
                      readOnly
                      className="font-mono text-sm bg-muted"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={async () => {
                        await navigator.clipboard.writeText(providerkey);
                        toast({
                          title: "Copied!",
                          description: "Node key copied to clipboard.",
                        });
                      }}
                      title="Copy to clipboard"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    This key was automatically generated when you filled in the required fields.
                  </p>
                </div>
              )}
              <div className="space-y-2">
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
              <div className="space-y-2">
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
                <Label htmlFor="storageTotal">Total Storage (GB/TB)</Label>
                <Input
                  id="storageTotal"
                  placeholder="e.g., 2000 GB or 2 TB"
                  value={storageTotal}
                  onChange={(e) => setStorageTotal(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="storageType">Storage Type</Label>
                <Input
                  id="storageType"
                  placeholder="e.g., NVMe SSD, HDD"
                  value={storageType}
                  onChange={(e) => setStorageType(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="storageSpeed">Storage Speed</Label>
                <Input
                  id="storageSpeed"
                  placeholder="e.g., 3500 MB/s read, 3000 MB/s write"
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
                <Label htmlFor="bandwidth">Bandwidth (Mbps/Gbps)</Label>
                <Input
                  id="bandwidth"
                  placeholder="e.g., 1000 Mbps or 1 Gbps"
                  value={bandwidth}
                  onChange={(e) => setBandwidth(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="networkType">Network Type</Label>
                <Input
                  id="networkType"
                  placeholder="e.g., Ethernet, Fiber"
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
          
          {/* Bond Info */}
          {bondInfo && (
            <div className="p-4 rounded-lg bg-muted/50 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Total Bond:</span>
                <span className="text-lg font-bold">{bondInfo.bondAmount} CLD</span>
              </div>
              <div className="text-xs text-muted-foreground space-y-1">
                <div>🔥 Burn (80%): {(parseFloat(bondInfo.bondAmount) * 0.8).toFixed(0)} CLD</div>
                <div>👥 Team (15%): {(parseFloat(bondInfo.bondAmount) * 0.15).toFixed(0)} CLD</div>
                <div>🏛️ Treasury (5%): {(parseFloat(bondInfo.bondAmount) * 0.05).toFixed(0)} CLD</div>
              </div>
            </div>
          )}
          
          {/* Balance & Allowance */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Your Balance:</span>
              <span className={hasEnoughBalance ? "text-green-500" : "text-red-500"}>
                {balanceValue.toFixed(2)} CLD
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Allowance:</span>
              <span className={!needsApproval ? "text-green-500" : "text-yellow-500"}>
                {allowanceValue.toFixed(2)} CLD
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Remaining Quota:</span>
              <span>{remainingQuota} / 10 providers</span>
            </div>
          </div>
          
              </>
            )}

          {/* Actions */}
          <div className="flex gap-2">
            {!showTransactionInfo && (
              <Button
                onClick={handleValidateAndPrepare}
                disabled={isValidating || !canValidateAndPrepare}
                className="flex-1"
              >
                {isValidating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Validating...
                  </>
                ) : (
                  "Validate & Prepare"
                )}
              </Button>
            )}
            
            {showTransactionInfo && needsApproval && (
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
                  key={provider.providerkey}
                  className="p-4 rounded-lg border bg-card space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">#{idx + 1}</Badge>
                      <span className="font-mono text-xs">
                        {provider.providerkey.slice(0, 10)}...{provider.providerkey.slice(-8)}
                      </span>
                    </div>
                    <Badge
                      variant={
                        provider.status === 1
                          ? "default"
                          : provider.status === 0
                          ? "secondary"
                          : "destructive"
                      }
                    >
                      {provider.status === 1
                        ? "🟢 Active"
                        : provider.status === 0
                        ? "🟡 Registered"
                        : "🔴 Inactive"}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Region:</span> {provider.region}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Tier:</span>{" "}
                      {HARDWARE_TIERS[provider.hardwareTier]?.label || "Unknown"}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Capacity:</span> {provider.capacity}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Registered:</span>{" "}
                      {formatDistanceToNow(new Date(provider.registeredAt), { addSuffix: true })}
                    </div>
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
