/**
 * Developer API keys and session lifecycle (ENGINEERING_BACKLOG B-7, SECURITY_AUDIT O3 → F8): a wallet session mints
 * keys (token shown once, hashed at rest), keys act within their scopes and never reach key management, credits,
 * payments or provider state; revocation is immediate; sessions end on logout.
 */
import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app.js";
import { getD1, getKV, initStorage } from "../src/lib/storage.js";
import { consumeNonce, generateToken, issueNonce } from "../src/middleware/auth.js";
import { creditUcld } from "../src/services/balance.service.js";
import { authenticateApiKey, forgetApiKeyCache, MAX_KEYS_PER_ACCOUNT, scopeFor } from "../src/services/api-keys.service.js";
import { MATMUL_N_MIN } from "../src/services/work-types.js";

let app: ReturnType<typeof buildApp>;
let seq = 0;

function call(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", `203.0.113.${++seq % 250}`);
  return app.request(path, { ...init, headers });
}
function bearer(token: string, method: string, path: string, body?: unknown) {
  return call(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body !== undefined && { "Content-Type": "application/json" }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}
async function user(credits = 0) {
  const addr = "0x" + (++seq).toString(16).padStart(40, "a");
  if (credits > 0) await creditUcld(addr, credits);
  return { addr, jwt: await generateToken(addr) };
}
async function mint(jwt: string, scopes: string[], extra: Record<string, unknown> = {}) {
  const res = await bearer(jwt, "POST", "/v1/keys", { name: `k${seq}`, scopes, ...extra });
  expect(res.status).toBe(201);
  return (await res.json()).key as { id: string; token: string; prefix: string; scopes: string[] };
}
const n = MATMUL_N_MIN;
const job = { workType: "matmul", n, matrixA: Array.from({ length: n * n }, (_, i) => (i * 7) % 11), matrixB: Array.from({ length: n * n }, (_, i) => (i * 5) % 13) };

beforeAll(async () => {
  await setupV1Db({ DEV_MODE: "true" });
  app = buildApp({ runtime: "node" });
});

describe("scopeFor", () => {
  it("maps a request to the scope a key needs; wallet-only routes get none", () => {
    expect(scopeFor("GET", "/v1/jobs")).toBe("read");
    expect(scopeFor("GET", "/v1/jobs/abc")).toBe("read");
    expect(scopeFor("GET", "/v1/account")).toBe("read");
    expect(scopeFor("GET", "/v1/deployments/x")).toBe("read");
    expect(scopeFor("POST", "/v1/jobs")).toBe("jobs");
    expect(scopeFor("DELETE", "/v1/jobs/abc")).toBe("jobs");
    expect(scopeFor("POST", "/v1/deployments")).toBe("deployments");
    expect(scopeFor("PATCH", "/v1/deployments/x/secrets")).toBe("deployments");
    expect(scopeFor("DELETE", "/v1/deployments/x/")).toBe("deployments");
    expect(scopeFor("POST", "/v1/ipfs/pin")).toBe("deployments");
    for (const [m, p] of [
      ["GET", "/v1/keys"], ["POST", "/v1/keys"], ["DELETE", "/v1/keys/1"],
      ["POST", "/v1/auth/logout"], ["GET", "/v1/payments/balance"], ["POST", "/v1/payments/checkout"],
      ["POST", "/v1/dev/credits"], ["GET", "/v1/fleets"], ["POST", "/v1/fleets"], ["GET", "/v1/nodes/mine"],
      ["DELETE", "/v1/nodes/mine/0xabc"], ["POST", "/v1/providers/scan"], ["POST", "/v1/account"], ["POST", "/v1/anything-else"],
    ]) expect(scopeFor(m, p), `${m} ${p}`).toBeNull();
  });
});

describe("API keys", () => {
  it("a session mints a key shown once; the list carries the prefix, scopes and use, never the token", async () => {
    const u = await user();
    const res = await bearer(u.jwt, "POST", "/v1/keys", { name: "ci", scopes: ["read", "jobs"] });
    expect(res.status).toBe(201);
    const { key } = await res.json();
    expect(key.token).toMatch(/^cld_sk_[A-Za-z0-9_-]{32}$/);
    expect(key).toMatchObject({ name: "ci", prefix: key.token.slice(7, 15), scopes: ["read", "jobs"], lastUsedAt: null, expiresAt: null, revokedAt: null });
    const row = await getD1().prepare("SELECT * FROM api_keys WHERE id = ?").bind(key.id).first<Record<string, unknown>>();
    expect(row!.hash).toHaveLength(64);
    expect(JSON.stringify(row)).not.toContain(key.token);
    // Use it once, then list.
    expect((await bearer(key.token, "GET", "/v1/jobs")).status).toBe(200);
    const listed = (await (await bearer(u.jwt, "GET", "/v1/keys")).json()).keys;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: key.id, prefix: key.prefix, scopes: ["read", "jobs"] });
    expect(listed[0].token).toBeUndefined();
    expect(listed[0].lastUsedAt).toBeGreaterThan(0);
    // Bad input.
    expect((await bearer(u.jwt, "POST", "/v1/keys", { name: "x", scopes: [] })).status).toBe(400);
    expect((await bearer(u.jwt, "POST", "/v1/keys", { name: "x", scopes: ["admin"] })).status).toBe(400);
    expect((await bearer(u.jwt, "POST", "/v1/keys", { name: "", scopes: ["read"] })).status).toBe(400);
  });

  it("a key acts within its scopes, and never on keys, sessions, payments or provider state", async () => {
    const u = await user(5_000_000);
    const reader = await mint(u.jwt, ["read"]);
    expect((await bearer(reader.token, "GET", "/v1/jobs")).status).toBe(200);
    const acct = await bearer(reader.token, "GET", "/v1/account");
    expect(acct.status).toBe(200);
    expect((await acct.json()).address).toBe(u.addr);
    const denied = await bearer(reader.token, "POST", "/v1/jobs", job);
    expect(denied.status).toBe(403);
    expect((await denied.json()).error.message).toMatch(/lacks the "jobs" scope/);
    for (const [m, p] of [["GET", "/v1/keys"], ["POST", "/v1/keys"], ["DELETE", `/v1/keys/${reader.id}`], ["POST", "/v1/auth/logout"], ["GET", "/v1/payments/balance"], ["GET", "/v1/fleets"], ["GET", "/v1/nodes/mine"]]) {
      const r = await bearer(reader.token, m, p, m === "POST" ? { name: "x", scopes: ["read"] } : undefined);
      expect(r.status, `${m} ${p}`).toBe(403);
      expect((await r.json()).error.message).toMatch(/wallet session/);
    }
    // A jobs-only key queues work for the key's owner (and pays with the owner's credits) but cannot read.
    const worker = await mint(u.jwt, ["jobs"]);
    const queued = await bearer(worker.token, "POST", "/v1/jobs", job);
    expect(queued.status).toBe(200);
    const { jobId } = await queued.json();
    expect((await getD1().prepare("SELECT owner FROM work_jobs WHERE id = ?").bind(jobId).first<{ owner: string }>())!.owner).toBe(u.addr);
    expect((await bearer(worker.token, "GET", "/v1/jobs")).status).toBe(403);
    // The owner's session sees the job the key queued.
    expect((await (await bearer(u.jwt, "GET", "/v1/jobs")).json()).jobs.map((j: { id: string }) => j.id)).toContain(jobId);
  });

  it("revocation is immediate; expiry, garbage and other people's keys are refused", async () => {
    const u = await user();
    const k = await mint(u.jwt, ["read"]);
    expect((await bearer(k.token, "GET", "/v1/jobs")).status).toBe(200);
    const other = await user();
    expect((await bearer(other.jwt, "DELETE", `/v1/keys/${k.id}`)).status).toBe(404);
    const revoked = await bearer(u.jwt, "DELETE", `/v1/keys/${k.id}`);
    expect(revoked.status).toBe(200);
    expect((await revoked.json()).revokedAt).toBeGreaterThan(0);
    const after = await bearer(k.token, "GET", "/v1/jobs");
    expect(after.status).toBe(401);
    expect((await after.json()).error.message).toMatch(/revoked API key/);
    expect((await bearer(u.jwt, "DELETE", `/v1/keys/${k.id}`)).status).toBe(404);
    expect((await (await bearer(u.jwt, "GET", "/v1/keys")).json()).keys[0].revokedAt).toBeGreaterThan(0);
    // Expiry is honoured even through the per-isolate cache.
    const short = await mint(u.jwt, ["read"], { expiresInDays: 1 });
    expect((await bearer(short.token, "GET", "/v1/jobs")).status).toBe(200);
    await getD1().prepare("UPDATE api_keys SET expires_at = ? WHERE id = ?").bind(Date.now() - 1, short.id).run();
    forgetApiKeyCache();
    expect((await bearer(short.token, "GET", "/v1/jobs")).status).toBe(401);
    // The lookup cache never outlives the key: an expiry inside the 30 s window ends the entry there.
    const soon = await mint(u.jwt, ["read"], { expiresInDays: 1 });
    const expiresAt = Date.now() + 5_000;
    await getD1().prepare("UPDATE api_keys SET expires_at = ? WHERE id = ?").bind(expiresAt, soon.id).run();
    forgetApiKeyCache();
    expect(await authenticateApiKey(soon.token)).not.toBeNull();
    expect(await authenticateApiKey(soon.token, expiresAt + 1)).toBeNull();
    for (const bad of ["cld_sk_", "cld_sk_" + "x".repeat(32), "cld_sk_" + "y".repeat(200), k.token.slice(0, -1) + (k.token.endsWith("A") ? "B" : "A")]) {
      expect((await bearer(bad, "GET", "/v1/jobs")).status, bad.slice(0, 20)).toBe(401);
    }
  });

  it(`allows at most ${MAX_KEYS_PER_ACCOUNT} live keys; revoked ones do not count`, async () => {
    const u = await user();
    const ids: string[] = [];
    for (let i = 0; i < MAX_KEYS_PER_ACCOUNT; i++) ids.push((await mint(u.jwt, ["read"])).id);
    const full = await bearer(u.jwt, "POST", "/v1/keys", { name: "one-too-many", scopes: ["read"] });
    expect(full.status).toBe(409);
    expect((await bearer(u.jwt, "DELETE", `/v1/keys/${ids[0]}`)).status).toBe(200);
    expect((await bearer(u.jwt, "POST", "/v1/keys", { name: "fits-again", scopes: ["read"] })).status).toBe(201);
  });
});

