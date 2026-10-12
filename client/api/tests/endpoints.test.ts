/**
 * GPU endpoints (docs/V4_ENDPOINTS_CONTRACT.md): one parent + replica rows, per-replica price and hold, placement on
 * relay GPU nodes that run the image (any-image), anti-affinity, health-path probes with replacement, keys, the
 * gateway route, failure logs, stop.
 */
import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { privateKeyToAccount, generatePrivateKey, type PrivateKeyAccount } from "viem/accounts";
import { createHash } from "node:crypto";
import { buildApp } from "../src/app.js";
import { getD1 } from "../src/lib/storage.js";
import { setRelay } from "../src/lib/relay.js";
import { generateToken } from "../src/middleware/auth.js";
import { nodeSigningMessage } from "../src/middleware/node-auth.js";
import { creditUcld, getBalanceUcld } from "../src/services/balance.service.js";
import { priceUcldPerHour } from "../src/services/deployment-spec.js";

const SECRET = "r".repeat(40);
const INTERNAL_KEY = "k".repeat(32);
let app: ReturnType<typeof buildApp>;
let seq = 0;

function call(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", `198.51.100.${++seq % 250}`);
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
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const signature = await node.signMessage({ message: nodeSigningMessage("POST", path, ts, body, nonce) });
  return call(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Node": node.address, "X-Node-Timestamp": ts, "X-Nonce": nonce, "X-Node-Signature": signature },
    body,
  });
}

const GPUS = [{ name: "NVIDIA GeForce RTX 4090", vramGB: 24 }, { name: "NVIDIA GeForce RTX 4090", vramGB: 24 }];

/** A bound fleet node (payout set) with the given capabilities; 2 consumer GPUs, 16 threads, 64 GB. */
async function node(workTypes: string[], opts: { fleet?: boolean; gpus?: typeof GPUS } = {}) {
  const n = privateKeyToAccount(generatePrivateKey());
  const res = await signed(n, "/v1/nodes/announce", {
    manifest: { cpuThreads: 16, ramGB: 64, gpus: opts.gpus ?? GPUS, os: "linux" },
    benchmarkMmacPerSec: 100,
    workTypes,
    pubkey: n.publicKey.slice(2),
    publicHost: "127.0.0.1",
    agentVersion: "1.2.0",
  });
  expect(res.status).toBe(200);
  await getD1()
    .prepare("UPDATE nodes SET payout = ?, fleet_id = ? WHERE address = ?")
    .bind("0x" + (++seq).toString(16).padStart(40, "e"), opts.fleet === false ? null : "flt_test", n.address.toLowerCase())
    .run();
  return n;
}
const relayGpuNode = (extra: string[] = ["any-image"]) => node(["matmul", "hosting", "container", "gpu", "relay", ...extra]);
const addr = (n: PrivateKeyAccount) => n.address.toLowerCase();

async function user(credits = 100_000) {
  const a = "0x" + (++seq).toString(16).padStart(40, "c");
  if (credits > 0) await creditUcld(a, credits);
  return { addr: a, jwt: await generateToken(a) };
}

/** Heartbeat with the relay socket up; returns the instructions. */
async function beat(n: PrivateKeyAccount, relay = true) {
  const res = await signed(n, "/v1/nodes/heartbeat", { relay, agentVersion: "1.2.0" });
  expect(res.status).toBe(200);
  return (await res.json()).deployments as { id: string; action: string; kind: string; spec: any; relayed?: boolean; imageAllowed?: boolean }[];
}

const ENDPOINT = {
  image: "vllm/vllm-openai:v0.6.3",
  command: ["--model", "Qwen/Qwen2.5-0.5B-Instruct"],
  env: { HF_TOKEN: "hf_x" },
  port: 8000,
  health: { path: "/health", startupGraceSec: 900 },
  gpu: { count: 1, minVramGb: 16 },
  cpu: 4000,
  memMb: 16_384,
  storageMb: 51_200,
  replicas: 2,
};

const create = (jwt: string, spec: Record<string, unknown> = ENDPOINT, body: Record<string, unknown> = {}) =>
  authed(jwt, "POST", "/v1/deployments", { name: "llm", kind: "endpoint", spec, ...body });
