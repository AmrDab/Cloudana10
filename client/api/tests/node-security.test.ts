/**
 * Node security (docs/IMPL_SPEC_2026-10.md): signed instructions (API sign → agent verify), node→API nonce replay,
 * capability/fleet/resource gating in placement, content-hash probe + endpoint host check, per-node rate limits,
 * minAgentVersion, the duties cron, and the agent's "cannot serve" re-queue.
 */
import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { privateKeyToAccount, generatePrivateKey, type PrivateKeyAccount } from "viem/accounts";
import { buildApp } from "../src/app.js";
import { getD1 } from "../src/lib/storage.js";
import { resetEnv } from "../src/config/env.js";
import { generateToken } from "../src/middleware/auth.js";
import { nodeSigningMessage } from "../src/middleware/node-auth.js";
import { creditUcld } from "../src/services/balance.service.js";
import { HOSTING_MIGRATIONS } from "../src/db/migrations-hosting.js";
import { checkSpec } from "../src/services/deployment-spec.js";
import { canonicalJSON, instructionSignerAddress, signInstruction, compareVersions, agentVersionAllowed } from "../src/services/instruction-signing.service.js";
import { NODE_CANNOT_SERVE, probeOne, probeUrl, runDutiesCron, imageAllowed } from "../src/services/deployment-duties.service.js";
// The agent's verifier, so the round trip is the real one (node-agent/src/instructions.ts).
import { NonceLru, verifyInstruction, canonicalJSON as agentCanonicalJSON } from "../../../node-agent/src/instructions.ts";

const SIGNING_KEY = generatePrivateKey();
const SIGNER = privateKeyToAccount(SIGNING_KEY).address;
let app: ReturnType<typeof buildApp>;
let ipSeq = 0;
let userSeq = 0;

function call(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", `10.7.${Math.floor(ipSeq / 250)}.${ipSeq++ % 250}`);
  return app.request(path, { ...init, headers });
}

