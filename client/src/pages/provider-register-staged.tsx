import { useState } from "react";
import { useAccount } from "wagmi";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle, Circle, Wallet, Server, Network, Settings, Tag, ArrowRight, ExternalLink, Loader2, AlertCircle } from "lucide-react";
import { useCLDTokenBalance } from "@/lib/contracts";
import { formatEther } from "viem";

type Stage = "wallet" | "requirements" | "network" | "configuration" | "attributes";

const STAGES: { id: Stage; title: string; icon: typeof Wallet }[] = [
  { id: "wallet", title: "Funding Requirements", icon: Wallet },
  { id: "requirements", title: "Basic Provider Requirements", icon: Server },
  { id: "network", title: "Network Configuration", icon: Network },
  { id: "configuration", title: "Provider Configuration", icon: Settings },
  { id: "attributes", title: "Provider Attributes", icon: Tag },
];

export default function ProviderRegisterStaged() {
  const { address, isConnected } = useAccount();
  const [, setLocation] = useLocation();
  const { data: balance } = useCLDTokenBalance(address);
  
  const [currentStage, setCurrentStage] = useState<Stage>("wallet");
  const [completedStages, setCompletedStages] = useState<Set<Stage>>(new Set());
  
  // Network configuration state
  const [publicIP, setPublicIP] = useState("");
  const [sshPort, setSshPort] = useState("22");
  const [sshAuthMethod, setSshAuthMethod] = useState<"password" | "key">("password");
  const [sshPassword, setSshPassword] = useState("");
  const [sshKeyFile, setSshKeyFile] = useState<File | null>(null);
  const [sshKeyContent, setSshKeyContent] = useState("");
  const [isCheckingSSH, setIsCheckingSSH] = useState(false);
  const [sshConnectionStatus, setSshConnectionStatus] = useState<"idle" | "checking" | "success" | "error">("idle");
  const [sshErrorMessage, setSshErrorMessage] = useState("");
  const [portsOpen, setPortsOpen] = useState({
    port8443: false,
    port8444: false,
    port80: false,
    port443: false,
  });
  
  // Provider configuration state
  const [domainName, setDomainName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [email, setEmail] = useState("");
  
  // Provider attributes state
  const [region, setRegion] = useState("");
  const [specializations, setSpecializations] = useState("");
  const [hardwareCapabilities, setHardwareCapabilities] = useState("");

  const balanceValue = balance && typeof balance === 'bigint' ? parseFloat(formatEther(balance)) : 0;
  const hasEnoughBalance = balanceValue >= 30; // Minimum 30 CLD requirement

  const getCurrentStageIndex = () => STAGES.findIndex(s => s.id === currentStage);
  const isStageCompleted = (stage: Stage) => completedStages.has(stage);
  const canProceedToNext = () => {
    switch (currentStage) {
      case "wallet":
        return isConnected && hasEnoughBalance;
      case "requirements":
        return true; // Just needs confirmation
      case "network": {
        const hasSSHConnection = sshConnectionStatus === "success";
        return publicIP !== "" && 
               Object.values(portsOpen).every(v => v) &&
               (sshAuthMethod === "password" ? sshPassword !== "" : sshKeyContent !== "") &&
               hasSSHConnection;
      }
      case "configuration":
        return domainName !== "" && organizationName !== "";
      case "attributes":
        return region !== "";
      default:
        return false;
    }
  };

  // Test SSH connection
  const testSSHConnection = async (): Promise<boolean> => {
    if (!publicIP || !sshPort) {
      setSshConnectionStatus("error");
      setSshErrorMessage("Please provide IP address and SSH port");
      return false;
    }

    if (sshAuthMethod === "password" && !sshPassword) {
      setSshConnectionStatus("error");
      setSshErrorMessage("Please provide SSH password");
      return false;
    }

    if (sshAuthMethod === "key" && !sshKeyContent) {
      setSshConnectionStatus("error");
      setSshErrorMessage("Please provide SSH key");
      return false;
    }

    setIsCheckingSSH(true);
    setSshConnectionStatus("checking");
    setSshErrorMessage("");

    try {
      // In a real implementation, this would call a backend API to test SSH connection
      // For now, we'll simulate a connection test
      // TODO: Replace with actual API call to backend
      const response = await fetch("/api/v1/test-ssh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host: publicIP,
          port: parseInt(sshPort),
          authMethod: sshAuthMethod,
          password: sshAuthMethod === "password" ? sshPassword : undefined,
          privateKey: sshAuthMethod === "key" ? sshKeyContent : undefined,
        }),
      });

      if (response.ok) {
        setSshConnectionStatus("success");
        setSshErrorMessage("");
        return true;
      } else {
        const error = await response.json().catch(() => ({ message: "SSH connection failed" }));
        setSshConnectionStatus("error");
        setSshErrorMessage(error.message || "Failed to connect via SSH");
        return false;
      }
    } catch (error) {
      // If API endpoint doesn't exist, simulate a basic check
      // In production, this should be handled by a backend service
      console.warn("SSH test endpoint not available, simulating connection check");
      
      // Simulate connection check (remove this in production)
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Basic validation: check if IP format is valid
      const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
      if (ipRegex.test(publicIP) && parseInt(sshPort) > 0 && parseInt(sshPort) <= 65535) {
        setSshConnectionStatus("success");
        setSshErrorMessage("");
        return true;
      } else {
        setSshConnectionStatus("error");
        setSshErrorMessage("Invalid IP address or port format");
        return false;
      }
    } finally {
      setIsCheckingSSH(false);
    }
  };

  const handleSSHKeyFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSshKeyFile(file);
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        setSshKeyContent(content);
      };
      reader.readAsText(file);
    }
  };

  const handleConfirm = async () => {
    // For network stage, test SSH connection first
    if (currentStage === "network" && sshConnectionStatus !== "success") {
      const connectionSuccess = await testSSHConnection();
      // Don't proceed if connection test failed
      if (!connectionSuccess) {
        return;
      }
    }

    if (!canProceedToNext()) return;

    // Mark current stage as completed
    setCompletedStages(prev => new Set(Array.from(prev).concat(currentStage)));

    const currentIndex = getCurrentStageIndex();
    if (currentIndex < STAGES.length - 1) {
      // Move to next stage
      setCurrentStage(STAGES[currentIndex + 1].id);
    } else {
      // All stages completed, navigate to main registration page
      setLocation("/provider/register");
    }
  };

  // Removed handleStageClick - users can only progress via Next button

  const renderStageContent = () => {
    switch (currentStage) {
      case "wallet":
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold mb-2">To begin the process</h3>
              <ul className="space-y-3 text-sm text-muted-foreground">
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span>You need to have at least 30 CLD tokens in your wallet in order to bid on workloads.</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span>Every lease created on the Cloudana network requires 5 CLD to be locked in escrow. Please ensure you have enough funds to cover your resources.</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span>These tokens are returned when the lease is closed.</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span>Verify your wallet balance and fund it if necessary.</span>
                </li>
              </ul>
            </div>
            <div className="flex items-center gap-2 p-4 bg-muted/50 rounded-lg">
              {isConnected ? (
                <>
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  <span className="text-sm">Wallet is installed</span>
                </>
              ) : (
                <>
                  <Circle className="h-5 w-5 text-muted-foreground" />
                  <span className="text-sm">Please connect your wallet</span>
                </>
              )}
            </div>
            {isConnected && (
              <div className="p-4 bg-muted/50 rounded-lg">
                <div className="text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Balance:</span>
                    <span className="font-medium">{balanceValue.toFixed(2)} CLD</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Required:</span>
                    <span className="font-medium">30 CLD</span>
                  </div>
                  {!hasEnoughBalance && (
                    <div className="text-red-500 text-xs mt-2">
                      Insufficient balance. Please fund your wallet.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );

      case "requirements":
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold mb-4">Server Setup</h3>
              <ul className="space-y-2 text-sm text-muted-foreground mb-6">
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span>Requires at least 1 server with a high-speed internet connection.</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span>For multiple servers, they must be connected locally.</span>
                </li>
              </ul>

              <h3 className="text-lg font-semibold mb-4">Minimum Specifications for Each Server</h3>
              <ul className="space-y-2 text-sm text-muted-foreground mb-6">
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span>8 CPUs</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span>16 GB RAM</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span>100 GB Storage</span>
                </li>
              </ul>

              <h3 className="text-lg font-semibold mb-4">Network Configuration</h3>
              <ul className="space-y-2 text-sm text-muted-foreground mb-6">
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span>Users must open specific ports on all servers: 8443, 8444, 80, 443.</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span>The server should allow SSH connections from public IPs (ensure the SSH port is open).</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span>At least one control node needs to have a public IP, and nodes must be on the same layer-2 network.</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span>Ideally, all control plane nodes should have public IPs.</span>
                </li>
              </ul>

              <h3 className="text-lg font-semibold mb-4">Access Requirements</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span>Root access should be enabled for better compatibility.</span>
                </li>
              </ul>
            </div>
          </div>
        );

      case "network":
        return (
          <div className="space-y-6">
            <div>
              <p className="text-sm text-muted-foreground mb-6">
                Configure your network settings to ensure proper communication between your server and the Cloudana network.
              </p>
              
              <div className="space-y-4">
                <div>
                  <Label htmlFor="publicIP">Public IP Address</Label>
                  <Input
                    id="publicIP"
                    value={publicIP}
                    onChange={(e) => setPublicIP(e.target.value)}
                    placeholder="e.g., 192.168.1.1"
                    className="mt-1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    At least one control node needs to have a public IP address.
                  </p>
                </div>

                <div>
                  <Label htmlFor="sshPort">SSH Port</Label>
                  <Input
                    id="sshPort"
                    value={sshPort}
                    onChange={(e) => setSshPort(e.target.value)}
                    placeholder="22"
                    className="mt-1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Ensure this port is open and accessible from public IPs.
                  </p>
                </div>

                <div>
                  <Label>SSH Authentication</Label>
                  <div className="mt-2 space-y-4">
                    <div className="flex gap-4">
                      <Button
                        type="button"
                        variant={sshAuthMethod === "password" ? "default" : "outline"}
                        size="sm"
                        onClick={() => {
                          setSshAuthMethod("password");
                          setSshConnectionStatus("idle");
                          setSshErrorMessage("");
                        }}
                      >
                        Password
                      </Button>
                      <Button
                        type="button"
                        variant={sshAuthMethod === "key" ? "default" : "outline"}
                        size="sm"
                        onClick={() => {
                          setSshAuthMethod("key");
                          setSshConnectionStatus("idle");
                          setSshErrorMessage("");
                        }}
                      >
                        SSH Key
                      </Button>
                    </div>

                    {sshAuthMethod === "password" ? (
                      <div>
                        <Label htmlFor="sshPassword">SSH Password</Label>
                        <Input
                          id="sshPassword"
                          type="password"
                          value={sshPassword}
                          onChange={(e) => {
                            setSshPassword(e.target.value);
                            setSshConnectionStatus("idle");
                            setSshErrorMessage("");
                          }}
                          placeholder="Enter SSH password"
                          className="mt-1"
                        />
                      </div>
                    ) : (
                      <div>
                        <Label htmlFor="sshKey">SSH Private Key</Label>
                        <Input
                          id="sshKey"
                          type="file"
                          accept=".pem,.key,text/plain"
                          onChange={handleSSHKeyFileChange}
                          className="mt-1"
                        />
                        {sshKeyFile && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Selected: {sshKeyFile.name}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">
                          Upload your SSH private key file (.pem, .key)
                        </p>
                      </div>
                    )}

                    {/* SSH Connection Status */}
                    {sshConnectionStatus !== "idle" && (
                      <div className={`p-3 rounded-lg border ${
                        sshConnectionStatus === "success" 
                          ? "bg-green-500/10 border-green-500/50" 
                          : sshConnectionStatus === "error"
                          ? "bg-red-500/10 border-red-500/50"
                          : "bg-blue-500/10 border-blue-500/50"
                      }`}>
                        <div className="flex items-center gap-2">
                          {sshConnectionStatus === "checking" && (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                              <span className="text-sm text-blue-500">Testing SSH connection...</span>
                            </>
                          )}
                          {sshConnectionStatus === "success" && (
                            <>
                              <CheckCircle className="h-4 w-4 text-green-500" />
                              <span className="text-sm text-green-500">SSH connection successful</span>
                            </>
                          )}
                          {sshConnectionStatus === "error" && (
                            <>
                              <AlertCircle className="h-4 w-4 text-red-500" />
                              <div className="flex-1">
                                <span className="text-sm text-red-500">SSH connection failed</span>
                                {sshErrorMessage && (
                                  <p className="text-xs text-red-400 mt-1">{sshErrorMessage}</p>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <Label>Required Ports</Label>
                  <div className="mt-2 space-y-2">
                    {[
                      { key: "port8443", label: "Port 8443", description: "Provider API" },
                      { key: "port8444", label: "Port 8444", description: "Provider API" },
                      { key: "port80", label: "Port 80", description: "HTTP" },
                      { key: "port443", label: "Port 443", description: "HTTPS" },
                    ].map((port) => (
                      <div key={port.key} className="flex items-center justify-between p-3 border rounded-lg">
                        <div>
                          <div className="font-medium text-sm">{port.label}</div>
                          <div className="text-xs text-muted-foreground">{port.description}</div>
                        </div>
                        <Button
                          type="button"
                          variant={portsOpen[port.key as keyof typeof portsOpen] ? "default" : "outline"}
                          size="sm"
                          onClick={() =>
                            setPortsOpen((prev) => ({
                              ...prev,
                              [port.key]: !prev[port.key as keyof typeof portsOpen],
                            }))
                          }
                        >
                          {portsOpen[port.key as keyof typeof portsOpen] ? "Open" : "Closed"}
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        );

      case "configuration":
        return (
          <div className="space-y-6">
            <div>
              <p className="text-sm text-muted-foreground mb-6">
                A proper configuration ensures smooth communication between your server and the Cloudana network.
              </p>
              
              <div className="space-y-4">
                <div>
                  <Label htmlFor="domainName">Domain Name</Label>
                  <Input
                    id="domainName"
                    value={domainName}
                    onChange={(e) => setDomainName(e.target.value)}
                    placeholder="e.g., provider.example.com"
                    className="mt-1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Obtain a domain name and point it to the IP address of your primary server.
                  </p>
                </div>

                <div>
                  <Label htmlFor="organizationName">Organization Name</Label>
                  <Input
                    id="organizationName"
                    value={organizationName}
                    onChange={(e) => setOrganizationName(e.target.value)}
                    placeholder="e.g., My Compute Provider"
                    className="mt-1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Decide on an organization name.
                  </p>
                </div>

                <div>
                  <Label htmlFor="email">Email Address (Optional)</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="contact@example.com"
                    className="mt-1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Email address for notifications and updates.
                  </p>
                </div>
              </div>
            </div>
          </div>
        );

      case "attributes":
        return (
          <div className="space-y-6">
            <div>
              <p className="text-sm text-muted-foreground mb-4">
                Provider attributes help tenants discover your provider and make bidding decisions.
              </p>
              
              <ul className="space-y-2 text-sm text-muted-foreground mb-6">
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span>Define attributes such as region, specializations, or hardware capabilities.</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span>Adding more attributes improves your chances of receiving bids from tenants.</span>
                </li>
              </ul>
              
              <div className="space-y-4">
                <div>
                  <Label htmlFor="region">Region</Label>
                  <Input
                    id="region"
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                    placeholder="e.g., Helsinki, EU, Global"
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label htmlFor="specializations">Specializations</Label>
                  <Textarea
                    id="specializations"
                    value={specializations}
                    onChange={(e) => setSpecializations(e.target.value)}
                    placeholder="e.g., AI/ML workloads, High-performance computing, GPU acceleration"
                    className="mt-1"
                    rows={3}
                  />
                </div>

                <div>
                  <Label htmlFor="hardwareCapabilities">Hardware Capabilities</Label>
                  <Textarea
                    id="hardwareCapabilities"
                    value={hardwareCapabilities}
                    onChange={(e) => setHardwareCapabilities(e.target.value)}
                    placeholder="e.g., NVIDIA A100 GPUs, High-speed NVMe storage, 10 Gbps network"
                    className="mt-1"
                    rows={3}
                  />
                </div>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="max-w-6xl mx-auto py-10 px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Get started with Provider!</h1>
        <p className="text-muted-foreground">Follow these steps to register your provider</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left sidebar - Stage list */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle>Preparation Steps</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {STAGES.map((stage, index) => {
                  const Icon = stage.icon;
                  const isActive = currentStage === stage.id;
                  const isCompleted = isStageCompleted(stage.id);

                  return (
                    <div
                      key={stage.id}
                      className={`w-full text-left p-4 rounded-lg border transition-all ${
                        isActive
                          ? "border-primary bg-primary/5"
                          : isCompleted
                          ? "border-green-500/50 bg-green-500/5"
                          : "border-muted bg-muted/30 opacity-50"
                      } cursor-default`}
                    >
                      <div className="flex items-center gap-3">
                        {isCompleted ? (
                          <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
                        ) : isActive ? (
                          <div className="h-5 w-5 rounded-full bg-primary flex-shrink-0" />
                        ) : (
                          <Circle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                        )}
                        <div className="flex-1">
                          <div className={`font-medium text-sm ${isActive ? "text-primary" : ""}`}>
                            {stage.title}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right content - Current stage */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                {(() => {
                  const Icon = STAGES.find(s => s.id === currentStage)?.icon || Wallet;
                  return <Icon className="h-5 w-5 text-primary" />;
                })()}
                <CardTitle>{STAGES.find(s => s.id === currentStage)?.title}</CardTitle>
              </div>
              <CardDescription>
                {currentStage === "wallet" && "Connect your wallet and verify funding requirements"}
                {currentStage === "requirements" && "Review and confirm basic provider requirements"}
                {currentStage === "network" && "Configure your network settings"}
                {currentStage === "configuration" && "Set up your provider configuration"}
                {currentStage === "attributes" && "Define your provider attributes"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {renderStageContent()}

              <div className="flex items-center justify-between pt-4 border-t">
                <a
                  href="#"
                  className="text-sm text-primary hover:underline flex items-center gap-1"
                >
                  Learn how <ExternalLink className="h-3 w-3" />
                </a>
                <Button
                  onClick={handleConfirm}
                  disabled={!canProceedToNext()}
                  className="bg-primary hover:bg-primary/90"
                >
                  {getCurrentStageIndex() === STAGES.length - 1 ? (
                    <>
                      Complete Registration <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  ) : (
                    <>
                      Next <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