const row = (id: string) => getD1().prepare("SELECT * FROM deployments WHERE id = ?").bind(id).first<Record<string, any>>();
const replicas = async (id: string) =>
  (await getD1().prepare("SELECT * FROM deployments WHERE parent_id = ? ORDER BY created_at").bind(id).all<Record<string, any>>()).results!;
const route = (id: string) => call(`/v1/deployments/${id}/route`, { headers: { "x-internal-key": INTERNAL_KEY } });
const running = (n: PrivateKeyAccount, dep: string, extra: Record<string, unknown> = {}) =>
  signed(n, `/v1/nodes/deployments/${dep}/status`, { status: "running", ...extra });

/** A 2-replica endpoint placed on two relay GPU nodes and reported running on both. */
async function liveEndpoint() {
  const u = await user();
  const id = (await (await create(u.jwt)).json()).id as string;
  const a = await relayGpuNode();
  const b = await relayGpuNode();
  await beat(a);
  await beat(b);
  const [r1, r2] = await replicas(id);
  expect((await running(a, r1.id)).status).toBe(200);
  expect((await running(b, r2.id)).status).toBe(200);
  return { u, id, a, b, r1, r2 };
}

beforeAll(async () => {
  await setupV1Db({ DEV_MODE: "true", RELAY_TICKET_SECRET: SECRET, INTERNAL_API_KEY: INTERNAL_KEY, SITES_DOMAIN: "example.run", NODE_ACTIVE_SECONDS: "15" });
  app = buildApp({ runtime: "node" });
});
// Placement takes the oldest queued rows: keep each test's queue its own.
beforeEach(async () => {
  await getD1().prepare("UPDATE deployments SET status = 'stopped', stop_acked_at = 1 WHERE status = 'queued'").run();
});
afterEach(() => setRelay(null));

describe("create", () => {
  it("prices per replica (container + GPU), holds replicas × price, and stores one relayed container per replica", async () => {
    const u = await user();
    const res = await create(u.jwt);
    expect(res.status).toBe(201);
    const body = await res.json();
    const perReplica = priceUcldPerHour("endpoint", { ...ENDPOINT, auth: "key" } as any);
    // 4 cores × 200 + 16 GB × 100 + 50 GB × 20 + 1 consumer GPU × 2000
    expect(perReplica).toBe(800 + 1600 + 1000 + 2000);
    expect(body).toEqual({ status: "success", id: expect.any(String), priceUcldPerHour: perReplica * 2, deploymentStatus: "queued" });
    expect(await getBalanceUcld(u.addr)).toEqual({ balanceUcld: 100_000 - perReplica * 2, heldUcld: perReplica * 2 });

    const parent = (await row(body.id))!;
    expect(parent).toMatchObject({ kind: "container", replicas: 2, parent_id: null, held_ucld: 0, status: "queued", price_ucld_per_hour: perReplica });
    const kids = await replicas(body.id);
    expect(kids).toHaveLength(2);
    for (const k of kids) {
      expect(k).toMatchObject({ kind: "container", workstation: 0, replicas: 0, held_ucld: perReplica, status: "queued", probe_path: "/health", owner: u.addr });
      expect(JSON.parse(k.spec_json)).toEqual({
        image: ENDPOINT.image, command: ENDPOINT.command, env: ENDPOINT.env, cpu: 4000, memMb: 16_384, storageMb: 51_200,
        gpu: { count: 1, minVramGb: 16 }, ports: [{ container: 8000 }], health: { path: "/health", startupGraceSec: 900 },
      });
    }
    expect(kids.map((k) => k.name)).toEqual(["llm #1", "llm #2"]);

    // The owner's list shows the endpoint, never its replicas.
    const list = (await (await authed(u.jwt, "GET", "/v1/deployments")).json()).deployments;
    expect(list.map((d: any) => d.id)).toEqual([body.id]);
    expect(list[0]).toMatchObject({
      kind: "endpoint", status: "queued", auth: "key", url: `https://${body.id}.example.run`, priceUcldPerHour: perReplica * 2,
      replicas: [expect.objectContaining({ id: kids[0].id, status: "queued" }), expect.objectContaining({ id: kids[1].id, status: "queued" })],
    });
    expect(list[0].spec).toEqual({ ...ENDPOINT, env: undefined, envKeys: ["HF_TOKEN"], auth: "key" });
  });

  it("defaults health and auth, caps replicas, refuses root and short credits", async () => {
    const u = await user();
    const id = (await (await create(u.jwt, { ...ENDPOINT, health: undefined, replicas: undefined })).json()).id;
    expect(JSON.parse((await replicas(id))[0].spec_json).health).toEqual({ path: "/", startupGraceSec: 600 });
    expect((await row(id))!.replicas).toBe(1);
    expect((await (await authed(u.jwt, "GET", `/v1/deployments/${id}`)).json()).deployment.auth).toBe("key");

    for (const bad of [{ ...ENDPOINT, port: undefined }, { ...ENDPOINT, replicas: 9 }, { ...ENDPOINT, user: "0" }, { ...ENDPOINT, auth: "token" }]) {
      expect((await create(u.jwt, bad as any)).status, JSON.stringify(bad)).toBe(400);
    }
    const poor = await user(6000);
    const res = await create(poor.jwt);
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toMatch(/2 replicas cost 10800 µCLD/);
  });
});

