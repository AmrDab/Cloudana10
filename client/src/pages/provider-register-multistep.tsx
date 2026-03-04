import { useState, useEffect, useCallback, useRef, Fragment } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle, Circle, Loader2, AlertCircle, Trash2, Info, Play, Server, Settings, Tag, Wrench } from "lucide-react";
import ProviderBuildCluster from "@/pages/provider-build-cluster";
import { Checkbox } from "@/components/ui/checkbox";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { useToast } from "@/hooks/use-toast";
import {
  useCLDTokenBalance,
  useCLDTokenAllowance,
  useApproveCLDToken,
  useRegisterProvider,
  PROVIDER_REGISTRY_ADDRESS,
  useProviderRegistryBondInfo,
  type ProviderDeviceId,
} from "@/lib/contracts";
import { uploadToIPFS, getPinataGatewayUrl, type ProviderMetadata } from "@/lib/api";
import { ConfirmRegisterModal } from "@/components/confirm-register-modal";
import { formatEther } from "viem";

const ATTRIBUTE_KEYS = ["host", "tier", "organization"] as const;

type AttributeRow = { key: string; value: string };

const DEFAULT_ATTRIBUTES: AttributeRow[] = [
  { key: "host", value: "cloudana" },
  { key: "tier", value: "community" },
  { key: "organization", value: "" },
];

type Step = "server-access" | "provider-config" | "provider-attributes" | "provider-install" | "register-onchain";

const MULTISTEP_DRAFT_KEY = "cloudana_provider_multistep_draft";
const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

type MultistepDraft = {
  ts: number;
  currentStep: Step;
  completedSteps: Step[];
  serverAccessSubStep: 1 | 2 | 3;
  serverCount: string;
  publicIP: string;
  port: string;
  sshUsername: string;
  credentialMethod: "password" | "keyfile";
  domainName: string;
  organizationName: string;
  email: string;
  attributes: AttributeRow[];
  buildActionId: string | null;
  buildDeviceId: string | null;
};

function loadMultistepDraft(): Partial<MultistepDraft> | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(MULTISTEP_DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as MultistepDraft;
    if (d.ts && Date.now() - d.ts > DRAFT_MAX_AGE_MS) {
      sessionStorage.removeItem(MULTISTEP_DRAFT_KEY);
      return null;
    }
    return d;
  } catch {
    return null;
  }
}

function saveMultistepDraft(draft: Omit<MultistepDraft, "ts">) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(MULTISTEP_DRAFT_KEY, JSON.stringify({ ...draft, ts: Date.now() }));
  } catch {
    /* ignore */
  }
}

