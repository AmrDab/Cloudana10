import { useState, useEffect, useRef } from "react";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { TxLink } from "@/components/ui/tx-link";
import { AddressDisplay } from "@/components/ui/address-display";
import { Server, Copy, Check, Loader2, Flame, Cpu, HardDrive, Network, MapPin, CheckCircle, ExternalLink } from "lucide-react";
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
  type ProviderDeviceId,
} from "@/lib/contracts";
import { uploadToIPFS, generatePubKeyHash as generatePubKey, getPinataGatewayUrl, type ProviderMetadata, type ProviderNode } from "@/lib/api";
import { ConfirmRegisterModal } from "@/components/confirm-register-modal";
import { formatEther } from "viem";
import { formatDistanceToNow } from "date-fns";

const REGIONS = ["Helsinki", "EU", "Global"] as const;

const HARDWARE_TIERS = [
  { value: 0, label: "CPU", multiplier: "1x" },
  { value: 1, label: "GPU-T1", multiplier: "3x" },
  { value: 2, label: "GPU-T2", multiplier: "5x" },
] as const;

const REGISTER_DRAFT_KEY = "cloudana_provider_register_draft";
const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

type RegisterDraft = {
  ts: number;
  deviceId: string;
  ipfsCID: string;
  isPrepared: boolean;
  region: string;
  hardwareTier: number;
  capacity: number[];
  name: string;
  description: string;
  cpuModel: string;
  cpuCores: string;
  cpuThreads: string;
  cpuClockSpeed: string;
  gpuModel: string;
  gpuCount: string;
  gpuMemory: string;
  gpuCudaCores: string;
  ramTotal: string;
  ramType: string;
  storageTotal: string;
  storageType: string;
  storageSpeed: string;
  bandwidth: string;
  networkType: string;
  location: string;
  country: string;
  city: string;
};

function loadRegisterDraft(): Partial<RegisterDraft> | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(REGISTER_DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as RegisterDraft;
    if (d.ts && Date.now() - d.ts > DRAFT_MAX_AGE_MS) {
      sessionStorage.removeItem(REGISTER_DRAFT_KEY);
      return null;
    }
    return d;
  } catch {
    return null;
  }
}

function saveRegisterDraft(draft: Omit<RegisterDraft, "ts">) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(REGISTER_DRAFT_KEY, JSON.stringify({ ...draft, ts: Date.now() }));
  } catch {
    /* ignore */
  }
}