describe("placement", () => {
  it("needs a relay node that runs the image, spreads replicas over nodes, and sends the health + gpu spec", async () => {
    const u = await user();
    const id = (await (await create(u.jwt)).json()).id;
    const [r1, r2] = await replicas(id);
    // A direct (non-relay) GPU fleet node: endpoint traffic is POSTs through the hub, so never.
    expect(await beat(await node(["matmul", "hosting", "container", "gpu"]))).toEqual([]);
    // A relay GPU node without any-image: vLLM is not a curated image.
    expect(await beat(await relayGpuNode([]))).toEqual([]);
    // A relay any-image node without GPUs.
    expect(await beat(await node(["matmul", "hosting", "container", "relay", "any-image"], { gpus: [] }))).toEqual([]);
    expect((await row(r1.id))!.status).toBe("queued");

    const a = await relayGpuNode();
    const first = await beat(a);
    expect(first).toEqual([
      expect.objectContaining({ id: r1.id, action: "start", kind: "container", relayed: true, imageAllowed: false, spec: JSON.parse(r1.spec_json) }),
    ]);
    // Anti-affinity: the second replica never lands next to its sibling, even with 1 GPU free.
    expect(await beat(a)).toEqual([expect.objectContaining({ id: r1.id, action: "start" })]);
    expect((await row(r2.id))!.status).toBe("queued");
    const b = await relayGpuNode();
    expect(await beat(b)).toEqual([expect.objectContaining({ id: r2.id, action: "start", relayed: true })]);
    expect((await row(r2.id))!.node).toBe(addr(b));

    const got = (await (await authed(u.jwt, "GET", `/v1/deployments/${id}`)).json()).deployment;
    expect(got.status).toBe("assigned");
    expect(got.replicas.map((r: any) => r.node)).toEqual([addr(a), addr(b)]);
  });

  it("places a curated image without any-image, and only where a GPU of the class is free", async () => {
    const u = await user();
    const curated = { ...ENDPOINT, image: "quay.io/jupyter/pytorch-notebook:cuda12-latest", replicas: 1, gpu: { count: 1, class: "datacenter" } };
    const id = (await (await create(u.jwt, curated)).json()).id;
    const consumer = await relayGpuNode([]);
    expect(await beat(consumer)).toEqual([]); // 4090s are consumer parts
    const dc = await node(["matmul", "hosting", "container", "gpu", "relay"], { gpus: [{ name: "NVIDIA A100-SXM4-80GB", vramGB: 80 }] });
    expect(await beat(dc)).toEqual([expect.objectContaining({ id: (await replicas(id))[0].id, imageAllowed: true })]);
  });
});

