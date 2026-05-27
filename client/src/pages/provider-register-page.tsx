import { useState, useEffect, useRef } from "react";
import { Building2, Home, ArrowRight, Wifi, Server, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import ProviderRegisterStaged from "@/pages/provider-register-staged";
import ProviderRegisterMultistep from "@/pages/provider-register-multistep";

const GUIDE_SEEN_KEY = "cloudana_provider_guide_seen";
const PROVIDER_TYPE_KEY = "cloudana_provider_type";

type ProviderType = "datacenter" | "home" | null;

function readGuideSeen(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(GUIDE_SEEN_KEY) === "true";
}

function readProviderType(): ProviderType {
  if (typeof window === "undefined") return null;
  return (localStorage.getItem(PROVIDER_TYPE_KEY) as ProviderType) || null;
}

function ProviderTypeSelector({ onSelect }: { onSelect: (type: ProviderType) => void }) {
  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold">What type of provider are you?</h2>
        <p className="text-muted-foreground">This determines your setup path. You can always change later.</p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {/* Datacenter */}
        <Card
          className="border-white/10 hover:border-primary/40 cursor-pointer transition-all duration-200 hover:bg-white/5 group"
          onClick={() => onSelect("datacenter")}
        >
          <CardContent className="p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div className="h-12 w-12 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                <Building2 className="h-6 w-6 text-blue-400" />
              </div>
              <Badge variant="outline" className="text-blue-400 border-blue-500/30 text-xs">Recommended</Badge>
            </div>

            <div>
              <h3 className="text-lg font-semibold mb-1">Datacenter / VPS</h3>
              <p className="text-sm text-muted-foreground">
                Dedicated server, VPS, or colocation. Static IP, high uptime, business-grade internet.
              </p>
            </div>

            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500 shrink-0" /> Static public IP</li>
              <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500 shrink-0" /> Open ports (80/443/8443)</li>
              <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500 shrink-0" /> Linux server (Ubuntu 22.04+)</li>
              <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500 shrink-0" /> Higher rewards &amp; SLA tier</li>
            </ul>

            <Button className="w-full group-hover:bg-primary/90" size="sm">
              Datacenter Setup <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </CardContent>
        </Card>

        {/* Home */}
        <Card
          className="border-white/10 hover:border-primary/40 cursor-pointer transition-all duration-200 hover:bg-white/5 group"
          onClick={() => onSelect("home")}
        >
          <CardContent className="p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div className="h-12 w-12 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
                <Home className="h-6 w-6 text-purple-400" />
              </div>
              <Badge variant="outline" className="text-purple-400 border-purple-500/30 text-xs">Home / Hobbyist</Badge>
            </div>

            <div>
              <h3 className="text-lg font-semibold mb-1">Home Provider</h3>
              <p className="text-sm text-muted-foreground">
                Personal machine, gaming PC, or spare hardware. Consumer internet, dynamic IP. No port forwarding needed.
              </p>
            </div>

            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500 shrink-0" /> No static IP required</li>
              <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500 shrink-0" /> No router port forwarding</li>
              <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500 shrink-0" /> Works behind NAT/firewall</li>
              <li className="flex items-center gap-2"><Wifi className="h-4 w-4 text-yellow-500 shrink-0" /> Built-in WireGuard tunnel</li>
            </ul>

            <Button variant="outline" className="w-full border-white/10 group-hover:border-white/20" size="sm">
              Home Setup <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </CardContent>
        </Card>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Not sure? Pick <strong>Home Provider</strong>. It works everywhere.
      </p>
    </div>
  );
}

