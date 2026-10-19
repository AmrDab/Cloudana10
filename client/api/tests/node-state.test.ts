/**
 * Node state model (ENGINEERING_BACKLOG B-8): active | draining | suspended. A draining node (its owner's call) takes
 * no new jobs, deployments or storage copies and keeps serving what it has; a suspended node (Cloudana's call) loses
 * its live deployments to the queue, is owed a stop for each, gets no relay ticket and no work, and only an admin
 * lifts it.
 */
import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import { privateKeyToAccount, generatePrivateKey, type PrivateKeyAccount } from "viem/accounts";
import { buildApp } from "../src/app.js";
import { getD1 } from "../src/lib/storage.js";
import { generateToken } from "../src/middleware/auth.js";
import { nodeSigningMessage } from "../src/middleware/node-auth.js";
import { creditUcld } from "../src/services/balance.service.js";
import { enqueueWorkJob, runAssignment } from "../src/services/jobs.service.js";
import { MATMUL_N_MIN } from "../src/services/work-types.js";

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
const admin = (method: string, path: string, body?: unknown) =>
  call(path, {
    method,
    headers: { "x-internal-key": INTERNAL_KEY, ...(body !== undefined && { "Content-Type": "application/json" }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
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
/** A bound node (payout = a fresh wallet, in a fleet) that serves on 127.0.0.1 (DEV_MODE). */
async function boundNode(workTypes: string[]) {
  const node = privateKeyToAccount(generatePrivateKey());
  const res = await signed(node, "/v1/nodes/announce", { manifest: MANIFEST, benchmarkMmacPerSec: 100, workTypes, pubkey: node.publicKey.slice(2), publicHost: "127.0.0.1", agentVersion: "1.5.0" });
  expect(res.status).toBe(200);
  const payout = "0x" + (++seq).toString(16).padStart(40, "e");
  await getD1().prepare("UPDATE nodes SET payout = ?, fleet_id = 'flt_state' WHERE address = ?").bind(payout, node.address.toLowerCase()).run();
  return { node, addr: node.address.toLowerCase(), payout, owner: await generateToken(payout) };
}
async function user(credits = 1_000_000) {
  const addr = "0x" + (++seq).toString(16).padStart(40, "c");
  await creditUcld(addr, credits);
  return { addr, jwt: await generateToken(addr) };
}
const SITE = { files: [{ path: "index.html", contentBase64: Buffer.from("<h1>hi</h1>").toString("base64") }] };
async function site(jwt: string) {
  const res = await authed(jwt, "POST", "/v1/deployments", { name: "d", kind: "static", spec: SITE });
  expect(res.status).toBe(201);
  return (await res.json()).id as string;
}
async function heartbeat(node: PrivateKeyAccount) {
  const res = await signed(node, "/v1/nodes/heartbeat", { agentVersion: "1.5.0" });
  expect(res.status).toBe(200);
  return (await res.json()).deployments as { id: string; action: string }[];
}
const row = (id: string) => getD1().prepare("SELECT * FROM deployments WHERE id = ?").bind(id).first<Record<string, any>>();
const nodeRow = (addr: string) => getD1().prepare("SELECT * FROM nodes WHERE address = ?").bind(addr).first<Record<string, any>>();
const mine = async (jwt: string, addr: string) => ((await (await authed(jwt, "GET", "/v1/nodes/mine")).json()).nodes as any[]).find((n) => n.address === addr);
const n = MATMUL_N_MIN;
const matrices = () => ({ matrixA: Array.from({ length: n * n }, (_, i) => (i * 7) % 11), matrixB: Array.from({ length: n * n }, (_, i) => (i * 5) % 13) });

beforeAll(async () => {
  await setupV1Db({ DEV_MODE: "true", INTERNAL_API_KEY: INTERNAL_KEY, NODE_ACTIVE_SECONDS: "15", RELAY_TICKET_SECRET: "r".repeat(40), CLUSTER_N_MIN: "1" });
  app = buildApp({ runtime: "node" });
});

describe("draining (owner)", () => {
  it("takes no new deployments or jobs, keeps what runs, and resumes on request", async () => {
    const u = await user();
    const { node, addr, payout, owner } = await boundNode(["matmul", "hosting"]);
    const first = await site(u.jwt);
    expect(await heartbeat(node)).toEqual([expect.objectContaining({ id: first, action: "start" })]);
    expect((await signed(node, `/v1/nodes/deployments/${first}/status`, { status: "running", endpoint: "http://127.0.0.1:42031" })).status).toBe(200);

    // Nobody else's node; no session, no node.
    expect((await call(`/v1/nodes/mine/${addr}/drain`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(401);
    expect((await authed(u.jwt, "POST", `/v1/nodes/mine/${addr}/drain`, {})).status).toBe(404);
    const drained = await authed(owner, "POST", `/v1/nodes/mine/${addr}/drain`, { reason: "kernel update" });
    expect(drained.status).toBe(200);
    expect(await drained.json()).toEqual({ status: "success", address: addr, state: "draining" });
    expect(await mine(owner, addr)).toMatchObject({ state: "draining", stateReason: "kernel update", online: true });

    // A new site stays queued; the running one is untouched.
    const second = await site(u.jwt);
    expect(await heartbeat(node)).toEqual([]);
    expect((await row(second))!.status).toBe("queued");
    expect(await row(first)).toMatchObject({ status: "running", node: addr });
    // The matmul draw skips it too.
    const q = await enqueueWorkJob({ owner: u.addr, workType: "matmul", n, ...matrices() });
    if (!q.ok) throw new Error(q.message);
    expect(await runAssignment()).toBe(0);
    expect((await getD1().prepare("SELECT status FROM work_jobs WHERE id = ?").bind(q.jobId).first<{ status: string }>())!.status).toBe("queued");

    // Resume: next heartbeat starts the waiting site; the draw finds it again.
    const resumed = await authed(owner, "DELETE", `/v1/nodes/mine/${addr}/drain`);
    expect(resumed.status).toBe(200);
    expect((await resumed.json()).state).toBe("active");
    expect(await mine(owner, addr)).toMatchObject({ state: "active", stateReason: null });
    expect(await heartbeat(node)).toEqual([expect.objectContaining({ id: second, action: "start" })]);
    expect(await runAssignment()).toBe(1);
    expect((await getD1().prepare("SELECT status, node FROM work_jobs WHERE id = ?").bind(q.jobId).first<{ status: string; node: string }>())).toMatchObject({ status: "assigned", node: addr });
    void payout;
  });
});

describe("suspension (admin)", () => {
  it("re-queues live deployments, owes the node a stop, refuses its relay ticket, and only an admin lifts it", async () => {
    const u = await user();
    const { node, addr, owner } = await boundNode(["matmul", "hosting"]);
    const id = await site(u.jwt);
    await heartbeat(node);
    expect((await signed(node, `/v1/nodes/deployments/${id}/status`, { status: "running", endpoint: "http://127.0.0.1:42032" })).status).toBe(200);
    expect((await signed(node, "/v1/nodes/relay/ticket")).status).toBe(200);
    const before = (await (await call("/v1/network")).json()).nodesOnline as number;

    expect((await call(`/v1/admin/nodes/${addr}/suspend`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "x" }) })).status).toBe(401);
    expect((await admin("POST", `/v1/admin/nodes/${"0x" + "f".repeat(40)}/suspend`, { reason: "nobody" })).status).toBe(404);
    const sus = await admin("POST", `/v1/admin/nodes/${addr}/suspend`, { reason: "abuse report #12" });
    expect(sus.status).toBe(200);
    expect(await sus.json()).toEqual({ status: "success", address: addr, state: "suspended", requeued: 1 });
    expect(await row(id)).toMatchObject({ status: "queued", node: null, status_reason: "node suspended: abuse report #12" });
    expect(await nodeRow(addr)).toMatchObject({ state: "suspended", state_reason: "abuse report #12" });

    // It still gets answers (so it learns to stop), but no work, no ticket, and it is not counted as online.
    expect(await heartbeat(node)).toEqual([expect.objectContaining({ id, action: "stop" })]);
    const ticket = await signed(node, "/v1/nodes/relay/ticket");
    expect(ticket.status).toBe(403);
    expect((await ticket.json()).error.message).toMatch(/suspended/);
    expect((await (await call("/v1/network")).json()).nodesOnline).toBe(before - 1);
    // The owner sees it and cannot change it.
    expect(await mine(owner, addr)).toMatchObject({ state: "suspended", stateReason: "abuse report #12" });
    expect((await authed(owner, "POST", `/v1/nodes/mine/${addr}/drain`, {})).status).toBe(409);
    expect((await authed(owner, "DELETE", `/v1/nodes/mine/${addr}/drain`)).status).toBe(409);
    expect(await runAssignment()).toBe(0);

    const lifted = await admin("DELETE", `/v1/admin/nodes/${addr}/suspend`);
    expect(lifted.status).toBe(200);
    expect(await lifted.json()).toEqual({ status: "success", address: addr, state: "active", requeued: 0 });
    expect(await nodeRow(addr)).toMatchObject({ state: "active", state_reason: null });
    expect((await signed(node, "/v1/nodes/relay/ticket")).status).toBe(200);
    expect((await (await call("/v1/network")).json()).nodesOnline).toBe(before);
  });
});
