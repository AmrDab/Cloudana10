import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll } from "vitest";
import { privateKeyToAccount, generatePrivateKey, type PrivateKeyAccount } from "viem/accounts";
import { buildApp } from "../src/app.js";
import { getD1 } from "../src/lib/storage.js";
import { generateToken } from "../src/middleware/auth.js";
import { nodeSigningMessage, sha256Hex } from "../src/middleware/node-auth.js";
import { getNode } from "../src/services/nodes.service.js";

let app: ReturnType<typeof buildApp>;
let ipSeq = 0;

const alice = "0x" + "a1".repeat(20);
const bob = "0x" + "b2".repeat(20);
let aliceJwt = "";
let bobJwt = "";

/** Each call gets its own client IP so the per-IP rate limits don't interfere. */
function call(path: string, init: RequestInit = {}, ip?: string) {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", ip ?? `10.1.${Math.floor(ipSeq / 250)}.${ipSeq++ % 250}`);
  return app.request(path, { ...init, headers });
}

function authed(jwt: string, method: string, path: string, body?: unknown, ip?: string) {
  return call(
    path,
    {
      method,
      headers: { Authorization: `Bearer ${jwt}`, ...(body !== undefined && { "Content-Type": "application/json" }) },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    },
    ip,
  );
}

const MANIFEST = { cpuThreads: 64, ramGB: 256, gpus: [{ name: "H100", vramGB: 80 }], os: "linux" };

async function announce(node: PrivateKeyAccount, extra: Record<string, unknown> = {}) {
  const body = JSON.stringify({ manifest: MANIFEST, benchmarkMmacPerSec: 5000, workTypes: ["matmul"], ...extra });
  const ts = String(Date.now());
  const signature = await node.signMessage({ message: nodeSigningMessage("POST", "/v1/nodes/announce", ts, body) });
  return call("/v1/nodes/announce", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Node": node.address, "X-Node-Timestamp": ts, "X-Node-Signature": signature },
    body,
  });
}

async function createFleet(jwt: string, body: Record<string, unknown> = {}) {
  const res = await authed(jwt, "POST", "/v1/fleets", body);
  expect(res.status).toBe(201);
  return (await res.json()) as { status: string; id: string; token: string };
}

beforeAll(async () => {
  await setupV1Db();
  app = buildApp({ runtime: "node" });
  aliceJwt = await generateToken(alice);
  bobJwt = await generateToken(bob);
});

