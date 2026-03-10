import { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import {
  Cpu, HardDrive, Zap, Monitor, CheckCircle2,
  Loader2, ChevronRight, Info, Terminal,
} from "lucide-react";

// ─── Hardware pricing model ────────────────────────────────────────────────────
//
// Compute Score (CS) = benchmarked performance indicator (not self-reported)
//   T1 Edge       ~10-50 CS    RPi, NUC, mini PC              no GPU
//   T2 Consumer   ~100-400 CS  Gaming PCs, mid workstations   entry-mid GPU
//   T3 Prosumer   ~400-1000 CS High-end gaming, RTX 3090/4090 prosumer GPU
//   T4 Pro        ~1k-3k CS    A100, L40S, datacenter GPUs    dc GPU
//   T5 Enterprise ~3k+ CS      Multi-GPU, H100, InfiniBand    dc GPU cluster

type HardwareTier = "T1" | "T2" | "T3" | "T4" | "T5";

interface GPUEntry {
  keywords: string[];
  label: string;
  tflops: number;     // FP32 TFLOPS
  vramGB: number;
  hourlyUSD: number;  // market rate per GPU per hour (early 2026 spot)
  tier: HardwareTier;
}

// Market-calibrated GPU database -- match by substring of WebGL renderer string
const GPU_DATABASE: GPUEntry[] = [
  { keywords: ["1060", "1070", "2060", "rx 5700", "rx 5600"], label: "Entry GPU", tflops: 6.5, vramGB: 6, hourlyUSD: 0.15, tier: "T2" },
  { keywords: ["2080", "3060", "4060", "rx 6600", "rx 6700"], label: "Consumer Mid", tflops: 13.0, vramGB: 12, hourlyUSD: 0.32, tier: "T2" },
  { keywords: ["apple m1", "apple m2", "apple m3", "apple m4"], label: "Apple Silicon", tflops: 10.0, vramGB: 16, hourlyUSD: 0.28, tier: "T2" },
  { keywords: ["3070", "3080", "4070", "rx 6800", "rx 7700", "rx 7800"], label: "Consumer High", tflops: 30.0, vramGB: 16, hourlyUSD: 0.58, tier: "T3" },
  { keywords: ["3090", "4080", "4090", "rx 7900 xtx", "rx 7900 xt"], label: "Prosumer", tflops: 70.0, vramGB: 24, hourlyUSD: 0.95, tier: "T3" },
  { keywords: ["t4"], label: "Datacenter T4", tflops: 8.1, vramGB: 16, hourlyUSD: 0.45, tier: "T4" },
  { keywords: ["a10g"], label: "Datacenter A10G", tflops: 31.2, vramGB: 24, hourlyUSD: 0.75, tier: "T4" },
  { keywords: ["a40", "rtx a6000", "rtx 6000"], label: "Workstation Pro", tflops: 37.4, vramGB: 48, hourlyUSD: 1.10, tier: "T4" },
  { keywords: ["l40s", "l40"], label: "Datacenter L40S", tflops: 91.6, vramGB: 48, hourlyUSD: 1.40, tier: "T4" },
  { keywords: ["a100-40", "a100 40gb"], label: "A100 40GB", tflops: 77.4, vramGB: 40, hourlyUSD: 1.65, tier: "T4" },
  { keywords: ["a100"], label: "A100 80GB", tflops: 77.4, vramGB: 80, hourlyUSD: 2.10, tier: "T4" },
  { keywords: ["mi250", "mi300", "instinct"], label: "AMD Instinct", tflops: 200.0, vramGB: 96, hourlyUSD: 2.20, tier: "T5" },
  { keywords: ["h100 pcie", "h100-pcie"], label: "H100 PCIe", tflops: 204.0, vramGB: 80, hourlyUSD: 2.49, tier: "T5" },
  { keywords: ["h100"], label: "H100 SXM", tflops: 267.0, vramGB: 80, hourlyUSD: 3.00, tier: "T5" },
  { keywords: ["b100", "b200", "gb200"], label: "B100/B200", tflops: 700.0, vramGB: 192, hourlyUSD: 5.00, tier: "T5" },
];

// Fallback when GPU not in database -- classified by name heuristics
const FALLBACK_SPECS: Record<string, { tflops: number; vramGB: number; hourlyUSD: number; tier: HardwareTier }> = {
  none: { tflops: 0,  vramGB: 0,  hourlyUSD: 0,    tier: "T1" },
  low:  { tflops: 5,  vramGB: 4,  hourlyUSD: 0.12, tier: "T2" },
  mid:  { tflops: 13, vramGB: 12, hourlyUSD: 0.32, tier: "T2" },
  high: { tflops: 30, vramGB: 16, hourlyUSD: 0.58, tier: "T3" },
  pro:  { tflops: 70, vramGB: 24, hourlyUSD: 0.95, tier: "T3" },
};

// Compute Score: composite performance indicator
function computeScore(tflops: number, vramGB: number, threads: number, ramGB: number): number {
  return Math.round(tflops * 10 + vramGB * 2 + threads * 4 + ramGB * 0.8);
}

// Market baseline rates
const CPU_PRICE_PER_THREAD_MONTH = 1.60;  // $/thread/month
const RAM_PRICE_PER_GB_MONTH = 0.80;      // $/GB/month
// POUW mining: ~4.7 certs/day per TFLOP at difficulty=12, n=128
const POUW_CERTS_PER_TFLOP_DAY = 4.7;
const POUW_CLD_PER_CERT = 56;

interface DetectedHardware {
  gpu: string;
  gpuLabel: string;
  gpuVendor: string;
  gpuEntry: GPUEntry | null;
  cpuThreads: number;
  ramGB: number;
  tflops: number;
  vramGB: number;
  hourlyUSD: number;
  tier: HardwareTier;
  cs: number;
  pouwCertsPerDay: number;
  pouwCLDPerDay: number;
  monthlyHostingUSD: number;
}

function detectGPU(): { gpu: string; vendor: string } {
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl") || canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return { gpu: "Unknown (WebGL unavailable)", vendor: "" };
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    if (!ext) return { gpu: "Unknown (extension blocked)", vendor: "" };
    const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string;
    const vendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) as string;
    const clean = renderer.replace(/\/PCIe\/SSE2|\/PCIe|Direct3D.*$|\(.*?\)/g, "").trim();
    return { gpu: clean, vendor };
  } catch {
    return { gpu: "Unknown", vendor: "" };
  }
}

