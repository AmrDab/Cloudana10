import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle, Circle, Loader2, AlertCircle, Trash2, Info } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";

const ATTRIBUTE_KEYS = ["host", "tier", "organization"] as const;

type AttributeRow = { key: string; value: string };

const DEFAULT_ATTRIBUTES: AttributeRow[] = [
  { key: "host", value: "akash" },
  { key: "tier", value: "community" },
  { key: "organization", value: "asdf" },
];

type Step = "server-access" | "provider-config" | "provider-attributes" | "import-wallet";

const STEPS: { id: Step; title: string; number: number }[] = [
  { id: "server-access", title: "Server Access", number: 1 },
  { id: "provider-config", title: "Provider Config", number: 2 },
  { id: "provider-attributes", title: "Provider Attributes", number: 3 },
  { id: "import-wallet", title: "Import Wallet", number: 4 },
];

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

  // Wallet state (for import-wallet step)
  const [walletKeyId, setWalletKeyId] = useState("");
  const [walletPhrase, setWalletPhrase] = useState("");
  const [walletImportMode, setWalletImportMode] = useState<"auto" | "manual">("auto");

  // Build provider state
  const [isBuilding, setIsBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);

  const getCurrentStepIndex = () => STEPS.findIndex(s => s.id === currentStep);
  const isStepCompleted = (step: Step) => completedSteps.has(step);
  const isStepActive = (step: Step) => currentStep === step;

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
            setLocation("/provider/register/build-cluster");
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
    
    // Mark current step as completed
    setCompletedSteps(prev => new Set(Array.from(prev).concat(currentStep)));
    
    if (currentIndex < STEPS.length - 1) {
      // Move to next step
      setCurrentStep(STEPS[currentIndex + 1].id);
    } else {
      // All steps completed - call build-provider API and navigate to Build Cluster
      await startBuildProvider();
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

      // Navigate to build cluster page with action_id
      setLocation(`/provider/register/build-cluster?action_id=${returnedActionId}`);
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
      case "import-wallet":
        return !isBuilding;
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

  // Check SSH connection
  const checkSSHConnection = async (): Promise<boolean> => {
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
      });

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
      // Handle network/connection errors
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
      });

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
      // Handle network/connection errors
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
                  <p className="text-sm text-green-600 dark:text-green-400 mt-1.5 flex items-center gap-1.5">
                    <CheckCircle className="h-4 w-4 shrink-0" />
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

      case "import-wallet":
        return (
          <div className="space-y-6">
            <div className="space-y-4">
              <div>
                <Label htmlFor="walletKeyId" className="text-base font-semibold">
                  Wallet Key ID <span className="text-red-500">*</span>
                </Label>
                <p className="text-sm text-muted-foreground mb-2">
                  Enter the key ID for your wallet. This is required to import your wallet.
                </p>
                <Input
                  id="walletKeyId"
                  type="text"
                  placeholder="Enter wallet key ID"
                  value={walletKeyId}
                  onChange={(e) => {
                    setWalletKeyId(e.target.value);
                    setBuildError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                      e.preventDefault();
                      if (canProceed() && !isBuilding) {
                        handleNext();
                      }
                    }
                  }}
                  className="max-w-md"
                />
              </div>

              <div>
                <Label htmlFor="walletImportMode" className="text-base font-semibold">
                  Import Mode
                </Label>
                <p className="text-sm text-muted-foreground mb-2">
                  Select how you want to import your wallet.
                </p>
                <Select
                  value={walletImportMode}
                  onValueChange={(value: "auto" | "manual") => {
                    setWalletImportMode(value);
                    setBuildError(null);
                  }}
                >
                  <SelectTrigger className="max-w-md">
                    <SelectValue placeholder="Select import mode" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto</SelectItem>
                    <SelectItem value="manual">Manual</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="walletPhrase" className="text-base font-semibold">
                  Wallet Phrase (Optional)
                </Label>
                <p className="text-sm text-muted-foreground mb-2">
                  Enter your wallet mnemonic phrase if you want to import an existing wallet. Leave empty to create a new wallet.
                </p>
                <Input
                  id="walletPhrase"
                  type="text"
                  placeholder="Enter wallet mnemonic phrase (12 or 24 words)"
                  value={walletPhrase}
                  onChange={(e) => {
                    setWalletPhrase(e.target.value);
                    setBuildError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                      e.preventDefault();
                      if (canProceed() && !isBuilding) {
                        handleNext();
                      }
                    }
                  }}
                  className="max-w-md"
                />
              </div>

              {buildError && (
                <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-md">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-destructive">Build Error</p>
                      <p className="text-sm text-destructive/80 mt-1">{buildError}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-10 px-4">
      {/* Progress Steps */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          {STEPS.map((step, index) => {
            const isCompleted = isStepCompleted(step.id);
            const isActive = isStepActive(step.id);
            const isPast = getCurrentStepIndex() > index;

            return (
              <div key={step.id} className="flex items-center flex-1">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${
                      isCompleted || isActive
                        ? "bg-red-500 border-red-500"
                        : "bg-transparent border-gray-300"
                    }`}
                  >
                    {isCompleted || isActive ? (
                      <CheckCircle className="h-6 w-6 text-white" />
                    ) : (
                      <div className="w-6 h-6 rounded-full border-2 border-gray-300" />
                    )}
                  </div>
                  <span
                    className={`text-xs mt-2 text-center max-w-[100px] ${
                      isActive ? "font-semibold text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {step.number}. {step.title}
                  </span>
                </div>
                {index < STEPS.length - 1 && (
                  <div
                    className={`flex-1 h-0.5 mx-2 ${
                      isPast || isCompleted ? "bg-red-500" : "bg-gray-300"
                    }`}
                  />
                )}
              </div>
            );
          })}
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
          <div /> // Spacer
        )}
        <Button
          onClick={handleNext}
          disabled={!canProceed() || isChecking || isBuilding}
          className="bg-red-500 hover:bg-red-600 text-white"
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
          ) : (
            "Next"
          )}
        </Button>
      </div>
    </div>
  );
}
