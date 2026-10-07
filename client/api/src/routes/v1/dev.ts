/**
 * POST /v1/dev/credits — test credits for the signed-in wallet.
 * - DEV_MODE (local): +10 CLD on every call.
 * - TESTNET_CREDITS (public testnet): +10 CLD once per wallet per 24 h AND once per IP (IPv6: per /64)
 *   per 24 h, capped at 20 claims per 24 h per ASN (request.cf.asn; skipped where the runtime has no cf data).
 *   Caps are rows in D1 `testnet_claims` taken with atomic upserts, so concurrent claims cannot all pass
 *   (KV is eventually consistent). A claim whose credit fails is released again. Credits have no monetary value.
 * 404 when neither flag is on, so the route does not exist on a value-bearing deployment.
 */
import { createRoute, z } from "@hono/zod-openapi";
import { getEnv } from "../../config/env.js";
import { ok, fail } from "../../lib/http.js";
import { getD1 } from "../../lib/storage.js";
import { trustedClientIp } from "../../middleware/rate-limit.js";
import { creditUcld } from "../../services/balance.service.js";
import { BEARER_AUTH, createRouter, json, responses } from "./_openapi.js";

export const DEV_CREDITS_UCLD = 10_000_000;
export const ASN_DAILY_CLAIM_CAP = 20;
const TESTNET_COOLDOWN_MS = 86_400_000;

export const devRouter = createRouter();

const creditsRoute = createRoute({
  method: "post",
  path: "/dev/credits",
  tags: ["Dev"],
  description:
    "Test credits: 10 CLD (no monetary value). Unlimited locally; on the public testnet once per wallet and once per IP per day, 20 per network (ASN) per day.",
  security: BEARER_AUTH,
  responses: responses({ 200: json(z.object({ status: z.literal("success"), balanceUcld: z.number().int() }), "Credited") }, 400, 401, 404, 429),
});

/** The cap bucket for an address: IPv4 as is, IPv6 by its /64 (one host usually owns a whole /64). */
export function ipBucket(ip: string): string {
  if (!ip.includes(":")) return ip;
  const [head, tail = ""] = ip.split("::");
  const groups = head.split(":").filter(Boolean);
  const missing = 8 - groups.length - tail.split(":").filter(Boolean).length;
  const full = [...groups, ...Array<string>(Math.max(0, missing)).fill("0"), ...tail.split(":").filter(Boolean)];
  return `${full.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/** Take a once-per-day claim on `key`: a new row, or a refresh of one older than the cooldown. False when already claimed. */
async function claimDaily(key: string, now: number): Promise<boolean> {
  const r = await getD1()
    .prepare(
      "INSERT INTO testnet_claims (key, at, n) VALUES (?, ?, 1) " +
        "ON CONFLICT(key) DO UPDATE SET at = excluded.at WHERE excluded.at - testnet_claims.at >= ?",
    )
    .bind(key, now, TESTNET_COOLDOWN_MS)
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

/** Count one claim against the per-day ASN key while under the cap. False when the cap is reached. */
async function claimCounted(key: string, now: number, cap: number): Promise<boolean> {
  const r = await getD1()
    .prepare("INSERT INTO testnet_claims (key, at, n) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET n = n + 1 WHERE testnet_claims.n < ?")
    .bind(key, now, cap)
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

devRouter.openapi(creditsRoute, async (c) => {
  const env = getEnv();
  if (!env.DEV_MODE && !env.TESTNET_CREDITS) return fail(c, "not_found", "Not found");
  const wallet = c.get("jwtPayload").sub.toLowerCase();
  if (!env.DEV_MODE) {
    const ip = trustedClientIp(c);
    if (ip === "unknown") return fail(c, "bad_request", "Test credits need a known client IP address.");
    const asn = (c.req.raw as Request & { cf?: { asn?: number } }).cf?.asn;
    const now = Date.now();
    const walletKey = `wallet:${wallet}`;
    const ipKey = `ip:${ipBucket(ip)}`;
    const asnKey = asn ? `asn:${asn}:${Math.floor(now / TESTNET_COOLDOWN_MS)}` : null;
    const db = getD1();
    // Each claim is taken atomically; a later refusal (or a failed credit) releases the claims already taken,
    // so nobody is locked out without having been credited.
    const dailyTaken: string[] = [];
    let asnTaken = false;
    const release = async () => {
      for (const key of dailyTaken) await db.prepare("DELETE FROM testnet_claims WHERE key = ?").bind(key).run();
      if (asnTaken) await db.prepare("UPDATE testnet_claims SET n = n - 1 WHERE key = ?").bind(asnKey).run();
    };
    if (!(await claimDaily(walletKey, now))) return fail(c, "rate_limited", "Test credits are limited to once per day per wallet.");
    dailyTaken.push(walletKey);
    if (!(await claimDaily(ipKey, now))) {
      await release();
      return fail(c, "rate_limited", "Test credits are limited to once per day per IP address.");
    }
    dailyTaken.push(ipKey);
    if (asnKey) {
      if (!(await claimCounted(asnKey, now, ASN_DAILY_CLAIM_CAP))) {
        await release();
        return fail(c, "rate_limited", "Test credits for this network are exhausted for today.");
      }
      asnTaken = true;
    }
    try {
      const balanceUcld = await creditUcld(wallet, DEV_CREDITS_UCLD);
      return ok(c, { balanceUcld });
    } catch (err) {
      await release();
      throw err;
    }
  }
  const balanceUcld = await creditUcld(wallet, DEV_CREDITS_UCLD);
  return ok(c, { balanceUcld });
});
