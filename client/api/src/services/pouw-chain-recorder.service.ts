/**
 * POUW Chain Recorder — records verified certificates on-chain via POUWVerifier.sol.
 *
 * Called asynchronously after a certificate passes off-chain verification.
 * Failure to record on-chain does NOT invalidate the certificate (testnet resilience).
 */

import { createWalletClient, http, keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { log } from "../lib/logger.js";
import { getRpcUrl } from "../config/contracts.js";
import { getEnv } from "../config/env.js";
import type { POUWCertificate } from "../../../../pouw/src/types.js";

const L = log.pouw;

const POUW_VERIFIER_ABI = [
  {
    name: "recordCertificate",
    type: "function",
    inputs: [
      { name: "provider", type: "address" },
      { name: "deviceId", type: "bytes32" },
      { name: "matrixSize", type: "uint32" },
      { name: "difficulty", type: "uint8" },
      { name: "transcriptHash", type: "bytes32" },
      { name: "z", type: "bytes32" },
      { name: "timestamp", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

/** Hex string → bytes32 (truncate or pad). */
function toBytes32(hex: string): `0x${string}` {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return `0x${clean.padEnd(64, "0").slice(0, 64)}` as `0x${string}`;
}

/** The fields POUWVerifier.recordCertificate needs — a full certificate or a stored row. */
export type ChainRecordInput = Pick<
  POUWCertificate,
  "providerAddress" | "deviceId" | "n" | "difficulty" | "transcriptHash" | "z" | "timestamp"
>;

export type ChainStatus = "recorded" | "pending" | "failed" | "not_configured";

export interface ChainOutcome {
  status: ChainStatus;
  tx: string | null;
  reason: string | null;
}

/**
 * Record a certificate on-chain. Never throws; the outcome is persisted by the
 * settlement service so failed records can be retried and the provider can see
 * whether their certificate made it to Base.
 */
export async function recordOnChain(cert: ChainRecordInput): Promise<ChainOutcome> {
  const POUW_VERIFIER_ADDRESS = getEnv().POUW_VERIFIER_CONTRACT_ADDRESS as `0x${string}` | undefined;
  const ORCHESTRATOR_PK = getEnv().ORCHESTRATOR_PRIVATE_KEY as `0x${string}` | undefined;
  if (!POUW_VERIFIER_ADDRESS || !ORCHESTRATOR_PK) {
    return { status: "not_configured", tx: null, reason: "verifier contract or orchestrator signer not provisioned" };
  }

  try {
    const account = privateKeyToAccount(ORCHESTRATOR_PK);
    const client = createWalletClient({ chain: baseSepolia, transport: http(getRpcUrl()), account });

    const hash = await client.writeContract({
      address: POUW_VERIFIER_ADDRESS,
      abi: POUW_VERIFIER_ABI,
      functionName: "recordCertificate",
      args: [
        cert.providerAddress as `0x${string}`,
        toBytes32(cert.deviceId),
        cert.n,
        cert.difficulty,
        toBytes32(cert.transcriptHash),
        toBytes32(cert.z),
        BigInt(cert.timestamp),
      ],
    });

    L.info(`[POUW:chain] Recorded on-chain | tx: ${hash}`);
    return { status: "recorded", tx: hash, reason: null };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    // The contract's usedZ check makes a duplicate record a revert; that means it
    // is already on-chain from an earlier attempt — treat it as recorded.
    if (/already recorded|replay/i.test(reason)) return { status: "recorded", tx: null, reason: "already recorded on-chain" };
    L.warn("[POUW:chain] On-chain recording failed (will retry):", reason);
    return { status: "failed", tx: null, reason };
  }
}