describe("fleet tokens", () => {
  it("require a JWT", async () => {
    expect((await call("/v1/fleets")).status).toBe(401);
    expect((await call("/v1/fleets", { method: "POST", body: "{}" })).status).toBe(401);
  });

  it("returns the token once and stores only its hash", async () => {
    const f = await createFleet(aliceJwt, { name: "rack-1", floorUcldPerMmac: 900 });
    expect(f.id).toMatch(/^flt_[0-9a-f]{16}$/);
    expect(f.token).toMatch(/^cft_[0-9a-f]{32}$/);

    const row = await getD1().prepare("SELECT * FROM fleets WHERE id = ?").bind(f.id).first<Record<string, unknown>>();
    expect(row).toMatchObject({ owner: alice, name: "rack-1", token_hash: sha256Hex(f.token), floor_ucld_per_mmac: 900, revoked_at: null });
    expect(JSON.stringify(row)).not.toContain(f.token);

    const list = await (await authed(aliceJwt, "GET", "/v1/fleets")).json();
    const listed = list.fleets.find((x: { id: string }) => x.id === f.id);
    expect(listed).toEqual({
      id: f.id,
      name: "rack-1",
      floorUcldPerMmac: 900,
      createdAt: expect.any(Number),
      revokedAt: null,
      nodes: 0,
      nodesOnline: 0,
      jobsDone: 0,
    });
    expect(JSON.stringify(list)).not.toContain(f.token);
    expect(JSON.stringify(list)).not.toContain(sha256Hex(f.token));
  });

  it("announce with a valid token binds the node to the fleet owner, no bind code", async () => {
    const f = await createFleet(aliceJwt, { name: "rack-2" });
    const node = privateKeyToAccount(generatePrivateKey());
    const res = await announce(node, { fleetToken: f.token });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "success", bound: true, payout: alice, bindCode: null, fleetId: f.id });
    expect(await getNode(node.address)).toMatchObject({ payout: alice, fleet_id: f.id, bind_code: null });

    // Re-announcing (with or without the token) keeps the binding.
    expect(await (await announce(node, { fleetToken: f.token })).json()).toMatchObject({ bound: true, fleetId: f.id });
    expect(await (await announce(node)).json()).toMatchObject({ bound: true, payout: alice, bindCode: null, fleetId: f.id });

    const listed = (await (await authed(aliceJwt, "GET", "/v1/fleets")).json()).fleets.find((x: { id: string }) => x.id === f.id);
    expect(listed).toMatchObject({ nodes: 1, nodesOnline: 1, jobsDone: 0 });
  });

  it("an announce without a token still gets a bind code and fleetId null", async () => {
    const res = await announce(privateKeyToAccount(generatePrivateKey()));
    const body = await res.json();
    expect(body).toMatchObject({ status: "success", bound: false, payout: null, fleetId: null });
    expect(body.bindCode).toMatch(/^[0-9a-f]{16}$/);
  });

  it("an unknown token is 401 and the node is not bound", async () => {
    const node = privateKeyToAccount(generatePrivateKey());
    const res = await announce(node, { fleetToken: "cft_" + "0".repeat(32) });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ status: "error", error: { code: "unauthorized" } });
    expect(await getNode(node.address)).toBeNull();
  });

  it("revoking stops new announces; bound nodes stay bound", async () => {
    const f = await createFleet(aliceJwt);
    const early = privateKeyToAccount(generatePrivateKey());
    await announce(early, { fleetToken: f.token });

    const del = await authed(aliceJwt, "DELETE", `/v1/fleets/${f.id}`);
    expect(del.status).toBe(200);
    const revoked = await del.json();
    expect(revoked).toEqual({ status: "success", revoked: true, revokedAt: expect.any(Number) });
    // Idempotent.
    expect(await (await authed(aliceJwt, "DELETE", `/v1/fleets/${f.id}`)).json()).toEqual(revoked);

    const late = privateKeyToAccount(generatePrivateKey());
    const res = await announce(late, { fleetToken: f.token });
    expect(res.status).toBe(401);
    expect(await getNode(late.address)).toBeNull();
    expect(await getNode(early.address)).toMatchObject({ payout: alice, fleet_id: f.id });
  });

  it("refuses a fleet token for a node already bound to another wallet (409)", async () => {
    const aliceFleet = await createFleet(aliceJwt);
    const bobFleet = await createFleet(bobJwt);
    const node = privateKeyToAccount(generatePrivateKey());
    await announce(node, { fleetToken: aliceFleet.token });
    const res = await announce(node, { fleetToken: bobFleet.token });
    expect(res.status).toBe(409);
    expect(await getNode(node.address)).toMatchObject({ payout: alice, fleet_id: aliceFleet.id });
  });

  it("PATCH updates name and floor; null clears", async () => {
    const f = await createFleet(aliceJwt, { name: "old", floorUcldPerMmac: 10 });
    let res = await authed(aliceJwt, "PATCH", `/v1/fleets/${f.id}`, { name: "new" });
    expect(res.status).toBe(200);
    expect((await res.json()).fleet).toMatchObject({ id: f.id, name: "new", floorUcldPerMmac: 10 });
    res = await authed(aliceJwt, "PATCH", `/v1/fleets/${f.id}`, { floorUcldPerMmac: null });
    expect((await res.json()).fleet).toMatchObject({ name: "new", floorUcldPerMmac: null });
    res = await authed(aliceJwt, "PATCH", `/v1/fleets/${f.id}`, { floorUcldPerMmac: -1 });
    expect(res.status).toBe(400);
  });

  it("another owner gets 404 on PATCH and DELETE, and nothing changes", async () => {
    const f = await createFleet(aliceJwt, { name: "mine" });
    const patch = await authed(bobJwt, "PATCH", `/v1/fleets/${f.id}`, { name: "stolen" });
    expect(patch.status).toBe(404);
    expect(await patch.json()).toMatchObject({ status: "error", error: { code: "not_found" } });
    const del = await authed(bobJwt, "DELETE", `/v1/fleets/${f.id}`);
    expect(del.status).toBe(404);
    const row = await getD1().prepare("SELECT name, revoked_at FROM fleets WHERE id = ?").bind(f.id).first();
    expect(row).toEqual({ name: "mine", revoked_at: null });
    // Bob's list never shows Alice's fleets.
    const bobs = (await (await authed(bobJwt, "GET", "/v1/fleets")).json()).fleets;
    expect(bobs.some((x: { id: string }) => x.id === f.id)).toBe(false);
  });

  it("caps active fleets per owner at 10 (revoked ones don't count)", async () => {
    const carol = "0x" + "c3".repeat(20);
    const jwt = await generateToken(carol);
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push((await createFleet(jwt)).id);
    const over = await authed(jwt, "POST", "/v1/fleets", {});
    expect(over.status).toBe(409);
    await authed(jwt, "DELETE", `/v1/fleets/${ids[0]}`);
    expect((await authed(jwt, "POST", "/v1/fleets", {})).status).toBe(201);
  });

  it("rate limits fleet creation per IP (10/hour)", async () => {
    const dave = "0x" + "d4".repeat(20);
    const jwt = await generateToken(dave);
    const ip = "10.9.9.9";
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await authed(jwt, "POST", "/v1/fleets", {}, ip);
      statuses.push(res.status);
      if (res.status === 201) await authed(jwt, "DELETE", `/v1/fleets/${(await res.json()).id}`);
    }
    expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});
