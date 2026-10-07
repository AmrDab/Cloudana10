/**
 * Hosting gateway (docs/IMPL_SPEC_2026-10.md): probe hash at upload, the public route lookup, admin stop.
 * HOSTING_MIGRATIONS run inside ensureSchema().
 * The public route is exercised on the bare router: security.ts still puts requireAuth on /v1/deployments/*
 * (integration exempts GET /v1/deployments/:id/route there).
 */
import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { privateKeyToAccount, generatePrivateKey, type PrivateKeyAccount } from "viem/accounts";
import { buildApp } from "../src/app.js";
import { getD1 } from "../src/lib/storage.js";
import { generateToken } from "../src/middleware/auth.js";
import { nodeSigningMessage } from "../src/middleware/node-auth.js";
import { creditUcld } from "../src/services/balance.service.js";
import { deploymentsRouter } from "../src/routes/v1/deployments.js";
import { staticProbe } from "../src/services/deployments.service.js";

const INTERNAL_KEY = "k".repeat(32);
let app: ReturnType<typeof buildApp>;
let bare: OpenAPIHono;
let seq = 0;

const b64 = (s: string) => Buffer.from(s).toString("base64");
const INDEX = "<h1>hi</h1>";
const SITE = { files: [{ path: "z.css", contentBase64: b64("h1{}") }, { path: "index.html", contentBase64: b64(INDEX) }] };

async function user() {
  const addr = "0x" + (++seq).toString(16).padStart(40, "a");
  await creditUcld(addr, 10_000);
  return { addr, jwt: await generateToken(addr) };
}

function call(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", `10.8.0.${++seq % 250}`);
  return app.request(path, { ...init, headers });
}

async function signed(node: PrivateKeyAccount, path: string, payload: unknown = {}) {
  const body = JSON.stringify(payload);
  const ts = String(Date.now());
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const signature = await node.signMessage({ message: nodeSigningMessage("POST", path, ts, body, nonce) });
  return call(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Node": node.address, "X-Node-Timestamp": ts, "X-Nonce": nonce, "X-Node-Signature": signature },
    body,
  });
}

async function createSite(jwt: string): Promise<string> {
  const res = await call("/v1/deployments", {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "site", kind: "static", spec: SITE }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).id;
}

/** A static site reported running by a fresh hosting node. */
async function runningSite() {
  const u = await user();
  const node = privateKeyToAccount(generatePrivateKey());
  const ann = await signed(node, "/v1/nodes/announce", {
    manifest: { cpuThreads: 8, ramGB: 16, gpus: [], os: "linux" }, benchmarkMmacPerSec: 100, workTypes: ["matmul", "hosting"], pubkey: node.publicKey.slice(2), publicHost: "203.0.113.10",
  });
  expect(ann.status).toBe(200);
  await getD1().prepare("UPDATE nodes SET payout = ? WHERE address = ?").bind("0x" + "e".repeat(40), node.address.toLowerCase()).run();
  // Older queued deployments from other tests must not take this node's slot.
  await getD1().prepare("UPDATE deployments SET status = 'stopped', stop_acked_at = 1 WHERE status = 'queued'").run();
  const id = await createSite(u.jwt);
  expect((await signed(node, "/v1/nodes/heartbeat")).status).toBe(200);
  const r = await signed(node, `/v1/nodes/deployments/${id}/status`, { status: "running", endpoint: "http://203.0.113.10:42001" });
  expect(r.status).toBe(200);
  return { u, node, id };
}

const row = (id: string) => getD1().prepare("SELECT * FROM deployments WHERE id = ?").bind(id).first<Record<string, any>>();
const adminStop = (id: string, key = INTERNAL_KEY) => call(`/v1/admin/deployments/${id}/stop`, { method: "POST", headers: { "X-Internal-Key": key } });

beforeAll(async () => {
  await setupV1Db({ DEV_MODE: "true", INTERNAL_API_KEY: INTERNAL_KEY, SITES_DOMAIN: "sites.example.test" });
  // HOSTING_MIGRATIONS run inside ensureSchema() now (lib/schema.ts).
  app = buildApp({ runtime: "node" });
  bare = new OpenAPIHono();
  bare.route("/v1", deploymentsRouter);
});

describe("probe hash at upload", () => {
  it("picks index.html and stores its sha256", async () => {
    const probe = await staticProbe(SITE);
    expect(probe.path).toBe("index.html");
    expect(probe.hash).toMatch(/^[0-9a-f]{64}$/);
    const nodeHash = (await import("node:crypto")).createHash("sha256").update(INDEX).digest("hex");
    expect(probe.hash).toBe(nodeHash);

    const u = await user();
    const id = await createSite(u.jwt);
    expect(await row(id)).toMatchObject({ probe_path: "index.html", probe_hash: nodeHash });
  });

  it("falls back to the first file sorted when there is no index.html", async () => {
    const probe = await staticProbe({ files: [{ path: "b.txt", contentBase64: b64("b") }, { path: "a.txt", contentBase64: b64("a") }] });
    expect(probe.path).toBe("a.txt");
  });
});

describe("url", () => {
  it("is https://{id}.{SITES_DOMAIN} and the origin stays in endpoint", async () => {
    const { u, id } = await runningSite();
    const got = await (await call(`/v1/deployments/${id}`, { headers: { Authorization: `Bearer ${u.jwt}` } })).json();
    expect(got.deployment).toMatchObject({ url: `https://${id}.sites.example.test`, endpoint: "http://203.0.113.10:42001", status: "running" });
  });
});

describe("GET /v1/deployments/{id}/route (public)", () => {
  it("answers endpoint + state for a running site, cached 30 s", async () => {
    const { id } = await runningSite();
    const res = await bare.request(`/v1/deployments/${id}/route`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=30");
    expect(await res.json()).toEqual({ status: "success", id, state: "running", endpoint: "http://203.0.113.10:42001", kind: "static" });
  });

  it("hides the endpoint while not running and 404s unknown ids", async () => {
    const u = await user();
    const id = await createSite(u.jwt);
    const queued = await (await bare.request(`/v1/deployments/${id}/route`)).json();
    expect(queued).toEqual({ status: "success", id, state: "queued", endpoint: null, kind: "static" });
    expect((await bare.request(`/v1/deployments/${crypto.randomUUID()}/route`)).status).toBe(404);
    expect((await bare.request(`/v1/deployments/not-a-uuid/route`)).status).toBe(400);
  });
});

describe("POST /v1/admin/deployments/{id}/stop", () => {
  it("needs the internal key", async () => {
    const { id } = await runningSite();
    expect((await adminStop(id, "wrong")).status).toBe(401);
    expect((await call(`/v1/admin/deployments/${id}/stop`, { method: "POST" })).status).toBe(401);
    expect((await row(id))!.status).toBe("running");
  });

  it("stops with reason admin and the node is told to stop on its heartbeat", async () => {
    const { id, node } = await runningSite();
    const res = await adminStop(id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "success", deploymentStatus: "stopped" });
    expect(await row(id)).toMatchObject({ status: "stopped", status_reason: "admin", stop_acked_at: null });

    const hb = await (await signed(node, "/v1/nodes/heartbeat")).json();
    expect(hb.deployments).toContainEqual(expect.objectContaining({ id, action: "stop" }));
    expect((await bare.request(`/v1/deployments/${id}/route`).then((r) => r.json())).state).toBe("stopped");
    // idempotent
    expect((await adminStop(id)).status).toBe(200);
    expect((await adminStop(crypto.randomUUID())).status).toBe(404);
  });
});