function clearRegisterDraft() {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(REGISTER_DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

export default function ProviderRegister() {
  const { address, isConnected } = useAccount();
  const { toast } = useToast();
  
  // Form state
  const [deviceId, setDeviceId] = useState<ProviderDeviceId | "">("");
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
  const [gpuCount, setGpuCount] = useState("0");
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
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [myProviders, setMyProviders] = useState<any[]>([]);
  const [copiedPubKey, setCopiedPubKey] = useState(false);
  const [providerEndpoint, setProviderEndpoint] = useState<string>("");
  
  // Contract hooks
  const { data: balance, isLoading: balanceLoading } = useCLDTokenBalance(address);
  const { data: allowance, isLoading: allowanceLoading } = useCLDTokenAllowance(address, PROVIDER_REGISTRY_ADDRESS);
  const { approve, hash: approveHash, isPending: isApproving, isSuccess: isApproved, reset: resetApprove } = useApproveCLDToken();
  const { register, hash: registerHash, isPending: isRegistering, isSuccess: isRegistered, error, reset: resetRegister } = useRegisterProvider();
  const { data: bondInfo } = useProviderRegistryBondInfo();
  const { data: myProviderDeviceIds } = useMyProviders(address);
  const hasRestoredDraft = useRef(false);
  const hasRunFirstPersist = useRef(false);

  // Restore draft from sessionStorage once on mount (survives refresh)
  useEffect(() => {
    if (hasRestoredDraft.current) return;
    hasRestoredDraft.current = true;
    const d = loadRegisterDraft();
    if (!d) return;
    hasRestoredDraft.current = true;
    if (d.deviceId != null) setDeviceId(d.deviceId as ProviderDeviceId | "");
    if (d.ipfsCID != null) setIpfsCID(d.ipfsCID);
    if (d.isPrepared != null) setIsPrepared(d.isPrepared);
    if (d.region != null && REGIONS.includes(d.region as typeof region)) setRegion(d.region as typeof region);
    if (d.hardwareTier != null) setHardwareTier(d.hardwareTier);
    if (d.capacity != null && d.capacity.length) setCapacity(d.capacity);
    if (d.name != null) setName(d.name);
    if (d.description != null) setDescription(d.description);
    if (d.cpuModel != null) setCpuModel(d.cpuModel);
    if (d.cpuCores != null) setCpuCores(d.cpuCores);
    if (d.cpuThreads != null) setCpuThreads(d.cpuThreads);
    if (d.cpuClockSpeed != null) setCpuClockSpeed(d.cpuClockSpeed);
    if (d.gpuModel != null) setGpuModel(d.gpuModel);
    if (d.gpuCount != null) setGpuCount(d.gpuCount);
    if (d.gpuMemory != null) setGpuMemory(d.gpuMemory);
    if (d.gpuCudaCores != null) setGpuCudaCores(d.gpuCudaCores);
    if (d.ramTotal != null) setRamTotal(d.ramTotal);
    if (d.ramType != null) setRamType(d.ramType);
    if (d.storageTotal != null) setStorageTotal(d.storageTotal);
    if (d.storageType != null) setStorageType(d.storageType);
    if (d.storageSpeed != null) setStorageSpeed(d.storageSpeed);
    if (d.bandwidth != null) setBandwidth(d.bandwidth);
    if (d.networkType != null) setNetworkType(d.networkType);
    if (d.location != null) setLocation(d.location);
    if (d.country != null) setCountry(d.country);
    if (d.city != null) setCity(d.city);
  }, []);

  // Load device_id and endpoint from build when action_id is in URL (after build cluster)
  useEffect(() => {
    const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const actionId = params?.get("action_id");
    if (!actionId) return;
    const apiUrl = `${import.meta.env.VITE_API_URL || "http://localhost:7002/v1"}/build-provider-status`;
    fetch(`${apiUrl}/${actionId}`)
      .then((r) => r.json())
      .then((data: { device_id?: string; control_node_endpoint?: string }) => {
        if (data.device_id && typeof data.device_id === "string" && data.device_id.startsWith("0x")) {
          setDeviceId(data.device_id as ProviderDeviceId);
        }
        if (data.control_node_endpoint && typeof data.control_node_endpoint === "string") {
          setProviderEndpoint(data.control_node_endpoint);
        }
      })
      .catch(() => {});
  }, []);

  // Auto-generate pubKeyHash when name changes
  useEffect(() => {
    if (name && region) {
      const newKey = generatePubKeyHash();
      setPubKeyHash(newKey);
    }
  }, [name, region]);

  // Load my providers (device ids)
  useEffect(() => {
    if (myProviderDeviceIds && Array.isArray(myProviderDeviceIds)) {
      setMyProviders(myProviderDeviceIds.map((id: string) => ({ deviceId: id })));
    }
  }, [myProviderDeviceIds]);
  
  // Show success message after approval (data will auto-refresh)
  useEffect(() => {
    if (isApproved && approveHash) {
      toast({
        title: "Approval Successful!",
        description: "Token approval has been confirmed. You can now register your provider.",
      });
    }
  }, [isApproved, approveHash]);

  const queryClient = useQueryClient();

  // Show success message after registration; invalidate provider lists so UI updates in real time
  useEffect(() => {
    if (isRegistered && address && registerHash) {
      queryClient.invalidateQueries({ queryKey: ["myProviders", address] });
      queryClient.invalidateQueries({ queryKey: ["providers"] });
      queryClient.invalidateQueries({ queryKey: ["allProviders"] });
      clearRegisterDraft();
      toast({
        title: "Registration Successful!",
        description: "Your provider has been registered on-chain. You can register another provider or clear the form.",
        duration: 5000,
      });

      // Reset only the prepared state to allow registering another provider with similar data
      setIsPrepared(false);
      setIpfsCID("");
      setDeviceId("");
      if (name && region) {
        const newKey = generatePubKeyHash();
        setPubKeyHash(newKey);
      }
    }
  }, [isRegistered, address, registerHash, queryClient]);

  // Show error toast when registration fails
  useEffect(() => {
    if (error && !isRegistering && !isRegistered) {
      // Skip internal RPC errors that are transient
      if (error.message?.includes("Internal JSON-RPC error")) return;
      
      const errorMessage = error.message?.includes("User rejected") || error.message?.includes("User denied")
        ? "Transaction was rejected in wallet"
        : error.message?.includes("already registered")
        ? "This provider is already registered. Each device can only be registered once."
        : error.message || "Registration failed";
      
      toast({
        title: "Registration Failed",
        description: errorMessage,
        variant: "destructive",
        duration: 7000,
      });
    }
  }, [error, isRegistering, isRegistered, toast]);

  // Persist draft to sessionStorage so refresh/reload keeps form and prepared state
  useEffect(() => {
    // Skip first run so we don't overwrite sessionStorage with initial state before restore commits
    if (!hasRunFirstPersist.current) {
      hasRunFirstPersist.current = true;
      return;
    }
    saveRegisterDraft({
      deviceId: typeof deviceId === "string" ? deviceId : "",
      ipfsCID,
      isPrepared,
      region,
      hardwareTier,
      capacity,
      name,
      description,
      cpuModel,
      cpuCores,
      cpuThreads,
      cpuClockSpeed,
      gpuModel,
      gpuCount,
      gpuMemory,
      gpuCudaCores,
      ramTotal,
      ramType,
      storageTotal,
      storageType,
      storageSpeed,
      bandwidth,
      networkType,
      location,
      country,
      city,
    });
  }, [
    deviceId,
    ipfsCID,
    isPrepared,
    region,
    hardwareTier,
    capacity,
    name,
    description,
    cpuModel,
    cpuCores,
    cpuThreads,
    cpuClockSpeed,
    gpuModel,
    gpuCount,
    gpuMemory,
    gpuCudaCores,
    ramTotal,
    ramType,
    storageTotal,
    storageType,
    storageSpeed,
    bandwidth,
    networkType,
    location,
    country,
    city,
  ]);

  const resetForm = () => {
    clearRegisterDraft();
    resetApprove();
    resetRegister();
    setName("");
    setDescription("");
    setDeviceId("");
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
    const info = bondInfo as { maxBond?: bigint } | undefined;
    if (!info?.maxBond) return;
    const bondAmount = formatEther(info.maxBond);
    console.log('[ProviderRegister] Calling approve...');
    approve(PROVIDER_REGISTRY_ADDRESS, bondAmount);
  };
  
  const handleRegisterClick = () => {
    const effectiveDeviceId = (deviceId && deviceId.startsWith("0x") ? deviceId : null) as ProviderDeviceId | null;
    if (!effectiveDeviceId) {
      toast({
        title: "Device ID required",
        description: "Get a device ID by completing the provider build flow, or paste the device ID from your node (GET /device-info).",
        variant: "destructive",
      });
      return;
    }
    setConfirmModalOpen(true);
  };

  const handleConfirmRegister = async (metadata: ProviderMetadata) => {
    const effectiveDeviceId = (deviceId && deviceId.startsWith("0x") ? deviceId : null) as ProviderDeviceId | null;
    if (!effectiveDeviceId) return;
    try {
      const cid = await uploadToIPFS(metadata);
      setIpfsCID(cid);
      setIsPrepared(true);
      setConfirmModalOpen(false);
      // Store only the CID on-chain, not the full gateway URL
      // The gateway URL will be constructed when fetching the metadata
      register(effectiveDeviceId, cid);
    } catch (error: unknown) {
      toast({
        title: "IPFS upload failed",
        description: error instanceof Error ? error.message : "Upload failed",
        variant: "destructive",
      });
    }
  };

  // Debug logging for loading states
  useEffect(() => {
    if (isApproving || isRegistering) {
      console.log('[ProviderRegister] Loading states:', { isApproving, isRegistering, approveHash, registerHash });
    }
  }, [isApproving, isRegistering, approveHash, registerHash]);
  
  const balanceValue = balance && typeof balance === 'bigint' ? parseFloat(formatEther(balance)) : 0;
  const allowanceValue = allowance && typeof allowance === 'bigint' ? parseFloat(formatEther(allowance)) : 0;
  const bondAmount = bondInfo && typeof (bondInfo as { maxBond?: bigint }).maxBond === 'bigint'
    ? parseFloat(formatEther((bondInfo as { maxBond: bigint }).maxBond))
    : 1000;
  const needsApproval = allowanceValue < bondAmount;
  const hasEnoughBalance = balanceValue >= bondAmount;
  const remainingQuota = Math.max(0, 10 - myProviders.length);

  const canPrepare = name && !isPrepared && remainingQuota > 0;
  const hasDeviceId = !!(deviceId && deviceId.startsWith("0x"));
  const canRegister = hasEnoughBalance && !needsApproval && remainingQuota > 0 && hasDeviceId;
  
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
      {/* Notice when ProviderRegistry not deployed */}
      {PROVIDER_REGISTRY_ADDRESS === "0x0000000000000000000000000000000000000000" && (
        <Card className="border-yellow-500/50 bg-yellow-500/10">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <Server className="h-5 w-5 text-yellow-500 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-yellow-400 mb-2">Provider Registry Not Deployed</h3>
                <p className="text-sm text-yellow-300/80">
                  Deploy ProviderRegistry contract and set the address in shared/addresses to enable registration.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      
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
                  <span className="text-muted-foreground">Device ID:</span>
                  <span className="font-mono text-xs">{deviceId ? `${deviceId.slice(0, 18)}...` : "—"}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">IPFS CID:</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs">{ipfsCID.slice(0, 20)}...</span>
                    <a
                      href={getPinataGatewayUrl(ipfsCID)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:text-primary/80 transition-colors"
                      title="View metadata on IPFS"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </div>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Bond Amount:</span>
                  <span className="font-bold">{bondAmount} CLD</span>
                </div>
              </div>
              <div className="flex gap-2">
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
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (confirm("Are you sure you want to clear all form data? This cannot be undone.")) {
                      resetForm();
                    }
                  }}
                >
                  Clear Form
                </Button>
              </div>
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
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="deviceId">Device ID * (from build flow or GET /device-info on your node)</Label>
                    <div className="flex gap-2">
                      <Input
                        id="deviceId"
                        placeholder="0x..."
                        value={deviceId}
                        onChange={(e) => setDeviceId(e.target.value.trim() as ProviderDeviceId | "")}
                        className="font-mono text-sm"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className={copiedPubKey ? "bg-green-500/10 border-green-500/20" : ""}
                        onClick={async () => {
                          if (!deviceId) return;
                          try {
                            if (navigator.clipboard?.writeText) {
                              await navigator.clipboard.writeText(deviceId);
                            } else {
                              const textArea = document.createElement("textarea");
                              textArea.value = deviceId;
                              document.body.appendChild(textArea);
                              textArea.select();
                              document.execCommand("copy");
                              textArea.remove();
                            }
                            setCopiedPubKey(true);
                            toast({ title: "Copied!", description: "Device ID copied to clipboard." });
                            setTimeout(() => setCopiedPubKey(false), 2000);
                          } catch {
                            toast({ title: "Copy Failed", variant: "destructive" });
                          }
                        }}
                        title="Copy device ID"
                      >
                        {copiedPubKey ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Complete the provider build flow to get a device ID automatically, or run <code className="bg-muted px-1 rounded">curl http://YOUR_NODE:4040/device-info</code> on your node.
                    </p>
                  </div>
                  {pubKeyHash && (
                    <div className="space-y-2 md:col-span-2 hidden">
                      <Label>Auto-Generated Public Key Hash</Label>
                      <Input value={pubKeyHash} readOnly className="font-mono text-sm bg-muted" />
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
          <div className="p-4 rounded-lg bg-muted/50 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Total Bond:</span>
              <span className="text-lg font-bold">{bondAmount} CLD</span>
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              <div>🏛️ Treasury (80%): {(bondAmount * 0.8).toFixed(0)} CLD</div>
              <div>👥 Team (20%): {(bondAmount * 0.2).toFixed(0)} CLD</div>
            </div>
            <div className="pt-2 border-t border-white/5">
              <p className="text-xs text-muted-foreground mb-2">Registry Contract:</p>
              <AddressDisplay 
                address={PROVIDER_REGISTRY_ADDRESS} 
                truncate={true}
                truncateLength={6}
              />
            </div>
          </div>
          
          {/* Balance & Allowance */}
          <div className="space-y-3">
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
              <span className={remainingQuota === 0 ? "text-red-500 font-semibold" : remainingQuota <= 2 ? "text-yellow-500" : "text-green-500"}>
                {remainingQuota} / 10 providers
              </span>
            </div>
            {remainingQuota === 0 && (
              <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded p-2">
                ⚠️ Maximum provider limit reached. You cannot register more providers.
              </div>
            )}
            <div className="pt-2 border-t border-white/5">
              <p className="text-xs text-muted-foreground mb-2">CLD Token Contract:</p>
              <AddressDisplay 
                address={CLD_TOKEN_ADDRESS} 
                truncate={true}
                truncateLength={6}
              />
            </div>
          </div>
          
          {/* Actions */}
          <div className="space-y-2">
            <div className="flex gap-2">
              {!isPrepared && (
                <>
                  <Button
                    onClick={handlePrepareIPFS}
                    disabled={isPreparingIPFS || !canPrepare}
                    className="flex-1"
                    title={remainingQuota === 0 ? "Maximum provider limit reached" : !name ? "Please enter a provider name" : ""}
                  >
                    {isPreparingIPFS ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Uploading to IPFS...
                      </>
                    ) : remainingQuota === 0 ? (
                      "Quota Full - Cannot Register"
                    ) : (
                      "Prepare & Upload to IPFS"
                    )}
                  </Button>
                  {(name || description || cpuModel || gpuModel) && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        if (confirm("Are you sure you want to clear all form data? This cannot be undone.")) {
                          resetForm();
                        }
                      }}
                    >
                      Clear Form
                    </Button>
                  )}
                </>
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
                      {approveHash ? "Confirming Approval..." : "Waiting for Wallet..."}
                    </>
                  ) : isApproved ? (
                    <>
                      <Check className="mr-2 h-4 w-4" />
                      Approved
                    </>
                  ) : (
                    "Approve Tokens"
                  )}
                </Button>
              )}
              
              {(canRegister || (isPrepared && remainingQuota === 0)) && (
                <Button
                  onClick={handleRegisterClick}
                  disabled={isRegistering || remainingQuota === 0}
                  className="flex-1 bg-orange-600 hover:bg-orange-700"
                  title={remainingQuota === 0 ? "Maximum provider limit reached" : ""}
                >
                  {isRegistering ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {registerHash ? "Confirming Registration..." : "Waiting for Wallet..."}
                    </>
                  ) : remainingQuota === 0 ? (
                    "Quota Full - Cannot Register"
                  ) : (
                    <>
                      <Flame className="mr-2 h-4 w-4" />
                      Register Provider
                    </>
                  )}
                </Button>
              )}
            </div>
            
            {/* Show "Register Another" after successful registration */}
            {isRegistered && registerHash && !isPrepared && (
              <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                <p className="text-sm text-green-600 dark:text-green-400 mb-2">
                  ✓ Registration successful! You can register another provider with the same data or clear the form.
                </p>
                <div className="flex gap-2">
                </div>
              </div>
            )}
          </div>
          
          {error && !isRegistered && !isRegistering && (
            // Don't show "Internal JSON-RPC error" during polling - it's transient
            !error.message?.includes("Internal JSON-RPC error") && (
              <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                <div className="font-semibold mb-1">Transaction Error</div>
                <div className="text-xs opacity-90">
                  {error.message?.includes("User rejected") || error.message?.includes("User denied")
                    ? "Transaction was rejected in wallet"
                    : error.message || "Registration failed"}
                </div>
              </div>
            )
          )}
          
          {/* Transaction Success Links */}
          {approveHash && isApproved && (
            <TxLink hash={approveHash} label="Token approval confirmed" />
          )}
          
          {registerHash && isRegistered && (
            <TxLink hash={registerHash} label="Provider registration confirmed" />
          )}

          <ConfirmRegisterModal
            open={confirmModalOpen}
            onOpenChange={setConfirmModalOpen}
            deviceId={deviceId && deviceId.startsWith("0x") ? deviceId : ""}
            defaultName={name}
            defaultDescription={description}
            additionalMetadata={{
              region,
              hardwareTier,
              capacity: capacity[0],
              cpuModel: cpuModel || undefined,
              cpuThreads: cpuThreads ? parseInt(cpuThreads) : undefined,
              cpuClockSpeed: cpuClockSpeed ? `${cpuClockSpeed} GHz` : undefined,
              gpuModel: gpuModel || undefined,
              gpuCount: gpuCount ? parseInt(gpuCount) : undefined,
              gpuMemory: gpuMemory ? `${gpuMemory} GB` : undefined,
              gpuCudaCores: gpuCudaCores || undefined,
              ramType: ramType || undefined,
              storageType: storageType || undefined,
              storageSpeed: storageSpeed || undefined,
              bandwidth: bandwidth || undefined,
              networkType: networkType || undefined,
              location: location || undefined,
              country: country || undefined,
              city: city || undefined,
              endpoint: providerEndpoint || undefined,
            }}
            onConfirm={handleConfirmRegister}
            isRegistering={isRegistering}
          />
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