describe("running, route and keys", () => {
  it("derives the endpoint's status from its replicas and routes to every running replica", async () => {
    const { u, id, a, b, r1, r2 } = await liveEndpoint();
    expect(await row(r1.id)).toMatchObject({ status: "running", node: addr(a), relayed: 1, endpoint: null });
    const got = (await (await authed(u.jwt, "GET", `/v1/deployments/${id}`)).json()).deployment;
    expect(got).toMatchObject({ status: "running", kind: "endpoint", node: null, replicas: [expect.objectContaining({ status: "running" }), expect.objectContaining({ status: "running" })] });

    const r = await route(id);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      status: "success", id, state: "running", kind: "endpoint", workstation: false, relayed: true, endpoint: null, auth: "key", keys: [],
      targets: [{ node: addr(a), dep: r1.id }, { node: addr(b), dep: r2.id }],
    });
    // A replica's own id is no address: that would be a way around the endpoint's key.
    expect((await route(r1.id)).status).toBe(404);
    // One replica gone: the endpoint still runs on the other.
    expect((await signed(a, `/v1/nodes/deployments/${r1.id}/status`, { status: "failed", message: "OOM" })).status).toBe(200);
    expect((await (await route(id)).json()).targets).toEqual([{ node: addr(b), dep: r2.id }]);
    expect((await (await authed(u.jwt, "GET", `/v1/deployments/${id}`)).json()).deployment.status).toBe("running");
  });

  it("creates keys shown once, lists prefixes, serves hashes to the gateway, and revokes", async () => {
    const { u, id } = await liveEndpoint();
    const res = await authed(u.jwt, "POST", `/v1/deployments/${id}/keys`, { name: "prod" });
    expect(res.status).toBe(201);
    const { key } = await res.json();
    expect(key.key).toMatch(/^cld_ek_[0-9a-f]{48}$/);
    expect(key).toMatchObject({ id: expect.any(String), name: "prod", prefix: key.key.slice(7, 15), revokedAt: null });

    const list = (await (await authed(u.jwt, "GET", `/v1/deployments/${id}/keys`)).json()).keys;
    expect(list).toEqual([{ id: key.id, name: "prod", prefix: key.prefix, createdAt: key.createdAt, revokedAt: null }]);
    expect(JSON.stringify(list)).not.toContain(key.key);
    expect((await (await route(id)).json()).keys).toEqual([createHash("sha256").update(key.key).digest("hex")]);

    expect((await authed(u.jwt, "DELETE", `/v1/deployments/${id}/keys/${key.id}`)).status).toBe(200);
    expect((await (await route(id)).json()).keys).toEqual([]);
    expect((await (await authed(u.jwt, "GET", `/v1/deployments/${id}/keys`)).json()).keys[0].revokedAt).toBeGreaterThan(0);
    expect((await authed(u.jwt, "DELETE", `/v1/deployments/${id}/keys/${key.id}`)).status).toBe(404);

    // Another owner sees nothing; keys are for endpoints only.
    const other = await user(0);
    expect((await authed(other.jwt, "POST", `/v1/deployments/${id}/keys`, { name: "x" })).status).toBe(404);
    expect((await authed(other.jwt, "GET", `/v1/deployments/${id}/keys`)).status).toBe(404);
    const site = (await (await authed(u.jwt, "POST", "/v1/deployments", {
      name: "s", kind: "static", spec: { files: [{ path: "index.html", contentBase64: Buffer.from("<p>").toString("base64") }] },
    })).json()).id;
    expect((await authed(u.jwt, "POST", `/v1/deployments/${site}/keys`, { name: "x" })).status).toBe(400);
  });

  it("allows at most 20 live keys and omits keys on public endpoints", async () => {
    const u = await user();
    const id = (await (await create(u.jwt, { ...ENDPOINT, replicas: 1, auth: "public" })).json()).id;
    for (let i = 0; i < 20; i++) expect((await authed(u.jwt, "POST", `/v1/deployments/${id}/keys`, { name: `k${i}` })).status).toBe(201);
    expect((await authed(u.jwt, "POST", `/v1/deployments/${id}/keys`, { name: "k20" })).status).toBe(409);
    const r = await (await route(id)).json();
    expect(r.auth).toBe("public");
    expect(r.keys).toBeUndefined();
    expect(r.state).toBe("queued");
  });
});

