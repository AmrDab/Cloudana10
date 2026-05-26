/**
 * Cloudana POUW Orchestrator Server
 *
 * Responsibilities:
 *   1. GET  /v1/pouw/seed    — Return fresh chain-derived seed for miners.
 *   2. POST /v1/pouw/submit  — Verify certificate off-chain, record on POUWVerifier,
 *                               mint CLD reward via CLDToken.mint().
 *   3. GET  /v1/pouw/stats   — Network mining stats.
 *   4. GET  /health          — Health check.
 *
 * Env vars:
 *   RPC_URL              — Base Sepolia RPC (default: public endpoint)
 *   ORCHESTRATOR_KEY     — Private key with ORCHESTRATOR_ROLE on POUWVerifier + MINTER_ROLE on CLDToken
 *   PORT                 — Server port (default: 7002)
 *   POUW_DIFFICULTY      — Required difficulty bits (default: 12)
 *   POUW_MATRIX_SIZE     — Required matrix dimension (default: 64)
 *   BLOCK_REWARD_CLD     — CLD minted per valid certificate (default: 100)
 *   CERT_MAX_AGE_MS      — Max age of certificate timestamp (default: 60000 = 60s)
 *   SEED_REFRESH_SECS    — Seconds between seed rotations (default: 10)
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { ethers } from "ethers";
import { createHash } from "node:crypto";
import { verify as verifyCert } from "../../pouw/src/cupow.js";
import type { POUWCertificate } from "../../pouw/src/types.js";

// ─── Config ──────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? "7002");
const RPC_URL = process.env.RPC_URL ?? "https://sepolia.base.org";
const ORCHESTRATOR_KEY = process.env.ORCHESTRATOR_KEY ?? "";
const POUW_DIFFICULTY = Number(process.env.POUW_DIFFICULTY ?? "12");
const POUW_MATRIX_SIZE = Number(process.env.POUW_MATRIX_SIZE ?? "64");
const BLOCK_REWARD_CLD = Number(process.env.BLOCK_REWARD_CLD ?? "100");
const CERT_MAX_AGE_MS = Number(process.env.CERT_MAX_AGE_MS ?? "60000");
const SEED_REFRESH_SECS = Number(process.env.SEED_REFRESH_SECS ?? "10");

// Contract addresses from shared/addresses.baseSepolia.json
const POUW_VERIFIER_ADDRESS = "0xE2791574413d2bdE5B84848A99Aeb3B9f4d80682";
const CLD_TOKEN_ADDRESS = "0xcfd19DF5a3f963Dabf52aC7B46d4780Cc0E599e2";
const REWARD_CONTRACT_ADDRESS = "0x427830A20C4752eb30C47e0d2572A457ebF4A8AD";

// Minimal ABIs — only the functions we call
const POUW_VERIFIER_ABI = [
  "function recordCertificate(address provider, bytes32 deviceId, uint32 matrixSize, uint8 difficulty, bytes32 transcriptHash, bytes32 z, uint256 timestamp) external",
  "function isZUsed(bytes32 z) external view returns (bool)",
  "function certificateCount() external view returns (uint256)",
  "function minerCount() external view returns (uint256)",
];

const CLD_TOKEN_ABI = [
  "function mint(address to, uint256 amount) external",
  "function balanceOf(address account) external view returns (uint256)",
];

// ─── State ───────────────────────────────────────────────────────────────────

interface OrchestratorState {
  currentSeed: string;
  seedTimestamp: number;
  totalCertificates: number;
  totalRewardsMinted: number;
  startTime: number;
  recentCerts: Array<{ provider: string; z: string; timestamp: number; reward: number }>;
}

const state: OrchestratorState = {
  currentSeed: "",
  seedTimestamp: 0,
  totalCertificates: 0,
  totalRewardsMinted: 0,
  startTime: Date.now(),
  recentCerts: [],
};

// In-memory replay protection (supplements on-chain usedZ mapping)
const usedZLocal = new Set<string>();

// ─── Chain Connection ────────────────────────────────────────────────────────

let provider: ethers.JsonRpcProvider;
let wallet: ethers.Wallet;
let pouwVerifier: ethers.Contract;
let cldToken: ethers.Contract;
let chainConnected = false;

function initChain(): boolean {
  if (!ORCHESTRATOR_KEY) {
    console.warn("[ORCH] No ORCHESTRATOR_KEY set — running in DRY-RUN mode (no on-chain writes)");
    return false;
  }
  try {
    provider = new ethers.JsonRpcProvider(RPC_URL);
    wallet = new ethers.Wallet(ORCHESTRATOR_KEY, provider);
    pouwVerifier = new ethers.Contract(POUW_VERIFIER_ADDRESS, POUW_VERIFIER_ABI, wallet);
    cldToken = new ethers.Contract(CLD_TOKEN_ADDRESS, CLD_TOKEN_ABI, wallet);
    console.log(`[ORCH] Chain connected — wallet: ${wallet.address}`);
    console.log(`[ORCH] POUWVerifier: ${POUW_VERIFIER_ADDRESS}`);
    console.log(`[ORCH] CLDToken: ${CLD_TOKEN_ADDRESS}`);
    chainConnected = true;
    return true;
  } catch (err) {
    console.error("[ORCH] Chain init failed:", err);
    return false;
  }
}

// ─── Seed Management ─────────────────────────────────────────────────────────

async function refreshSeed(): Promise<string> {
  let blockData = "genesis";
  if (chainConnected) {
    try {
      const block = await provider.getBlock("latest");
      if (block) {
        blockData = block.hash ?? block.number.toString();
      }
    } catch {
      // Fallback to time-based seed
    }
  }

  const timeBlock = Math.floor(Date.now() / (SEED_REFRESH_SECS * 1000));
  const seed = createHash("sha256")
    .update(blockData)
    .update(timeBlock.toString())
    .digest("hex");

  state.currentSeed = seed;
  state.seedTimestamp = Date.now();
  return seed;
}

async function getCurrentSeed(): Promise<string> {
  const age = Date.now() - state.seedTimestamp;
  if (!state.currentSeed || age > SEED_REFRESH_SECS * 1000) {
    return refreshSeed();
  }
  return state.currentSeed;
}

// ─── Certificate Verification & Recording ────────────────────────────────────

interface SubmitResult {
  status: "accepted" | "rejected" | "error";
  reason?: string;
  reward?: string;
  txHash?: string;
  certificateId?: number;
}

async function processCertificate(cert: POUWCertificate): Promise<SubmitResult> {
  // 1. Basic validation
  if (cert.n !== POUW_MATRIX_SIZE) {
    return { status: "rejected", reason: `Matrix size must be ${POUW_MATRIX_SIZE}, got ${cert.n}` };
  }
  if (cert.difficulty < POUW_DIFFICULTY) {
    return { status: "rejected", reason: `Difficulty must be >= ${POUW_DIFFICULTY}, got ${cert.difficulty}` };
  }
  if (!cert.providerAddress || !cert.providerAddress.startsWith("0x")) {
    return { status: "rejected", reason: "Invalid provider address" };
  }
  if (!cert.z || cert.z.length !== 64) {
    return { status: "rejected", reason: "Invalid z hash" };
  }

  // 2. Timestamp freshness
  const age = Date.now() - cert.timestamp;
  if (age > CERT_MAX_AGE_MS) {
    return { status: "rejected", reason: `Certificate too old (${Math.round(age / 1000)}s > ${CERT_MAX_AGE_MS / 1000}s)` };
  }
  if (age < -5000) {
    return { status: "rejected", reason: "Certificate timestamp in the future" };
  }

  // 3. Local replay check
  if (usedZLocal.has(cert.z)) {
    return { status: "rejected", reason: "Duplicate certificate (z already used)" };
  }

  // 4. Off-chain cryptographic verification (re-runs the full cuPOW verify)
  let valid: boolean;
  try {
    valid = verifyCert(cert);
  } catch (err) {
    return { status: "rejected", reason: `Verification error: ${err}` };
  }
  if (!valid) {
    return { status: "rejected", reason: "Cryptographic verification failed" };
  }

  // 5. Mark locally used
  usedZLocal.add(cert.z);

  // 6. Record on-chain + mint reward
  const rewardWei = ethers.parseEther(BLOCK_REWARD_CLD.toString());

  if (chainConnected) {
    try {
      // Check on-chain replay
      const zBytes32 = "0x" + cert.z;
      const alreadyUsed = await pouwVerifier.isZUsed(zBytes32);
      if (alreadyUsed) {
        usedZLocal.delete(cert.z); // Remove from local since it wasn't actually new
        return { status: "rejected", reason: "Certificate already recorded on-chain" };
      }

      // Record certificate on POUWVerifier
      const deviceIdBytes32 = cert.deviceId.startsWith("0x")
        ? cert.deviceId
        : "0x" + cert.deviceId.padStart(64, "0");
      const transcriptHashBytes32 = "0x" + cert.transcriptHash;

      const recordTx = await pouwVerifier.recordCertificate(
        cert.providerAddress,
        deviceIdBytes32,
        cert.n,
        cert.difficulty,
        transcriptHashBytes32,
        zBytes32,
        cert.timestamp,
      );
      await recordTx.wait();

      // Mint CLD reward to provider (75% to provider, 20% burn, 5% treasury)
      const providerReward = (rewardWei * 75n) / 100n;
      const treasuryReward = (rewardWei * 5n) / 100n;
      // 20% is not minted (effectively burned by not creating it)

      const mintProviderTx = await cldToken.mint(cert.providerAddress, providerReward);
      await mintProviderTx.wait();

      // Mint treasury portion to the treasury wallet (deployer for testnet)
      if (treasuryReward > 0n) {
        const mintTreasuryTx = await cldToken.mint(wallet.address, treasuryReward);
        await mintTreasuryTx.wait();
      }

      state.totalCertificates++;
      state.totalRewardsMinted += BLOCK_REWARD_CLD;
      state.recentCerts.push({
        provider: cert.providerAddress,
        z: cert.z.slice(0, 16) + "...",
        timestamp: Date.now(),
        reward: BLOCK_REWARD_CLD * 0.75,
      });
      // Keep only last 50
      if (state.recentCerts.length > 50) state.recentCerts.shift();

      console.log(`[ORCH] Certificate accepted — provider: ${cert.providerAddress}, reward: ${BLOCK_REWARD_CLD * 0.75} CLD, tx: ${recordTx.hash}`);

      return {
        status: "accepted",
        reward: (BLOCK_REWARD_CLD * 0.75).toString(),
        txHash: recordTx.hash,
      };
    } catch (err: any) {
      console.error("[ORCH] On-chain recording failed:", err.message ?? err);
      return { status: "error", reason: `Chain error: ${err.message ?? "unknown"}` };
    }
  } else {
    // DRY-RUN mode — no chain writes
    state.totalCertificates++;
    state.totalRewardsMinted += BLOCK_REWARD_CLD;
    state.recentCerts.push({
      provider: cert.providerAddress,
      z: cert.z.slice(0, 16) + "...",
      timestamp: Date.now(),
      reward: BLOCK_REWARD_CLD * 0.75,
    });
    if (state.recentCerts.length > 50) state.recentCerts.shift();

    console.log(`[ORCH] [DRY-RUN] Certificate accepted — provider: ${cert.providerAddress}, z: ${cert.z.slice(0, 16)}...`);

    return {
      status: "accepted",
      reward: (BLOCK_REWARD_CLD * 0.75).toString(),
      txHash: "dry-run",
    };
  }
}

// ─── HTTP Server ─────────────────────────────────────────────────────────────

const app = new Hono();

app.use("*", cors());

// Health check
app.get("/health", (c) =>
  c.json({
    status: "ok",
    uptime: Math.round((Date.now() - state.startTime) / 1000),
    chainConnected,
    difficulty: POUW_DIFFICULTY,
    matrixSize: POUW_MATRIX_SIZE,
    blockReward: BLOCK_REWARD_CLD,
  }),
);

// GET /v1/pouw/seed — return current mining seed
app.get("/v1/pouw/seed", async (c) => {
  const seed = await getCurrentSeed();
  return c.json({
    seed,
    difficulty: POUW_DIFFICULTY,
    matrixSize: POUW_MATRIX_SIZE,
    refreshInterval: SEED_REFRESH_SECS,
    timestamp: Date.now(),
  });
});

// POST /v1/pouw/submit — accept a mined certificate
app.post("/v1/pouw/submit", async (c) => {
  let body: POUWCertificate;
  try {
    body = await c.req.json<POUWCertificate>();
  } catch {
    return c.json({ status: "rejected", reason: "Invalid JSON body" }, 400);
  }

  const result = await processCertificate(body);

  const httpStatus = result.status === "accepted" ? 200 : result.status === "rejected" ? 400 : 500;
  return c.json(result, httpStatus);
});

// GET /v1/pouw/stats — network mining stats
app.get("/v1/pouw/stats", async (c) => {
  let onChainCount = 0;
  let onChainMiners = 0;
  if (chainConnected) {
    try {
      onChainCount = Number(await pouwVerifier.certificateCount());
      onChainMiners = Number(await pouwVerifier.minerCount());
    } catch { /* ignore */ }
  }

  return c.json({
    totalCertificates: state.totalCertificates,
    totalRewardsMinted: state.totalRewardsMinted,
    onChainCertificates: onChainCount,
    onChainMiners,
    difficulty: POUW_DIFFICULTY,
    matrixSize: POUW_MATRIX_SIZE,
    blockReward: BLOCK_REWARD_CLD,
    uptime: Math.round((Date.now() - state.startTime) / 1000),
    recentCerts: state.recentCerts.slice(-10),
  });
});

// ─── Start ───────────────────────────────────────────────────────────────────

initChain();
refreshSeed().then(() => {
  console.log(`[ORCH] Initial seed: ${state.currentSeed.slice(0, 16)}...`);
});

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`\n=== Cloudana POUW Orchestrator ===`);
  console.log(`Port:       ${PORT}`);
  console.log(`Difficulty: ${POUW_DIFFICULTY} bits`);
  console.log(`Matrix:     ${POUW_MATRIX_SIZE}x${POUW_MATRIX_SIZE}`);
  console.log(`Reward:     ${BLOCK_REWARD_CLD} CLD/cert (75% provider, 20% burned, 5% treasury)`);
  console.log(`Chain:      ${chainConnected ? "CONNECTED" : "DRY-RUN (no ORCHESTRATOR_KEY)"}`);
  console.log(`RPC:        ${RPC_URL}`);
  console.log(`Seed:       /v1/pouw/seed`);
  console.log(`Submit:     /v1/pouw/submit`);
  console.log(`Stats:      /v1/pouw/stats`);
  console.log(`================================\n`);
});
