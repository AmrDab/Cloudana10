import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, Circle, Wallet, Server, Network, Settings, Tag, ArrowRight, ExternalLink } from "lucide-react";
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
      case "network":
        return true; // Just needs confirmation
      case "configuration":
        return true; // Just needs confirmation
      case "attributes":
        return true; // Just needs confirmation
      default:
        return false;
    }
  };

  const handleConfirm = async () => {
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

  // Handle Enter key press to activate Next button
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only trigger if not typing in an input field
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }

      if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (canProceedToNext()) {
          handleConfirm();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [currentStage, isConnected, hasEnoughBalance]);

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
                  <h3 className="text-sm font-semibold mb-1">Domain Name</h3>
                  <p className="text-sm text-muted-foreground">
                    Obtain a domain name and point it to the IP address of your primary server.
                  </p>
                </div>
                <div>
                  <h3 className="text-sm font-semibold mb-1">Organization Information</h3>
                  <p className="text-sm text-muted-foreground">
                    Decide on an organization name.
                  </p>
                </div>
                <div>
                  <h3 className="text-sm font-semibold mb-1">Email Address (Optional)</h3>
                  <p className="text-sm text-muted-foreground">
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
                      Create Provider <ArrowRight className="ml-2 h-4 w-4" />
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
