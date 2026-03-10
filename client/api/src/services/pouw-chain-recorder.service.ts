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
import { rpcUrl } from "../config/contracts.js";
import type { POUWCertificate } from "../../../../pouw/src/types.js";

const L = log.pouw;

const POUW_VERIFIER_ADDRESS = process.env.POUW_VERIFIER_CONTRACT_ADDRESS as `0x${string}` | undefined;
const ORCHESTRATOR_PK = process.env.ORCHESTRATOR_PRIVATE_KEY as `0x${string}` | undefined;

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

/** Record a certificate on-chain. Fails silently for testnet resilience. */
export async function recordOnChain(cert: POUWCertificate): Promise<void> {
  if (!POUW_VERIFIER_ADDRESS || !ORCHESTRATOR_PK) {
    // On-chain recording is optional for testnet
    return;
  }

  try {
    const account = privateKeyToAccount(ORCHESTRATOR_PK);
    const client = createWalletClient({ chain: baseSepolia, transport: http(rpcUrl), account });

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
  } catch (err) {
    L.warn("[POUW:chain] On-chain recording failed (non-critical):", err instanceof Error ? err.message : err);
  }
}
