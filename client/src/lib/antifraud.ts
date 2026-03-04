/**
 * antifraud.ts — Anti-fraud utilities for Cloudana
 *
 * Covers:
 *  - Hardware fingerprinting (Sybil prevention)
 *  - Challenger selection verification
 *  - Replay attack detection
 *  - Fraud pattern detection
 */

import { keccak256, encodePacked, type Hex } from "viem";

// ─── Hardware Fingerprinting (Sybil Prevention) ───────────────────────────────

/**
 * Generate a hardware fingerprint from browser signals.
 *
 * In the browser, we collect available hardware signals. In the real provider
 * node software, this uses actual hardware IDs: CPU serial, GPU UUID, MAC addr.
 *
 * The fingerprint is submitted to ProviderRegistry.setHardwareFingerprint()
 * and is unique per physical machine — prevents one machine registering
 * under multiple wallets (Sybil attack).
 *
 * @returns keccak256 hash of hardware signals as bytes32 hex
 */
export async function generateHardwareFingerprint(): Promise<Hex> {
  const signals: string[] = [];

  // CPU / threading
  signals.push(`cpu:${navigator.hardwareConcurrency}`);

  // Screen
  signals.push(`screen:${screen.width}x${screen.height}x${screen.colorDepth}`);

  // Platform
  signals.push(`platform:${navigator.platform}`);
  signals.push(`lang:${navigator.language}`);

  // Timezone
  signals.push(`tz:${Intl.DateTimeFormat().resolvedOptions().timeZone}`);

  // WebGL GPU fingerprint
  const gpuInfo = getWebGLFingerprint();
  signals.push(`gpu:${gpuInfo}`);

  // Canvas fingerprint
  const canvasHash = await getCanvasFingerprint();
  signals.push(`canvas:${canvasHash}`);

  // Audio fingerprint
  const audioHash = await getAudioFingerprint();
  signals.push(`audio:${audioHash}`);

  const combined = signals.join("|");
  const encoded = new TextEncoder().encode(combined);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const hashArray = new Uint8Array(hashBuffer);
  const hashHex = ("0x" + Array.from(hashArray).map(b => b.toString(16).padStart(2, "0")).join("")) as Hex;

  return hashHex as Hex;
}

function getWebGLFingerprint(): string {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl") as WebGLRenderingContext | null;
    if (!gl) return "no-webgl";

    const ext = (gl as WebGLRenderingContext).getExtension("WEBGL_debug_renderer_info");
    if (!ext) return "no-debug-ext";

    const renderer = (gl as WebGLRenderingContext).getParameter(ext.UNMASKED_RENDERER_WEBGL);
    const vendor = (gl as WebGLRenderingContext).getParameter(ext.UNMASKED_VENDOR_WEBGL);
    return `${vendor}::${renderer}`;
  } catch {
    return "webgl-error";
  }
}

async function getCanvasFingerprint(): Promise<string> {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 50;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "no-canvas";

    ctx.textBaseline = "top";
    ctx.font = "14px Arial";
    ctx.fillStyle = "#f60";
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = "#069";
    ctx.fillText("Cloudana POUW", 2, 15);
    ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
    ctx.fillText("Cloudana POUW", 4, 17);

    const dataUrl = canvas.toDataURL();
    const encoded = new TextEncoder().encode(dataUrl);
    const hash = await crypto.subtle.digest("SHA-256", encoded);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
  } catch {
    return "canvas-error";
  }
}

async function getAudioFingerprint(): Promise<string> {
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return "no-audio";

    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const analyser = ctx.createAnalyser();
    const gain = ctx.createGain();

    gain.gain.value = 0;
    oscillator.connect(analyser);
    analyser.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(0);

    const data = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(data);
    oscillator.stop();
    await ctx.close();

    const sum = data.slice(0, 10).reduce((a, b) => a + Math.abs(b), 0);
    return sum.toFixed(6);
  } catch {
    return "audio-error";
  }
}

// ─── Challenger Selection Verification ────────────────────────────────────────

