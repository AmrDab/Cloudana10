/**
 * Fleet pinning (B-9, owner decision 2026-10-21): spec.placement.fleetId pins a container, workstation or endpoint to
 * the owner's own fleet or a partner's (chosen by its id), never to a node. Placement, preemption, the create-time
 * check, the waiting event, what the owner sees (the pin and the node's fleet) and revocation.
 */
import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { randomBytes } from "node:crypto";
import { privateKeyToAccount, generatePrivateKey, type PrivateKeyAccount } from "viem/accounts";
import { buildApp } from "../src/app.js";
import { getD1 } from "../src/lib/storage.js";
import { generateToken } from "../src/middleware/auth.js";
import { nodeSigningMessage } from "../src/middleware/node-auth.js";
import { creditUcld, getBalanceUcld } from "../src/services/balance.service.js";
import { preemptForOnDemand, runDutiesCron } from "../src/services/deployment-duties.service.js";

let app: ReturnType<typeof buildApp>;
let seq = 0;

function call(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", `10.66.${Math.floor(seq / 250) % 250}.${seq++ % 250}`);
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

async function user(credits = 100_000) {
  const addr = "0x" + (++seq).toString(16).padStart(40, "c");
  if (credits > 0) await creditUcld(addr, credits);
  return { addr, jwt: await generateToken(addr) };
}

/** A node of `fleet` (bound to the fleet owner's payout), online and active; one 24 GB GPU, 16 threads, 64 GB. */
async function node(workTypes: string[], fleet: { id: string; owner: string }) {
  const n = privateKeyToAccount(generatePrivateKey());
  const res = await signed(n, "/v1/nodes/announce", {
    manifest: { cpuThreads: 16, ramGB: 64, gpus: [{ name: "NVIDIA GeForce RTX 4090", vramGB: 24 }], os: "linux" },
    benchmarkMmacPerSec: 100,
    workTypes,
    pubkey: n.publicKey.slice(2),
    publicHost: "127.0.0.1",
    agentVersion: "1.5.0",
  });
  expect(res.status).toBe(200);
  await getD1()
    .prepare("UPDATE nodes SET payout = ?, fleet_id = ?, state = 'active', last_seen = ? WHERE address = ?")
    .bind(fleet.owner, fleet.id, Date.now(), n.address.toLowerCase())
    .run();
  return n;
}
const CONTAINER_NODE = ["matmul", "container"];
const RELAY_GPU_NODE = ["matmul", "hosting", "container", "gpu", "relay", "any-image"];
const GPU_NODE = ["matmul", "container", "gpu"];
const addr = (n: PrivateKeyAccount) => n.address.toLowerCase();

async function fleet(owner: { addr: string; jwt: string }, name: string) {
  const res = await authed(owner.jwt, "POST", "/v1/fleets", { name });
  expect(res.status).toBe(201);
  return { id: (await res.json()).id as string, owner: owner.addr };
}

/** A heartbeat (relay socket up for relay nodes); returns the instructions. */
async function beat(n: PrivateKeyAccount, relay = false) {
  const res = await signed(n, "/v1/nodes/heartbeat", { relay, agentVersion: "1.5.0" });
  expect(res.status).toBe(200);
  return (await res.json()).deployments as { id: string; action: string }[];
}

const CONTAINER = (placement?: { fleetId: string }) => ({
  image: "nginx:1",
  ports: [{ container: 80 }],
  cpu: 500,
  memMb: 512,
  storageMb: 1024,
  ...(placement && { placement }),
});
const WS = (o: Record<string, unknown> = {}) => ({
  image: "quay.io/jupyter/pytorch-notebook:cuda12-latest",
  ports: [{ container: 8888 }],
  cpu: 1000,
  memMb: 1024,
  storageMb: 1024,
  gpu: { count: 1 },
  tier: "on-demand",
  maxHours: 4,
  access: { web: { port: 8888 } },
  ...o,
});
const ENDPOINT = (placement: { fleetId: string }) => ({
  image: "vllm/vllm-openai:v0.6.3",
  port: 8000,
  health: { path: "/health" },
  gpu: { count: 1, minVramGb: 16 },
  cpu: 4000,
  memMb: 16_384,
  storageMb: 51_200,
  replicas: 2,
  placement,
});

const create = (jwt: string, kind: string, spec: unknown) => authed(jwt, "POST", "/v1/deployments", { name: "pinned", kind, spec });
async function createId(jwt: string, kind: string, spec: unknown) {
  const res = await create(jwt, kind, spec);
  expect(res.status).toBe(201);
  return (await res.json()).id as string;
}
const row = (id: string) => getD1().prepare("SELECT * FROM deployments WHERE id = ?").bind(id).first<Record<string, any>>();
const replicas = async (id: string) =>
  (await getD1().prepare("SELECT * FROM deployments WHERE parent_id = ? ORDER BY created_at").bind(id).all<Record<string, any>>()).results!;
const detail = async (jwt: string, id: string) => (await (await authed(jwt, "GET", `/v1/deployments/${id}`)).json()) as Record<string, any>;

let alice: { addr: string; jwt: string };
let carol: { addr: string; jwt: string };

beforeAll(async () => {
  // The relay secret keeps the relay capability on announce (endpoint replicas need it); no relay binding is installed,
  // so direct nodes still take containers (B-13).
  await setupV1Db({ DEV_MODE: "true", RELAY_TICKET_SECRET: "r".repeat(40) });
  app = buildApp({ runtime: "node" });
  alice = await user(0); // runs fleet "acme"
  carol = await user(0); // runs another fleet
});

// Assignment and preemption are global: each test starts with nothing queued or live and every node offline.
beforeEach(async () => {
  await getD1()
    .prepare("UPDATE deployments SET status = 'stopped', stop_acked_at = 1 WHERE status IN ('queued','assigned','running','unreachable')")
    .run();
  await getD1().prepare("UPDATE nodes SET last_seen = 0").run();
});

describe("placement", () => {
  it("a pinned container is never assigned outside its fleet: it waits for a node of the fleet", async () => {
    const acme = await fleet(alice, "acme");
    const other = await fleet(carol, "other");
    const bob = await user();
    const outside = await node(CONTAINER_NODE, other);
    const inside = await node(CONTAINER_NODE, acme);
    // Bob pins to Alice's fleet (a partner fleet, chosen by its id).
    const id = await createId(bob.jwt, "container", CONTAINER({ fleetId: acme.id }));

    expect((await beat(outside)).map((d) => d.id)).not.toContain(id);
    expect(await row(id)).toMatchObject({ status: "queued", node: null });

    expect((await beat(inside)).map((d) => [d.id, d.action])).toContainEqual([id, "start"]);
    expect(await row(id)).toMatchObject({ status: "assigned", node: addr(inside) });
  });

  it("endpoint replicas honour the pin", async () => {
    const acme = await fleet(alice, "acme");
    const other = await fleet(carol, "other");
    const bob = await user();
    const outside = await node(RELAY_GPU_NODE, other);
    const inside = await node(RELAY_GPU_NODE, acme);
    const id = await createId(bob.jwt, "endpoint", ENDPOINT({ fleetId: acme.id }));
    expect((await replicas(id)).map((r) => JSON.parse(r.spec_json).placement)).toEqual([{ fleetId: acme.id }, { fleetId: acme.id }]);

    await beat(outside, true);
    expect((await replicas(id)).map((r) => [r.status, r.node])).toEqual([["queued", null], ["queued", null]]);

    // One replica per node (anti-affinity): the fleet's node takes one; the outside node still takes none.
    await beat(inside, true);
    await beat(outside, true);
    expect((await replicas(id)).map((r) => [r.status, r.node])).toEqual([["assigned", addr(inside)], ["queued", null]]);
  });

  it("preemption honours the pin: no interruptible workstation outside the fleet is stopped for it", async () => {
    const acme = await fleet(alice, "acme");
    const other = await fleet(carol, "other");
    const bob = await user();
    const outside = await node(GPU_NODE, other);
    const inside = await node(GPU_NODE, acme);
    // Each node's only GPU is held by an interruptible workstation; the one outside the fleet is the younger, which
    // preemption would otherwise pick.
    const victim = async (n: PrivateKeyAccount, startedAgoMs: number) => {
      const id = crypto.randomUUID();
      await getD1()
        .prepare(
          "INSERT INTO deployments (id, owner, name, kind, spec_json, price_ucld_per_hour, status, created_at, started_at, workstation, node) " +
            "VALUES (?, ?, 'spot', 'container', ?, 100, 'running', ?, ?, 1, ?)",
        )
        .bind(id, "0x" + "d".repeat(40), JSON.stringify(WS({ tier: "interruptible" })), Date.now() - startedAgoMs, Date.now() - startedAgoMs, addr(n))
        .run();
      return id;
    };
    const victimInside = await victim(inside, 2 * 3_600_000);
    const victimOutside = await victim(outside, 600_000);

    const ws = await createId(bob.jwt, "workstation", WS({ placement: { fleetId: acme.id } }));
    expect(await preemptForOnDemand()).toBe(1);
    expect(await row(victimOutside)).toMatchObject({ status: "running" });
    expect(await row(victimInside)).toMatchObject({ status: "stopped", status_reason: "preempted by on-demand work" });
    expect((await beat(inside)).map((d) => [d.id, d.action])).toEqual([[victimInside, "stop"], [ws, "start"]]);
  });
});

describe("create", () => {
  it("refuses a fleet that does not exist or is revoked, a malformed id, and a pinned static site — nothing is held", async () => {
    const bob = await user(10_000);
    const gone = await fleet(alice, "gone");
    expect((await authed(alice.jwt, "DELETE", `/v1/fleets/${gone.id}`)).status).toBe(200);

    for (const fleetId of ["flt_" + "0".repeat(16), gone.id]) {
      const res = await create(bob.jwt, "container", CONTAINER({ fleetId }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatchObject({ code: "validation_failed", message: "spec.placement.fleetId: no such fleet" });
    }
    const bad = await create(bob.jwt, "container", CONTAINER({ fleetId: "acme" }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.message).toMatch(/^spec\.placement\.fleetId: /);

    const live = await fleet(alice, "live");
    const site = { files: [{ path: "index.html", contentBase64: btoa("<h1>hi</h1>") }], placement: { fleetId: live.id } };
    const res = await create(bob.jwt, "static", site);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatchObject({ code: "validation_failed", message: expect.stringMatching(/^spec\.placement: static sites cannot be pinned/) });

    expect(await getBalanceUcld(bob.addr)).toEqual({ balanceUcld: 10_000, heldUcld: 0 });
  });
});

describe("what the owner sees", () => {
  it("the waiting event names the fleet; list and detail show the pin and the node's fleet, never the fleet's owner", async () => {
    const acme = await fleet(alice, "acme");
    const other = await fleet(carol, "other");
    const bob = await user();
    await node(CONTAINER_NODE, other); // online, but not in the pinned fleet
    const id = await createId(bob.jwt, "container", CONTAINER({ fleetId: acme.id }));
    expect((await detail(bob.jwt, id)).events.map((e: { message: string }) => e.message)).toContain("waiting for a node in fleet acme");

    const inside = await node(CONTAINER_NODE, acme);
    await beat(inside);
    const want = { id, node: addr(inside), placement: { fleetId: acme.id }, nodeFleet: { id: acme.id, name: "acme" } };
    const listed = await (await authed(bob.jwt, "GET", "/v1/deployments")).json();
    expect(listed.deployments.find((d: { id: string }) => d.id === id)).toMatchObject(want);
    const got = await detail(bob.jwt, id);
    expect(got.deployment).toMatchObject(want);
    // The partner fleet's owner (Alice, also the node's payout) appears nowhere in what Bob is shown.
    expect(JSON.stringify(listed)).not.toContain(alice.addr);
    expect(JSON.stringify(got)).not.toContain(alice.addr);

    // An unpinned one has no placement; its node's fleet is named, but a fleet that is neither Bob's nor his pin keeps
    // its id (its owner's to share — otherwise anyone could pin to a one-node partner fleet, i.e. a single machine).
    const free = await createId(bob.jwt, "container", CONTAINER());
    const outside = await node(CONTAINER_NODE, other);
    await beat(outside);
    const unpinned = (await detail(bob.jwt, free)).deployment;
    expect(unpinned).toMatchObject({ node: addr(outside), nodeFleet: { id: null, name: "other" } });
    expect(unpinned).not.toHaveProperty("placement");
    expect(JSON.stringify(await detail(bob.jwt, free))).not.toContain(other.id);
  });

  it("a node that moves to another fleet of the same wallet hands back work pinned to its old fleet", async () => {
    const op = await user(); // its own fleets: an owner may hold at most 10 live ones
    const acme = await fleet(op, "acme");
    const created = await authed(op.jwt, "POST", "/v1/fleets", { name: "acme2" });
    const token = (await created.json()).token as string;
    const bob = await user();
    const n = await node(CONTAINER_NODE, acme);
    const id = await createId(bob.jwt, "container", CONTAINER({ fleetId: acme.id }));
    await beat(n);
    expect(await row(id)).toMatchObject({ status: "assigned", node: addr(n) });
    // The same node re-announces with acme2's token (same payout wallet: it just moves).
    const res = await signed(n, "/v1/nodes/announce", {
      manifest: { cpuThreads: 16, ramGB: 64, gpus: [], os: "linux" },
      benchmarkMmacPerSec: 100,
      workTypes: CONTAINER_NODE,
      pubkey: n.publicKey.slice(2),
      publicHost: "127.0.0.1",
      agentVersion: "1.5.0",
      fleetToken: token,
    });
    expect(res.status).toBe(200);
    expect(await row(id)).toMatchObject({ status: "queued", node: null });
  });

  it("the cron hands back pinned work from a node that left its fleet by any other route", async () => {
    const op = await user(); // its own fleets: an owner may hold at most 10 live ones
    const acme = await fleet(op, "acme");
    const other = await fleet(op, "other");
    const bob = await user();
    const n = await node(CONTAINER_NODE, acme);
    const id = await createId(bob.jwt, "container", CONTAINER({ fleetId: acme.id }));
    await beat(n);
    expect(await row(id)).toMatchObject({ status: "assigned", node: addr(n) });
    // The node's fleet changed without the bind route's hand-back (e.g. it died half-way).
    await getD1().prepare("UPDATE nodes SET fleet_id = ? WHERE address = ?").bind(other.id, addr(n)).run();
    const out = await runDutiesCron();
    expect(out.mispinned).toBe(1);
    expect(await row(id)).toMatchObject({ status: "queued", node: null });
    expect((await runDutiesCron()).mispinned).toBe(0); // idempotent
  });

  it("a revoke retried after a half failure still fails what is pinned to the fleet", async () => {
    const op = await user(); // its own fleets: an owner may hold at most 10 live ones
    const acme = await fleet(op, "acme");
    const bob = await user();
    const id = await createId(bob.jwt, "container", CONTAINER({ fleetId: acme.id }));
    // The first revoke set revoked_at and died before failing pinned work.
    await getD1().prepare("UPDATE fleets SET revoked_at = ? WHERE id = ?").bind(Date.now(), acme.id).run();
    expect((await authed(op.jwt, "DELETE", `/v1/fleets/${acme.id}`)).status).toBe(200);
    expect(await row(id)).toMatchObject({ status: "failed", held_ucld: 0 });
  });

  it("an endpoint shows its pin, and each replica its node's fleet", async () => {
    const acme = await fleet(alice, "acme");
    const bob = await user();
    const inside = await node(RELAY_GPU_NODE, acme);
    const id = await createId(bob.jwt, "endpoint", ENDPOINT({ fleetId: acme.id }));
    await beat(inside, true);
    const got = (await detail(bob.jwt, id)).deployment;
    expect(got.placement).toEqual({ fleetId: acme.id });
    expect(got.replicas[0]).toMatchObject({ status: "assigned", node: addr(inside), nodeFleet: { id: acme.id, name: "acme" } });
    expect(got.replicas[1]).toMatchObject({ status: "queued", node: null });
    expect(got.replicas[1]).not.toHaveProperty("nodeFleet");
  });
});

describe("revocation", () => {
  it("revoking a fleet fails what is pinned to it (queued or on its nodes) and releases the holds", async () => {
    const acme = await fleet(alice, "acme");
    const other = await fleet(carol, "other");
    const bob = await user(10_000);
    const inside = await node(CONTAINER_NODE, acme);
    const onNode = await createId(bob.jwt, "container", CONTAINER({ fleetId: acme.id }));
    await beat(inside);
    expect(await row(onNode)).toMatchObject({ status: "assigned", node: addr(inside) });
    const waiting = await createId(bob.jwt, "container", CONTAINER({ fleetId: acme.id }));
    const elsewhere = await createId(bob.jwt, "container", CONTAINER({ fleetId: other.id }));
    expect((await getBalanceUcld(bob.addr)).heldUcld).toBe(3 * 170);

    expect((await authed(alice.jwt, "DELETE", `/v1/fleets/${acme.id}`)).status).toBe(200);
    for (const id of [onNode, waiting]) {
      expect(await row(id)).toMatchObject({ status: "failed", status_reason: `its fleet ${acme.id} was revoked; a pinned deployment runs on no other fleet` });
    }
    expect(await row(elsewhere)).toMatchObject({ status: "queued" });
    expect(await getBalanceUcld(bob.addr)).toEqual({ balanceUcld: 10_000 - 170, heldUcld: 170 });
    // The node it was on is owed a stop.
    const stale = await getD1().prepare("SELECT node FROM deployment_stale_nodes WHERE deployment_id = ?").bind(onNode).first<{ node: string }>();
    expect(stale?.node).toBe(addr(inside));
  });
});