describe("sessions", () => {
  it("logout ends the token now; a second logout and any later use are refused", async () => {
    const u = await user();
    expect((await bearer(u.jwt, "GET", "/v1/account")).status).toBe(200);
    const out = await bearer(u.jwt, "POST", "/v1/auth/logout");
    expect(out.status).toBe(200);
    expect(await out.json()).toEqual({ status: "success", revoked: true });
    const after = await bearer(u.jwt, "GET", "/v1/account");
    expect(after.status).toBe(401);
    expect((await after.json()).error.message).toMatch(/revoked token/);
    expect((await bearer(u.jwt, "POST", "/v1/auth/logout")).status).toBe(401);
    // Other sessions of the same wallet are untouched.
    const again = await generateToken(u.addr);
    expect((await bearer(again, "GET", "/v1/account")).status).toBe(200);
  });

  it("unauthenticated and key callers cannot touch /v1/keys or logout", async () => {
    expect((await call("/v1/keys")).status).toBe(401);
    expect((await call("/v1/auth/logout", { method: "POST" })).status).toBe(401);
  });
});

describe("the revocation list, the key store and sign-in nonces live in D1", () => {
  /** The real D1 with every statement that mentions `fragment` failing at prepare; everything else keeps working. */
  function brokenD1(fragment: string) {
    const db = getD1();
    return new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "prepare") {
          return (sql: string) => {
            if (sql.includes(fragment)) throw new Error("d1 down");
            return target.prepare(sql);
          };
        }
        const v = Reflect.get(target, prop, receiver);
        return typeof v === "function" ? v.bind(target) : v;
      },
    }) as typeof db;
  }

  it("a revocation list that cannot be read answers 503 for a session — never 'valid', never 'revoked'; a key is unaffected", async () => {
    const u = await user();
    const key = await mint(u.jwt, ["read"]);
    const db = getD1();
    const kv = getKV();
    initStorage(brokenD1("FROM revoked_tokens"), kv);
    try {
      const res = await bearer(u.jwt, "GET", "/v1/account");
      expect(res.status).toBe(503);
      expect(res.headers.get("retry-after")).toBe("5");
      expect((await res.json()).error).toMatchObject({ code: "service_unavailable", message: expect.stringMatching(/was not refused/) });
      expect((await bearer(key.token, "GET", "/v1/account")).status).toBe(200);
    } finally {
      initStorage(db, kv);
    }
    expect((await bearer(u.jwt, "GET", "/v1/account")).status).toBe(200);
  });

  it("a key store that cannot be read answers 503 for a key, not the false 'revoked' that signs a client out", async () => {
    const u = await user();
    const key = await mint(u.jwt, ["read"]);
    forgetApiKeyCache();
    const db = getD1();
    const kv = getKV();
    initStorage(brokenD1("FROM api_keys"), kv);
    try {
      const res = await bearer(key.token, "GET", "/v1/account");
      expect(res.status).toBe(503);
      expect((await res.json()).error.message).toMatch(/the key was not refused/);
    } finally {
      initStorage(db, kv);
    }
    expect((await bearer(key.token, "GET", "/v1/account")).status).toBe(200);
  });

  it("a revocation list that cannot be written makes logout say revoked:false — the token then runs to its expiry", async () => {
    const u = await user();
    const db = getD1();
    const kv = getKV();
    initStorage(brokenD1("INSERT INTO revoked_tokens"), kv);
    try {
      const res = await bearer(u.jwt, "POST", "/v1/auth/logout");
      expect(res.status).toBe(200);
      expect((await res.json()).revoked).toBe(false);
    } finally {
      initStorage(db, kv);
    }
    expect((await bearer(u.jwt, "GET", "/v1/account")).status).toBe(200); // exactly what revoked:false warns about
    // A logout that could write refuses the token everywhere at once (one shared list, no KV).
    expect((await (await bearer(u.jwt, "POST", "/v1/auth/logout")).json()).revoked).toBe(true);
    expect((await bearer(u.jwt, "GET", "/v1/account")).status).toBe(401);
    expect((await getD1().prepare("SELECT COUNT(*) AS n FROM revoked_tokens").first<{ n: number }>())!.n).toBeGreaterThan(0);
  });

  it("sign-in nonces are issued into D1, taken exactly once, and gone after", async () => {
    const address = "0x" + "ab".repeat(20);
    const issued = await issueNonce(address);
    const count = async () => (await getD1().prepare("SELECT COUNT(*) AS n FROM login_nonces WHERE key LIKE ?").bind(`nonce:${address}:%`).first<{ n: number }>())!.n;
    expect(await count()).toBe(1);
    expect(await consumeNonce(address, issued.message)).toBe(true);
    expect(await consumeNonce(address, issued.message)).toBe(false);
    expect(await count()).toBe(0);
  });
});
