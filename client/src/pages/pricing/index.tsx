import { useState } from "react";
import { useLocation } from "wouter";
import {
  Server, Cpu, Brain, Gamepad2, Globe, Boxes, ArrowRight, ChevronRight,
  Zap, HardDrive, MemoryStick, Network
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type WorkloadType = "vps" | "ai" | "gaming" | "webapp" | "vm" | "custom" | null;

interface WorkloadOption {
  id: WorkloadType;
  icon: React.ReactNode;
  label: string;
  description: string;
  examples: string[];
  badge?: string;
  badgeColor?: string;
  estimate: string;
  destination: string;
}

const WORKLOADS: WorkloadOption[] = [
  {
    id: "vps",
    icon: <Server className="h-6 w-6 text-blue-400" />,
    label: "VPS / Server",
    description: "Run a lightweight server, API, database, or backend service.",
    examples: ["Node.js API", "PostgreSQL", "Redis", "nginx"],
    estimate: "From $4/mo",
    destination: "/pricing/usage",
    badge: "Most Popular",
    badgeColor: "text-blue-400 border-blue-500/30",
  },
  {
    id: "webapp",
    icon: <Globe className="h-6 w-6 text-green-400" />,
    label: "Web App / CMS",
    description: "Host a website, CMS, or full-stack web application.",
    examples: ["WordPress", "Ghost", "Next.js", "Strapi"],
    estimate: "From $6/mo",
    destination: "/pricing/usage",
  },
  {
    id: "ai",
    icon: <Brain className="h-6 w-6 text-purple-400" />,
    label: "AI / Machine Learning",
    description: "GPU-accelerated training, fine-tuning, or inference workloads.",
    examples: ["LLM inference", "Stable Diffusion", "PyTorch training", "vLLM"],
    estimate: "From $0.72/hr (GPU)",
    destination: "/pricing/gpus-on-demand",
    badge: "GPU Required",
    badgeColor: "text-purple-400 border-purple-500/30",
  },
  {
    id: "gaming",
    icon: <Gamepad2 className="h-6 w-6 text-orange-400" />,
    label: "Game Server",
    description: "Dedicated game server with low latency and high uptime.",
    examples: ["Minecraft", "Valheim", "CS2", "Rust"],
    estimate: "From $8/mo",
    destination: "/pricing/usage",
  },
  {
    id: "vm",
    icon: <Cpu className="h-6 w-6 text-cyan-400" />,
    label: "Virtual Machine",
    description: "Full VM with custom OS image, persistent storage, and dedicated vCPUs.",
    examples: ["Ubuntu VM", "Windows Server", "Dev environment", "CI runners"],
    estimate: "From $12/mo",
    destination: "/pricing/usage",
  },
  {
    id: "custom",
    icon: <Boxes className="h-6 w-6 text-yellow-400" />,
    label: "Custom / Enterprise",
    description: "Multi-node clusters, custom hardware, or high-throughput workloads.",
    examples: ["K8s clusters", "HPC jobs", "Data pipelines", "Multi-GPU"],
    estimate: "Custom quote",
    destination: "/pricing/usage",
    badge: "Talk to us",
    badgeColor: "text-yellow-400 border-yellow-500/30",
  },
];

const QUICK_SPECS: Record<NonNullable<WorkloadType>, { cpu: string; ram: string; storage: string; gpu?: string }> = {
  vps:    { cpu: "1–4 vCPU", ram: "1–8 GB",   storage: "20–100 GB" },
  webapp: { cpu: "2–4 vCPU", ram: "2–8 GB",   storage: "20–100 GB" },
  ai:     { cpu: "8–32 vCPU", ram: "32–256 GB", storage: "100–1000 GB", gpu: "RTX 4090 → H100" },
  gaming: { cpu: "4–8 vCPU", ram: "8–32 GB",  storage: "50–200 GB" },
  vm:     { cpu: "2–16 vCPU", ram: "4–64 GB",  storage: "50–500 GB" },
  custom: { cpu: "Any",       ram: "Any",       storage: "Any",           gpu: "Any" },
};

export default function PricingLandingPage() {
  const [selected, setSelected] = useState<WorkloadType>(null);
  const [, navigate] = useLocation();

  const selectedWorkload = WORKLOADS.find(w => w.id === selected);

  return (
    <div className="max-w-5xl mx-auto py-10 px-4 space-y-10 animate-in fade-in duration-300">

      {/* Header */}
      <div className="text-center space-y-3">
        <Badge variant="outline" className="text-green-400 border-green-500/30 mb-2">
          <Zap className="h-3 w-3 mr-1" /> No egress fees · No hidden costs
        </Badge>
        <h1 className="text-4xl font-bold tracking-tight">What are you building?</h1>
        <p className="text-muted-foreground text-lg max-w-xl mx-auto">
          Pick your workload type and we'll show you the right pricing. No surprises.
        </p>
      </div>

      {/* Workload grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {WORKLOADS.map((w) => (
          <Card
            key={w.id}
            onClick={() => setSelected(w.id === selected ? null : w.id)}
            className={cn(
              "border cursor-pointer transition-all duration-200 hover:bg-white/5 group",
              selected === w.id
                ? "border-primary/60 bg-primary/5 ring-1 ring-primary/30"
                : "border-white/10 hover:border-white/20"
            )}
          >
            <CardContent className="p-5 space-y-3">
              <div className="flex items-start justify-between">
                <div className="h-11 w-11 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center">
                  {w.icon}
                </div>
                {w.badge && (
                  <Badge variant="outline" className={cn("text-xs", w.badgeColor)}>
                    {w.badge}
                  </Badge>
                )}
              </div>

              <div>
                <h3 className="font-semibold text-base">{w.label}</h3>
                <p className="text-sm text-muted-foreground mt-0.5">{w.description}</p>
              </div>

              <div className="flex flex-wrap gap-1">
                {w.examples.map(ex => (
                  <span key={ex} className="text-xs bg-white/5 border border-white/10 rounded px-2 py-0.5 text-muted-foreground">
                    {ex}
                  </span>
                ))}
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-sm font-medium text-primary">{w.estimate}</span>
                {selected === w.id && (
                  <ChevronRight className="h-4 w-4 text-primary" />
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Expanded detail + CTA when selected */}
      {selected && selectedWorkload && (
        <Card className="border-primary/30 bg-primary/5 animate-in slide-in-from-bottom-2 duration-200">
          <CardContent className="p-6">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6">
              <div className="space-y-4 flex-1">
                <div className="flex items-center gap-2">
                  {selectedWorkload.icon}
                  <h3 className="text-lg font-semibold">{selectedWorkload.label}</h3>
                </div>

                {/* Typical specs */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-white/5 rounded-lg p-3 text-center">
                    <Cpu className="h-4 w-4 text-muted-foreground mx-auto mb-1" />
                    <p className="text-xs text-muted-foreground">CPU</p>
                    <p className="text-sm font-medium">{QUICK_SPECS[selected].cpu}</p>
                  </div>
                  <div className="bg-white/5 rounded-lg p-3 text-center">
                    <MemoryStick className="h-4 w-4 text-muted-foreground mx-auto mb-1" />
                    <p className="text-xs text-muted-foreground">Memory</p>
                    <p className="text-sm font-medium">{QUICK_SPECS[selected].ram}</p>
                  </div>
                  <div className="bg-white/5 rounded-lg p-3 text-center">
                    <HardDrive className="h-4 w-4 text-muted-foreground mx-auto mb-1" />
                    <p className="text-xs text-muted-foreground">Storage</p>
                    <p className="text-sm font-medium">{QUICK_SPECS[selected].storage}</p>
                  </div>
                  <div className="bg-white/5 rounded-lg p-3 text-center">
                    <Network className="h-4 w-4 text-muted-foreground mx-auto mb-1" />
                    <p className="text-xs text-muted-foreground">Egress</p>
                    <p className="text-sm font-medium text-green-400">$0.00</p>
                  </div>
                </div>

                {QUICK_SPECS[selected].gpu && (
                  <p className="text-sm text-muted-foreground">
                    GPU options: <span className="text-foreground font-medium">{QUICK_SPECS[selected].gpu}</span>
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-3 sm:min-w-[180px]">
                <Button
                  className="w-full"
                  onClick={() => navigate(selectedWorkload.destination)}
                >
                  See Full Pricing <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
                {selected === "ai" && (
                  <Button
                    variant="outline"
                    className="w-full border-white/10"
                    onClick={() => navigate("/pricing/gpus")}
                  >
                    GPU Market Rates
                  </Button>
                )}
                <Button
                  variant="ghost"
                  className="w-full text-muted-foreground text-sm"
                  onClick={() => navigate("/pricing/usage")}
                >
                  Build custom estimate
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Bottom comparison teaser */}
      <div className="border-t border-white/10 pt-8 grid sm:grid-cols-3 gap-6 text-center">
        <div className="space-y-1">
          <p className="text-2xl font-bold text-green-400">34–89%</p>
          <p className="text-sm text-muted-foreground">cheaper than AWS across all workload types</p>
        </div>
        <div className="space-y-1">
          <p className="text-2xl font-bold text-green-400">$0.00</p>
          <p className="text-sm text-muted-foreground">egress fees, always, on every plan</p>
        </div>
        <div className="space-y-1">
          <p className="text-2xl font-bold text-green-400">Pay-as-you-go</p>
          <p className="text-sm text-muted-foreground">no contracts, no minimums, cancel anytime</p>
        </div>
      </div>

      <div className="text-center">
        <Button variant="outline" className="border-white/10" onClick={() => navigate("/pricing/provider")}>
          Are you a provider? Calculate your earnings →
        </Button>
      </div>
    </div>
  );
}
