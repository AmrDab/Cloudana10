/**
 * Testnet CLD Faucet — mints 100 CLD to any wallet, 24h cooldown.
 * Uses the orchestrator wallet (which must have MINTER_ROLE on CLDToken).
 *
 * Workers-compatible: uses KV for cooldown persistence, inline ABIs.
 */
import { Hono } from "hono";
import { parseEther, type Address } from "viem";
import { publicClient, walletClient } from "../../services/chain-client.js";
import { contractAddresses } from "../../config/contracts.js";
import { CLDTokenABI } from "../../lib/abi-data.js";
import { getKV } from "../../lib/storage.js";
import { log } from "../../lib/logger.js";

const L = log.api;
const DRIP_AMOUNT = parseEther("100"); // 100 CLD per claim
const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours
const CLD_TOKEN_ADDRESS = contractAddresses.CLDToken as Address;

export const faucetRouter = new Hono();

interface FaucetClaim {
  claimedAt: number;
  txHash: string;
}

function kvKey(address: string): string {
  return `faucet:${address}`;
}

/**
 * POST /faucet/claim
 * Body: { address: "0x..." }
 * Mints 100 CLD to the given address. 24h cooldown per wallet.
 */
faucetRouter.post("/faucet/claim", async (c) => {
  try {
    const body = await c.req.json();
    const address = (body.address || "").trim().toLowerCase();

    if (!address || !address.startsWith("0x") || address.length !== 42) {
      return c.json({ success: false, error: "Invalid wallet address" }, 400);
    }

    if (!walletClient) {
      return c.json({ success: false, error: "Faucet not configured (no orchestrator key)" }, 503);
    }

    // Check cooldown from KV
    const kv = getKV();
    const raw = await kv.get(kvKey(address));
    const lastClaim = raw ? (JSON.parse(raw) as FaucetClaim).claimedAt : 0;
    const now = Date.now();
    const remaining = COOLDOWN_MS - (now - lastClaim);

    if (remaining > 0) {
      const hours = Math.ceil(remaining / (60 * 60 * 1000));
      return c.json({
        success: false,
        error: `Cooldown active. Try again in ~${hours}h.`,
        cooldownMs: remaining,
        nextClaimAt: new Date(lastClaim + COOLDOWN_MS).toISOString(),
      }, 429);
    }

    L.info(`Faucet: Minting 100 CLD to ${address}`);

    const hash = await walletClient.writeContract({
      address: CLD_TOKEN_ADDRESS,
      abi: CLDTokenABI as any,
      functionName: "mint",
      args: [address as Address, DRIP_AMOUNT],
      account: walletClient.account!,
    });

    L.info(`Faucet: TX sent ${hash}, waiting for confirmation...`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status === "success") {
      // Record claim in KV
      const claim: FaucetClaim = { claimedAt: now, txHash: hash };
      await kv.put(kvKey(address), JSON.stringify(claim));

      L.info(`Faucet: Minted 100 CLD to ${address} (tx: ${hash})`);
      return c.json({
        success: true,
        txHash: hash,
        amount: "100",
        nextClaimAt: new Date(now + COOLDOWN_MS).toISOString(),
      });
    } else {
      L.error(`Faucet: TX reverted for ${address}`);
      return c.json({ success: false, error: "Transaction reverted. The orchestrator wallet may not have MINTER_ROLE." }, 500);
    }
  } catch (err: any) {
    L.error("Faucet error:", err);
    return c.json({ success: false, error: err.message || "Faucet error" }, 500);
  }
});

/**
 * GET /faucet/status?address=0x...
 * Returns cooldown info for a wallet.
 */
faucetRouter.get("/faucet/status", async (c) => {
  const address = (c.req.query("address") || "").trim().toLowerCase();
  if (!address) return c.json({ canClaim: false, error: "Missing address" }, 400);

  const kv = getKV();
  const raw = await kv.get(kvKey(address));
  const lastClaim = raw ? (JSON.parse(raw) as FaucetClaim).claimedAt : 0;
  const now = Date.now();
  const remaining = COOLDOWN_MS - (now - lastClaim);

  return c.json({
    canClaim: remaining <= 0,
    cooldownMs: remaining > 0 ? remaining : 0,
    nextClaimAt: lastClaim > 0 ? new Date(lastClaim + COOLDOWN_MS).toISOString() : null,
    dripAmount: "100",
  });
});