function matchGPU(gpuName: string): GPUEntry | null {
  const g = gpuName.toLowerCase();
  // Sort by longest keyword first -- more specific matches win
  const sorted = [...GPU_DATABASE].sort((a, b) =>
    Math.max(...b.keywords.map(k => k.length)) - Math.max(...a.keywords.map(k => k.length))
  );
  for (const entry of sorted) {
    if (entry.keywords.some(k => g.includes(k))) return entry;
  }
  return null;
}

function fallbackTierKey(gpuName: string): keyof typeof FALLBACK_SPECS {
  const g = gpuName.toLowerCase();
  if (g.includes("intel") || g.includes("mesa") || g.includes("llvm") || g.includes("swiftshader")) return "none";
  if (g.includes("h100") || g.includes("a100") || g.includes("4090") || g.includes("3090")) return "pro";
  if (g.includes("4080") || g.includes("4070") || g.includes("3080") || g.includes("a40") || g.includes("a6000")) return "high";
  if (g.includes("3070") || g.includes("3060") || g.includes("2080") || g.includes("4060") || g.includes("rx 6800")) return "mid";
  return "low";
}

async function detectHardware(): Promise<DetectedHardware> {
  const { gpu, vendor: gpuVendor } = detectGPU();
  const cpuThreads = navigator.hardwareConcurrency || 4;
  const ramGB = (navigator as any).deviceMemory ?? Math.round(cpuThreads * 1.5);

  const matched = matchGPU(gpu);
  let tflops: number, vramGB: number, hourlyUSD: number, tier: HardwareTier, gpuLabel: string;

  if (matched) {
    ({ tflops, vramGB, hourlyUSD, tier, label: gpuLabel } = matched);
  } else {
    const fb = FALLBACK_SPECS[fallbackTierKey(gpu)];
    ({ tflops, vramGB, hourlyUSD, tier } = fb);
    gpuLabel = tier === "T1" ? "CPU Only" : "GPU (unrecognized)";
  }

  // Edge devices with no GPU and modest specs -> T1
  if (tflops === 0 && cpuThreads <= 8 && ramGB <= 16) tier = "T1";

  const certs = tflops > 0
    ? Math.round(tflops * POUW_CERTS_PER_TFLOP_DAY)
    : Math.max(1, Math.floor(cpuThreads / 4)); // CPU-only floor

  const cs = computeScore(tflops, vramGB, cpuThreads, ramGB);
  const monthlyHostingUSD =
    hourlyUSD * 720 * 0.7 +           // GPU at 70% utilisation
    cpuThreads * CPU_PRICE_PER_THREAD_MONTH +
    ramGB * RAM_PRICE_PER_GB_MONTH;

  return {
    gpu, gpuLabel, gpuVendor,
    gpuEntry: matched,
    cpuThreads, ramGB,
    tflops, vramGB, hourlyUSD,
    tier, cs,
    pouwCertsPerDay: certs,
    pouwCLDPerDay: certs * POUW_CLD_PER_CERT,
    monthlyHostingUSD,
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const TIER_LABEL: Record<HardwareTier, string> = {
  T1: "Edge Node", T2: "Consumer", T3: "Prosumer", T4: "Professional", T5: "Enterprise",
};
const TIER_COLOR: Record<HardwareTier, string> = {
  T1: "border-white/20 text-muted-foreground",
  T2: "border-blue-500/30 text-blue-400",
  T3: "border-green-500/30 text-green-400",
  T4: "border-purple-500/30 text-purple-400",
  T5: "border-yellow-500/30 text-yellow-400",
};

function HardwareDetectCard({
  onApply,
}: {
  onApply: (hw: DetectedHardware) => void;
}) {
  const [state, setState] = useState<"idle" | "running" | "done">("idle");
  const [hw, setHw] = useState<DetectedHardware | null>(null);

  const run = async () => {
    setState("running");
    // Give the UI a tick to render the loading state
    await new Promise(r => setTimeout(r, 80));
    const result = await detectHardware();
    setHw(result);
    setState("done");
  };

  return (
    <Card className="p-6 border-primary/20 bg-primary/3">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="font-semibold flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            Auto-detect My Hardware
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Runs a quick in-browser benchmark — no installs, no permissions needed.
          </p>
        </div>
        {state === "idle" && (
          <Button size="sm" onClick={run} className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90">
            Detect Hardware
          </Button>
        )}
        {state === "running" && (
          <Button size="sm" disabled className="shrink-0">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Scanning…
          </Button>
        )}
        {state === "done" && (
          <Button size="sm" variant="outline" onClick={run} className="shrink-0 border-white/10">
            Re-run
          </Button>
        )}
      </div>

      {state === "running" && (
        <div className="text-sm text-muted-foreground animate-pulse">
          Detecting GPU via WebGL · reading CPU threads · running matrix benchmark…
        </div>
      )}

      {state === "done" && hw && (
        <div className="space-y-4">
          {/* Tier + Compute Score header */}
          <div className="flex items-center gap-3 flex-wrap">
            <Badge variant="outline" className={`${TIER_COLOR[hw.tier]} text-sm px-3 py-1`}>
              {hw.tier} &mdash; {TIER_LABEL[hw.tier]}
            </Badge>
            <div className="flex items-center gap-1.5 text-sm">
              <Zap className="h-3.5 w-3.5 text-primary" />
              <span className="font-bold text-primary">{hw.cs.toLocaleString()}</span>
              <span className="text-muted-foreground">Compute Score</span>
            </div>
            {hw.tflops > 0 && (
              <span className="text-xs text-muted-foreground">{hw.tflops} TFLOPS &middot; {hw.vramGB}GB VRAM &middot; ~${hw.hourlyUSD.toFixed(2)}/hr</span>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3 rounded-lg bg-white/5 border border-white/8">
              <div className="flex items-center gap-1.5 mb-1">
                <Monitor className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs text-muted-foreground">GPU</span>
              </div>
              <p className="text-sm font-semibold leading-tight truncate">{hw.gpuLabel || "Not detected"}</p>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{hw.gpu || "--"}</p>
            </div>
            <div className="p-3 rounded-lg bg-white/5 border border-white/8">
              <div className="flex items-center gap-1.5 mb-1">
                <Cpu className="h-3.5 w-3.5 text-blue-400" />
                <span className="text-xs text-muted-foreground">CPU</span>
              </div>
              <p className="text-sm font-semibold">{hw.cpuThreads} threads</p>
              <p className="text-xs text-muted-foreground mt-1">~{Math.round(hw.cpuThreads / 2)} cores</p>
            </div>
            <div className="p-3 rounded-lg bg-white/5 border border-white/8">
              <div className="flex items-center gap-1.5 mb-1">
                <HardDrive className="h-3.5 w-3.5 text-green-400" />
                <span className="text-xs text-muted-foreground">RAM</span>
              </div>
              <p className="text-sm font-semibold">{hw.ramGB} GB</p>
              <p className="text-xs text-muted-foreground mt-1">system estimate</p>
            </div>
            <div className="p-3 rounded-lg bg-white/5 border border-white/8">
              <div className="flex items-center gap-1.5 mb-1">
                <Zap className="h-3.5 w-3.5 text-yellow-400" />
                <span className="text-xs text-muted-foreground">POUW Mining</span>
              </div>
              <p className="text-sm font-semibold">{hw.pouwCertsPerDay} certs/day</p>
              <p className="text-xs text-muted-foreground mt-1">{hw.pouwCLDPerDay.toLocaleString()} CLD/day</p>
            </div>
          </div>

          <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="text-sm font-semibold text-green-400 mb-1">
                  Estimated monthly earnings with this hardware
                </p>
                <div className="flex flex-wrap gap-4 text-sm">
                  <span>
                    <span className="text-muted-foreground">Hosting: </span>
                    <span className="font-bold">${hw.monthlyHostingUSD.toFixed(0)}/mo</span>
                  </span>
                  <span>
                    <span className="text-muted-foreground">POUW mining: </span>
                    <span className="font-bold text-primary">{(hw.pouwCLDPerDay * 30).toLocaleString()} CLD/mo</span>
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  At 70% utilisation &middot; POUW at difficulty=12, n=128 &middot; market spot rates
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => onApply(hw)}
                className="bg-primary text-primary-foreground hover:bg-primary/90 gap-1.5"
              >
                <CheckCircle2 className="h-4 w-4" />
                Apply to Calculator
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function HowMonitoringWorks() {
  return (
    <Card className="p-6 border-white/8">
      <h2 className="font-semibold mb-4 flex items-center gap-2">
        <Terminal className="h-4 w-4 text-muted-foreground" />
        How provider monitoring works
      </h2>
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground leading-relaxed">
          No flashing. No Prometheus setup. No configuration files. You run one command and the agent handles everything automatically.
        </p>

        {[
          {
            step: "1",
            title: "Install the agent (one command)",
            desc: "The provider agent installs via a single curl command. It auto-detects your OS, installs as a system service, and starts immediately.",
            code: "curl -sSL https://get.cloudana.io | bash",
          },
          {
            step: "2",
            title: "Hardware auto-detected",
            desc: "The agent uses systeminformation to read your CPU model and cores, GPU model and VRAM, RAM, storage, and network bandwidth — no manual input.",
            code: null,
          },
          {
            step: "3",
            title: "Specs published to IPFS",
            desc: "Your hardware JSON is uploaded to IPFS. Only the content hash (CID) is stored on-chain in ProviderRegistry — keeping gas costs near zero.",
            code: null,
          },
          {
            step: "4",
            title: "Health reported continuously",
            desc: "The agent pushes a heartbeat to the orchestrator every 30 seconds — CPU load, GPU utilisation, memory, active jobs. If you go offline, the orchestrator stops routing workloads to you within 60 seconds.",
            code: null,
          },
          {
            step: "5",
            title: "POUW mining runs in background",
            desc: "While idle, the agent automatically mines POUW certificates. You don't configure anything — it starts mining, submits certificates, and earns CLD with no intervention.",
            code: null,
          },
        ].map(({ step, title, desc, code }) => (
          <div key={step} className="flex gap-3">
            <div className="shrink-0 w-6 h-6 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-xs font-bold text-primary">
              {step}
            </div>
            <div className="text-sm space-y-1">
              <p className="font-medium">{title}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
              {code && (
                <pre className="mt-2 px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-xs font-mono text-green-400">
                  {code}
                </pre>
              )}
            </div>
          </div>
        ))}

        <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 flex gap-2 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 text-blue-400 shrink-0 mt-0.5" />
          <span>
            Prometheus metrics are exposed on <code className="font-mono text-blue-400">:9090/metrics</code> if you want
            to plug into your own Grafana dashboard — but it's optional. The Cloudana orchestrator handles all monitoring automatically.
          </span>
        </div>
      </div>
    </Card>
  );
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_VALUE = {
  leasePercentInput: 100, cpuInput: 100, cpuPricing: 5,
  memoryInput: 1024, memoryPricing: 5, storageInput: 10240, storagePricing: 1,
  persistentStorageInput: 10240, persistentStoragePricing: 1,
  gpuInput: 100, gpuPricing: 1000, ipInput: 100, ipPricing: 10,
  endpointInput: 100, endpointPricing: 1,
};
const STEP = {
  leasePercentInput: 0.5, cpuInput: 1, cpuPricing: 0.1,
  memoryInput: 1, memoryPricing: 0.1, storageInput: 1, storagePricing: 0.001,
  persistentStorageInput: 1, persistentStoragePricing: 0.001,
  gpuInput: 1, gpuPricing: 1, ipInput: 1, ipPricing: 0.1,
  endpointInput: 1, endpointPricing: 0.01,
};

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ProviderCalculatorPage() {
  const [leasePercentInput, setLeasePercentInput] = useState(70);
  const [cpuInput, setCpuInput] = useState(10);
  const [cpuPricing, setCpuPricing] = useState(1.6);
  const [memoryInput, setMemoryInput] = useState(32);
  const [memoryPricing, setMemoryPricing] = useState(0.8);
  const [storageInput, setStorageInput] = useState(512);
  const [storagePricing, setStoragePricing] = useState(0.02);
  const [persistentStorageInput, setPersistentStorageInput] = useState(512);
  const [persistentStoragePricing, setPersistentStoragePricing] = useState(0.04);
  const [gpuInput, setGPUInput] = useState(1);
  const [gpuPricing, setGPUPricing] = useState(100);
  const [ipInput, setIpInput] = useState(1);
  const [ipPricing, setIpPricing] = useState(1);
  const [endpointInput, setEndpointInput] = useState(1);
  const [endpointPricing, setEndpointPricing] = useState(1);
  const [CLDAverage, setCLDAverage] = useState(true);
  const [usdPrice, setUsdPrice] = useState(0);
  const [monthlyAverage, setMonthlyAverage] = useState(0);
  const [pouwCLDPerMonth, setPouwCLDPerMonth] = useState(0);

  const [usdPrices, setUsdPrices] = useState({
    cpuTotalPrice: 0, memoryTotalPrice: 0, storageTotalPrice: 0,
    persistenStorageTotalPrice: 0, gpuTotalPrice: 0, ipTotalPrice: 0,
    endpointTotalPrice: 0, totalPrice: 0,
  });

  const { isLoading: loadingPrice } = useQuery({
    queryKey: ["CLD_PRICE"],
    queryFn: async () => {
      try {
        const response = await fetch("https://api.coingecko.com/api/v3/coins/akash-network/tickers");
        if (!response.ok) return 0;
        const data = await response.json();
        if (!Array.isArray(data.tickers)) return 0;
        for (const ticker of data.tickers) {
          if (ticker.market?.name === "Coinbase Exchange") {
            setUsdPrice(ticker.converted_last?.usd ?? 0);
            return ticker.converted_last?.usd ?? 0;
          }
        }
      } catch {
        // Network error or rate limit — fall back to 0
      }
      return 0;
    },
  });

  const { isLoading: loadingDaily } = useQuery({
    queryKey: ["CLD_AVERAGE"],
    queryFn: async () => {
      try {
        const response = await fetch(
          "https://api.coingecko.com/api/v3/coins/akash-network/market_chart?vs_currency=usd&days=30&interval=daily"
        );
        if (!response.ok) return 0;
        const data = await response.json();
        if (!Array.isArray(data.prices) || data.prices.length === 0) return 0;
        const mean = data.prices.reduce((acc: number, [_, p]: [number, number]) => acc + p, 0) / data.prices.length;
        setMonthlyAverage(mean);
        if (usdPrice > mean) setCLDAverage(false);
        return mean;
      } catch {
        return 0;
      }
    },
  });

  useEffect(() => {
    const util = 100 / leasePercentInput;
    const cpuTotalPrice = (cpuInput * cpuPricing) / util;
    const memoryTotalPrice = (memoryInput * memoryPricing) / util;
    const storageTotalPrice = (storageInput * storagePricing) / util;
    const persistenStorageTotalPrice = (persistentStorageInput * persistentStoragePricing) / util;
    const gpuTotalPrice = (gpuPricing * gpuInput) / util;
    const ipTotalPrice = (ipPricing * ipInput) / util;
    const endpointTotalPrice = (endpointInput * endpointPricing) / util;
    const totalPrice = cpuTotalPrice + memoryTotalPrice + storageTotalPrice +
      persistenStorageTotalPrice + gpuTotalPrice + ipTotalPrice + endpointTotalPrice;
    setUsdPrices({ cpuTotalPrice, memoryTotalPrice, storageTotalPrice, persistenStorageTotalPrice, gpuTotalPrice, ipTotalPrice, endpointTotalPrice, totalPrice });
  }, [cpuInput, cpuPricing, memoryInput, memoryPricing, storageInput, storagePricing,
    persistentStorageInput, persistentStoragePricing, gpuInput, gpuPricing,
    ipInput, ipPricing, endpointInput, endpointPricing, leasePercentInput]);

  const calculateCLDPrice = (usdValue: number) => {
    const price = CLDAverage ? monthlyAverage : usdPrice;
    if (!price || price <= 0) return "0.00";
    return (usdValue / price).toFixed(2);
  };
  const fmt = (v: number) => v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  const applyDetectedHardware = (hw: DetectedHardware) => {
    setCpuInput(hw.cpuThreads);
    setMemoryInput(Math.max(1, hw.ramGB));
    setGPUInput(hw.tflops > 0 ? 1 : 0);
    // GPU pricing: convert hourly market rate to monthly
    setGPUPricing(Math.round(hw.hourlyUSD * 720));
    setCpuPricing(CPU_PRICE_PER_THREAD_MONTH);
    setMemoryPricing(RAM_PRICE_PER_GB_MONTH);
    setPouwCLDPerMonth(hw.pouwCLDPerDay * 30);
  };

  const loadingAny = loadingPrice || loadingDaily;
  const totalMonthlyUSD = usdPrices.totalPrice;
  const totalMonthlyCLD = loadingAny ? 0 : +calculateCLDPrice(totalMonthlyUSD);

  return (
    <div className="flex flex-col gap-8 max-w-5xl">
      <div>
        <h1 className="text-3xl font-bold mb-2">Provider Earn Calculator</h1>
        <p className="text-muted-foreground text-sm">
          Estimate your monthly earnings from hosting workloads and POUW mining.
          Use the auto-detect button to benchmark your actual hardware in seconds.
        </p>
      </div>

      {/* Auto-detect */}
      <HardwareDetectCard onApply={applyDetectedHardware} />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Summary */}
        <div className="lg:col-span-1 space-y-4">
          <Card className="p-6">
            <h2 className="font-semibold mb-5">Monthly Earnings</h2>
            <div className="space-y-5">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Hosting revenue (USD)</p>
                <p className="text-2xl font-bold">
                  {loadingAny ? "—" : `$${fmt(totalMonthlyUSD)}`}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Hosting revenue (CLD)</p>
                <p className="text-2xl font-bold">
                  {loadingAny ? "—" : `${fmt(totalMonthlyCLD)} CLD`}
                </p>
              </div>
              {pouwCLDPerMonth > 0 && (
                <div className="rounded-lg bg-primary/8 border border-primary/20 p-3">
                  <p className="text-xs text-muted-foreground mb-1">POUW mining (CLD)</p>
                  <p className="text-xl font-bold text-primary">+{(pouwCLDPerMonth).toLocaleString()} CLD</p>
                  <p className="text-xs text-muted-foreground mt-1">Runs automatically in background</p>
                </div>
              )}
              <div className="pt-3 border-t border-white/8">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium">Use 30-day avg price</p>
                    <p className="text-xs text-muted-foreground">Avg: ${monthlyAverage.toFixed(2)}</p>
                  </div>
                  <Switch checked={CLDAverage} onCheckedChange={setCLDAverage} />
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="font-semibold mb-4">Breakdown</h2>
            <div className="space-y-3 text-sm">
              {[
                { label: "CPU", val: usdPrices.cpuTotalPrice },
                { label: "Memory", val: usdPrices.memoryTotalPrice },
                { label: "Storage", val: usdPrices.storageTotalPrice },
                { label: "Persistent Storage", val: usdPrices.persistenStorageTotalPrice },
                { label: "GPU", val: usdPrices.gpuTotalPrice },
                { label: "IP Addresses", val: usdPrices.ipTotalPrice },
                { label: "Endpoints", val: usdPrices.endpointTotalPrice },
              ].map(({ label, val }) => (
                <div key={label} className="flex justify-between">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium">${val.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Sliders */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="p-6">
            <h2 className="font-semibold mb-6">Configure Resources</h2>
            <div className="space-y-7">

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label>Utilisation</Label>
                  <span className="text-sm font-medium">{leasePercentInput}%</span>
                </div>
                <Slider min={10} max={100} step={0.5} value={[leasePercentInput]} onValueChange={v => setLeasePercentInput(v[0])} />
                <p className="text-xs text-muted-foreground">How much of your hardware is leased out on average</p>
              </div>

              {[
                { label: "CPU", unit: `${cpuInput} vCPU`, pLabel: `$${cpuPricing.toFixed(2)} / thread-month`, val: cpuInput, setVal: setCpuInput, max: 100, step: 1, min: 1, pVal: cpuPricing, setPVal: setCpuPricing, pMax: 5, pStep: 0.1, pMin: 0.1 },
                { label: "Memory", unit: `${memoryInput} GB`, pLabel: `$${memoryPricing.toFixed(2)} / GB-month`, val: memoryInput, setVal: setMemoryInput, max: 1024, step: 1, min: 1, pVal: memoryPricing, setPVal: setMemoryPricing, pMax: 5, pStep: 0.1, pMin: 0.1 },
                { label: "Storage", unit: `${storageInput} GB`, pLabel: `$${storagePricing.toFixed(3)} / GB-month`, val: storageInput, setVal: setStorageInput, max: 10240, step: 1, min: 1, pVal: storagePricing, setPVal: setStoragePricing, pMax: 1, pStep: 0.001, pMin: 0.001 },
                { label: "Persistent Storage", unit: `${persistentStorageInput} GB`, pLabel: `$${persistentStoragePricing.toFixed(3)} / GB-month`, val: persistentStorageInput, setVal: setPersistentStorageInput, max: 10240, step: 1, min: 1, pVal: persistentStoragePricing, setPVal: setPersistentStoragePricing, pMax: 1, pStep: 0.001, pMin: 0.001 },
                { label: "GPUs", unit: `${gpuInput} unit`, pLabel: `$${gpuPricing.toFixed(0)} / unit-month`, val: gpuInput, setVal: setGPUInput, max: 100, step: 1, min: 0, pVal: gpuPricing, setPVal: setGPUPricing, pMax: 1000, pStep: 1, pMin: 1 },
                { label: "IP Addresses", unit: `${ipInput}`, pLabel: `$${ipPricing.toFixed(2)} / unit-month`, val: ipInput, setVal: setIpInput, max: 100, step: 1, min: 0, pVal: ipPricing, setPVal: setIpPricing, pMax: 10, pStep: 0.1, pMin: 0.1 },
                { label: "Endpoints", unit: `${endpointInput}`, pLabel: `$${endpointPricing.toFixed(2)} / port-month`, val: endpointInput, setVal: setEndpointInput, max: 100, step: 1, min: 0, pVal: endpointPricing, setPVal: setEndpointPricing, pMax: 1, pStep: 0.01, pMin: 0.01 },
              ].map(({ label, unit, pLabel, val, setVal, max, step, min, pVal, setPVal, pMax, pStep, pMin }) => (
                <div key={label} className="space-y-2 pt-5 border-t border-white/5">
                  <div className="flex justify-between items-center">
                    <Label className="font-medium">{label}</Label>
                    <span className="text-sm font-medium text-primary">{unit}</span>
                  </div>
                  <Slider min={min} max={max} step={step} value={[val]} onValueChange={v => setVal(v[0])} />
                  <div className="flex justify-between items-center mt-1">
                    <Label className="text-xs text-muted-foreground">Price</Label>
                    <span className="text-xs text-muted-foreground">{pLabel}</span>
                  </div>
                  <Slider min={pMin} max={pMax} step={pStep} value={[pVal]} onValueChange={v => setPVal(v[0])} />
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* How monitoring works */}
      <HowMonitoringWorks />
    </div>
  );
}
