import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { privateKeyToAccount, generatePrivateKey, type PrivateKeyAccount } from "viem/accounts";
import { buildApp } from "../src/app.js";
import { getD1 } from "../src/lib/storage.js";
import { generateToken } from "../src/middleware/auth.js";
import { nodeSigningMessage } from "../src/middleware/node-auth.js";
import { creditUcld, getBalanceUcld } from "../src/services/balance.service.js";
import { closeEpochs } from "../src/services/ledger.service.js";
import { endpointAllowed, priceUcldPerHour } from "../src/services/deployment-spec.js";
import { runDutiesCron } from "../src/services/deployment-duties.service.js";

const TREASURY = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
let app: ReturnType<typeof buildApp>;
let ipSeq = 0;
let userSeq = 0;

function call(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", `10.9.${Math.floor(ipSeq / 250)}.${ipSeq++ % 250}`);
  return app.request(path, { ...init, headers });
}

function authed(jwt: string, method: string, path: string, body?: unknown) {
  return call(path, {
    method,
    headers: { Authorization: `Bearer ${jwt}`, ...(body !== undefined && { "Content-Type": "application/json" }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

async function signed(node: PrivateKeyAccount, path: string, payload: unknown = {}) {
  const body = JSON.stringify(payload);
  const ts = String(Date.now());
  const nonce = randomBytes(16).toString("hex");
  const signature = await node.signMessage({ message: nodeSigningMessage("POST", path, ts, body, nonce) });
  return call(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Node": node.address, "X-Node-Timestamp": ts, "X-Nonce": nonce, "X-Node-Signature": signature },
    body,
  });
}

const MANIFEST = { cpuThreads: 8, ramGB: 16, gpus: [], os: "linux" };

/** A bound fleet node with the given capabilities (payout = a fresh wallet); it serves on 127.0.0.1 (DEV_MODE). */
async function boundNode(workTypes: string[]) {
  const node = privateKeyToAccount(generatePrivateKey());
  const res = await signed(node, "/v1/nodes/announce", {
    manifest: MANIFEST,
    benchmarkMmacPerSec: 100,
    workTypes,
    pubkey: node.publicKey.slice(2),
    publicHost: "127.0.0.1",
    agentVersion: "1.1.0",
  });
  expect(res.status).toBe(200);
  const payout = "0x" + (++userSeq).toString(16).padStart(40, "e");
  await getD1().prepare("UPDATE nodes SET payout = ?, fleet_id = 'flt_test' WHERE address = ?").bind(payout, node.address.toLowerCase()).run();
  return { node, payout };
}

async function user(credits = 10_000) {
  const addr = "0x" + (++userSeq).toString(16).padStart(40, "c");
  if (credits > 0) await creditUcld(addr, credits);
  return { addr, jwt: await generateToken(addr) };
}

const b64 = (s: string) => Buffer.from(s).toString("base64");
const SITE = { files: [{ path: "index.html", contentBase64: b64("<h1>hi</h1>") }, { path: "css/a.css", contentBase64: b64("h1{}") }] };
const CONTAINER = { image: "nginx:alpine", env: { A: "1", SECRET_ISH: "plain" }, ports: [{ container: 80 }], cpu: 500, memMb: 512, storageMb: 1024 };

async function create(jwt: string, body: Record<string, unknown> = {}) {
  return authed(jwt, "POST", "/v1/deployments", { name: "site", kind: "static", spec: SITE, ...body });
}

async function heartbeat(node: PrivateKeyAccount) {
  const res = await signed(node, "/v1/nodes/heartbeat");
  expect(res.status).toBe(200);
  return (await res.json()) as { deployments: { id: string; action: string; kind: string; spec: unknown; sealedEnv?: string }[] };
}

const row = (id: string) => getD1().prepare("SELECT * FROM deployments WHERE id = ?").bind(id).first<Record<string, any>>();
const shift = (id: string, col: string, ms: number) => getD1().prepare(`UPDATE deployments SET ${col} = ${col} - ? WHERE id = ?`).bind(ms, id).run();

/** Deploy a static site, assign it to a fresh hosting node and report it running. */
async function runningSite(credits = 10_000) {
  const u = await user(credits);
  const { node, payout } = await boundNode(["matmul", "hosting"]);
  const id = (await (await create(u.jwt)).json()).id as string;
  await heartbeat(node);
  const r = await signed(node, `/v1/nodes/deployments/${id}/status`, { status: "running", endpoint: "http://127.0.0.1:42001" });
  expect(r.status).toBe(200);
  return { u, node, payout, id };
}

beforeAll(async () => {
  await setupV1Db({ DEV_MODE: "true", TREASURY_ADDRESS: TREASURY, NODE_ACTIVE_SECONDS: "15" });
  app = buildApp({ runtime: "node" });
});

// Assignment takes the oldest queued deployments: keep each test's queue its own.
beforeEach(async () => {
  await getD1().prepare("UPDATE deployments SET status = 'stopped', stop_acked_at = 1 WHERE status = 'queued'").run();
});
afterEach(() => vi.unstubAllGlobals());

describe("create", () => {
  it("queues a static site at 50 µCLD/h and holds the first hour", async () => {
    const u = await user(1000);
    const res = await create(u.jwt);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ status: "success", id: expect.any(String), priceUcldPerHour: 50, deploymentStatus: "queued" });
    expect(await getBalanceUcld(u.addr)).toEqual({ balanceUcld: 950, heldUcld: 50 });

    const got = await (await authed(u.jwt, "GET", `/v1/deployments/${body.id}`)).json();
    expect(got.deployment).toMatchObject({ id: body.id, kind: "static", status: "queued", probeOk: null, node: null });
    expect(got.deployment.spec).toEqual({ files: [{ path: "index.html", bytes: 11 }, { path: "css/a.css", bytes: 4 }] });
    // newest first: no hosting node is online yet, so the last event says so
    expect(got.events.map((e: { message: string }) => e.message)).toEqual([
      "waiting for a capable node",
      "queued at 50 µCLD/hour; first hour held",
    ]);
    const list = await (await authed(u.jwt, "GET", "/v1/deployments")).json();
    expect(list.deployments.map((d: { id: string }) => d.id)).toEqual([body.id]);
  });

  it("rejects bad specs, a missing index.html and short balances", async () => {
    const u = await user(1000);
    const bad = await create(u.jwt, { spec: { files: [{ path: "../index.html", contentBase64: b64("x") }] } });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe("validation_failed");
    expect((await create(u.jwt, { spec: { files: [{ path: "/index.html", contentBase64: b64("x") }] } })).status).toBe(400);
    const noIndex = await create(u.jwt, { spec: { files: [{ path: "about.html", contentBase64: b64("x") }] } });
    expect(noIndex.status).toBe(400);
    expect((await noIndex.json()).error.message).toContain("index.html");
    expect((await create(u.jwt, { kind: "container", spec: { image: "nginx", ports: [], cpu: 500, memMb: 512, storageMb: 1024 } })).status).toBe(400);
    const big = "A".repeat(4 * 1024 * 1024);
    expect((await create(u.jwt, { spec: { files: [{ path: "index.html", contentBase64: big }] } })).status).toBe(413);
    const poor = await user(10);
    expect((await create(poor.jwt)).status).toBe(422);
    expect(await getBalanceUcld(u.addr)).toEqual({ balanceUcld: 1000, heldUcld: 0 });
  });

  it("prices containers from resources with a 50 µCLD floor", () => {
    expect(priceUcldPerHour("container", { ...CONTAINER, cpu: 1000, memMb: 1024, storageMb: 1024 })).toBe(320);
    expect(priceUcldPerHour("container", { ...CONTAINER, cpu: 100, memMb: 64, storageMb: 64 })).toBe(50);
  });

  it("a container stays queued without a container-capable node", async () => {
    const u = await user();
    const { node } = await boundNode(["matmul", "hosting"]);
    const id = (await (await create(u.jwt, { kind: "container", spec: CONTAINER })).json()).id;
    expect((await heartbeat(node)).deployments.find((d) => d.id === id)).toBeUndefined();
    const got = await (await authed(u.jwt, "GET", `/v1/deployments/${id}`)).json();
    expect(got.deployment.status).toBe("queued");
    expect(got.deployment.spec.envKeys).toEqual(["A", "SECRET_ISH"]);
    expect(JSON.stringify(got)).not.toContain("plain");
    expect(got.events.map((e: { message: string }) => e.message)).toContain("waiting for a capable node");
  });
});

describe("node side", () => {
  it("assigns on a hosting node's heartbeat, then running sets the endpoint", async () => {
    const u = await user();
    const { node } = await boundNode(["matmul", "hosting"]);
    const id = (await (await create(u.jwt)).json()).id;
    const hb = await heartbeat(node);
    expect(hb.deployments).toEqual([{ id, action: "start", kind: "static", spec: SITE }]);
    expect(await row(id)).toMatchObject({ status: "assigned", node: node.address.toLowerCase() });

    const other = privateKeyToAccount(generatePrivateKey());
    expect((await signed(other, `/v1/nodes/deployments/${id}/status`, { status: "running", endpoint: "http://127.0.0.1:1" })).status).toBe(404);
    const r = await signed(node, `/v1/nodes/deployments/${id}/status`, { status: "running", endpoint: "http://127.0.0.1:42001" });
    expect(await r.json()).toEqual({ status: "success", deploymentStatus: "running" });
    const got = await (await authed(u.jwt, "GET", `/v1/deployments/${id}`)).json();
    expect(got.deployment).toMatchObject({ status: "running", endpoint: "http://127.0.0.1:42001", startedAt: expect.any(Number) });
    expect(got.nodePubkey).toBe(node.publicKey.slice(2));
    expect((await heartbeat(node)).deployments).toEqual([]);
    const net = await (await call("/v1/network")).json();
    expect(net.deploymentsRunning).toBeGreaterThanOrEqual(1);
  });

  it("refuses a pubkey that is not the node's own key", async () => {
    const node = privateKeyToAccount(generatePrivateKey());
    const other = privateKeyToAccount(generatePrivateKey());
    const res = await signed(node, "/v1/nodes/announce", { manifest: MANIFEST, benchmarkMmacPerSec: 1, workTypes: ["hosting"], pubkey: other.publicKey.slice(2) });
    expect(res.status).toBe(400);
  });

  it("probes: 3 failures → unreachable, success → running again", async () => {
    const { node, id } = await runningSite();
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);
    for (let i = 1; i <= 3; i++) {
      await shift(id, "last_probe_at", 61_000);
      await getD1().prepare("UPDATE deployments SET last_probe_at = COALESCE(last_probe_at, 0) WHERE id = ?").bind(id).run();
      await heartbeat(node);
      expect((await row(id))!.probe_fail).toBe(i);
    }
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:42001/index.html", expect.objectContaining({ method: "GET" }));
    expect(await row(id)).toMatchObject({ status: "unreachable" });

    // The content probe fetches probe_path and requires the uploaded bytes (sha256 of index.html), not just a 200.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<h1>hi</h1>", { status: 200 })));
    await shift(id, "last_probe_at", 61_000);
    await heartbeat(node);
    expect(await row(id)).toMatchObject({ status: "running", probe_fail: 0 });
  });

  it("does not re-probe before DEPLOY_PROBE_SECONDS", async () => {
    const { node } = await runningSite();
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    await heartbeat(node);
    await heartbeat(node);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("bills a full hour: provider lane A + treasury, no lane B, and re-holds", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("ok")));
    const { u, node, payout, id } = await runningSite(1000);
    await shift(id, "last_billed_at", 3_600_000);
    await heartbeat(node);
    const entries = await getD1().prepare("SELECT lane, address, amount_ucld, job_id FROM reward_entries WHERE address = ?").bind(payout).all<Record<string, any>>();
    expect(entries.results).toEqual([{ lane: "A", address: payout, amount_ucld: 47, job_id: expect.any(String) }]);
    const lanes = await getD1()
      .prepare("SELECT lane FROM reward_entries WHERE job_id = ?")
      .bind(entries.results![0].job_id)
      .all<{ lane: string }>();
    expect(lanes.results!.map((r) => r.lane)).not.toContain("B");
    expect(await getBalanceUcld(u.addr)).toEqual({ balanceUcld: 900, heldUcld: 50 });
    expect((await row(id))!.status).toBe("running");

    const closed = await closeEpochs(Date.now() + 2 * 3_600_000);
    const epoch = closed.find((e) => e.leaves.some((l) => l.account === payout));
    expect(epoch!.feesBurnedUcld).toBeGreaterThanOrEqual(50);
  });

  it("stops with 'out of credits' when the next hour cannot be held", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("ok")));
    const { u, node, id } = await runningSite(50);
    await shift(id, "last_billed_at", 3_600_000);
    const hb = await heartbeat(node);
    expect(await row(id)).toMatchObject({ status: "stopped", status_reason: "out of credits", stop_acked_at: null });
    expect(hb.deployments).toEqual([{ id, action: "stop", kind: "static", spec: null }]);
    expect(await getBalanceUcld(u.addr)).toEqual({ balanceUcld: 0, heldUcld: 0 });
  });
});