function HomeProviderSetup({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState(0);

  const steps = [
    {
      title: "Install the Cloudana provider node",
      description: "The provider node includes a built-in WireGuard tunnel. No port forwarding, no third-party services, no static IP needed.",
      code: `# Install Docker if not already installed
curl -fsSL https://get.docker.com | sh

# Pull and run the Cloudana provider node
docker run -d \\
  --name cloudana-provider \\
  --restart unless-stopped \\
  --cap-add NET_ADMIN \\
  -p 4040:4040 \\
  -v /var/cloudana:/data \\
  cloudana/provider-node:latest`,
    },
    {
      title: "Register your node",
      description: "The node auto-detects your hardware (CPU, GPU, RAM, storage) and generates a device ID. Register it on-chain to start earning.",
      code: `# Check your node is running
curl http://localhost:4040/device-info

# The output shows your device ID and hardware specs.
# Use these to register on the Cloudana console.`,
    },
    {
      title: "Start mining",
      description: "Once registered, the node automatically begins POUW mining and accepts workloads from the network.",
      code: `# Check mining status
curl http://localhost:4040/mining/stats

# View logs
docker logs -f cloudana-provider`,
    },
  ];

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="text-muted-foreground">
          ← Back
        </Button>
        <div>
          <h2 className="text-xl font-bold">Home Provider Setup</h2>
          <p className="text-sm text-muted-foreground">Step {step + 1} of {steps.length}</p>
        </div>
      </div>

      {/* Progress */}
      <div className="flex gap-2">
        {steps.map((_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-colors ${i <= step ? "bg-primary" : "bg-white/10"}`}
          />
        ))}
      </div>

      {/* Current step */}
      <Card className="border-white/10">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-sm font-bold text-primary">
              {step + 1}
            </div>
            <h3 className="text-lg font-semibold">{steps[step].title}</h3>
          </div>
          <p className="text-sm text-muted-foreground">{steps[step].description}</p>
          <pre className="bg-black/40 border border-white/10 rounded-lg p-4 text-xs text-green-400 overflow-x-auto whitespace-pre-wrap">
            {steps[step].code}
          </pre>
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" size="sm" className="border-white/10" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>
          Previous
        </Button>
        {step < steps.length - 1 ? (
          <Button size="sm" onClick={() => setStep(step + 1)}>
            Next Step <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        ) : (
          <Button size="sm" className="bg-green-600 hover:bg-green-700">
            <CheckCircle className="h-4 w-4 mr-1" /> Complete: Register Node
          </Button>
        )}
      </div>

      <Card className="border-yellow-500/20 bg-yellow-500/5">
        <CardContent className="p-4 text-sm text-yellow-200/80 flex items-start gap-2">
          <Server className="h-4 w-4 mt-0.5 shrink-0 text-yellow-400" />
          <span>
            <strong className="text-yellow-300">Testnet note:</strong> Home provider support is in active development.
            The steps above are a preview. Full automated setup will be available before mainnet.
          </span>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ProviderRegisterPage() {
  // Always show the type selector first; let users pick their path each visit
  const [providerType, setProviderType] = useState<ProviderType>(null);
  const [guideSeen, setGuideSeenState] = useState(readGuideSeen);
  const registerSectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setGuideSeenState(readGuideSeen());
    // Don't restore provider type from localStorage; always show selector first
  }, []);

  const handleSelectType = (type: ProviderType) => {
    setProviderType(type);
    if (typeof window !== "undefined") {
      localStorage.setItem(PROVIDER_TYPE_KEY, type!);
    }
  };

  const handleBack = () => {
    setProviderType(null);
    if (typeof window !== "undefined") {
      localStorage.removeItem(PROVIDER_TYPE_KEY);
    }
  };

  const setGuideSeenAndPersist = () => {
    setGuideSeenState(true);
    localStorage.setItem(GUIDE_SEEN_KEY, "true");
  };

  const handleGuideComplete = () => {
    setGuideSeenAndPersist();
    registerSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="max-w-6xl mx-auto py-10 px-4 space-y-8 animate-in fade-in duration-300">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Become a Provider</h1>
        <p className="mt-2 text-muted-foreground text-base">
          Contribute compute resources and earn CLD rewards.
        </p>
      </div>

      {/* Step 0: choose provider type */}
      {!providerType && (
        <ProviderTypeSelector onSelect={handleSelectType} />
      )}

      {/* Home provider flow */}
      {providerType === "home" && (
        <HomeProviderSetup onBack={handleBack} />
      )}

      {/* Datacenter flow - existing guided registration */}
      {providerType === "datacenter" && (
        <>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleBack} className="text-muted-foreground">
              ← Change type
            </Button>
            <Badge variant="outline" className="text-blue-400 border-blue-500/30">
              <Building2 className="h-3 w-3 mr-1" /> Datacenter / VPS
            </Badge>
          </div>

          {!guideSeen && (
            <section className="mb-12">
              <ProviderRegisterStaged
                onGuideComplete={handleGuideComplete}
                onSkip={setGuideSeenAndPersist}
              />
            </section>
          )}

          <section
            id="provider-register-form"
            ref={registerSectionRef}
            className={guideSeen ? undefined : "scroll-mt-6"}
          >
            {!guideSeen && (
              <div className="mb-8 pt-6 border-t border-white/10">
                <h2 className="text-xl font-semibold text-primary mb-1">Registration form</h2>
                <p className="text-muted-foreground text-sm">
                  Complete the form below to register and connect your provider to the Cloudana network.
                </p>
              </div>
            )}
            <ProviderRegisterMultistep />
          </section>
        </>
      )}
    </div>
  );
}
