/**
 * Testnet CLD Faucet — mints 100 CLD to any wallet, 24h cooldown.
 * Uses the orchestrator wallet (which must have MINTER_ROLE on CLDToken).
 *
 * Workers-compatible: uses KV for cooldown persistence, inline ABIs.
 */
import { createRoute } from "@hono/zod-openapi";
import { parseEther, type Address } from "viem";
import { getPublicClient, getWalletClient } from "../../services/chain-client.js";
import { contractAddresses } from "../../config/contracts.js";
import { CLDTokenABI } from "../../lib/abi-data.js";
import { getKV } from "../../lib/storage.js";
import { log } from "../../lib/logger.js";
import { ok, fail } from "../../lib/http.js";
import {
  FaucetClaimRequestSchema,
  FaucetClaimResponseSchema,
  FaucetStatusQuerySchema,
  FaucetStatusResponseSchema,
} from "../../schemas/faucet.schema.js";
import { createRouter, json, responses } from "./_openapi.js";

const L = log.api;
const DRIP_AMOUNT = parseEther("100"); // 100 CLD per claim
const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours
const CLD_TOKEN_ADDRESS = contractAddresses.CLDToken as Address;

export const faucetRouter = createRouter();

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
const claimRoute = createRoute({
  method: "post",
  path: "/faucet/claim",
  tags: ["Faucet"],
  request: { body: { required: true, content: { "application/json": { schema: FaucetClaimRequestSchema } } } },
  responses: responses(
    { 200: json(FaucetClaimResponseSchema, "100 CLD minted") },
    400,
    429,
    500,
    503,
  ),
});

faucetRouter.openapi(claimRoute, async (c) => {
  try {
    const body = c.req.valid("json");
    const address = (body.address || "").trim().toLowerCase();

    if (!address || !address.startsWith("0x") || address.length !== 42) {
      return fail(c, "bad_request", "Invalid wallet address");
    }

    const wallet = getWalletClient();
    if (!wallet) {
      return fail(c, "not_configured", "Faucet not configured (no orchestrator key)");
    }

    // Check cooldown from KV
    const kv = getKV();
    const raw = await kv.get(kvKey(address));
    const lastClaim = raw ? (JSON.parse(raw) as FaucetClaim).claimedAt : 0;
    const now = Date.now();
    const remaining = COOLDOWN_MS - (now - lastClaim);

    if (remaining > 0) {
      const hours = Math.ceil(remaining / (60 * 60 * 1000));
      return fail(c, "rate_limited", `Cooldown active. Try again in ~${hours}h.`, {
        cooldownMs: remaining,
        nextClaimAt: new Date(lastClaim + COOLDOWN_MS).toISOString(),
      });
    }

    L.info(`Faucet: Minting 100 CLD to ${address}`);

    const hash = await wallet.writeContract({
      address: CLD_TOKEN_ADDRESS,
      abi: CLDTokenABI as any,
      functionName: "mint",
      args: [address as Address, DRIP_AMOUNT],
      account: wallet.account!,
    });

    L.info(`Faucet: TX sent ${hash}, waiting for confirmation...`);

    const receipt = await getPublicClient().waitForTransactionReceipt({ hash });

    if (receipt.status === "success") {
      // Record claim in KV
      const claim: FaucetClaim = { claimedAt: now, txHash: hash };
      await kv.put(kvKey(address), JSON.stringify(claim));

      L.info(`Faucet: Minted 100 CLD to ${address} (tx: ${hash})`);
      return ok(c, {
        txHash: hash,
        amount: "100",
        nextClaimAt: new Date(now + COOLDOWN_MS).toISOString(),
      });
    } else {
      L.error(`Faucet: TX reverted for ${address}`);
      return fail(c, "internal", "Transaction reverted. The orchestrator wallet may not have MINTER_ROLE.");
    }
  } catch (err: any) {
    L.error("Faucet error:", err);
    return fail(c, "internal", err.message || "Faucet error");
  }
});

/**
 * GET /faucet/status?address=0x...
 * Returns cooldown info for a wallet.
 */
const statusRoute = createRoute({
  method: "get",
  path: "/faucet/status",
  tags: ["Faucet"],
  request: { query: FaucetStatusQuerySchema },
  responses: responses({ 200: json(FaucetStatusResponseSchema, "Cooldown info for the wallet") }, 400),
});

faucetRouter.openapi(statusRoute, async (c) => {
  const address = c.req.valid("query").address.toLowerCase();

  const kv = getKV();
  const raw = await kv.get(kvKey(address));
  const lastClaim = raw ? (JSON.parse(raw) as FaucetClaim).claimedAt : 0;
  const now = Date.now();
  const remaining = COOLDOWN_MS - (now - lastClaim);

  return ok(c, {
    canClaim: remaining <= 0,
    cooldownMs: remaining > 0 ? remaining : 0,
    nextClaimAt: lastClaim > 0 ? new Date(lastClaim + COOLDOWN_MS).toISOString() : null,
    dripAmount: "100",
  });
});