describe("owner actions", () => {
  it("PATCH secrets works only for containers while queued/assigned", async () => {
    const u = await user();
    const { node } = await boundNode(["matmul", "hosting", "container"]);
    const id = (await (await create(u.jwt, { kind: "container", spec: CONTAINER })).json()).id;
    const sealed = b64("ciphertext");
    expect((await authed(u.jwt, "PATCH", `/v1/deployments/${id}/secrets`, { sealedEnv: sealed })).status).toBe(200);
    const hb = await heartbeat(node);
    expect(hb.deployments[0]).toMatchObject({ id, action: "start", kind: "container", sealedEnv: sealed, spec: CONTAINER });
    expect((await authed(u.jwt, "PATCH", `/v1/deployments/${id}/secrets`, { sealedEnv: sealed })).status).toBe(200);
    await signed(node, `/v1/nodes/deployments/${id}/status`, { status: "running", endpoint: "http://127.0.0.1:42002" });
    expect((await authed(u.jwt, "PATCH", `/v1/deployments/${id}/secrets`, { sealedEnv: sealed })).status).toBe(409);

    const site = (await (await create(u.jwt)).json()).id;
    expect((await authed(u.jwt, "PATCH", `/v1/deployments/${site}/secrets`, { sealedEnv: sealed })).status).toBe(400);
  });

  it("a container expecting secrets is assigned but not started until sealedEnv arrives", async () => {
    const u = await user();
    const { node } = await boundNode(["matmul", "hosting", "container"]);
    const spec = { image: "postgres:16-alpine", ports: [{ container: 5432 }], cpu: 1000, memMb: 1024, storageMb: 10240 };
    // via the template's secretEnv …
    const viaTemplate = (await (await create(u.jwt, { kind: "container", templateId: "postgresql", spec })).json()).id;
    // … or the explicit flag
    const viaFlag = (await (await create(u.jwt, { kind: "container", spec: { ...spec, expectsSecrets: true } })).json()).id;
    expect((await heartbeat(node)).deployments).toEqual([]);
    for (const id of [viaTemplate, viaFlag]) {
      expect((await row(id))!.status).toBe("assigned");
      const got = await (await authed(u.jwt, "GET", `/v1/deployments/${id}`)).json();
      expect(got.events[0].message).toBe("waiting for sealed secrets");
      expect(got.nodePubkey).toBe(node.publicKey.slice(2));
    }
    expect((await authed(u.jwt, "PATCH", `/v1/deployments/${viaFlag}/secrets`, { sealedEnv: b64("sealed") })).status).toBe(200);
    const hb = await heartbeat(node);
    expect(hb.deployments).toEqual([
      { id: viaFlag, action: "start", kind: "container", spec: { ...spec, expectsSecrets: true }, sealedEnv: b64("sealed"), imageAllowed: false },
    ]);
  });

  it("DELETE stops now; the node gets 'stop' until it confirms", async () => {
    const { u, node, id } = await runningSite(1000);
    const res = await authed(u.jwt, "DELETE", `/v1/deployments/${id}`);
    expect(await res.json()).toEqual({ status: "success", deploymentStatus: "stopped" });
    expect((await heartbeat(node)).deployments).toEqual([{ id, action: "stop", kind: "static", spec: null }]);
    // the agent re-reporting "running" on boot is accepted and the stop stays owed
    expect((await signed(node, `/v1/nodes/deployments/${id}/status`, { status: "running", endpoint: "http://127.0.0.1:42001" })).status).toBe(200);
    expect((await signed(node, `/v1/nodes/deployments/${id}/status`, { status: "stopped" })).status).toBe(200);
    expect((await heartbeat(node)).deployments).toEqual([]);
    expect((await signed(node, `/v1/nodes/deployments/${id}/status`, { status: "running", endpoint: "http://127.0.0.1:42001" })).status).toBe(200);
    expect((await heartbeat(node)).deployments).toEqual([{ id, action: "stop", kind: "static", spec: null }]);
    // stopped seconds after starting: ~0 charged, the rest of the hold released
    const bal = await getBalanceUcld(u.addr);
    expect(bal.heldUcld).toBe(0);
    expect(bal.balanceUcld).toBeGreaterThanOrEqual(999);
  });

  it("DELETE of a queued deployment releases the full hold and owes no stop", async () => {
    const u = await user(1000);
    const id = (await (await create(u.jwt, { kind: "container", spec: CONTAINER })).json()).id;
    expect((await authed(u.jwt, "DELETE", `/v1/deployments/${id}`)).status).toBe(200);
    expect(await getBalanceUcld(u.addr)).toEqual({ balanceUcld: 1000, heldUcld: 0 });
    expect((await row(id))!.stop_acked_at).not.toBeNull();
  });

  it("another owner's deployment is 404", async () => {
    const a = await user();
    const b = await user();
    const id = (await (await create(a.jwt)).json()).id;
    expect((await authed(b.jwt, "GET", `/v1/deployments/${id}`)).status).toBe(404);
    expect((await authed(b.jwt, "DELETE", `/v1/deployments/${id}`)).status).toBe(404);
    expect((await authed(b.jwt, "PATCH", `/v1/deployments/${id}/secrets`, { sealedEnv: b64("x") })).status).toBe(404);
    expect((await call("/v1/deployments")).status).toBe(401);
  });
});

