/**
 * Mining Reward Service — distributes CLD rewards for verified POUW certificates.
 *
 * For testnet:
 *   - Orchestrator directly calls RewardContract.rewardProvider() on-chain.
 *   - Reward amount scales with matrix size and difficulty achieved.
 *   - Rewards come from a pre-funded mining rewards pool in the RewardContract.
 *
 * Reward formula (from Cloudana whitepaper §4.3):
 *   R_mining = Base_Reward × (n / 64)^1.5 × difficulty_multiplier
 *
 * For testnet we use a minimal base reward and low multipliers.
 */

import { createPublicClient, createWalletClient, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { log } from "../lib/logger.js";
import type { POUWCertificate } from "../../../../pouw/src/types.js";

const L = log.pouw;

// ─── Config ──────────────────────────────────────────────────────────────────

const MINING_REWARDS_ENABLED = process.env.MINING_REWARDS_ENABLED !== "false";
const RPC_URL = process.env.ORCHESTRATOR_CHAIN_RPC_URL ?? "";
const ORCHESTRATOR_PK = process.env.ORCHESTRATOR_PRIVATE_KEY as `0x${string}` | undefined;

/** Base reward per certificate in CLD wei (18 decimals).
 *  Testnet: 10 CLD per certificate at n=64, difficulty=12. */
const BASE_REWARD_CLD = parseUnits("10", 18); // 10 CLD

/** Mining pool workload ID — a special workload funded at deployment for mining rewards. */
const MINING_POOL_WORKLOAD_ID = BigInt(process.env.POUW_MINING_POOL_WORKLOAD_ID ?? "0");

/** Minimal RewardContract ABI for rewardProvider. */
const REWARD_ABI = [
  {
    name: "rewardProvider",
    type: "function",
    inputs: [
      { name: "provider", type: "address" },
      { name: "workloadId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    name: "workloadDeposits",
    type: "function",
    inputs: [{ name: "workloadId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

// ─── Reward calculation ───────────────────────────────────────────────────────

/**
 * Calculate mining reward for a certificate.
 * Scales with matrix size (n) and difficulty.
 */
export function calculateReward(cert: POUWCertificate): bigint {
  // Scale by (n/64)^1.5 — bigger matrices = bigger reward
  const sizeScale = Math.pow(cert.n / 64, 1.5);
  // Scale by difficulty above minimum (each extra bit doubles expected work)
  const diffScale = Math.pow(2, Math.max(0, cert.difficulty - 8) / 4);
  const multiplier = sizeScale * diffScale;
  return BigInt(Math.round(Number(BASE_REWARD_CLD) * multiplier));
}

// ─── On-chain reward distribution ────────────────────────────────────────────

let rewardContractAddress: `0x${string}` | null = null;

function getRewardContractAddress(): `0x${string}` {
  if (rewardContractAddress) return rewardContractAddress;
  const addr = process.env.REWARD_CONTRACT_ADDRESS;
  if (!addr) throw new Error("REWARD_CONTRACT_ADDRESS not configured");
  rewardContractAddress = addr as `0x${string}`;
  return rewardContractAddress;
}

/**
 * Distribute mining reward for a verified certificate.
 * Returns the reward amount in CLD (as a formatted string) or null if disabled.
 */
export async function distributeMiningReward(cert: POUWCertificate): Promise<string | null> {
  if (!MINING_REWARDS_ENABLED) return null;
  if (!ORCHESTRATOR_PK) {
    L.warn("[POUW:reward] ORCHESTRATOR_PRIVATE_KEY not set — skipping on-chain reward");
    return null;
  }
  if (MINING_POOL_WORKLOAD_ID === 0n) {
    L.warn("[POUW:reward] POUW_MINING_POOL_WORKLOAD_ID not set — skipping on-chain reward");
    return null;
  }

  let contractAddress: `0x${string}`;
  try {
    contractAddress = getRewardContractAddress();
  } catch (err) {
    L.warn("[POUW:reward] Cannot get reward contract address:", err);
    return null;
  }

  const rewardAmount = calculateReward(cert);
  const account = privateKeyToAccount(ORCHESTRATOR_PK);

  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });
  const walletClient = createWalletClient({ chain: baseSepolia, transport: http(RPC_URL), account });

  try {
    // Check pool has enough balance
    const poolBalance = await publicClient.readContract({
      address: contractAddress,
      abi: REWARD_ABI,
      functionName: "workloadDeposits",
      args: [MINING_POOL_WORKLOAD_ID],
    });

    if (poolBalance < rewardAmount) {
      L.warn(`[POUW:reward] Mining pool insufficient: ${poolBalance} < ${rewardAmount}`);
      return null;
    }

    const hash = await walletClient.writeContract({
      address: contractAddress,
      abi: REWARD_ABI,
      functionName: "rewardProvider",
      args: [cert.providerAddress as `0x${string}`, MINING_POOL_WORKLOAD_ID, rewardAmount],
    });

    L.success(`[POUW:reward] Rewarded ${cert.providerAddress.slice(0, 10)}... ${rewardAmount} wei CLD | tx: ${hash}`);
    return rewardAmount.toString();
  } catch (err) {
    L.error("[POUW:reward] On-chain reward failed:", err);
    return null;
  }
}
