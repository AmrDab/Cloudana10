import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { type Hex } from "viem";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  XCircle,
  Clock,
  ShieldCheck,
  ShieldAlert,
  Info,
  Fingerprint,
  Hash,
  AlertTriangle,
} from "lucide-react";
import {
  buildPOUWCertificate,
  formatCertForDisplay,
  checkDifficulty,
  type POUWCertificate,
} from "@/lib/pouw";
import { scanForFraudSignals } from "@/lib/antifraud";

// ─── Props ────────────────────────────────────────────────────────────────────

interface POUWStatusProps {
  jobId: Hex;
  /** Block hash when the job was assigned (for seed verification) */
  jobBlockHash?: Hex;
  /** Block number when proof was submitted (for challenge window countdown) */
  proofBlockNumber?: number;
  /** Current block number */
  currentBlock?: number;
  /** Pre-existing certificate (if already computed) */
  certificate?: POUWCertificate;
  /** Whether the connected wallet is a registered challenger */
  isChallenger?: boolean;
  /** Callback when user wants to challenge */
  onChallenge?: (jobId: Hex) => void;
  className?: string;
}

const CHALLENGE_WINDOW = 50; // blocks

// ─── Component ────────────────────────────────────────────────────────────────

export function POUWStatus({
  jobId,
  jobBlockHash,
  proofBlockNumber,
  currentBlock,
  certificate: externalCert,
  isChallenger = false,
  onChallenge,
  className,
}: POUWStatusProps) {
  const { address } = useAccount();
  const [demoCert, setDemoCert] = useState<POUWCertificate | null>(null);
  const [generating, setGenerating] = useState(false);

  const cert = externalCert ?? demoCert;

  // In demo mode, generate a sample certificate to show the UI
  const generateDemoCert = async () => {
    if (!address) return;
    setGenerating(true);
    try {
      // Use a fake block hash for demo
      const fakeBlockHash = ("0x" + jobId.slice(2, 34).padEnd(64, "a")) as Hex;
      const c = buildPOUWCertificate({
        jobId,
        blockHash: fakeBlockHash,
        chainId: 84532, // Base Sepolia
        providerAddress: address as Hex,
      });
      setDemoCert(c);
    } finally {
      setGenerating(false);
    }
  };

  // Challenge window countdown
  const blocksRemaining = proofBlockNumber != null && currentBlock != null
    ? Math.max(0, CHALLENGE_WINDOW - (currentBlock - proofBlockNumber))
    : null;
  const windowOpen = blocksRemaining == null ? false : blocksRemaining > 0;

  const formatted = cert ? formatCertForDisplay(cert) : null;

  // Fraud signals
  const fraudSignals = cert
    ? scanForFraudSignals(
        {
          seed: cert.seed,
          transcriptHash: cert.transcriptHash,
          matrixDim: cert.matrixDim,
          blockSize: cert.blockSize,
          timestamp: cert.timestamp,
        },
        []
      )
    : [];

  const hasCriticalSignal = fraudSignals.some(s => s.severity === "CRITICAL");

  return (
    <TooltipProvider>
      <Card className={cn("border-white/5 bg-card/50", className)}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Fingerprint className="h-4 w-4 text-cyan-400" />
              <span className="font-semibold text-sm">POUW Certificate</span>
            </div>
            {cert ? (
              <Badge
                className={cn(
                  "text-xs border",
                  formatted?.difficultyMet
                    ? "bg-emerald-950 text-emerald-400 border-emerald-800"
                    : "bg-red-950 text-red-400 border-red-800"
                )}
              >
                {formatted?.difficultyMet ? "✓ Verified" : "✗ Invalid"}
              </Badge>
            ) : (
              <Badge className="text-xs border bg-zinc-900 text-zinc-500 border-zinc-700">
                Pending
              </Badge>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {!cert ? (
            <div className="text-center py-4 space-y-3">
              <p className="text-xs text-muted-foreground">
                No proof submitted yet for this job.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={generateDemoCert}
                disabled={generating || !address}
                className="text-xs"
              >
                {generating ? "Generating..." : "Generate Demo Certificate"}
              </Button>
            </div>
          ) : (
            <>
              {/* Certificate Fields */}
              <div className="space-y-2">
                {/* Transcript Hash */}
                <div className="flex items-center justify-between rounded-md bg-background/40 border border-white/5 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Transcript Hash</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-cyan-400">
                      {formatted?.transcriptHash}
                    </span>
                    {formatted?.difficultyMet
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                      : <XCircle className="h-3.5 w-3.5 text-red-400" />
                    }
                  </div>
                </div>

                {/* Seed */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center justify-between rounded-md bg-background/40 border border-white/5 px-3 py-2 cursor-help">
                      <div className="flex items-center gap-2">
                        <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">Seed</span>
                        <Info className="h-3 w-3 text-muted-foreground/50" />
                      </div>
                      <span className="font-mono text-xs text-purple-400">{formatted?.seed}</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-64 text-xs">
                    <p className="font-semibold mb-1">Replay Attack Prevention</p>
                    <p>
                      Seed = keccak256(jobId + blockHash + chainId). Unique per job, so a
                      previously computed transcript is useless for any other job. This
                      implements σ-freshness from the POUW paper (§5).
                    </p>
                  </TooltipContent>
                </Tooltip>

                {/* Matrix Dimensions */}
                <div className="flex items-center justify-between rounded-md bg-background/40 border border-white/5 px-3 py-2">
                  <span className="text-xs text-muted-foreground">Matrix / Block Size</span>
                  <span className="font-mono text-xs text-zinc-300">
                    {formatted?.matrixDim} × r={formatted?.blockSize}
                  </span>
                </div>

                {/* Result Hash */}
                <div className="flex items-center justify-between rounded-md bg-background/40 border border-white/5 px-3 py-2">
                  <span className="text-xs text-muted-foreground">Result Hash</span>
                  <span className="font-mono text-xs text-zinc-400">{formatted?.resultHash}</span>
                </div>

                {/* Timestamp */}
                <div className="flex items-center justify-between rounded-md bg-background/40 border border-white/5 px-3 py-2">
                  <span className="text-xs text-muted-foreground">Generated</span>
                  <span className="text-xs text-zinc-400">{formatted?.timestamp}</span>
                </div>
              </div>

              {/* Difficulty Indicator */}
              <div
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-xs",
                  formatted?.difficultyMet
                    ? "bg-emerald-950/30 border border-emerald-900/40 text-emerald-400"
                    : "bg-red-950/30 border border-red-900/40 text-red-400"
                )}
              >
                {formatted?.difficultyMet
                  ? <CheckCircle2 className="h-4 w-4 shrink-0" />
                  : <XCircle className="h-4 w-4 shrink-0" />
                }
                <span>
                  {formatted?.difficultyMet
                    ? "Difficulty target met. Proof of work valid"
                    : "Difficulty target NOT met. This proof is invalid"
                  }
                </span>
              </div>

              {/* Fraud Signals */}
              {fraudSignals.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 text-yellow-400" />
                    Fraud Signals Detected
                  </div>
                  {fraudSignals.map((signal, i) => (
                    <div
                      key={i}
                      className={cn(
                        "rounded px-2.5 py-1.5 text-xs border",
                        signal.severity === "CRITICAL"
                          ? "bg-red-950/50 border-red-800/50 text-red-400"
                          : signal.severity === "HIGH"
                          ? "bg-orange-950/50 border-orange-800/50 text-orange-400"
                          : "bg-yellow-950/50 border-yellow-800/50 text-yellow-400"
                      )}
                    >
                      <span className="font-semibold">[{signal.severity}]</span> {signal.description}
                    </div>
                  ))}
                </div>
              )}

              {/* Challenge Window */}
              <div
                className={cn(
                  "flex items-center justify-between rounded-md px-3 py-2 text-xs border",
                  windowOpen
                    ? "bg-cyan-950/20 border-cyan-900/30"
                    : "bg-background/30 border-white/5"
                )}
              >
                <div className="flex items-center gap-2">
                  <Clock className={cn("h-3.5 w-3.5", windowOpen ? "text-cyan-400" : "text-zinc-600")} />
                  <span className={windowOpen ? "text-cyan-300" : "text-muted-foreground"}>
                    Challenge Window
                  </span>
                </div>
                <span className={cn("font-mono font-medium", windowOpen ? "text-cyan-400" : "text-zinc-600")}>
                  {blocksRemaining != null
                    ? windowOpen
                      ? `${blocksRemaining} blocks remaining`
                      : "Closed"
                    : proofBlockNumber
                    ? "Calculating..."
                    : "Not submitted"
                  }
                </span>
              </div>

              {/* Challenge Button */}
              {isChallenger && windowOpen && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => onChallenge?.(jobId)}
                  className="w-full text-xs gap-2"
                >
                  <ShieldAlert className="h-3.5 w-3.5" />
                  Challenge This Proof
                </Button>
              )}

              {isChallenger && !windowOpen && proofBlockNumber && (
                <div className="text-center text-xs text-muted-foreground py-1">
                  Challenge window has closed for this proof.
                </div>
              )}

              {!isChallenger && windowOpen && (
                <div className="text-center text-xs text-muted-foreground py-1">
                  Register as a challenger to dispute proofs and earn rewards.
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