describe("health probes and replacement", () => {
  it("probes the health path through the relay and re-queues a replica after DEPLOY_PROBE_FAILS misses", async () => {
    const { u, id, a, r1 } = await liveEndpoint();
    const seen: { node: string; path: string | undefined; dep: string | undefined }[] = [];
    let healthy = true;
    setRelay(async (node, _path, init) => {
      seen.push({ node, path: init?.headers?.["x-relay-path"], dep: init?.headers?.["x-relay-dep"] });
      return new Response(healthy ? '{"ok":true}' : "", { status: healthy ? 200 : 503 });
    });
    await beat(a);
    expect(seen).toEqual([{ node: addr(a), path: "/health", dep: r1.id }]);
    expect(await row(r1.id)).toMatchObject({ probe_fail: 0, status: "running" });

    // The hub refusing the probe (every stream in use) or the relay call failing says nothing about the app.
    const reprobe = () => getD1().prepare("UPDATE deployments SET last_probe_at = 0 WHERE id = ?").bind(r1.id).run();
    setRelay(async () => new Response("", { status: 503, headers: { "x-relay-error": "busy" } }));
    await reprobe();
    await beat(a);
    setRelay(async () => {
      throw new Error("binding exploded");
    });
    await reprobe();
    await beat(a);
    expect(await row(r1.id)).toMatchObject({ probe_fail: 0, status: "running" });
    expect((await row(r1.id))!.last_probe_at).toBeGreaterThan(0);

    setRelay(async () => new Response("", { status: 503 }));
    // 30 minutes into the hour: the part served is billed at the re-queue, so failing health buys no free time.
    await getD1().prepare("UPDATE deployments SET last_billed_at = last_billed_at - ? WHERE id = ?").bind(30 * 60_000, r1.id).run();
    const balanceBefore = await getBalanceUcld(u.addr);
    for (let i = 1; i <= 2; i++) {
      await reprobe();
      await beat(a);
      expect(await row(r1.id)).toMatchObject({ probe_fail: i, status: "running" });
    }
    await reprobe();
    const instructions = await beat(a);
    // Replaced, not "unreachable": back in the queue, this node owes a stop, the other replica keeps serving.
    expect(await row(r1.id)).toMatchObject({ status: "queued", node: null, status_reason: `refused by node ${addr(a)}: replica failed 3 health probes`, held_ucld: 5400 });
    expect(instructions).toEqual([expect.objectContaining({ id: r1.id, action: "stop" })]);
    const after = await getBalanceUcld(u.addr);
    expect(after.heldUcld).toBe(balanceBefore.heldUcld);
    expect(balanceBefore.balanceUcld - after.balanceUcld).toBeGreaterThanOrEqual(2699); // ≈ 30/60 × 5400
    expect(balanceBefore.balanceUcld - after.balanceUcld).toBeLessThanOrEqual(2701);
    const got = (await (await authed(u.jwt, "GET", `/v1/deployments/${id}`)).json());
    expect(got.deployment.status).toBe("running");
    expect(got.events.map((e: any) => e.message)).toContain(`llm #1: refused by node ${addr(a)}: replica failed 3 health probes — re-queued`);
    expect(got.events.map((e: any) => e.message)).toContain("llm #1: billed 2700 µCLD for the 30 min served before the re-queue");
    // The failing node cannot reclaim it while its stop is still in flight; a third node picks it up.
    expect(await beat(a)).toEqual([expect.objectContaining({ id: r1.id, action: "stop" })]);
    expect((await row(r1.id))!.status).toBe("queued");
    const c = await relayGpuNode();
    expect(await beat(c)).toEqual([expect.objectContaining({ id: r1.id, action: "start" })]);
  });

  it("stops a replica with no credits for the part it served", async () => {
    const u = await user(2 * 5400);
    const id = (await (await create(u.jwt)).json()).id as string;
    const a = await relayGpuNode();
    const b = await relayGpuNode();
    await beat(a);
    await beat(b);
    const [r1] = await replicas(id);
    expect((await running(a, r1.id)).status).toBe(200);
    setRelay(async () => new Response("", { status: 503 }));
    await getD1().prepare("UPDATE deployments SET last_billed_at = last_billed_at - ?, probe_fail = 2, last_probe_at = 0 WHERE id = ?").bind(30 * 60_000, r1.id).run();
    await beat(a);
    expect(await row(r1.id)).toMatchObject({ status: "stopped", status_reason: "out of credits", held_ucld: 0 });
    expect((await getBalanceUcld(u.addr)).heldUcld).toBe(5400); // only the other replica's hour stays held
  });

  it("keeps the node's log tail from a failed start, and re-queues on a GPU refusal", async () => {
    const u = await user();
    const id = (await (await create(u.jwt, { ...ENDPOINT, replicas: 1 })).json()).id;
    const [r1] = await replicas(id);
    const a = await relayGpuNode();
    await beat(a);
    expect((await signed(a, `/v1/nodes/deployments/${r1.id}/status`, { status: "failed", message: "not enough free GPUs" })).status).toBe(200);
    expect(await row(r1.id)).toMatchObject({ status: "queued", node: null });
    const b = await relayGpuNode();
    await beat(b);
    const logs = "INFO loading model\nCUDA error: out of memory\n";
    expect((await signed(b, `/v1/nodes/deployments/${r1.id}/status`, { status: "failed", message: "not healthy after 900 s", logs })).status).toBe(200);
    expect(await row(r1.id)).toMatchObject({ status: "failed", last_logs: logs });
    const parent = await (await authed(u.jwt, "GET", `/v1/deployments/${id}`)).json();
    expect(parent.deployment.status).toBe("failed");
    expect(parent.deployment.replicas[0]).toMatchObject({ status: "failed", statusReason: "not healthy after 900 s", logs });
    const replica = await (await authed(u.jwt, "GET", `/v1/deployments/${r1.id}`)).json();
    expect(replica.deployment).toMatchObject({ kind: "container", parentId: id, logs, url: null });
    // The list never carries logs.
    expect(JSON.stringify((await (await authed(u.jwt, "GET", "/v1/deployments")).json()).deployments)).not.toContain("out of memory");
  });
});