function clearMultistepDraft() {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(MULTISTEP_DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

const STEPS: { id: Step; title: string; number: number }[] = [
  { id: "server-access", title: "Server Access", number: 1 },
  { id: "provider-config", title: "Provider Config", number: 2 },
  { id: "provider-attributes", title: "Provider Attributes", number: 3 },
  { id: "provider-install", title: "Provider Install", number: 4 },
  { id: "register-onchain", title: "Register on-chain", number: 5 },
];

/** Compact registration flow for step 5: device_id from build → Confirm modal (real spec from backend) → Approve → Register. */
function RegisterOnChainStep({
  deviceId,
  defaultName,
  organization,
  email,
  providerEndpoint,
  onDone,
  buildActionId,
  loadingDeviceId,
  onLoadDeviceId,
}: {
  deviceId: string | null;
  defaultName: string;
  organization?: string;
  email?: string;
  providerEndpoint?: string;
  onDone: () => void;
  buildActionId?: string | null;
  loadingDeviceId?: boolean;
  onLoadDeviceId?: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { address, isConnected } = useAccount();
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);

  const { data: balance } = useCLDTokenBalance(address);
  const { data: allowance } = useCLDTokenAllowance(address, PROVIDER_REGISTRY_ADDRESS);
  const { data: bondInfo } = useProviderRegistryBondInfo();
  const { approve, isPending: isApproving, isSuccess: isApproved } = useApproveCLDToken();
  const { register, isPending: isRegistering, isSuccess: isRegistered, error: registerError } = useRegisterProvider();

  const bondAmount = bondInfo && typeof (bondInfo as { maxBond?: bigint }).maxBond === "bigint"
    ? parseFloat(formatEther((bondInfo as { maxBond: bigint }).maxBond))
    : 1000;
  const balanceValue = balance && typeof balance === "bigint" ? parseFloat(formatEther(balance)) : 0;
  const allowanceValue = allowance && typeof allowance === "bigint" ? parseFloat(formatEther(allowance)) : 0;
  const needsApproval = allowanceValue < bondAmount;
  const hasEnoughBalance = balanceValue >= bondAmount;

  const handleApprove = () => {
    approve(PROVIDER_REGISTRY_ADDRESS, String(bondAmount));
  };

  const handleConfirmRegister = async (metadata: ProviderMetadata) => {
    const effectiveDeviceId = (deviceId && deviceId.startsWith("0x") ? deviceId : null) as ProviderDeviceId | null;
    if (!effectiveDeviceId) return;
    try {
      const cid = await uploadToIPFS(metadata);
      setConfirmModalOpen(false);
      // Store only the CID on-chain, not the full gateway URL
      // The gateway URL will be constructed when fetching the metadata
      register(effectiveDeviceId, cid);
    } catch (e: unknown) {
      toast({ title: "IPFS upload failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  useEffect(() => {
    if (isRegistered) {
      queryClient.invalidateQueries({ queryKey: ["myProviders", address ?? ""] });
      queryClient.invalidateQueries({ queryKey: ["providers"] });
      queryClient.invalidateQueries({ queryKey: ["allProviders"] });
      toast({ title: "Provider registered", description: "You can view it in your provider dashboard." });
      onDone();
    }
  }, [isRegistered, queryClient, address, toast, onDone]);

  // Show error toast when registration fails
  useEffect(() => {
    if (registerError && !isRegistering && !isRegistered) {
      const errorMessage = registerError.message?.includes("User rejected") || registerError.message?.includes("User denied")
        ? "Transaction was rejected in wallet"
        : registerError.message?.includes("already registered")
        ? "This provider is already registered. Each device can only be registered once."
        : registerError.message || "Registration failed";
      
      toast({
        title: "Registration Failed",
        description: errorMessage,
        variant: "destructive",
      });
    }
  }, [registerError, isRegistering, isRegistered, toast]);

  if (!isConnected) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-6 text-center">
        <p className="text-muted-foreground mb-4">Connect your wallet to register this provider on-chain.</p>
        <p className="text-sm text-muted-foreground">Use the wallet button in the header to connect.</p>
      </div>
    );
  }

  if (!deviceId || !deviceId.startsWith("0x")) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-6 space-y-3">
        <p className="text-muted-foreground">
          {loadingDeviceId
            ? "Loading device ID from build…"
            : "Device ID not available. Complete the Provider Install step first; when the build finishes, you'll be brought here automatically."}
        </p>
        {buildActionId && onLoadDeviceId && !loadingDeviceId && (
          <Button variant="outline" size="sm" onClick={onLoadDeviceId}>
            Load device ID from build
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-muted/30 p-4">
        <Label className="text-muted-foreground">Device ID</Label>
        <p className="font-mono text-sm break-all mt-1">{deviceId}</p>
      </div>
      {!hasEnoughBalance && (
        <p className="text-sm text-destructive">Insufficient CLD balance. Need at least {bondAmount} CLD.</p>
      )}
      {needsApproval && (
        <Button onClick={handleApprove} disabled={isApproving || !hasEnoughBalance}>
          {isApproving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Approving…</> : `Approve ${bondAmount} CLD`}
        </Button>
      )}
      {!needsApproval && hasEnoughBalance && (
        <Button onClick={() => setConfirmModalOpen(true)} disabled={isRegistering}>
          {isRegistering ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Registering…</> : "Register provider on-chain"}
        </Button>
      )}
      
      {/* Show registration error */}
      {registerError && !isRegistered && !isRegistering && (
        <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
          <div className="font-semibold text-destructive text-sm mb-1">Registration Error</div>
          <div className="text-xs text-destructive/90">
            {registerError.message?.includes("User rejected") || registerError.message?.includes("User denied")
              ? "Transaction was rejected in wallet"
              : registerError.message?.includes("already registered")
              ? "This provider is already registered. Each device can only be registered once."
              : registerError.message || "Registration failed. Please try again."}
          </div>
        </div>
      )}
      
      <ConfirmRegisterModal
        open={confirmModalOpen}
        onOpenChange={setConfirmModalOpen}
        deviceId={deviceId}
        defaultName={defaultName}
        additionalMetadata={{
          organization: organization || undefined,
          email: email || undefined,
          region: "global",
          endpoint: providerEndpoint || undefined,
        }}
        onConfirm={handleConfirmRegister}
        isRegistering={isRegistering}
      />
    </div>
  );
}

export default function ProviderRegisterMultistep() {
  const [, setLocation] = useLocation();
  const [currentStep, setCurrentStep] = useState<Step>("server-access");
  const [completedSteps, setCompletedSteps] = useState<Set<Step>>(new Set());
  const [serverAccessSubStep, setServerAccessSubStep] = useState<1 | 2 | 3>(1);
  
  // Form state
  const [serverCount, setServerCount] = useState("1");
  
  // Control Plane Node configuration
  const [publicIP, setPublicIP] = useState("");
  const [port, setPort] = useState("22");
  const [sshUsername, setSshUsername] = useState("root");
  const [credentialMethod, setCredentialMethod] = useState<"password" | "keyfile">("keyfile");
  const [sshPassword, setSshPassword] = useState("");
  const [privateKeyFile, setPrivateKeyFile] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [applyToAllNodes, setApplyToAllNodes] = useState(false);
  
  // Validation state
  const [isChecking, setIsChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [privateKeyContent, setPrivateKeyContent] = useState<string>("");

  // Provider Information (first step of provider-config)
  const [domainName, setDomainName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [email, setEmail] = useState("");

  // DNS verification (provider-config)
  const [dnsVerifyStatus, setDnsVerifyStatus] = useState<"idle" | "verifying" | "success" | "error">("idle");
  const [dnsVerifyMessage, setDnsVerifyMessage] = useState<string>("");

  // Provider Attributes
  const [attributes, setAttributes] = useState<AttributeRow[]>(DEFAULT_ATTRIBUTES);

  // Build provider state (step 4: Provider install)
  const [isBuilding, setIsBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [buildActionId, setBuildActionId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("action_id");
  });
  /** Set when build completes (from onBuildComplete); used in step 5 for registration */
  const [buildDeviceId, setBuildDeviceId] = useState<string | null>(null);
  const [loadingDeviceId, setLoadingDeviceId] = useState(false);

  const hasRestoredMultistepDraft = useRef(false);
  const hasRunFirstMultistepPersist = useRef(false);

  // Restore draft from sessionStorage once on mount (form data only; step is always reset to 1 on reload)
  useEffect(() => {
    if (hasRestoredMultistepDraft.current) return;
    hasRestoredMultistepDraft.current = true;
    const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const actionIdFromUrl = params?.get("action_id") ?? null;
    const d = loadMultistepDraft();
    if (d) {
      // Do not restore currentStep or completedSteps: always start at step 1 with no circles completed on reload
      if (d.serverAccessSubStep != null) setServerAccessSubStep(d.serverAccessSubStep);
      if (d.serverCount != null) setServerCount(d.serverCount);
      if (d.publicIP != null) setPublicIP(d.publicIP);
      if (d.port != null) setPort(d.port);
      if (d.sshUsername != null) setSshUsername(d.sshUsername);
      if (d.credentialMethod != null) setCredentialMethod(d.credentialMethod);
      if (d.domainName != null) setDomainName(d.domainName);
      if (d.organizationName != null) setOrganizationName(d.organizationName);
      if (d.email != null) setEmail(d.email);
      if (d.attributes != null && d.attributes.length) setAttributes(d.attributes);
      if (d.buildActionId != null && !actionIdFromUrl) setBuildActionId(d.buildActionId);
      if (d.buildDeviceId != null) setBuildDeviceId(d.buildDeviceId);
    }
  }, []);

  // Persist draft for form data and build ids only; step is not saved so reload always starts at step 1
  useEffect(() => {
    if (!hasRunFirstMultistepPersist.current) {
      hasRunFirstMultistepPersist.current = true;
      return;
    }
    saveMultistepDraft({
      currentStep: "server-access",
      completedSteps: [],
      serverAccessSubStep,
      serverCount,
      publicIP,
      port,
      sshUsername,
      credentialMethod,
      domainName,
      organizationName,
      email,
      attributes,
      buildActionId,
      buildDeviceId,
    });
  }, [
    currentStep,
    completedSteps,
    serverAccessSubStep,
    serverCount,
    publicIP,
    port,
    sshUsername,
    credentialMethod,
    domainName,
    organizationName,
    email,
    attributes,
    buildActionId,
    buildDeviceId,
  ]);

  const getCurrentStepIndex = () => STEPS.findIndex(s => s.id === currentStep);
  const isStepCompleted = (step: Step) => completedSteps.has(step);
  const isStepActive = (step: Step) => currentStep === step;

  // Only when URL has action_id (deep link from build), show step 4; do not jump to step 4 when buildActionId was restored from draft (reload should stay at step 1)
  useEffect(() => {
    if (!buildActionId) return;
    const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const actionIdFromUrl = params?.get("action_id") ?? null;
    if (actionIdFromUrl !== buildActionId) return;
    setCurrentStep("provider-install");
    setCompletedSteps(new Set(["server-access", "provider-config", "provider-attributes"]));
  }, [buildActionId]);

  // When on step 4 (Provider Install) with action_id, if build is already completed with device_id, go to step 5 with device_id
  useEffect(() => {
    if (currentStep !== "provider-install" || !buildActionId) return;
    const apiUrl = import.meta.env.VITE_API_URL
      ? `${import.meta.env.VITE_API_URL}/v1/build-provider-status`
      : "http://localhost:7002/v1/build-provider-status";
    fetch(`${apiUrl}/${buildActionId}`)
      .then((r) => r.json())
      .then((data: { status?: string; device_id?: string }) => {
        if (data.status === "completed" && data.device_id && typeof data.device_id === "string" && data.device_id.startsWith("0x")) {
          setBuildDeviceId(data.device_id);
          setCompletedSteps((prev) => new Set([...prev, "provider-install"]));
          setCurrentStep("register-onchain");
        }
      })
      .catch(() => {});
  }, [currentStep, buildActionId]);

  // When on step 5 (Register on-chain) but device ID is missing, load it from build status (handles refresh and callback timing)
  const loadDeviceIdFromBuild = useCallback(() => {
    if (!buildActionId) return;
    setLoadingDeviceId(true);
    const apiUrl = import.meta.env.VITE_API_URL
      ? `${import.meta.env.VITE_API_URL}/v1/build-provider-status`
      : "http://localhost:7002/v1/build-provider-status";
    fetch(`${apiUrl}/${buildActionId}`)
      .then((r) => r.json())
      .then((data: { device_id?: string }) => {
        if (data.device_id && typeof data.device_id === "string" && data.device_id.startsWith("0x")) {
          setBuildDeviceId(data.device_id);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingDeviceId(false));
  }, [buildActionId]);

  // When on step 5 with no device ID, fetch once then poll every 5s until we get it (backend may set device_id after "completed")
  useEffect(() => {
    if (currentStep !== "register-onchain" || buildDeviceId || !buildActionId) return;
    loadDeviceIdFromBuild();
    const interval = setInterval(loadDeviceIdFromBuild, 5000);
    return () => clearInterval(interval);
  }, [currentStep, buildDeviceId, buildActionId, loadDeviceIdFromBuild]);

  const handleNext = async () => {
    // Handle sub-steps for server-access
    if (currentStep === "server-access") {
      if (serverAccessSubStep === 1) {
        // Move to second sub-step (node breakdown)
        setServerAccessSubStep(2);
        return;
      } else if (serverAccessSubStep === 2) {
        // Move to third sub-step (control plane node config)
        setServerAccessSubStep(3);
        return;
      } else {
        // Sub-step 3: Check SSH and port before proceeding
        setIsChecking(true);
        setCheckError(null);

        try {
          // Check port first
          await checkPort();
          
          // Then check SSH connection
          await checkSSHConnection();
          
          // Both checks passed, proceed to next step
          setCompletedSteps(prev => new Set(Array.from(prev).concat(currentStep)));
          const currentIndex = getCurrentStepIndex();
          if (currentIndex < STEPS.length - 1) {
            setCurrentStep(STEPS[currentIndex + 1].id);
            setServerAccessSubStep(1); // Reset for potential future use
          } else {
            setLocation("/register");
          }
        } catch (error: any) {
          setCheckError(error.message || "Validation failed. Please check your configuration.");
        } finally {
          setIsChecking(false);
        }
        return;
      }
    }

    const currentIndex = getCurrentStepIndex();
    
    // Step 3 (provider-attributes) → Next starts the build and goes to step 4 (provider-install)
    if (currentStep === "provider-attributes") {
      await startBuildProvider();
      return;
    }

    // Mark current step as completed and move to next
    setCompletedSteps(prev => new Set(Array.from(prev).concat(currentStep)));
    if (currentIndex < STEPS.length - 1) {
      setCurrentStep(STEPS[currentIndex + 1].id);
    }
  };

  // Start build provider process
  const startBuildProvider = async () => {
    setBuildError(null);

    try {
      // Process keyfile if using keyfile auth
      let keyfileData: string | null = null;
      if (credentialMethod === "keyfile" && privateKeyFile) {
        keyfileData = await processKeyfile(privateKeyFile);
      }

      // Generate action_id before calling build-provider API
      const actionId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `local-action-${Date.now()}-${Math.random().toString(16).slice(2)}`;

      // Build request payload (no wallet sent to build-provider API)
      const buildRequest = {
        action_id: actionId,
        nodes: [
          {
            hostname: publicIP,
            username: sshUsername,
            port: parseInt(port) || 22,
            password: credentialMethod === "password" ? sshPassword : null,
            keyfile: keyfileData,
            passphrase: credentialMethod === "keyfile" && passphrase ? passphrase : null,
            install_gpu_drivers: false, // TODO: Add UI for this
          },
        ],
        provider: {
          attributes: attributes.filter((a) => a.key.trim() !== "" && a.value.trim() !== ""),
          pricing: {
            cpu: null,
            memory: null,
            storage: null,
            gpu: null,
            persistentStorage: null,
            ipScalePrice: null,
            endpointBidPrice: null,
          },
          config: {
            domain: domainName || null,
            organization: organizationName || null,
            email: email || null,
          },
        },
      };

      const apiUrl = import.meta.env.VITE_API_URL
        ? `${import.meta.env.VITE_API_URL}/v1/build-provider`
        : "http://localhost:7002/v1/build-provider";

      // Get auth token from environment variable or localStorage
      const authToken = import.meta.env.VITE_AUTH_TOKEN || localStorage.getItem("auth_token");
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      
      if (authToken) {
        headers["Authorization"] = `Bearer ${authToken}`;
      }

      const response = await fetch(apiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(buildRequest),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({
          error: { message: "Failed to start build provider" },
        }));
        throw new Error(errorData.error?.message || "Failed to start build provider");
      }

      const data = await response.json();
      const returnedActionId = data.action_id || actionId;

      if (!returnedActionId) {
        throw new Error("No action ID returned from build provider API");
      }

      setBuildActionId(returnedActionId);
      setCompletedSteps((prev) => new Set(Array.from(prev).concat("provider-attributes")));
      setCurrentStep("provider-install");
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.set("action_id", returnedActionId);
        window.history.replaceState({}, "", url.pathname + url.search);
      }
    } catch (error: any) {
      console.error("Error starting build provider:", error);
      setBuildError(error.message || "Failed to start build provider. Please try again.");
      setIsBuilding(false);
    }
  };

  const handleBack = () => {
    if (currentStep === "server-access") {
      if (serverAccessSubStep === 2) {
        // Go back to first sub-step
        setServerAccessSubStep(1);
        return;
      } else if (serverAccessSubStep === 3) {
        // Go back to second sub-step
        setServerAccessSubStep(2);
        return;
      }
    }
    // For other steps, go back to previous main step
    const currentIndex = getCurrentStepIndex();
    if (currentIndex > 0) {
      setCurrentStep(STEPS[currentIndex - 1].id);
      setCompletedSteps(prev => {
        const newSet = new Set(prev);
        newSet.delete(STEPS[currentIndex - 1].id);
        return newSet;
      });
    }
  };

  // Handle Enter key press to activate Next button
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (canProceed() && !isChecking) {
        handleNext();
      }
    }
  };

  const canProceed = () => {
    switch (currentStep) {
      case "server-access":
        if (serverAccessSubStep === 1) {
          return serverCount !== "" && parseInt(serverCount) > 0;
        } else if (serverAccessSubStep === 3) {
          // Validate control plane node configuration
          if (!publicIP || !port || !sshUsername) return false;
          // Validate IPv4 format
          if (!isValidIPv4(publicIP)) return false;
          // Validate credentials
          if (credentialMethod === "password") {
            return sshPassword !== "";
          } else {
            return privateKeyFile !== null;
          }
        }
        return true; // Sub-step 2 always allows proceeding
      case "provider-config":
        return domainName.trim() !== "" && organizationName.trim() !== "";
      case "provider-attributes":
        return attributes.some((a) => a.key.trim() !== "" && a.value.trim() !== "");
      case "provider-install":
        return false;
      default:
        return true;
    }
  };

  const resetProviderInfo = () => {
    setDomainName("");
    setOrganizationName("");
    setEmail("");
    setDnsVerifyStatus("idle");
    setDnsVerifyMessage("");
  };

  const addAttribute = () => {
    setAttributes((prev) => [...prev, { key: "", value: "" }]);
  };

  const removeAttribute = (index: number) => {
    setAttributes((prev) => prev.filter((_, i) => i !== index));
  };

  const updateAttribute = (index: number, field: "key" | "value", value: string) => {
    setAttributes((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    );
  };

  const resetAttributes = () => {
    setAttributes([...DEFAULT_ATTRIBUTES]);
  };

  // Validate IPv4 address
  const isValidIPv4 = (ip: string) => {
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipv4Regex.test(ip)) return false;
    const parts = ip.split(".").map(Number);
    return parts.every(part => part >= 0 && part <= 255);
  };

  // Process keyfile to base64 with data URI format
  const processKeyfile = async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        // Determine MIME type
        let mimeType = "application/octet-stream";
        if (content.includes("-----BEGIN") && content.includes("PRIVATE KEY-----")) {
          if (content.includes("-----BEGIN RSA PRIVATE KEY-----")) {
            mimeType = "application/x-pem-file";
          } else if (content.includes("-----BEGIN OPENSSH PRIVATE KEY-----")) {
            mimeType = "application/x-openssh-key";
          } else {
            mimeType = "application/x-pem-file";
          }
        } else if (content.includes("PuTTY-User-Key-File")) {
          mimeType = "application/x-putty-private-key";
        }
        // Encode to base64 with data URI prefix
        const base64 = btoa(content);
        resolve(`data:${mimeType};base64,${base64}`);
      };
      reader.onerror = reject;
      reader.readAsText(file);
    });
  };

  const VERIFY_REQUEST_TIMEOUT_MS = 45_000; // Allow API time (e.g. 30s SSH timeout + buffer)

  // Check SSH connection
  const checkSSHConnection = async (): Promise<boolean> => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), VERIFY_REQUEST_TIMEOUT_MS);
    try {
      const apiUrl = import.meta.env.VITE_API_URL 
        ? `${import.meta.env.VITE_API_URL}/v1/verify/control-machine`
        : "http://localhost:7002/v1/verify/control-machine";

      let keyfileData = null;
      if (credentialMethod === "keyfile" && privateKeyFile) {
        keyfileData = await processKeyfile(privateKeyFile);
      }

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hostname: publicIP,
          port: parseInt(port) || 22,
          username: sshUsername,
          password: credentialMethod === "password" ? sshPassword : null,
          keyfile: keyfileData,
          passphrase: credentialMethod === "keyfile" && passphrase ? passphrase : null,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (response.ok) {
        const data = await response.json();
        if (data.status?.toLowerCase() === "success" || response.status === 200) {
          return true;
        } else {
          throw new Error(data.error?.message || "SSH connection failed");
        }
      } else {
        const error = await response.json().catch(() => ({ 
          message: "SSH connection failed",
          error: { message: "Failed to connect via SSH" }
        }));
        throw new Error(
          error.error?.message || 
          error.message || 
          "Failed to connect via SSH. Please check your credentials and try again."
        );
      }
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error?.name === "AbortError") {
        throw new Error(
          "Verification timed out. Check that the server is reachable and the verification API is running."
        );
      }
      if (error instanceof TypeError || error.message?.includes("Failed to fetch") || error.message?.includes("NetworkError")) {
        throw new Error(
          "Connection error: Unable to reach the verification server. Please ensure the API server is running and accessible."
        );
      }
      throw new Error(
        error.message || 
        "Failed to verify SSH connection. Please check your configuration and try again."
      );
    }
  };

  // Check port
  const checkPort = async (): Promise<boolean> => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), VERIFY_REQUEST_TIMEOUT_MS);
    try {
      const apiUrl = import.meta.env.VITE_API_URL 
        ? `${import.meta.env.VITE_API_URL}/v1/verify/open-ports`
        : "http://localhost:7002/v1/verify/open-ports";

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          public_ip: publicIP,
          ports: [parseInt(port) || 22],
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (response.ok) {
        const data = await response.json();
        const portNum = parseInt(port) || 22;
        const isOpen = data.open_ports?.includes(portNum) || false;
        if (!isOpen) {
          throw new Error(`Port ${portNum} is not open or accessible`);
        }
        return true;
      } else {
        const error = await response.json().catch(() => ({ 
          message: "Port check failed"
        }));
        throw new Error(error.message || "Failed to check port status");
      }
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error?.name === "AbortError") {
        throw new Error(
          "Port check timed out. Check that the server is reachable and the verification API is running."
        );
      }
      if (error instanceof TypeError || error.message?.includes("Failed to fetch") || error.message?.includes("NetworkError")) {
        throw new Error(
          "Connection error: Unable to reach the verification server. Please ensure the API server is running and accessible."
        );
      }
      throw new Error(
        error.message || 
        "Failed to verify port. Please ensure the port is open and accessible."
      );
    }
  };

  // Verify DNS configuration (resolve domain to public IP)
  const verifyDnsConfiguration = async (): Promise<void> => {
    const domain = domainName.trim();
    if (!domain) {
      setDnsVerifyStatus("error");
      setDnsVerifyMessage("Please enter a domain name first.");
      return;
    }

    setDnsVerifyStatus("verifying");
    setDnsVerifyMessage("");

    try {
      const apiUrl = import.meta.env.VITE_API_URL
        ? `${import.meta.env.VITE_API_URL}/v1/verify/dns`
        : "http://localhost:7002/v1/verify/dns";

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domains: [domain] }),
      });

      if (response.ok) {
        const data = await response.json();
        const publicIps = data.public_ips ?? [];
        const entry = Array.isArray(publicIps) ? publicIps.find((r: Record<string, string>) => domain in r) : null;
        const ip = entry ? (entry as Record<string, string>)[domain] : null;
        if (ip) {
          setDnsVerifyStatus("success");
          setDnsVerifyMessage(`${domain} resolves to ${ip}`);
        } else {
          setDnsVerifyStatus("error");
          setDnsVerifyMessage("No public IP returned for this domain.");
        }
      } else {
        const err = await response.json().catch(() => ({ error: { message: "Failed to verify DNS" } }));
        setDnsVerifyStatus("error");
        setDnsVerifyMessage(err.error?.message ?? err.message ?? "Failed to verify DNS.");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unable to reach the verification server.";
      setDnsVerifyStatus("error");
      setDnsVerifyMessage(msg);
    }
  };

  // Handle key file change
  const handleKeyFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPrivateKeyFile(file);
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        setPrivateKeyContent(content);
      };
      reader.readAsText(file);
    }
  };

  // Calculate node breakdown
  const controlPlaneNodes = 1; // Always 1 control plane node
  const workerNodes = Math.max(0, parseInt(serverCount) - controlPlaneNodes);

  const renderStepContent = () => {
    switch (currentStep) {
      case "server-access":
        if (serverAccessSubStep === 1) {
          return (
            <div className="space-y-6">
              <div>
                <Label htmlFor="serverCount" className="text-base font-semibold">
                  Server Count
                </Label>
                <Input
                  id="serverCount"
                  type="number"
                  value={serverCount}
                  onChange={(e) => setServerCount(e.target.value)}
                  className="mt-2"
                  min="1"
                />
                <p className="text-sm text-muted-foreground mt-2">
                  How many servers will you be using to set up this provider? (Include all nodes - control nodes, etcd, worker nodes)
                </p>
              </div>
            </div>
          );
        } else if (serverAccessSubStep === 2) {
          // Sub-step 2: Node breakdown
          return (
            <div className="space-y-6">
              <div className="bg-muted/50 rounded-lg border p-6">
                <div className="flex items-start gap-4">
                  <div className="h-5 w-5 rounded-full border-2 border-muted-foreground flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-xs text-muted-foreground font-semibold">i</span>
                  </div>
                  <div className="space-y-6 flex-1">
                    <div>
                      <h3 className="text-base font-semibold mb-1">
                        Control Plane Nodes: {controlPlaneNodes}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        Manages the cluster operations & runs your workloads
                      </p>
                    </div>
                    <div>
                      <h3 className="text-base font-semibold mb-1">
                        Worker Nodes: {workerNodes}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        Runs your workloads
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        } else {
          // Sub-step 3: Control Plane Node 1 configuration
          return (
            <div className="space-y-6">
              <div>
                <h3 className="text-xl font-bold mb-2">Control Plane Node 1</h3>
                <p className="text-sm text-muted-foreground mb-6">
                  This node will manage cluster operations and run workloads
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <Label htmlFor="publicIP">Public IP</Label>
                  <Input
                    id="publicIP"
                    type="text"
                    value={publicIP}
                    onChange={(e) => setPublicIP(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Enter a valid IPv4 address"
                    className="mt-1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Must be a valid IPv4 address
                  </p>
                </div>

                <div>
                  <Label htmlFor="port">Port</Label>
                  <Input
                    id="port"
                    type="number"
                    value={port}
                    onChange={(e) => {
                      setPort(e.target.value);
                      setCheckError(null);
                    }}
                    className="mt-1"
                    min="1"
                    max="65535"
                  />
                </div>

                <div>
                  <Label htmlFor="sshUsername">SSH Username</Label>
                  <Input
                    id="sshUsername"
                    type="text"
                    value={sshUsername}
                    onChange={(e) => setSshUsername(e.target.value)}
                    className="mt-1"
                    readOnly
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    The username must be 'root' for proper setup.
                  </p>
                </div>

                <div>
                  <Label>Choose how you would like to provide your credentials</Label>
                  <div className="flex gap-4 mt-2">
                    <Button
                      type="button"
                      variant={credentialMethod === "password" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setCredentialMethod("password")}
                    >
                      Password
                    </Button>
                    <Button
                      type="button"
                      variant={credentialMethod === "keyfile" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setCredentialMethod("keyfile")}
                    >
                      Key File
                    </Button>
                  </div>
                </div>

                {credentialMethod === "password" ? (
                  <div>
                    <Label htmlFor="sshPassword">Password</Label>
                    <Input
                      id="sshPassword"
                      type="password"
                      value={sshPassword}
                      onChange={(e) => {
                        setSshPassword(e.target.value);
                        setCheckError(null);
                      }}
                      onKeyDown={handleKeyDown}
                      className="mt-1"
                    />
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="privateKey">Private Key</Label>
                      <Input
                        id="privateKey"
                        type="file"
                        accept=".pem,.key,text/plain"
                        onChange={handleKeyFileChange}
                        className="mt-1"
                      />
                      {privateKeyFile && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Selected: {privateKeyFile.name}
                        </p>
                      )}
                    </div>
                    <div>
                      <Label htmlFor="passphrase">Passphrase (Optional)</Label>
                      <Input
                        id="passphrase"
                        type="password"
                        value={passphrase}
                        onChange={(e) => setPassphrase(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="mt-1"
                        placeholder="Enter passphrase if your key is encrypted"
                      />
                    </div>
                  </div>
                )}

                <div className="flex items-center space-x-2 pt-2">
                  <Checkbox
                    id="applyToAll"
                    checked={applyToAllNodes}
                    onCheckedChange={(checked) => setApplyToAllNodes(checked === true)}
                  />
                  <Label htmlFor="applyToAll" className="text-sm font-normal cursor-pointer">
                    Apply this config to all nodes?
                  </Label>
                </div>
              </div>

              {/* Error Message */}
              {checkError && (
                <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 mt-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <h4 className="text-sm font-semibold text-red-500 mb-1">Validation Failed</h4>
                      <p className="text-sm text-red-400">{checkError}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        }

      case "provider-config":
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold mb-1">Provider Information</h3>
              <p className="text-sm text-muted-foreground">
                Hostname will be displayed publicly to the Console.
              </p>
              <p className="text-sm text-muted-foreground">
                Email may be used for notifications.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <Label htmlFor="domainName">Domain Name</Label>
                <div className="flex gap-2 mt-1 items-start">
                  <Input
                    id="domainName"
                    type="text"
                    value={domainName}
                    onChange={(e) => {
                      setDomainName(e.target.value);
                      setDnsVerifyStatus("idle");
                      setDnsVerifyMessage("");
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder="example.com"
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={verifyDnsConfiguration}
                    disabled={dnsVerifyStatus === "verifying" || !domainName.trim()}
                    className="shrink-0"
                  >
                    {dnsVerifyStatus === "verifying" ? (
                      <>
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin shrink-0" />
                        Verifying…
                      </>
                    ) : (
                      "Verify DNS"
                    )}
                  </Button>
                </div>
                {dnsVerifyStatus === "success" && dnsVerifyMessage && (
                  <p className="text-sm text-primary mt-1.5 flex items-center gap-1.5">
                    <CheckCircle className="h-4 w-4 shrink-0 text-primary" />
                    {dnsVerifyMessage}
                  </p>
                )}
                {dnsVerifyStatus === "error" && dnsVerifyMessage && (
                  <p className="text-sm text-red-500 dark:text-red-400 mt-1.5 flex items-center gap-1.5">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {dnsVerifyMessage}
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="organizationName">Organization Name</Label>
                <Input
                  id="organizationName"
                  type="text"
                  value={organizationName}
                  onChange={(e) => setOrganizationName(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Your Organization"
                  className="mt-1"
                />
              </div>

              <div>
                <Label htmlFor="email">Email Address (Optional)</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="your@email.com"
                  className="mt-1"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={resetProviderInfo}
                  className="text-muted-foreground hover:text-foreground"
                >
                  Reset
                </Button>
              </div>
            </div>

            {/* Required Ports */}
            <div className="rounded-lg border p-4 space-y-3 mt-6">
              <h3 className="text-lg font-semibold">Required Ports</h3>
              <p className="text-sm text-muted-foreground">
                The following ports must be open on your control machine for the provider to function properly:
              </p>
              <div className="overflow-hidden rounded-md border text-sm">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-4 py-2 text-left font-semibold">Port</th>
                      <th className="px-4 py-2 text-left font-semibold">Purpose</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    <tr><td className="px-4 py-2">80</td><td className="px-4 py-2 text-muted-foreground">HTTP traffic</td></tr>
                    <tr><td className="px-4 py-2">443</td><td className="px-4 py-2 text-muted-foreground">HTTPS traffic</td></tr>
                    <tr><td className="px-4 py-2">8443</td><td className="px-4 py-2 text-muted-foreground">Kubernetes API server</td></tr>
                    <tr><td className="px-4 py-2">8444</td><td className="px-4 py-2 text-muted-foreground">Provider services</td></tr>
                    <tr><td className="px-4 py-2">30000-32676</td><td className="px-4 py-2 text-muted-foreground">Kubernetes NodePort services</td></tr>
                  </tbody>
                </table>
              </div>
              <div className="flex gap-2 rounded-lg border border-amber-200/80 bg-amber-50/80 dark:bg-amber-950/20 dark:border-amber-800/50 p-3">
                <Info className="h-5 w-5 text-amber-600 dark:text-amber-500 shrink-0 mt-0.5" />
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  Please configure your firewall to allow incoming traffic on these ports. Port availability will be verified automatically when services are deployed.
                </p>
              </div>
            </div>
          </div>
        );

      case "provider-attributes":
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold mb-1">Provider Attributes</h3>
              <p className="text-sm text-muted-foreground">
                Attributes chosen here will be displayed publicly to the Console. It will be used for filtering and querying providers during bid process.
              </p>
            </div>

            <div className="space-y-4">
              <Label className="text-base font-semibold">Attributes</Label>
              <div className="space-y-3">
                {attributes.map((row, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Select
                      value={row.key || "_placeholder"}
                      onValueChange={(v) => updateAttribute(index, "key", v === "_placeholder" ? "" : v)}
                    >
                      <SelectTrigger className="flex-1 min-w-[140px]">
                        <SelectValue placeholder="Select key" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_placeholder" disabled>
                          Select key
                        </SelectItem>
                        {ATTRIBUTE_KEYS.map((k) => (
                          <SelectItem key={k} value={k}>
                            {k}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      placeholder="Value"
                      value={row.value}
                      onChange={(e) => updateAttribute(index, "value", e.target.value)}
                      onKeyDown={handleKeyDown}
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => removeAttribute(index)}
                      aria-label="Remove attribute"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addAttribute}
                className="mt-2"
              >
                + Add Attribute
              </Button>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={resetAttributes}
                  className="text-muted-foreground hover:text-foreground"
                >
                  Reset
                </Button>
              </div>
            </div>
          </div>
        );

      case "provider-install":
        return (
          <div className="space-y-4">
            {!buildActionId ? (
              <p className="text-muted-foreground">Start the build from step 3 (Provider Attributes) to see install progress here.</p>
            ) : (
              <ProviderBuildCluster
                actionId={buildActionId}
                embedded
                onBuildComplete={(deviceId) => {
                  if (deviceId) setBuildDeviceId(deviceId);
                  setCompletedSteps((prev) => new Set([...prev, "provider-install"]));
                  setCurrentStep("register-onchain");
                }}
              />
            )}
          </div>
        );

      case "register-onchain":
        return (
          <RegisterOnChainStep
            deviceId={buildDeviceId}
            defaultName={organizationName || domainName || "Cloudana Provider"}
            organization={organizationName || undefined}
            email={email || undefined}
            providerEndpoint={publicIP ? `http://${publicIP}:4040` : undefined}
            onDone={() => {
              clearMultistepDraft();
              setLocation("/providers");
            }}
            buildActionId={buildActionId}
            loadingDeviceId={loadingDeviceId}
            onLoadDeviceId={loadDeviceIdFromBuild}
          />
        );

      default:
        return null;
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-10 px-4">
      {/* Progress: 5 circles and 4 lines on one row (same baseline), labels in row below */}
      <div className="mb-8 w-full">
        {/* Row 1: circles and connector lines only - all on same horizontal line */}
        <div className="flex items-center w-full h-10">
          {[0, 1, 2, 3, 4, 5].map((circleIndex) => {
            const filled =
              circleIndex === 0
                ? isStepCompleted(STEPS[0].id) || isStepActive(STEPS[0].id)
                : circleIndex < STEPS.length
                  ? isStepCompleted(STEPS[circleIndex - 1].id) || isStepActive(STEPS[circleIndex].id)
                  : isStepCompleted(STEPS[STEPS.length - 1].id);
            const circleLabels = ["Start", ...STEPS.map((s) => s.title)];
            const CircleIcons = [Play, Server, Settings, Tag, Wrench, CheckCircle];
            const Icon = CircleIcons[circleIndex];
            return (
              <div key={`stepper-${circleIndex}`} className="contents">
                {/* Each circle has its own icon; when filled show CheckCircle */}
                <div
                  className={`w-10 h-10 shrink-0 rounded-full flex items-center justify-center border-2 transition-all ${
                    filled ? "bg-primary border-primary" : "bg-primary/10 border-primary/50"
                  }`}
                  title={circleLabels[circleIndex]}
                >
                  {filled ? (
                    <CheckCircle className="h-6 w-6 text-white" />
                  ) : (
                    <Icon className="h-5 w-5 text-primary" />
                  )}
                </div>
                {/* Line after circle (except after last) */}
                {circleIndex < 5 && (
                  <div
                    className={`flex-1 h-0.5 min-h-[2px] min-w-[8px] mx-0.5 ${
                      isStepCompleted(STEPS[circleIndex].id) || getCurrentStepIndex() > circleIndex
                        ? "bg-primary"
                        : "bg-primary/30"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
        {/* Row 2: labels under the 4 gaps — same 9-column layout as row 1 */}
        <div className="flex w-full mt-2">
          <div className="w-10 shrink-0" />
          {STEPS.map((step, idx) => (
            <Fragment key={step.id}>
              <div className="flex-1 min-w-0 px-0.5 flex justify-center">
                <span
                  className={`text-xs text-center max-w-[72px] leading-tight ${
                    isStepActive(step.id) ? "font-semibold text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {step.number}. {step.title}
                </span>
              </div>
              {idx < STEPS.length - 1 ? <div className="w-10 shrink-0" /> : null}
            </Fragment>
          ))}
          <div className="w-10 shrink-0" />
        </div>
      </div>

      {/* Step Content */}
      <div className="bg-card rounded-lg border p-6 mb-6">
        <h2 className="text-2xl font-bold mb-6">
          {STEPS.find(s => s.id === currentStep)?.number}. {STEPS.find(s => s.id === currentStep)?.title}
        </h2>
        {renderStepContent()}
      </div>

      {/* Navigation */}
      <div className="flex justify-between">
        {(currentStep === "server-access" && serverAccessSubStep > 1) ||
         (getCurrentStepIndex() > 0 && currentStep !== "server-access") ? (
          <Button
            onClick={handleBack}
            variant="ghost"
            className="text-muted-foreground hover:text-foreground"
          >
            Back
          </Button>
        ) : (
          <div />
        )}
        {currentStep === "register-onchain" ? (
          <Button onClick={() => setLocation("/providers")} variant="outline">
            View my providers
          </Button>
        ) : (
          <Button
            onClick={handleNext}
            disabled={!canProceed() || isChecking || isBuilding}
            className="bg-primary hover:bg-primary/90 text-white"
          >
            {isChecking ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Checking...
              </>
            ) : isBuilding ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Starting build...
              </>
            ) : currentStep === "provider-attributes" ? (
              "Start build"
            ) : (
              "Next"
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