function authed(jwt: string, method: string, path: string, body?: unknown) {
  return call(path, {
    method,
    headers: { Authorization: `Bearer ${jwt}`, ...(body !== undefined && { "Content-Type": "application/json" }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

/** Build a node-signed request; `nonce: null` omits the nonce (as agents < 1.1.0 did — refused since 1.1.0 is the minimum). */
async function signedRequest(node: PrivateKeyAccount, path: string, payload: unknown = {}, nonce: string | null = randomBytes(16).toString("hex")) {
  const body = JSON.stringify(payload);
  const ts = String(Date.now());
  const signature = await node.signMessage({ message: nodeSigningMessage("POST", path, ts, body, nonce ?? undefined) });
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Node": node.address, "X-Node-Timestamp": ts, "X-Node-Signature": signature, ...(nonce && { "X-Nonce": nonce }) },
    body,
  };
}
const signed = async (node: PrivateKeyAccount, path: string, payload: unknown = {}) => call(path, await signedRequest(node, path, payload));

const MANIFEST = { cpuThreads: 8, ramGB: 16, gpus: [], os: "linux" };
const announceBody = (node: PrivateKeyAccount, workTypes: string[], extra: Record<string, unknown> = {}) => ({
  manifest: MANIFEST,
  benchmarkMmacPerSec: 100,
  workTypes,
  pubkey: node.publicKey.slice(2),
  publicHost: "127.0.0.1",
  agentVersion: "1.1.0",
  ...extra,
});

async function boundNode(workTypes: string[], opts: { fleet?: boolean; announce?: Record<string, unknown> } = {}) {
  const node = privateKeyToAccount(generatePrivateKey());
  const res = await signed(node, "/v1/nodes/announce", announceBody(node, workTypes, opts.announce));
  expect(res.status).toBe(200);
  const payout = "0x" + (++userSeq).toString(16).padStart(40, "e");
  await getD1()
    .prepare("UPDATE nodes SET payout = ?, fleet_id = ? WHERE address = ?")
    .bind(payout, opts.fleet === false ? null : "flt_test", node.address.toLowerCase())
    .run();
  return { node, payout };
}

async function user(credits = 100_000) {
  const addr = "0x" + (++userSeq).toString(16).padStart(40, "c");
  await creditUcld(addr, credits);
  return { addr, jwt: await generateToken(addr) };
}

const b64 = (s: string) => Buffer.from(s).toString("base64");
const INDEX = "<h1>hello</h1>";
const SITE = { files: [{ path: "index.html", contentBase64: b64(INDEX) }] };
const CONTAINER = { image: "nginx:alpine", ports: [{ container: 80 }], cpu: 500, memMb: 512, storageMb: 1024 };
const row = (id: string) => getD1().prepare("SELECT * FROM deployments WHERE id = ?").bind(id).first<Record<string, any>>();

async function create(jwt: string, body: Record<string, unknown>) {
  const res = await authed(jwt, "POST", "/v1/deployments", { name: "d", ...body });
  expect(res.status).toBe(201);
  return (await res.json()).id as string;
}

type Heartbeat = { assignment: unknown; deployments: any[]; sig?: string; ts?: number; nonce?: string; minAgentVersion: string; upgradeRequired: boolean };
async function heartbeat(node: PrivateKeyAccount, body: unknown = {}) {
  const res = await signed(node, "/v1/nodes/heartbeat", body);
  expect(res.status).toBe(200);
  return (await res.json()) as Heartbeat;
}

beforeAll(async () => {
  await setupV1Db({ DEV_MODE: "true", INSTRUCTION_SIGNING_KEY: SIGNING_KEY, NODE_ACTIVE_SECONDS: "15" });
  for (const sql of HOSTING_MIGRATIONS) await getD1().prepare(sql).run().catch(() => undefined);
  app = buildApp({ runtime: "node" });
});
beforeEach(async () => {
  await getD1().prepare("UPDATE deployments SET status = 'stopped', stop_acked_at = 1 WHERE status IN ('queued','assigned','running','unreachable')").run();
  await getD1().prepare("UPDATE nodes SET last_seen = 0").run();
});
afterEach(() => vi.unstubAllGlobals());

describe("instruction signing: API sign → agent verify", () => {
  const node = privateKeyToAccount(generatePrivateKey());
  const body = { assignment: null, deployments: [{ id: "x", action: "start", kind: "static", spec: { files: [] } }] };

  it("both sides canonicalise JSON identically", () => {
    const v = { z: [3, { b: 1, a: undefined }], a: "é", n: null };
    expect(canonicalJSON(v)).toBe(agentCanonicalJSON(v));
    expect(canonicalJSON({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("round trip verifies; the same envelope is a replay; expired or foreign signatures are refused", async () => {
    expect(instructionSignerAddress()).toBe(SIGNER);
    const env = (await signInstruction(node.address, body))!;
    expect(env.nonce).toMatch(/^[0-9a-f]{32}$/);
    const seen = new NonceLru();
    expect(await verifyInstruction(env, node.address, body, SIGNER, seen)).toEqual({ ok: true });
    // Key order the agent sees may differ from what the API serialised.
    const reordered = { deployments: [{ spec: { files: [] }, kind: "static", action: "start", id: "x" }], assignment: null };
    expect(await verifyInstruction(env, node.address, reordered, SIGNER, new NonceLru())).toEqual({ ok: true });
    expect(await verifyInstruction(env, node.address, body, SIGNER, seen)).toEqual({ ok: false, reason: "replayed nonce" });
    expect(await verifyInstruction(env, node.address, body, SIGNER, new NonceLru(), env.ts + 61_000)).toEqual({ ok: false, reason: "stale timestamp" });
    expect(await verifyInstruction(env, node.address, { ...body, deployments: [] }, SIGNER, new NonceLru())).toEqual({ ok: false, reason: "wrong signer" });
    expect(await verifyInstruction(env, "0x" + "1".repeat(40), body, SIGNER, new NonceLru())).toEqual({ ok: false, reason: "wrong signer" });
    const other = privateKeyToAccount(generatePrivateKey()).address;
    expect(await verifyInstruction(env, node.address, body, other, new NonceLru())).toEqual({ ok: false, reason: "wrong signer" });
    expect(await verifyInstruction({ ...env, sig: undefined }, node.address, body, SIGNER, new NonceLru())).toEqual({ ok: false, reason: "unsigned" });
  });

  it("the heartbeat response is signed over { assignment, deployments } for that node, and the key is published", async () => {
    const u = await user();
    const { node: n } = await boundNode(["matmul", "hosting"]);
    const id = await create(u.jwt, { kind: "static", spec: SITE });
    const hb = await heartbeat(n);
    expect(hb.deployments.map((d) => d.id)).toEqual([id]);
    expect(hb.upgradeRequired).toBe(false);
    const payload = { assignment: hb.assignment, deployments: hb.deployments };
    expect(await verifyInstruction(hb, n.address, payload, SIGNER, new NonceLru())).toEqual({ ok: true });
    // Signed for this node only: another node cannot replay the instruction.
    const stranger = privateKeyToAccount(generatePrivateKey());
    expect(await verifyInstruction(hb, stranger.address, payload, SIGNER, new NonceLru())).toEqual({ ok: false, reason: "wrong signer" });

    const key = await (await call("/v1/nodes/instruction-key")).json();
    expect(key).toEqual({ status: "success", signer: SIGNER, minAgentVersion: "1.1.0" });
  });

  it("without INSTRUCTION_SIGNING_KEY the heartbeat is unsigned (agents ignore it) and the key route is 503", async () => {
    const saved = process.env.INSTRUCTION_SIGNING_KEY;
    delete process.env.INSTRUCTION_SIGNING_KEY;
    try {
      const { node: n } = await boundNode(["matmul"]);
      const hb = await heartbeat(n);
      expect(hb.sig).toBeUndefined();
      expect(await verifyInstruction(hb, n.address, { assignment: null, deployments: [] }, SIGNER, new NonceLru())).toEqual({ ok: false, reason: "unsigned" });
      expect((await call("/v1/nodes/instruction-key")).status).toBe(503);
    } finally {
      process.env.INSTRUCTION_SIGNING_KEY = saved;
    }
  });
});

describe("node→API replay protection", () => {
  it("rejects a re-sent request (same nonce); a nonce-less request is refused outright", async () => {
    const node = privateKeyToAccount(generatePrivateKey());
    const req = await signedRequest(node, "/v1/nodes/announce", announceBody(node, ["matmul"]));
    expect((await call("/v1/nodes/announce", req)).status).toBe(200);
    const replay = await call("/v1/nodes/announce", req);
    expect(replay.status).toBe(401);
    expect((await replay.json()).error.message).toMatch(/replay/i);

    const legacy = await signedRequest(node, "/v1/nodes/heartbeat", {}, null);
    const noNonce = await call("/v1/nodes/heartbeat", legacy);
    expect(noNonce.status).toBe(401);
    expect((await noNonce.json()).error.message).toMatch(/nonce/i);
    // A nonce that is not part of the signed message is refused like any tampering.
    const fresh = await signedRequest(node, "/v1/nodes/heartbeat", {});
    fresh.headers["X-Nonce"] = randomBytes(16).toString("hex");
    expect((await call("/v1/nodes/heartbeat", fresh)).status).toBe(401);
    const bad = await signedRequest(node, "/v1/nodes/heartbeat", {}, "zz");
    expect((await call("/v1/nodes/heartbeat", bad)).status).toBe(401);
  });
});

describe("minAgentVersion", () => {
  it("compares semver and defaults to the current agent version", () => {
    expect(compareVersions("1.1.0", "1.0.9")).toBeGreaterThan(0);
    expect(compareVersions("1.1.0", "1.1.0")).toBe(0);
    expect(compareVersions("0.9.0", "1.1.0")).toBeLessThan(0);
    expect(agentVersionAllowed("1.1.0")).toBe(true);
    expect(agentVersionAllowed("1.0.0")).toBe(false);
    expect(agentVersionAllowed(null)).toBe(false);
  });

  it("an old agent gets stops but no starts or assignments, and is told to upgrade", async () => {
    const u = await user();
    const { node: n } = await boundNode(["matmul", "hosting"], { announce: { agentVersion: "1.0.0" } });
    const id = await create(u.jwt, { kind: "static", spec: SITE });
    const hb = await heartbeat(n);
    expect(hb).toMatchObject({ upgradeRequired: true, minAgentVersion: "1.1.0", assignment: null, deployments: [] });
    // It was still assigned (per-node duty) — the start is withheld, not lost; an upgraded heartbeat delivers it.
    expect((await row(id))!.status).toBe("assigned");
    const upgraded = await heartbeat(n, { agentVersion: "1.1.0" });
    expect(upgraded.upgradeRequired).toBe(false);
    expect(upgraded.deployments.map((d) => d.id)).toEqual([id]);
    // A node that never reported a version is treated as too old.
    const { node: legacy } = await boundNode(["matmul"], { announce: { agentVersion: undefined } });
    expect((await heartbeat(legacy)).upgradeRequired).toBe(true);
  });
});

describe("placement gating", () => {
  it("places containers only on fleet nodes that announced `container` (static sites go to any hosting node)", async () => {
    const u = await user();
    const cid = await create(u.jwt, { kind: "container", spec: CONTAINER });
    const sid = await create(u.jwt, { kind: "static", spec: SITE });
    const { node: home } = await boundNode(["matmul", "hosting", "container"], { fleet: false });
    const hb = await heartbeat(home);
    expect(hb.deployments.map((d) => d.id)).toEqual([sid]); // no container for a home node
    expect((await row(cid))!.status).toBe("queued");
    const { node: hostingOnly } = await boundNode(["matmul", "hosting"]);
    expect((await heartbeat(hostingOnly)).deployments).toEqual([]);
    const { node: fleet } = await boundNode(["matmul", "hosting", "container"]);
    const got = await heartbeat(fleet);
    expect(got.deployments).toEqual([expect.objectContaining({ id: cid, action: "start", kind: "container", imageAllowed: false })]);
  });

  it("refuses containers that do not fit the node's CPU/RAM, and flags curated images", async () => {
    const u = await user();
    const big = await create(u.jwt, { kind: "container", spec: { ...CONTAINER, memMb: 32_768 } });
    const cpuHog = await create(u.jwt, { kind: "container", spec: { ...CONTAINER, cpu: 9000 } });
    const small = await create(u.jwt, { kind: "container", spec: { ...CONTAINER, image: "quay.io/jupyter/pytorch-notebook:cuda12-latest" } });
    const { node } = await boundNode(["matmul", "hosting", "container"]); // 8 threads, 16 GB
    const hb = await heartbeat(node);
    expect(hb.deployments.map((d) => d.id)).toEqual([small]);
    expect(hb.deployments[0].imageAllowed).toBe(true);
    expect((await row(big))!.status).toBe("queued");
    expect((await row(cpuHog))!.status).toBe("queued");
    expect(imageAllowed("nginx:alpine")).toBe(false);
  });

  it("outside DEV_MODE, a node without a public host announces no hosting capabilities", async () => {
    process.env.DEV_MODE = "false";
    resetEnv();
    try {
      const a = privateKeyToAccount(generatePrivateKey());
      expect((await signed(a, "/v1/nodes/announce", announceBody(a, ["matmul", "hosting", "container"], { publicHost: "127.0.0.1" }))).status).toBe(200);
      const b = privateKeyToAccount(generatePrivateKey());
      expect((await signed(b, "/v1/nodes/announce", announceBody(b, ["matmul", "hosting"], { publicHost: undefined }))).status).toBe(200);
      // A public host that is NOT the IP the announce came from is self-chosen → no hosting (billing-fraud guard).
      const c = privateKeyToAccount(generatePrivateKey());
      expect((await signed(c, "/v1/nodes/announce", announceBody(c, ["matmul", "hosting"], { publicHost: "203.0.113.5" }))).status).toBe(200);
      const d = privateKeyToAccount(generatePrivateKey());
      expect((await signed(d, "/v1/nodes/announce", announceBody(d, ["hosting"], { publicHost: "192.168.1.4" }))).status).toBe(400);
      // Announced from its own public IP (TRUST_PROXY lets the test set the header): hosting stays.
      process.env.TRUST_PROXY = "true";
      resetEnv();
      const fromIp = async (n: PrivateKeyAccount, host: string, ip: string) => {
        const req = await signedRequest(n, "/v1/nodes/announce", announceBody(n, ["matmul", "hosting"], { publicHost: host }));
        return app.request("/v1/nodes/announce", { ...req, headers: { ...req.headers, "cf-connecting-ip": ip } });
      };
      const e = privateKeyToAccount(generatePrivateKey());
      expect((await fromIp(e, "203.0.113.77", "203.0.113.77")).status).toBe(200);
      // IPv6: brackets are stripped in storage so endpoint hosts compare equal.
      const f = privateKeyToAccount(generatePrivateKey());
      expect((await fromIp(f, "[2001:DB8::10]", "2001:db8::10")).status).toBe(200);
      const types = async (n: PrivateKeyAccount) =>
        JSON.parse((await getD1().prepare("SELECT work_types FROM nodes WHERE address = ?").bind(n.address.toLowerCase()).first<{ work_types: string }>())!.work_types);
      expect(await types(a)).toEqual(["matmul"]);
      expect(await types(b)).toEqual(["matmul"]);
      expect(await types(c)).toEqual(["matmul"]);
      expect(await types(e)).toEqual(["matmul", "hosting"]);
      expect(await types(f)).toEqual(["matmul", "hosting"]);
      expect((await getD1().prepare("SELECT public_host FROM nodes WHERE address = ?").bind(f.address.toLowerCase()).first<{ public_host: string }>())!.public_host).toBe("2001:db8::10");
    } finally {
      process.env.DEV_MODE = "true";
      delete process.env.TRUST_PROXY;
      resetEnv();
    }
  });

  it("per-node limits key on the VERIFIED address: unsigned requests naming a victim's X-Node do not consume its quota", async () => {
    const { node } = await boundNode(["matmul"]);
    // 20 unsigned requests claiming to be this node: all 401, none counted against it.
    for (let i = 0; i < 20; i++) {
      const res = await call("/v1/nodes/heartbeat", { method: "POST", body: "{}", headers: { "Content-Type": "application/json", "X-Node": node.address } });
      expect(res.status).toBe(401);
    }
    const mine = await signed(node, "/v1/nodes/heartbeat");
    expect(mine.status).toBe(200);
    expect(mine.headers.get("X-RateLimit-Limit")).toBe("12");
  });

  it("refuses changing publicHost while the node has live deployments", async () => {
    const u = await user();
    const { node } = await boundNode(["matmul", "hosting"]);
    const id = await create(u.jwt, { kind: "static", spec: SITE });
    expect((await heartbeat(node)).deployments.map((d) => d.id)).toEqual([id]); // assigned
    const moved = await signed(node, "/v1/nodes/announce", announceBody(node, ["matmul", "hosting"], { publicHost: "203.0.113.42" }));
    expect(moved.status).toBe(409);
    expect((await moved.json()).error.message).toMatch(/live deployments/);
    // Same host again is fine.
    expect((await signed(node, "/v1/nodes/announce", announceBody(node, ["matmul", "hosting"]))).status).toBe(200);
    await getD1().prepare("UPDATE deployments SET status = 'stopped', stop_acked_at = 1 WHERE id = ?").bind(id).run();
    expect((await signed(node, "/v1/nodes/announce", announceBody(node, ["matmul", "hosting"], { publicHost: "203.0.113.42" }))).status).toBe(200);
  });

  it("containers may not run as root: spec.user 0 / 0:0 is refused, 1000 is fine", async () => {
    for (const user of ["0", "0:0", "0:1000"]) expect(checkSpec("container", { ...CONTAINER, user }).ok, user).toBe(false);
    expect(checkSpec("container", { ...CONTAINER, user: "1000:1000" }).ok).toBe(true);
    expect(checkSpec("container", { ...CONTAINER, user: "65534" }).ok).toBe(true);
  });

  it("aligns access.web.path with the agent's alphabet", () => {
    const ws = (path: string) => ({
      image: "x", ports: [{ container: 80 }], cpu: 500, memMb: 512, storageMb: 1024, tier: "on-demand", maxHours: 1, access: { web: { port: 80, path } },
    });
    expect(checkSpec("workstation", ws("/lab/tree~1")).ok).toBe(true);
    for (const p of ["/lab?x=1", "/a b", "/x;y", "/<script>"]) expect(checkSpec("workstation", ws(p)).ok, p).toBe(false);
  });
});

describe("endpoint host and content-hash probe", () => {
  it("refuses a running report whose endpoint is not on the node's announced host", async () => {
    const u = await user();
    const { node } = await boundNode(["matmul", "hosting"]);
    const id = await create(u.jwt, { kind: "static", spec: SITE });
    await heartbeat(node);
    const bad = await signed(node, `/v1/nodes/deployments/${id}/status`, { status: "running", endpoint: "http://203.0.113.9:42001" });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.message).toMatch(/announced public host/);
    expect((await row(id))!.status).toBe("assigned");
    const good = await signed(node, `/v1/nodes/deployments/${id}/status`, { status: "running", endpoint: "http://127.0.0.1:42001" });
    expect(good.status).toBe(200);
    // Moving it later to another host is refused too.
    const move = await signed(node, `/v1/nodes/deployments/${id}/status`, { status: "running", endpoint: "http://203.0.113.9:42001" });
    expect(move.status).toBe(400);
    expect((await row(id))!.endpoint).toBe("http://127.0.0.1:42001");
  });

  it("a node that cannot serve (agent-reported) gets the deployment re-queued and is skipped for it", async () => {
    const u = await user();
    const { node } = await boundNode(["matmul", "hosting"]);
    const id = await create(u.jwt, { kind: "static", spec: SITE });
    expect((await heartbeat(node)).deployments.map((d) => d.id)).toEqual([id]);
    const r = await signed(node, `/v1/nodes/deployments/${id}/status`, { status: "failed", message: `${NODE_CANNOT_SERVE} endpoint host must be the node's announced public host` });
    expect(await r.json()).toEqual({ status: "success", deploymentStatus: "queued" });
    expect(await row(id)).toMatchObject({ status: "queued", node: null, status_reason: expect.stringMatching(/^refused by node 0x/) });
    expect((await heartbeat(node)).deployments).toEqual([]); // not handed back to the same node
    const { node: other } = await boundNode(["matmul", "hosting"]);
    expect((await heartbeat(other)).deployments.map((d) => d.id)).toEqual([id]);
  });

  it("probeUrl / probeOne: hash must match; reachability only without a hash", async () => {
    expect(probeUrl("http://203.0.113.5:42001/?token=abc", "index.html")).toBe("http://203.0.113.5:42001/index.html");
    expect(probeUrl("http://h:1", "/a b/c.html")).toBe("http://h:1/a%20b/c.html");
    const hash = "5a6f0ca2d8b4d0b7e0b2f6c1f5e0d4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7";
    const sha = (await import("node:crypto")).createHash("sha256").update(INDEX).digest("hex");
    const fetchMock = vi.fn(async (url: string) => new Response(String(url).endsWith("/index.html") ? INDEX : "nope"));
    vi.stubGlobal("fetch", fetchMock);
    expect(await probeOne("http://127.0.0.1:1", { path: "index.html", hash: sha })).toBe(true);
    expect(await probeOne("http://127.0.0.1:1", { path: "index.html", hash })).toBe(false);
    expect(await probeOne("http://127.0.0.1:1", { path: "other.html", hash: sha })).toBe(false);
    expect(await probeOne("http://127.0.0.1:1")).toBe(true);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status: 404 })));
    expect(await probeOne("http://127.0.0.1:1", { path: "index.html", hash: sha })).toBe(false);
    expect(await probeOne("http://127.0.0.1:1")).toBe(false);
  });

  it("the heartbeat probe uses the stored probe_path/probe_hash: a wrong body counts as a failed probe", async () => {
    const u = await user();
    const { node } = await boundNode(["matmul", "hosting"]);
    const id = await create(u.jwt, { kind: "static", spec: SITE });
    await heartbeat(node);
    expect((await signed(node, `/v1/nodes/deployments/${id}/status`, { status: "running", endpoint: "http://127.0.0.1:42001" })).status).toBe(200);
    const sha = (await import("node:crypto")).createHash("sha256").update(INDEX).digest("hex");
    await getD1().prepare("UPDATE deployments SET probe_path = 'index.html', probe_hash = ?, last_probe_at = 0 WHERE id = ?").bind(sha, id).run();

    const served = vi.fn(async () => new Response(INDEX));
    vi.stubGlobal("fetch", served);
    await heartbeat(node);
    expect(served).toHaveBeenCalledWith("http://127.0.0.1:42001/index.html", expect.anything());
    expect(await row(id)).toMatchObject({ probe_fail: 0, status: "running" });

    await getD1().prepare("UPDATE deployments SET last_probe_at = 0 WHERE id = ?").bind(id).run();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<h1>someone else's site</h1>")));
    await heartbeat(node);
    expect(await row(id)).toMatchObject({ probe_fail: 1, status: "running" });
    const events = await (await authed(u.jwt, "GET", `/v1/deployments/${id}`)).json();
    expect(events.events[0].message).toMatch(/content probe failed \(1\/3\)/);
  });
});

describe("rate limits and the duties cron", () => {
  it("limits heartbeats per node address, independent of the client IP", async () => {
    const { node } = await boundNode(["matmul"]);
    let last = 200;
    for (let i = 0; i < 14 && last === 200; i++) last = (await signed(node, "/v1/nodes/heartbeat", {})).status;
    expect(last).toBe(429);
    const { node: other } = await boundNode(["matmul"]);
    expect((await signed(other, "/v1/nodes/heartbeat", {})).status).toBe(200);
  });

  it("limits POST /v1/nodes/bind per IP", async () => {
    const body = { node: "0x" + "a".repeat(40), payout: "0x" + "b".repeat(40), message: "x", signature: "0xab", code: "0".repeat(16) };
    const headers = { "Content-Type": "application/json", "cf-connecting-ip": "198.51.100.77" };
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await app.request("/v1/nodes/bind", { method: "POST", headers, body: JSON.stringify(body) })).status;
    expect(last).toBe(429);
  });

  it("global duties run from the cron, not the heartbeat: dead-node re-queue, preemption, matmul assignment", async () => {
    const u = await user();
    const { node: dead } = await boundNode(["matmul", "hosting"]);
    const id = await create(u.jwt, { kind: "static", spec: SITE });
    await heartbeat(dead);
    expect((await signed(dead, `/v1/nodes/deployments/${id}/status`, { status: "running", endpoint: "http://127.0.0.1:42001" })).status).toBe(200);
    await getD1().prepare("UPDATE nodes SET last_seen = ? WHERE address = ?").bind(Date.now() - 50_000, dead.address.toLowerCase()).run();
    const { node: alive } = await boundNode(["matmul"]);
    await heartbeat(alive);
    expect((await row(id))!.status).toBe("running"); // heartbeat did not touch other nodes' deployments
    expect(await runDutiesCron()).toEqual({ requeued: 1, preempted: 0, assigned: 0 });
    expect(await row(id)).toMatchObject({ status: "queued", node: null, status_reason: "node went offline" });
  });
});