describe("stop and secrets", () => {
  it("DELETE stops every replica (hold settled pro rata) and the nodes get stops", async () => {
    const { u, id, a, b, r1, r2 } = await liveEndpoint();
    const before = await getBalanceUcld(u.addr);
    expect(before.heldUcld).toBe(2 * 5400);
    const res = await authed(u.jwt, "DELETE", `/v1/deployments/${id}`);
    expect(await res.json()).toEqual({ status: "success", deploymentStatus: "stopped" });
    expect((await row(id))!.status).toBe("stopped");
    for (const r of [r1, r2]) expect(await row(r.id)).toMatchObject({ status: "stopped", status_reason: "endpoint stopped by owner", held_ucld: 0 });
    expect((await getBalanceUcld(u.addr)).heldUcld).toBe(0);
    expect(await beat(a)).toEqual([{ id: r1.id, action: "stop", kind: "container", spec: null }]);
    expect(await beat(b)).toEqual([{ id: r2.id, action: "stop", kind: "container", spec: null }]);
    expect((await (await route(id)).json()).state).toBe("stopped");
    expect((await (await authed(u.jwt, "GET", `/v1/deployments/${id}`)).json()).deployment.status).toBe("stopped");
  });

  it("an admin stop reaches every replica", async () => {
    const { id, a, b, r1, r2 } = await liveEndpoint();
    const res = await call(`/v1/admin/deployments/${id}/stop`, { method: "POST", headers: { "x-internal-key": INTERNAL_KEY } });
    expect(res.status).toBe(200);
    for (const r of [r1, r2]) expect(await row(r.id)).toMatchObject({ status: "stopped", status_reason: "admin", held_ucld: 0 });
    expect((await row(id))!.status).toBe("stopped");
    expect(await beat(a)).toEqual([{ id: r1.id, action: "stop", kind: "container", spec: null }]);
    expect(await beat(b)).toEqual([{ id: r2.id, action: "stop", kind: "container", spec: null }]);
    // Idempotent.
    expect((await call(`/v1/admin/deployments/${id}/stop`, { method: "POST", headers: { "x-internal-key": INTERNAL_KEY } })).status).toBe(200);
  });

  it("seals secrets per replica, never on the endpoint itself", async () => {
    const u = await user();
    const id = (await (await create(u.jwt, { ...ENDPOINT, replicas: 1, expectsSecrets: true })).json()).id;
    const [r1] = await replicas(id);
    const sealed = Buffer.from("sealed").toString("base64");
    const onParent = await authed(u.jwt, "PATCH", `/v1/deployments/${id}/secrets`, { sealedEnv: sealed });
    expect(onParent.status).toBe(400);
    expect((await onParent.json()).error.message).toMatch(/per replica/);
    expect((await authed(u.jwt, "PATCH", `/v1/deployments/${r1.id}/secrets`, { sealedEnv: sealed })).status).toBe(200);
    const a = await relayGpuNode();
    expect(await beat(a)).toEqual([expect.objectContaining({ id: r1.id, action: "start", sealedEnv: sealed })]);
  });
});