describe("totals", () => {
  it("network burned/minted and nodes/mine earned include hosting; deploymentsRunning per node", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("ok")));
    const before = await (await call("/v1/network")).json();
    const { node, payout, id } = await runningSite(1000);
    await shift(id, "last_billed_at", 3_600_000);
    await heartbeat(node);
    const after = await (await call("/v1/network")).json();
    expect(after.burnedUcld - before.burnedUcld).toBe(50);
    // lane A 47 to the provider + treasury ceil(0.03 × 50) = 2 (A trimmed so A + treasury ≤ floor(0.98 × 50))
    expect(after.mintedUcld - before.mintedUcld).toBe(49);
    const mine = await (await authed(await generateToken(payout), "GET", "/v1/nodes/mine")).json();
    expect(mine.nodes).toEqual([
      expect.objectContaining({ address: node.address.toLowerCase(), earnedUcld: 47, deploymentsRunning: 1 }),
    ]);
  });
});

describe("dead-node requeue", () => {
  const kill = (node: PrivateKeyAccount) =>
    getD1().prepare("UPDATE nodes SET last_seen = ? WHERE address = ?").bind(Date.now() - 46_000, node.address.toLowerCase()).run();

  it("re-queues a dead node's deployment, keeps the hold, restarts it elsewhere and stops it on the old node", async () => {
    const { u, node: old, id } = await runningSite(1000);
    await kill(old);
    // the owner's GET re-queues at once (3 × NODE_ACTIVE_SECONDS = 45 s of silence)
    const got = await (await authed(u.jwt, "GET", `/v1/deployments/${id}`)).json();
    expect(got.deployment).toMatchObject({ status: "queued", node: null, endpoint: null, statusReason: "node went offline" });
    expect(got.events[0].message).toBe("node went offline — re-queued");
    expect(got.nodePubkey).toBeUndefined();
    expect(await row(id)).toMatchObject({ last_billed_at: null, held_ucld: 50 });
    expect(await getBalanceUcld(u.addr)).toEqual({ balanceUcld: 950, heldUcld: 50 });

    const { node: next } = await boundNode(["matmul", "hosting"]);
    expect((await heartbeat(next)).deployments).toEqual([{ id, action: "start", kind: "static", spec: SITE }]);
    expect(await row(id)).toMatchObject({ status: "assigned", node: next.address.toLowerCase() });

    // the old node comes back still serving: it is owed a stop, and its "running" is refused
    expect((await heartbeat(old)).deployments).toEqual([{ id, action: "stop", kind: "static", spec: null }]);
    expect((await signed(old, `/v1/nodes/deployments/${id}/status`, { status: "running", endpoint: "http://127.0.0.1:42001" })).status).toBe(404);
    const ack = await signed(old, `/v1/nodes/deployments/${id}/status`, { status: "stopped" });
    expect(await ack.json()).toEqual({ status: "success", deploymentStatus: "stopped" });
    expect((await heartbeat(old)).deployments).toEqual([]);
    expect((await signed(old, `/v1/nodes/deployments/${id}/status`, { status: "stopped" })).status).toBe(404);

    // the new node runs it; billing restarts from its start
    await signed(next, `/v1/nodes/deployments/${id}/status`, { status: "running", endpoint: "http://127.0.0.1:42003" });
    expect(await row(id)).toMatchObject({ status: "running", endpoint: "http://127.0.0.1:42003", held_ucld: 50, last_billed_at: expect.any(Number) });
    expect(await getBalanceUcld(u.addr)).toEqual({ balanceUcld: 950, heldUcld: 50 });
  });

  it("the duties cron re-queues too; a node that comes back can take its deployment again without a stop", async () => {
    const { node: old, id } = await runningSite(1000);
    await kill(old);
    const { node: other } = await boundNode(["matmul"]); // not hosting-capable: cannot take it
    await heartbeat(other); // a heartbeat alone never re-queues (global duties are off the heartbeat)
    expect(await row(id)).toMatchObject({ status: "running" });
    expect(await runDutiesCron()).toMatchObject({ requeued: 1 });
    expect(await row(id)).toMatchObject({ status: "queued", node: null });
    expect((await heartbeat(old)).deployments).toEqual([{ id, action: "start", kind: "static", spec: SITE }]);
    expect((await heartbeat(old)).deployments).toEqual([{ id, action: "start", kind: "static", spec: SITE }]);
  });

  it("leaves deployments of live nodes alone and clears secrets sealed to the dead node", async () => {
    const u = await user();
    const { node: old } = await boundNode(["matmul", "hosting", "container"]);
    const id = (await (await create(u.jwt, { kind: "container", spec: CONTAINER })).json()).id;
    expect((await authed(u.jwt, "PATCH", `/v1/deployments/${id}/secrets`, { sealedEnv: b64("to-old") })).status).toBe(200);
    await heartbeat(old);
    await signed(old, `/v1/nodes/deployments/${id}/status`, { status: "running", endpoint: "http://127.0.0.1:42004" });
    await getD1().prepare("UPDATE nodes SET last_seen = ? WHERE address = ?").bind(Date.now() - 44_000, old.address.toLowerCase()).run();
    await authed(u.jwt, "GET", "/v1/deployments");
    expect((await row(id))!.status).toBe("running");

    await kill(old);
    const list = await (await authed(u.jwt, "GET", "/v1/deployments")).json();
    expect(list.deployments[0]).toMatchObject({ id, status: "queued" });
    expect(await row(id)).toMatchObject({ sealed_env: null });
    const { node: next } = await boundNode(["matmul", "hosting", "container"]);
    expect((await heartbeat(next)).deployments).toEqual([]); // assigned, waiting for re-sealed secrets
    expect((await row(id))!.status).toBe("assigned");
    const got = await (await authed(u.jwt, "GET", `/v1/deployments/${id}`)).json();
    expect(got.nodePubkey).toBe(next.publicKey.slice(2));
    expect(got.events.map((e: { message: string }) => e.message)).toContain("secrets were sealed to the old node — re-seal them for the next node");
    expect((await authed(u.jwt, "PATCH", `/v1/deployments/${id}/secrets`, { sealedEnv: b64("to-next") })).status).toBe(200);
    expect((await heartbeat(next)).deployments).toEqual([
      expect.objectContaining({ id, action: "start", sealedEnv: b64("to-next") }),
    ]);
  });
});

describe("probe endpoint policy", () => {
  it("allows loopback only in DEV_MODE", () => {
    expect(endpointAllowed("http://127.0.0.1:42000", true)).toBe(true);
    for (const u of ["http://127.0.0.1:1", "http://localhost", "http://10.0.0.5", "http://192.168.1.2", "http://169.254.169.254", "http://[::1]:80", "file:///etc/passwd"]) {
      expect(endpointAllowed(u, false)).toBe(false);
    }
    expect(endpointAllowed("http://203.0.113.7:42000", false)).toBe(true);
  });
});
