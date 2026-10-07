import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app.js";
import { generateToken } from "../src/middleware/auth.js";
import { ASN_DAILY_CLAIM_CAP, ipBucket } from "../src/routes/v1/dev.js";
import { resetEnv } from "../src/config/env.js";
import { getBalanceUcld } from "../src/services/balance.service.js";

const wallet = "0x00000000000000000000000000000000000000d7";
let app: ReturnType<typeof buildApp>;

const walletN = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

/** POST /v1/dev/credits as `jwt` from `ip`; `asn` emulates Cloudflare's request.cf.asn. */
const credit = (jwt: string, ip = "203.0.113.70", asn?: number) => {
  const req = new Request("http://localhost/v1/dev/credits", {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "cf-connecting-ip": ip },
  });
  if (asn !== undefined) Object.defineProperty(req, "cf", { value: { asn } });
  return app.request(req);
};

describe("public testnet credits (TESTNET_CREDITS, DEV_MODE off)", () => {
  beforeAll(async () => {
    // On the Node runtime the IP headers count only behind a trusted proxy.
    await setupV1Db({ DEV_MODE: "false", TESTNET_CREDITS: "true", TRUST_PROXY: "true" });
    app = buildApp({ runtime: "node" });
  });

  it("credits 10 CLD once, then refuses the wallet for the day", async () => {
    const jwt = await generateToken(wallet);
    const first = await credit(jwt);
    expect(first.status).toBe(200);
    expect((await first.json()).balanceUcld).toBe(10_000_000);
    const again = await credit(jwt, "203.0.113.71");
    expect(again.status).toBe(429);
    expect((await again.json()).error.code).toBe("rate_limited");
  });

  it("refuses a second wallet from an IP that already claimed today", async () => {
    const other = await generateToken(walletN(0xa1));
    const res = await credit(other, "203.0.113.70");
    expect(res.status).toBe(429);
    expect((await res.json()).error.message).toMatch(/IP/);
    // A fresh IP works for that wallet.
    const ok = await credit(other, "203.0.113.72");
    expect(ok.status).toBe(200);
  });

  it(`caps one ASN at ${ASN_DAILY_CLAIM_CAP} claims per day; another ASN is unaffected`, async () => {
    const asn = 64500;
    for (let i = 0; i < ASN_DAILY_CLAIM_CAP; i++) {
      const res = await credit(await generateToken(walletN(0x1000 + i)), `198.51.100.${i + 1}`, asn);
      expect(res.status).toBe(200);
    }
    const over = await credit(await generateToken(walletN(0x2000)), "198.51.100.200", asn);
    expect(over.status).toBe(429);
    expect((await over.json()).error.message).toMatch(/network/);
    const otherAsn = await credit(await generateToken(walletN(0x2001)), "198.51.100.201", 64501);
    expect(otherAsn.status).toBe(200);
  });

  it("ten concurrent claims by one wallet credit exactly once (atomic D1 claim, not KV check-then-set)", async () => {
    const w = walletN(0x3000);
    const jwt = await generateToken(w);
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => credit(jwt, `203.0.113.${100 + i}`)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 429)).toHaveLength(9);
    expect((await getBalanceUcld(w)).balanceUcld).toBe(10_000_000);
  });

  it("ten concurrent claims by different wallets from one IP credit exactly once", async () => {
    const jwts = await Promise.all(Array.from({ length: 10 }, (_, i) => generateToken(walletN(0x3100 + i))));
    const results = await Promise.all(jwts.map((jwt) => credit(jwt, "203.0.113.250")));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    // The refused wallets were not locked out: one of them claims fine from a fresh IP.
    const loser = results.findIndex((r) => r.status === 429);
    expect((await credit(jwts[loser], "203.0.113.251")).status).toBe(200);
  });

  it("buckets IPv6 by /64: a second address in the same /64 is the same IP; the next /64 is not", async () => {
    expect(ipBucket("2001:db8:abcd:12:aaaa:bbbb:cccc:1")).toBe("2001:db8:abcd:12::/64");
    expect(ipBucket("2001:db8:abcd:12::1")).toBe("2001:db8:abcd:12::/64");
    expect(ipBucket("2001:DB8::1")).toBe("2001:db8:0:0::/64");
    expect(ipBucket("::1")).toBe("0:0:0:0::/64");
    expect(ipBucket("203.0.113.9")).toBe("203.0.113.9");
    expect((await credit(await generateToken(walletN(0x3200)), "2001:db8:1:2:3:4:5:6")).status).toBe(200);
    const same64 = await credit(await generateToken(walletN(0x3201)), "2001:db8:1:2:ffff::9");
    expect(same64.status).toBe(429);
    expect((await same64.json()).error.message).toMatch(/IP/);
    expect((await credit(await generateToken(walletN(0x3202)), "2001:db8:1:3::1")).status).toBe(200);
  });

  it("refuses a claim when the client IP is unknown instead of skipping the IP cap", async () => {
    const res = await app.request("/v1/dev/credits", { method: "POST", headers: { Authorization: `Bearer ${await generateToken(walletN(0x3300))}` } });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/IP/);
  });

  it("without TRUST_PROXY the Node runtime ignores CF-Connecting-IP / X-Forwarded-For", async () => {
    process.env.TRUST_PROXY = "false";
    resetEnv();
    try {
      const res = await credit(await generateToken(walletN(0x3400)), "203.0.113.1");
      expect(res.status).toBe(400); // no socket here (app.request) → unknown → refused
    } finally {
      process.env.TRUST_PROXY = "true";
      resetEnv();
    }
  });

  it("requires a signed-in wallet", async () => {
    const res = await app.request("/v1/dev/credits", { method: "POST" });
    expect(res.status).toBe(401);
  });
});
