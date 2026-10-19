/**
 * Container logs through the relay (ENGINEERING_BACKLOG B-14): GET /v1/deployments/{id}/logs reads the tail live
 * from the node (reserved relay dep "agent"), only for the owner, only for containers on relay nodes; a deployment
 * that left its node answers with the tail its failure kept; relay failures are named, never swallowed.
 */
import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { privateKeyToAccount, generatePrivateKey, type PrivateKeyAccount } from "viem/accounts";
import { randomBytes } from "node:crypto";
import { buildApp } from "../src/app.js";
import { getD1 } from "../src/lib/storage.js";
import { setRelay } from "../src/lib/relay.js";
import { generateToken } from "../src/middleware/auth.js";
import { nodeSigningMessage } from "../src/middleware/node-auth.js";
import { creditUcld } from "../src/services/balance.service.js";

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
  const nonce = randomBytes(16).toString("hex");
  const signature = await node.signMessage({ message: nodeSigningMessage("POST", path, ts, body, nonce) });
  return call(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Node": node.address, "X-Node-Timestamp": ts, "X-Nonce": nonce, "X-Node-Signature": signature },
    body,
  });
}
const MANIFEST = { cpuThreads: 16, ramGB: 64, gpus: [], os: "linux" };
async function node(workTypes: string[], agentVersion = "1.6.0") {
  const n = privateKeyToAccount(generatePrivateKey());
  const res = await signed(n, "/v1/nodes/announce", { manifest: MANIFEST, benchmarkMmacPerSec: 100, workTypes, pubkey: n.publicKey.slice(2), publicHost: "127.0.0.1", agentVersion });
  expect(res.status).toBe(200);
  await getD1().prepare("UPDATE nodes SET payout = ?, fleet_id = 'flt_logs' WHERE address = ?").bind("0x" + (++seq).toString(16).padStart(40, "e"), n.address.toLowerCase()).run();
  return n;
}
const addr = (n: PrivateKeyAccount) => n.address.toLowerCase();
async function user(credits = 1_000_000) {
  const a = "0x" + (++seq).toString(16).padStart(40, "c");
  await creditUcld(a, credits);
  return { addr: a, jwt: await generateToken(a) };
}
const CONTAINER = { image: "nginx:alpine", ports: [{ container: 80 }], cpu: 500, memMb: 512, storageMb: 1024 };
async function create(jwt: string, body: Record<string, unknown>) {
  const res = await authed(jwt, "POST", "/v1/deployments", { name: "d", ...body });
  expect(res.status).toBe(201);
  return (await res.json()).id as string;
}
async function beat(n: PrivateKeyAccount, relay = true) {
  const res = await signed(n, "/v1/nodes/heartbeat", { relay, agentVersion: "1.6.0" });
  expect(res.status).toBe(200);
  return (await res.json()).deployments as { id: string; action: string }[];
}
const row = (id: string) => getD1().prepare("SELECT * FROM deployments WHERE id = ?").bind(id).first<Record<string, any>>();
const logs = (jwt: string, id: string, q = "") => authed(jwt, "GET", `/v1/deployments/${id}/logs${q}`);

/** A running relayed container on a 1.6.0 relay node. */
async function relayedContainer() {
  const u = await user();
  const n = await node(["matmul", "hosting", "container", "relay"]);
  const id = await create(u.jwt, { kind: "container", spec: CONTAINER });
  expect(await beat(n)).toEqual(expect.arrayContaining([expect.objectContaining({ id, action: "start", relayed: true })]));
  expect((await signed(n, `/v1/nodes/deployments/${id}/status`, { status: "running" })).status).toBe(200);
  expect(await row(id)).toMatchObject({ status: "running", node: addr(n), relayed: 1 });
  return { u, n, id };
}

type Seen = { node: string; path: string; headers: Record<string, string> };
function relayAnswering(body: string | null, init: ResponseInit = {}) {
  const seen: Seen[] = [];
  setRelay(async (node, path, i) => {
    seen.push({ node, path, headers: i?.headers ?? {} });
    return new Response(body, init);
  });
  return seen;
}

beforeAll(async () => {
  await setupV1Db({ DEV_MODE: "true", RELAY_TICKET_SECRET: "r".repeat(40), INTERNAL_API_KEY: "k".repeat(32), NODE_ACTIVE_SECONDS: "15" });
  app = buildApp({ runtime: "node" });
});
// Placement takes the oldest queued rows: keep each test's queue its own.
beforeEach(async () => {
  await getD1().prepare("UPDATE deployments SET status = 'stopped', stop_acked_at = 1 WHERE status = 'queued'").run();
});
afterEach(() => setRelay(null));

