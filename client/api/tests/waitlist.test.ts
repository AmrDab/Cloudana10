import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app.js";
import { getD1 } from "../src/lib/storage.js";
import { csvCell } from "../src/services/waitlist.service.js";

const INTERNAL_KEY = "k".repeat(32);
let app: ReturnType<typeof buildApp>;
let ipSeq = 0;

/** Each call gets its own client IP so the per-IP rate limits don't interfere. */
function call(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("cf-connecting-ip")) headers.set("cf-connecting-ip", `10.0.${Math.floor(ipSeq / 250)}.${ipSeq++ % 250}`);
  return app.request(path, { ...init, headers });
}

function join(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return call("/v1/waitlist", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ consent: true, role: "use", ...body }),
  });
}

async function count(): Promise<number> {
  return (await getD1().prepare("SELECT COUNT(*) AS n FROM waitlist").first<{ n: number }>())!.n;
}

beforeAll(async () => {
  await setupV1Db({ INTERNAL_API_KEY: INTERNAL_KEY });
  app = buildApp({ runtime: "node" });
});

describe("POST /v1/waitlist", () => {
  it("creates an entry (201) and normalises email/country", async () => {
    const res = await join({
      email: "  Alice@Example.COM ",
      role: "provide",
      name: "Alice",
      country: "de",
      interests: ["compute", "storage"],
      details: { gpus: 4, region: "eu" },
      newsletter: true,
      source: "twitter",
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ status: "success", position: 1, referrals: 0 });
    expect(body.refCode).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    const row = await getD1().prepare("SELECT * FROM waitlist WHERE ref_code = ?").bind(body.refCode).first<Record<string, unknown>>();
    expect(row).toMatchObject({ email: "alice@example.com", country: "DE", newsletter: 1, role: "provide" });
    expect(JSON.parse(row!.interests as string)).toEqual(["compute", "storage"]);
  });

  it("is idempotent on email: 200, same code, stored fields neither overwritten nor revealed", async () => {
    const first = await (await join({ email: "bob@example.com", name: "Bob", company: "Acme" })).json();
    const res = await join({ email: "BOB@example.com", role: "partner", name: "Mallory", company: "Evil" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "success", position: first.position, refCode: first.refCode, referrals: 0 });
    expect(JSON.stringify(body)).not.toMatch(/Bob|Acme|use/);
    const row = await getD1().prepare("SELECT name, company, role FROM waitlist WHERE email = 'bob@example.com'").first();
    expect(row).toEqual({ name: "Bob", company: "Acme", role: "use" });
  });

  it("honeypot: plausible success, nothing stored", async () => {
    const before = await count();
    const res = await join({ email: "bot@spam.example", website: "http://spam.example" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.refCode).toMatch(/^[A-Z2-9]{8}$/);
    expect(body.position).toBe(before + 1);
    expect(await count()).toBe(before);
  });

  it.each([
    ["invalid email", { email: "not-an-email" }],
    ["invalid role", { email: "x@example.com", role: "admin" }],
    ["missing consent", { email: "x@example.com", consent: undefined }],
    ["consent false", { email: "x@example.com", consent: false }],
    ["bad country", { email: "x@example.com", country: "DEU" }],
    ["unknown interest", { email: "x@example.com", interests: ["mining"] }],
    ["too many detail keys", { email: "x@example.com", details: Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`k${i}`, 1])) }],
    ["details value too long", { email: "x@example.com", details: { note: "x".repeat(201) } }],
  ])("%s → 400 envelope", async (_label, body) => {
    const res = await join(body);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toMatchObject({ status: "error", error: { code: "validation_failed" } });
    expect(typeof json.error.message).toBe("string");
  });

  it("referrals count and improve position; unknown ref is ignored", async () => {
    // Pad the list so the boost is visible.
    for (let i = 0; i < 8; i++) await join({ email: `pad${i}@example.com` });
    const carol = await (await join({ email: "carol@example.com" })).json();
    expect(carol.referrals).toBe(0);
    const before = carol.position;

    const friend = await join({ email: "dave@example.com", ref: carol.refCode.toLowerCase() });
    expect(friend.status).toBe(201);
    const ghost = await join({ email: "erin@example.com", ref: "ZZZZZZZZ" });
    expect(ghost.status).toBe(201);

    const res = await call(`/v1/waitlist/${carol.refCode}`);
    expect(res.status).toBe(200);
    const after = await res.json();
    expect(after).toEqual({ status: "success", position: Math.max(1, before - 5), referrals: 1 });
    expect(after.position).toBeLessThan(before);
    const erin = await getD1().prepare("SELECT referred_by FROM waitlist WHERE email = 'erin@example.com'").first();
    expect(erin).toEqual({ referred_by: null });
  });

  it("rate limits POST per IP (5/min)", async () => {
    const headers = { "cf-connecting-ip": "203.0.113.9" };
    for (let i = 0; i < 5; i++) expect((await join({ email: `rl${i}@example.com` }, headers)).status).toBe(201);
    const res = await join({ email: "rl5@example.com" }, headers);
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("rate_limited");
  });

  it("CORS preflight from the site origin allows POST + Content-Type", async () => {
    const res = await call("/v1/waitlist", {
      method: "OPTIONS",
      headers: {
        Origin: "https://cloudana.io",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(res.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("content-type");
  });
});

describe("GET /v1/waitlist/*", () => {
  it("lookup returns only position + referrals (no PII)", async () => {
    const { refCode } = await (await join({ email: "frank@example.com", name: "Frank", company: "FrankCo" })).json();
    const body = await (await call(`/v1/waitlist/${refCode}`)).json();
    expect(Object.keys(body).sort()).toEqual(["position", "referrals", "status"]);
  });

  it("unknown code → 404, malformed → 400", async () => {
    expect((await call("/v1/waitlist/ZZZZZZZZ")).status).toBe(404);
    expect((await call("/v1/waitlist/nope!")).status).toBe(400);
  });

  it("stats counts by role", async () => {
    const body = await (await call("/v1/waitlist/stats")).json();
    expect(body.status).toBe("success");
    expect(body.total).toBe(await count());
    expect(Object.keys(body.byRole).sort()).toEqual(["datacenter", "partner", "provide", "use", "verify"]);
    expect(body.byRole.provide).toBe(1);
    expect(Object.values(body.byRole as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(body.total);
  });

  it("appears in the OpenAPI document", async () => {
    const doc = await (await call("/v1/doc")).json();
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(["/v1/waitlist", "/v1/waitlist/stats", "/v1/waitlist/{refCode}", "/v1/admin/waitlist"]),
    );
  });
});

describe("GET /v1/admin/waitlist", () => {
  it("requires the internal key", async () => {
    expect((await call("/v1/admin/waitlist")).status).toBe(401);
    expect((await call("/v1/admin/waitlist", { headers: { "X-Internal-Key": "wrong-key-wrong-key" } })).status).toBe(401);
  });

  it("lists entries as JSON", async () => {
    const res = await call("/v1/admin/waitlist", { headers: { "X-Internal-Key": INTERNAL_KEY } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries.length).toBe(await count());
    expect(body.entries[0]).toMatchObject({ email: "alice@example.com", interests: ["compute", "storage"], newsletter: true });
  });

  it("exports CSV with escaping and formula-injection guard", async () => {
    await join({ email: "evil@example.com", name: '=HYPERLINK("http://x","click")', company: 'Comma, "Quoted"\nCo' });
    const res = await call("/v1/admin/waitlist?format=csv", { headers: { "X-Internal-Key": INTERNAL_KEY } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const text = await res.text();
    expect(text.startsWith("id,email,role,name,company,")).toBe(true);
    expect(text).toContain(`"'=HYPERLINK(""http://x"",""click"")"`);
    expect(text).toContain(`"Comma, ""Quoted""\nCo"`);
  });

  it("csvCell guards every formula prefix", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell(null)).toBe("");
    expect(csvCell(42)).toBe("42");
  });
});