/**
 * Verify which challenger is mandated for a given job.
 *
 * Mirrors the on-chain logic in ChallengeManager.sol:
 *   idx = keccak256(jobId, prevRandao) % challengerList.length
 *
 * This allows any party to independently verify the selection was fair
 * and not manipulated.
 *
 * @param jobId          The job ID
 * @param prevRandao     block.prevrandao value from the proof submission block
 * @param challengerList Ordered list of registered challenger addresses
 * @returns The mandated challenger address
 */
export function verifyChallengerSelection(
  jobId: Hex,
  prevRandao: Hex,
  challengerList: Hex[]
): Hex {
  if (challengerList.length === 0) throw new Error("No challengers registered");

  const hash = keccak256(encodePacked(["bytes32", "bytes32"], [jobId, prevRandao]));
  const idx = Number(BigInt(hash) % BigInt(challengerList.length));
  return challengerList[idx];
}

// ─── Replay Attack Detection ──────────────────────────────────────────────────

/**
 * Check if a POUW certificate seed has been used before.
 * A reused seed = replay attack attempt.
 *
 * In production, this queries the on-chain usedSeeds mapping in POUWVerifier.sol.
 * This function is the off-chain pre-check for the challenger client.
 *
 * @param seed       The seed from a POUW certificate
 * @param knownSeeds Set of seeds already seen on-chain
 * @returns true if replay detected
 */
export function checkReplayAttack(seed: Hex, knownSeeds: string[]): boolean {
  return knownSeeds.includes(seed.toLowerCase());
}

// ─── Fraud Pattern Detection ──────────────────────────────────────────────────

export interface FraudSignal {
  type: "REPLAY" | "LOW_DIFFICULTY" | "INVALID_SEED" | "DIMENSION_MISMATCH" | "TIMESTAMP_ANOMALY";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  description: string;
}

/**
 * Scan a POUW certificate for fraud signals.
 * Used by the challenger client to quickly triage certificates.
 */
export function scanForFraudSignals(cert: {
  seed: Hex;
  transcriptHash: Hex;
  matrixDim: number;
  blockSize: number;
  timestamp: number;
}, knownSeeds: string[]): FraudSignal[] {
  const signals: FraudSignal[] = [];

  // Check replay
  if (checkReplayAttack(cert.seed, knownSeeds)) {
    signals.push({
      type: "REPLAY",
      severity: "CRITICAL",
      description: `Seed ${cert.seed.slice(0, 10)}... was already used — replay attack`,
    });
  }

  // Check difficulty
  const DIFFICULTY_TARGET = BigInt("0x0000ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
  if (BigInt(cert.transcriptHash) >= DIFFICULTY_TARGET) {
    signals.push({
      type: "LOW_DIFFICULTY",
      severity: "HIGH",
      description: "Transcript hash does not meet difficulty target",
    });
  }

  // Check dimensions
  if (cert.matrixDim % cert.blockSize !== 0) {
    signals.push({
      type: "DIMENSION_MISMATCH",
      severity: "MEDIUM",
      description: `blockSize ${cert.blockSize} does not divide matrixDim ${cert.matrixDim}`,
    });
  }

  // Check timestamp anomaly (future timestamp or too old)
  const now = Date.now();
  const age = now - cert.timestamp;
  if (cert.timestamp > now + 60_000) {
    signals.push({
      type: "TIMESTAMP_ANOMALY",
      severity: "HIGH",
      description: "Certificate timestamp is in the future",
    });
  } else if (age > 24 * 60 * 60 * 1000) {
    signals.push({
      type: "TIMESTAMP_ANOMALY",
      severity: "MEDIUM",
      description: "Certificate is more than 24 hours old",
    });
  }

  return signals;
}

/**
 * Build a fraud proof object for on-chain submission.
 * The specific block index where the provider's computation diverges.
 */
export function buildFraudProof(params: {
  jobId: Hex;
  challengeId: Hex;
  fraudBlockIndex: number;   // Which (i,j,l) block is wrong
  expectedHash: Hex;         // What it should be
  actualHash: Hex;           // What provider submitted
}) {
  return {
    ...params,
    proofHash: keccak256(
      encodePacked(
        ["bytes32", "uint256", "bytes32", "bytes32"],
        [params.jobId, BigInt(params.fraudBlockIndex), params.expectedHash, params.actualHash]
      )
    ),
    timestamp: Date.now(),
  };
}