describe("GET /v1/deployments/{id}/logs", () => {
  it("asks the node through the relay as dep agent with the tail, and hands the text back", async () => {
    const { u, n, id } = await relayedContainer();
    const seen = relayAnswering("GET / 200\nGET /x 404\n", { headers: { "content-type": "text/plain" } });
    const res = await logs(u.jwt, id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "success", id, node: addr(n), tail: 200, source: "node", logs: "GET / 200\nGET /x 404\n", truncated: false });
    expect(seen).toEqual([{ node: addr(n), path: "/proxy", headers: { "x-relay-dep": "agent", "x-relay-class": "endpoint", "x-relay-path": `/logs/${id}?tail=200`, "x-relay-probe": "1" } }]);
    // tail is passed through; out-of-range tails never reach the node.
    expect((await logs(u.jwt, id, "?tail=50")).status).toBe(200);
    expect(seen[1].headers["x-relay-path"]).toBe(`/logs/${id}?tail=50`);
    for (const q of ["?tail=0", "?tail=1001", "?tail=abc"]) expect((await logs(u.jwt, id, q)).status, q).toBe(400);
    expect(seen).toHaveLength(2);
    // The node's own truncation flag and an oversize body are both reported.
    relayAnswering("x".repeat(70_000), { headers: { "x-cld-truncated": "1" } });
    const big = await (await logs(u.jwt, id)).json();
    expect(big.truncated).toBe(true);
    expect(big.logs).toHaveLength(64 * 1024);
  });

  it("is the owner's only, for containers and replicas only", async () => {
    const { u, id } = await relayedContainer();
    relayAnswering("ok");
    const other = await user();
    expect((await logs(other.jwt, id)).status).toBe(404);
    expect((await call(`/v1/deployments/${id}/logs`)).status).toBe(401);
    const site = await create(u.jwt, { kind: "static", spec: { files: [{ path: "index.html", contentBase64: Buffer.from("<h1>x</h1>").toString("base64") }] } });
    const s = await logs(u.jwt, site);
    expect(s.status).toBe(400);
    expect((await s.json()).error.message).toMatch(/static site has none/);
    const endpoint = await create(u.jwt, { kind: "endpoint", spec: { ...CONTAINER, ports: undefined, port: 80, replicas: 1, auth: "public" } });
    const e = await logs(u.jwt, endpoint);
    expect(e.status).toBe(400);
    expect((await e.json()).error.message).toMatch(/replicaId/);
    // A replica id is a container row of the same owner: it goes through the same path.
    const replica = (await getD1().prepare("SELECT id FROM deployments WHERE parent_id = ?").bind(endpoint).first<{ id: string }>())!.id;
    const r = await logs(u.jwt, replica);
    expect(r.status).toBe(409); // queued, no node, nothing kept
    expect((await r.json()).error.message).toMatch(/no node runs it now/);
  });

  it("answers with the failure's tail once it left its node, 409 when nothing was kept", async () => {
    const { u, id } = await relayedContainer();
    await getD1().prepare("UPDATE deployments SET status = 'failed', node = NULL, last_logs = ? WHERE id = ?").bind("panic: out of memory\n", id).run();
    const seen = relayAnswering("never");
    const res = await logs(u.jwt, id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ source: "last_failure", logs: "panic: out of memory\n", node: null });
    expect(seen).toHaveLength(0);
    await getD1().prepare("UPDATE deployments SET last_logs = NULL WHERE id = ?").bind(id).run();
    expect((await logs(u.jwt, id)).status).toBe(409);
  });

  it("names what went wrong: direct node, no relay, offline socket, an agent that cannot serve logs, a node answer", async () => {
    const u = await user();
    const direct = await node(["matmul", "hosting", "container"]);
    const id = await create(u.jwt, { kind: "container", spec: CONTAINER });
    expect(await beat(direct, false)).toEqual([expect.objectContaining({ id, action: "start", relayed: false })]);
    expect((await signed(direct, `/v1/nodes/deployments/${id}/status`, { status: "running", endpoint: "http://127.0.0.1:42051" })).status).toBe(200);
    relayAnswering("x");
    const d = await logs(u.jwt, id);
    expect(d.status).toBe(409);
    expect((await d.json()).error.message).toMatch(/direct/);

    const { u: u2, id: id2 } = await relayedContainer();
    setRelay(null);
    expect((await logs(u2.jwt, id2)).status).toBe(503);
    relayAnswering(null, { status: 503, headers: { "x-relay-error": "offline" } });
    let res = await logs(u2.jwt, id2);
    expect(res.status).toBe(502);
    expect((await res.json()).error.message).toMatch(/relay socket is down/);
    relayAnswering(null, { status: 503, headers: { "x-relay-error": "not_serving" } });
    res = await logs(u2.jwt, id2);
    expect(res.status).toBe(502);
    expect((await res.json()).error.message).toMatch(/agents from 1\.6\.0/);
    relayAnswering("gone", { status: 404 });
    res = await logs(u2.jwt, id2);
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toMatch(/no longer runs it/);
    relayAnswering("boom", { status: 502 });
    res = await logs(u2.jwt, id2);
    expect(res.status).toBe(502);
    expect((await res.json()).error.message).toMatch(/answered 502/);
    setRelay(async () => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    });
    res = await logs(u2.jwt, id2);
    expect(res.status).toBe(502);
    expect((await res.json()).error.message).toMatch(/within 10 s/);
  });

  it("is rate-limited per deployment, whatever IP asks", async () => {
    const { u, id } = await relayedContainer();
    relayAnswering("ok");
    let last = 0;
    for (let i = 0; i < 21; i++) last = (await logs(u.jwt, id)).status;
    expect(last).toBe(429);
  });
});
