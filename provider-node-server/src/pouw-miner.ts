/**
 * POUW Mining Service — runs on the provider node.
 *
 * Continuously mines POUW certificates using the cuPOW algorithm.
 * On finding a valid certificate, submits it to the orchestrator for
 * verification and reward distribution.
 *
 * Mining loop:
 *   1. Fetch current chain seed (sigma) from orchestrator.
 *   2. Run solve() for BATCH_SIZE attempts.
 *   3. If certificate found → POST to orchestrator /v1/pouw/submit.
 *   4. Loop, refreshing sigma every SIGMA_REFRESH_MS.
 */

import { createHash } from "node:crypto";

// We import the pouw package inline (same monorepo) using relative path
// since the workspace link may not be installed on provider nodes yet.
// TODO: replace with `import { solve, verify } from "@cloudana/pouw"` once installed.

const POUW_ENABLED = process.env.POUW_ENABLED !== "false";
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL ?? "http://localhost:7002";
const POUW_DIFFICULTY = Number(process.env.POUW_DIFFICULTY ?? "12"); // leading zero bits
const POUW_MATRIX_SIZE = Number(process.env.POUW_MATRIX_SIZE ?? "64"); // n×n
const BATCH_SIZE = Number(process.env.POUW_BATCH_SIZE ?? "100"); // attempts per tick
const SIGMA_REFRESH_MS = Number(process.env.POUW_SIGMA_REFRESH_MS ?? "10000"); // 10s
const POUW_PROVIDER_ADDRESS = process.env.POUW_PROVIDER_ADDRESS ?? "";

interface CertificatePayload {
  sigma: string;
  n: number;
  r: number;
  matrixAHash: string;
  matrixBHash: string;
  transcriptHash: string;
  z: string;
  difficulty: number;
  timestamp: number;
  providerAddress: string;
  deviceId: string;
  matrixA: number[];
  matrixB: number[];
}

interface MinerState {
  running: boolean;
  chainSeed: string;
  lastSeedRefresh: number;
  totalAttempts: number;
  totalFound: number;
  startTime: number;
  lastFound?: number;
}

const state: MinerState = {
  running: false,
  chainSeed: createHash("sha256").update("genesis-seed").digest("hex"),
  lastSeedRefresh: 0,
  totalAttempts: 0,
  totalFound: 0,
  startTime: Date.now(),
};

async function fetchChainSeed(): Promise<string> {
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/v1/pouw/seed`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { seed: string };
    return data.seed;
  } catch {
    // Fallback: derive a pseudo-seed from current timestamp block (10s windows)
    const timeBlock = Math.floor(Date.now() / 10000);
    return createHash("sha256").update(`fallback-${timeBlock}`).digest("hex");
  }
}

async function submitCertificate(cert: CertificatePayload): Promise<void> {
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/v1/pouw/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cert),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`[POUW] Certificate submission failed: HTTP ${res.status} — ${text}`);
    } else {
      const data = await res.json() as { status: string; reward?: string };
      console.log(`[POUW] ✅ Certificate accepted! Status: ${data.status}${data.reward ? ` | Reward: ${data.reward} CLD` : ""}`);
    }
  } catch (err) {
    console.error(`[POUW] Submission error:`, err);
  }
}

/** Inline minimal cuPOW implementation to avoid needing workspace install on provider nodes. */
async function runSolveAttempts(
  chainSeed: string,
  n: number,
  difficulty: number,
  providerAddress: string,
  deviceId: string,
  batchSize: number,
): Promise<CertificatePayload | null> {
  // Dynamic import so this can work as a standalone file too
  // In the monorepo we just import directly
  const { solve } = await import("../../pouw/src/cupow.js");
  const result = solve(chainSeed, n, difficulty, providerAddress, deviceId, batchSize);
  if (!result) return null;
  return result.certificate as CertificatePayload;
}

/** Main mining loop — call startMining() to begin. */
async function miningLoop(deviceId: string): Promise<void> {
  console.log(`[POUW] Mining started — n=${POUW_MATRIX_SIZE}, difficulty=${POUW_DIFFICULTY} bits`);
  console.log(`[POUW] Submitting to: ${ORCHESTRATOR_URL}/v1/pouw/submit`);

  while (state.running) {
    // Refresh chain seed periodically
    const now = Date.now();
    if (now - state.lastSeedRefresh > SIGMA_REFRESH_MS) {
      state.chainSeed = await fetchChainSeed();
      state.lastSeedRefresh = now;
    }

    const cert = await runSolveAttempts(
      state.chainSeed,
      POUW_MATRIX_SIZE,
      POUW_DIFFICULTY,
      POUW_PROVIDER_ADDRESS,
      deviceId,
      BATCH_SIZE,
    );

    state.totalAttempts += BATCH_SIZE;

    if (cert) {
      state.totalFound++;
      state.lastFound = Date.now();
      console.log(`[POUW] 🎯 Certificate #${state.totalFound} found! z=${cert.z.slice(0, 16)}...`);
      await submitCertificate(cert);
      // Refresh seed after finding a certificate to avoid replays
      state.chainSeed = await fetchChainSeed();
      state.lastSeedRefresh = Date.now();
    }

    // Yield to event loop between batches
    await new Promise((r) => setImmediate(r));
  }

  console.log("[POUW] Mining stopped.");
}

export function startMining(deviceId: string): void {
  if (!POUW_ENABLED) {
    console.log("[POUW] Mining disabled (POUW_ENABLED=false)");
    return;
  }
  if (!POUW_PROVIDER_ADDRESS) {
    console.log("[POUW] Mining disabled — set POUW_PROVIDER_ADDRESS to enable");
    return;
  }
  if (state.running) return;
  state.running = true;
  state.startTime = Date.now();
  miningLoop(deviceId).catch((err) => {
    console.error("[POUW] Mining loop crashed:", err);
    state.running = false;
  });
}

export function stopMining(): void {
  state.running = false;
}

export function getMiningStats() {
  const elapsed = (Date.now() - state.startTime) / 1000;
  return {
    running: state.running,
    totalAttempts: state.totalAttempts,
    totalFound: state.totalFound,
    hashRate: elapsed > 0 ? Math.round(state.totalAttempts / elapsed) : 0,
    uptime: Math.round(elapsed),
    difficulty: POUW_DIFFICULTY,
    matrixSize: POUW_MATRIX_SIZE,
    lastFound: state.lastFound,
  };
}
