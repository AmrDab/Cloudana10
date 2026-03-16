import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Wallet, Rocket, CheckCircle2, ArrowRight, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = [
  {
    title: "Welcome to Cloudana",
    description: "Deploy containerized workloads to a decentralized compute network. Cheaper and faster than traditional cloud.",
    icon: Rocket,
    content: (
      <div className="space-y-3 text-sm text-muted-foreground">
        <p>Cloudana connects you to a global network of compute providers. Your workloads run on real hardware, secured by smart contracts on Base.</p>
        <div className="grid grid-cols-3 gap-3 pt-2">
          <div className="rounded-lg border border-white/10 p-3 text-center">
            <p className="text-2xl font-bold text-foreground">89%</p>
            <p className="text-xs">cheaper than AWS</p>
          </div>
          <div className="rounded-lg border border-white/10 p-3 text-center">
            <p className="text-2xl font-bold text-foreground">100+</p>
            <p className="text-xs">templates</p>
          </div>
          <div className="rounded-lg border border-white/10 p-3 text-center">
            <p className="text-2xl font-bold text-foreground">On-chain</p>
            <p className="text-xs">verified</p>
          </div>
        </div>
      </div>
    ),
  },
  {
    title: "Get Testnet Funds",
    description: "You need Base Sepolia ETH (for gas) and CLD credits (for deployments).",
    icon: Wallet,
    content: (
      <div className="space-y-3 text-sm text-muted-foreground">
        <div className="rounded-lg border border-white/10 p-3 space-y-2">
          <p className="font-medium text-foreground">Base Sepolia ETH (gas)</p>
          <p>Free testnet ETH to pay for transaction gas fees:</p>
          <div className="flex flex-wrap gap-2">
            <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm" className="gap-1 text-xs">
                Circle Faucet <ExternalLink className="h-3 w-3" />
              </Button>
            </a>
            <a href="https://www.alchemy.com/faucets/base-sepolia" target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm" className="gap-1 text-xs">
                Alchemy Faucet <ExternalLink className="h-3 w-3" />
              </Button>
            </a>
            <a href="https://faucet.quicknode.com/base/sepolia" target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm" className="gap-1 text-xs">
                QuickNode <ExternalLink className="h-3 w-3" />
              </Button>
            </a>
          </div>
        </div>
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
          <p className="font-medium text-foreground">CLD Tokens (deployments)</p>
          <p>Get 100 free testnet CLD from our faucet to start deploying:</p>
          <a href="/faucet">
            <Button variant="outline" size="sm" className="gap-1 text-xs border-primary/30 text-primary hover:bg-primary/10">
              Open CLD Faucet <ExternalLink className="h-3 w-3" />
            </Button>
          </a>
        </div>
      </div>
    ),
  },
  {
    title: "Deploy Your First Workload",
    description: "Pick a template and deploy in one click.",
    icon: CheckCircle2,
    content: (
      <div className="space-y-3 text-sm text-muted-foreground">
        <ol className="space-y-3">
          <li className="flex gap-3">
            <span className="h-6 w-6 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-xs font-bold text-primary shrink-0">1</span>
            <span>Go to <strong>Deployments</strong> and click <strong>Create Deployment</strong></span>
          </li>
          <li className="flex gap-3">
            <span className="h-6 w-6 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-xs font-bold text-primary shrink-0">2</span>
            <span>Choose a template (Minecraft, WordPress, custom Docker image, etc.)</span>
          </li>
          <li className="flex gap-3">
            <span className="h-6 w-6 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-xs font-bold text-primary shrink-0">3</span>
            <span>Confirm the on-chain transaction. The orchestrator handles the rest</span>
          </li>
        </ol>
        <p className="pt-2">Your deployment will appear on the dashboard with live status updates.</p>
      </div>
    ),
  },
];

interface OnboardingModalProps {
  open: boolean;
  onClose: () => void;
}

export function OnboardingModal({ open, onClose }: OnboardingModalProps) {
  const [step, setStep] = useState(0);
  const isLast = step === STEPS.length - 1;
  const current = STEPS[step];
  const Icon = current.icon;

  const handleComplete = () => {
    localStorage.setItem("onboarding_complete", "true");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleComplete(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="h-9 w-9 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Icon className="h-5 w-5 text-primary" />
            </div>
            <DialogTitle>{current.title}</DialogTitle>
          </div>
          <DialogDescription>{current.description}</DialogDescription>
        </DialogHeader>

        <div className="py-2">{current.content}</div>

        {/* Step indicators */}
        <div className="flex items-center justify-between pt-2">
          <div className="flex gap-1.5">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === step ? "w-6 bg-primary" : "w-1.5 bg-muted-foreground/30"
                )}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {step > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setStep(step - 1)}>
                Back
              </Button>
            )}
            {!isLast ? (
              <Button size="sm" onClick={() => setStep(step + 1)} className="gap-1">
                Next <ArrowRight className="h-3 w-3" />
              </Button>
            ) : (
              <Button size="sm" onClick={handleComplete} className="gap-1">
                Get Started <Rocket className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
