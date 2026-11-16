/**
 * Trust tiers (docs/TRUST_TIERS.md §3) and the abuse switch (§4). spec.trust is "verified" by default: such work runs
 * only on nodes of a fleet an admin verified (POST/DELETE /v1/admin/fleets/{id}/verified); "community" only on nodes
 * that advertise both `sandbox` and `egress-v2`, and never with GPUs. A pin and a tier combine. Un-verifying a fleet
 * re-queues its verified work. POST /v1/admin/deployments/{id}/abuse stops a deployment, suspends its owner and stops
 * the owner's other work; a suspended owner gets 403 on create until DELETE /v1/admin/accounts/{address}/suspend.
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
import { preemptForOnDemand } from "../src/services/deployment-duties.service.js";

const INTERNAL_KEY = "k".repeat(32);
let app: ReturnType<typeof buildApp>;
let seq = 0;

function call(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", `10.67.${Math.floor(seq / 250) % 250}.${seq++ % 250}`);
  return app.request(path, { ...init, headers });
}

function authed(jwt: string, method: string, path: string, body?: unknown) {
  return call(path, {
    method,
    headers: { Authorization: `Bearer ${jwt}`, ...(body !== undefined && { "Content-Type": "application/json" }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

function admin(method: string, path: string, body?: unknown, key = INTERNAL_KEY) {
  return call(path, {
    method,
    headers: { "X-Internal-Key": key, ...(body !== undefined && { "Content-Type": "application/json" }) },
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
  const addr = "0x" + (++seq).toString(16).padStart(40, "a");
  if (credits > 0) await creditUcld(addr, credits);
  return { addr, jwt: await generateToken(addr) };
}

const announceBody = (n: PrivateKeyAccount, workTypes: string[]) => ({
  manifest: { cpuThreads: 16, ramGB: 64, gpus: [{ name: "NVIDIA GeForce RTX 4090", vramGB: 24 }], os: "linux" },
  benchmarkMmacPerSec: 100,
  workTypes,
  pubkey: n.publicKey.slice(2),
  publicHost: "127.0.0.1",
  agentVersion: "1.5.0",
});

/** A node of `fleet`, online and active; one 24 GB GPU, 16 threads, 64 GB. */
async function node(workTypes: string[], fleet: { id: string; owner: string }) {
  const n = privateKeyToAccount(generatePrivateKey());
  expect((await signed(n, "/v1/nodes/announce", announceBody(n, workTypes))).status).toBe(200);
  await getD1()
    .prepare("UPDATE nodes SET payout = ?, fleet_id = ?, state = 'active', last_seen = ? WHERE address = ?")
    .bind(fleet.owner, fleet.id, Date.now(), n.address.toLowerCase())
    .run();
  return n;
}
const CONTAINER_NODE = ["matmul", "container"];
const SANDBOX_NODE = ["matmul", "container", "sandbox", "egress-v2"];
const GPU_SANDBOX_NODE = ["matmul", "container", "gpu", "sandbox", "egress-v2"];
const addr = (n: PrivateKeyAccount) => n.address.toLowerCase();

/** A fleet of `owner`'s, verified by an admin when `verified`. */
async function fleet(owner: { addr: string; jwt: string }, name: string, verified: boolean) {
  const res = await authed(owner.jwt, "POST", "/v1/fleets", { name });
  expect(res.status).toBe(201);
  const id = (await res.json()).id as string;
  if (verified) expect((await admin("POST", `/v1/admin/fleets/${id}/verified`)).status).toBe(200);
  return { id, owner: owner.addr };
}

async function beat(n: PrivateKeyAccount) {
  const res = await signed(n, "/v1/nodes/heartbeat", { relay: false, agentVersion: "1.5.0" });
  expect(res.status).toBe(200);
  return (await res.json()).deployments as { id: string; action: string }[];
}

const CONTAINER = (o: Record<string, unknown> = {}) => ({ image: "nginx:1", ports: [{ container: 80 }], cpu: 500, memMb: 512, storageMb: 1024, ...o });
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

const create = (jwt: string, kind: string, spec: unknown) => authed(jwt, "POST", "/v1/deployments", { name: "tiered", kind, spec });
async function createId(jwt: string, kind: string, spec: unknown) {
  const res = await create(jwt, kind, spec);
  expect(res.status).toBe(201);
  return (await res.json()).id as string;
}
const row = (id: string) => getD1().prepare("SELECT * FROM deployments WHERE id = ?").bind(id).first<Record<string, any>>();
const detail = async (jwt: string, id: string) => (await (await authed(jwt, "GET", `/v1/deployments/${id}`)).json()) as Record<string, any>;
const events = async (jwt: string, id: string) => ((await detail(jwt, id)).events as { message: string }[]).map((e) => e.message);

let op: { addr: string; jwt: string };

beforeAll(async () => {
  await setupV1Db({ DEV_MODE: "true", INTERNAL_API_KEY: INTERNAL_KEY, RELAY_TICKET_SECRET: "r".repeat(40) });
  app = buildApp({ runtime: "node" });
  op = await user(0);
});

// Assignment and preemption are global: each test starts with nothing queued or live and every node offline.
beforeEach(async () => {
  await getD1()
    .prepare("UPDATE deployments SET status = 'stopped', stop_acked_at = 1 WHERE status IN ('queued','assigned','running','unreachable')")
    .run();
  await getD1().prepare("UPDATE nodes SET last_seen = 0").run();
  // An owner may hold at most 10 live fleets.
  await getD1().prepare("UPDATE fleets SET revoked_at = 1 WHERE revoked_at IS NULL").run();
});

describe("placement", () => {
  it("trust verified (the default) goes only to a verified fleet's node; the wait says why", async () => {
    const plain = await fleet(op, "plain", false);
    const vetted = await fleet(op, "vetted", true);
    const bob = await user();
    const unverifiedNode = await node(CONTAINER_NODE, plain);
    const id = await createId(bob.jwt, "container", CONTAINER());
    expect(await events(bob.jwt, id)).toContain('waiting for a node in a verified fleet: trust "verified" runs only on fleets Cloudana has verified');
    expect((await detail(bob.jwt, id)).deployment.trust).toBe("verified");

    expect((await beat(unverifiedNode)).map((d) => d.id)).not.toContain(id);
    expect(await row(id)).toMatchObject({ status: "queued", node: null });

    const verifiedNode = await node(CONTAINER_NODE, vetted);
    expect((await beat(verifiedNode)).map((d) => [d.id, d.action])).toContainEqual([id, "start"]);
    expect(await row(id)).toMatchObject({ status: "assigned", node: addr(verifiedNode) });
  });

  it("a deployment from before tiers (no trust in its spec) counts as verified", async () => {
    const plain = await fleet(op, "plain", false);
    const bob = await user();
    const id = await createId(bob.jwt, "container", CONTAINER());
    const spec = JSON.parse((await row(id))!.spec_json);
    delete spec.trust;
    await getD1().prepare("UPDATE deployments SET spec_json = ? WHERE id = ?").bind(JSON.stringify(spec), id).run();
    await beat(await node(CONTAINER_NODE, plain));
    expect(await row(id)).toMatchObject({ status: "queued" });
    expect((await detail(bob.jwt, id)).deployment.trust).toBe("verified");
  });

  it("trust community needs both sandbox and egress-v2, on any fleet; a verified fleet without them does not take it", async () => {
    const plain = await fleet(op, "plain", false);
    const vetted = await fleet(op, "vetted", true);
    const bob = await user();
    const unsandboxed = await node(CONTAINER_NODE, vetted); // verified, but not sandboxed
    const id = await createId(bob.jwt, "container", CONTAINER({ trust: "community" }));
    expect((await events(bob.jwt, id)).some((m) => m.startsWith("waiting for a node with sandbox and egress-v2"))).toBe(true);

    await beat(unsandboxed);
    await beat(await node(["matmul", "container", "sandbox"], plain)); // sandbox without the egress policy
    await beat(await node(["matmul", "container", "egress-v2"], plain)); // the egress policy without the sandbox
    expect(await row(id)).toMatchObject({ status: "queued", node: null });

    const both = await node(SANDBOX_NODE, plain);
    expect((await beat(both)).map((d) => [d.id, d.action])).toContainEqual([id, "start"]);
    expect(await row(id)).toMatchObject({ status: "assigned", node: addr(both) });
  });

  it("trust community with a GPU is refused at create (GPU containers are not sandboxed), and so is a tier on a static site", async () => {
    const bob = await user(10_000);
    for (const [kind, spec] of [
      ["workstation", WS({ trust: "community" })],
      ["container", CONTAINER({ trust: "community", gpu: { count: 1 } })],
    ] as const) {
      const res = await create(bob.jwt, kind, spec);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatchObject({ code: "validation_failed", message: expect.stringMatching(/^spec\.trust: GPU work runs on verified fleets only/) });
    }
    const site = await create(bob.jwt, "static", { files: [{ path: "index.html", contentBase64: btoa("<h1>hi</h1>") }], trust: "verified" });
    expect(site.status).toBe(400);
    expect((await site.json()).error.message).toMatch(/^spec\.trust: static sites have no trust tier/);
    const bad = await create(bob.jwt, "container", CONTAINER({ trust: "confidential" }));
    expect(bad.status).toBe(400);
    expect(await getBalanceUcld(bob.addr)).toEqual({ balanceUcld: 10_000, heldUcld: 0 });
  });

  it("a GPU workstation at trust verified runs on a verified fleet's GPU node", async () => {
    const vetted = await fleet(op, "vetted", true);
    const bob = await user();
    const id = await createId(bob.jwt, "workstation", WS());
    const n = await node(GPU_SANDBOX_NODE, vetted);
    await beat(n);
    expect(await row(id)).toMatchObject({ status: "assigned", node: addr(n) });
  });

  it("pin + verified: only that fleet, and only once it is verified", async () => {
    const pinned = await fleet(op, "pinned", false);
    const vetted = await fleet(op, "vetted", true);
    const bob = await user();
    const inPin = await node(CONTAINER_NODE, pinned);
    const elsewhere = await node(CONTAINER_NODE, vetted);
    const id = await createId(bob.jwt, "container", CONTAINER({ placement: { fleetId: pinned.id } }));
    expect(await events(bob.jwt, id)).toContain(
      'waiting for a node in a verified fleet (pinned to fleet pinned, which must be verified): trust "verified" runs only on fleets Cloudana has verified',
    );
    await beat(inPin); // the pinned fleet is not verified
    await beat(elsewhere); // verified, but not the pinned fleet
    expect(await row(id)).toMatchObject({ status: "queued", node: null });

    expect((await admin("POST", `/v1/admin/fleets/${pinned.id}/verified`)).status).toBe(200);
    await beat(elsewhere);
    expect(await row(id)).toMatchObject({ status: "queued" });
    await beat(inPin);
    expect(await row(id)).toMatchObject({ status: "assigned", node: addr(inPin) });
  });

  it("pin + community: that fleet's sandboxed nodes only", async () => {
    const pinned = await fleet(op, "pinned", false);
    const other = await fleet(op, "other", false);
    const bob = await user();
    const id = await createId(bob.jwt, "container", CONTAINER({ trust: "community", placement: { fleetId: pinned.id } }));
    await beat(await node(SANDBOX_NODE, other));
    await beat(await node(CONTAINER_NODE, pinned));
    expect(await row(id)).toMatchObject({ status: "queued" });
    const n = await node(SANDBOX_NODE, pinned);
    await beat(n);
    expect(await row(id)).toMatchObject({ status: "assigned", node: addr(n) });
  });

  it("preemption honours the tier: no interruptible workstation on an unverified fleet is stopped for verified work", async () => {
    const plain = await fleet(op, "plain", false);
    const bob = await user();
    const n = await node(["matmul", "container", "gpu"], plain);
    const victim = crypto.randomUUID();
    await getD1()
      .prepare(
        "INSERT INTO deployments (id, owner, name, kind, spec_json, price_ucld_per_hour, status, created_at, started_at, workstation, node) " +
          "VALUES (?, ?, 'spot', 'container', ?, 100, 'running', ?, ?, 1, ?)",
      )
      .bind(victim, "0x" + "d".repeat(40), JSON.stringify(WS({ tier: "interruptible" })), Date.now(), Date.now(), addr(n))
      .run();
    await createId(bob.jwt, "workstation", WS());
    expect(await preemptForOnDemand()).toBe(0);
    expect(await row(victim)).toMatchObject({ status: "running" });
  });
});

describe("admin: verified fleets", () => {
  it("needs the internal key, knows the fleet, refuses a revoked one and shows verified in the owner's list", async () => {
    const f = await fleet(op, "f", false);
    expect((await admin("POST", `/v1/admin/fleets/${f.id}/verified`, undefined, "wrong".repeat(8))).status).toBe(401);
    expect((await authed(op.jwt, "POST", `/v1/admin/fleets/${f.id}/verified`)).status).toBe(401);
    expect((await admin("POST", `/v1/admin/fleets/flt_${"0".repeat(16)}/verified`)).status).toBe(404);

    const listed = async () => (await (await authed(op.jwt, "GET", "/v1/fleets")).json()).fleets.find((x: { id: string }) => x.id === f.id);
    expect((await listed()).verified).toBe(false);
    const first = await (await admin("POST", `/v1/admin/fleets/${f.id}/verified`)).json();
    expect(first).toMatchObject({ status: "success", id: f.id, verified: true, verifiedAt: expect.any(Number), requeued: 0 });
    expect((await (await admin("POST", `/v1/admin/fleets/${f.id}/verified`)).json()).verifiedAt).toBe(first.verifiedAt); // idempotent
    expect((await listed()).verified).toBe(true);

    expect((await authed(op.jwt, "DELETE", `/v1/fleets/${f.id}`)).status).toBe(200);
    expect((await listed()).verified).toBe(false); // revoked: no longer counts
    expect((await admin("POST", `/v1/admin/fleets/${f.id}/verified`)).status).toBe(409);
  });

  it("un-verifying re-queues the fleet's verified work (its node owed a stop) and leaves community work; a retry finds nothing", async () => {
    const vetted = await fleet(op, "vetted", true);
    const bob = await user();
    const n = await node(SANDBOX_NODE, vetted);
    const verified = await createId(bob.jwt, "container", CONTAINER());
    const community = await createId(bob.jwt, "container", CONTAINER({ trust: "community" }));
    await beat(n);
    expect(await row(verified)).toMatchObject({ status: "assigned", node: addr(n) });
    expect(await row(community)).toMatchObject({ status: "assigned", node: addr(n) });

    const res = await admin("DELETE", `/v1/admin/fleets/${vetted.id}/verified`);
    expect(await res.json()).toMatchObject({ status: "success", verified: false, verifiedAt: null, requeued: 1 });
    expect(await row(verified)).toMatchObject({ status: "queued", node: null });
    expect(await row(community)).toMatchObject({ status: "assigned", node: addr(n) });
    expect(await events(bob.jwt, verified)).toContain(`its node's fleet ${vetted.id} is no longer verified (trust tier verified) — re-queued`);
    expect((await beat(n)).map((d) => [d.id, d.action])).toContainEqual([verified, "stop"]);
    expect(await row(verified)).toMatchObject({ status: "queued" }); // not taken straight back

    expect((await (await admin("DELETE", `/v1/admin/fleets/${vetted.id}/verified`)).json()).requeued).toBe(0);
  });
});

describe("abuse switch", () => {
  it("stops the reported deployment and the owner's other work, records why, and refuses new deployments until lifted", async () => {
    const vetted = await fleet(op, "vetted", true);
    const mallory = await user();
    const bob = await user();
    const n = await node(CONTAINER_NODE, vetted);
    const reported = await createId(mallory.jwt, "container", CONTAINER());
    const other = await createId(mallory.jwt, "container", CONTAINER());
    await beat(n);
    const queued = await createId(mallory.jwt, "container", CONTAINER({ trust: "community" }));
    const bystander = await createId(bob.jwt, "container", CONTAINER());

    expect((await admin("POST", `/v1/admin/deployments/${reported}/abuse`, { reason: "spam" }, "wrong".repeat(8))).status).toBe(401);
    const res = await admin("POST", `/v1/admin/deployments/${reported}/abuse`, { reason: "outbound spam" });
    expect(await res.json()).toMatchObject({ status: "success", owner: mallory.addr, suspendedAt: expect.any(Number), stopped: 3 });

    expect(await row(reported)).toMatchObject({ status: "stopped", status_reason: "stopped after an abuse report: outbound spam" });
    for (const id of [other, queued]) {
      expect(await row(id)).toMatchObject({ status: "stopped", status_reason: "account suspended after an abuse report: outbound spam" });
    }
    expect(await events(mallory.jwt, reported)).toContain("stopped: stopped after an abuse report: outbound spam");
    expect(await row(bystander)).toMatchObject({ status: expect.not.stringMatching(/stopped|failed/) });
    expect((await getBalanceUcld(mallory.addr)).heldUcld).toBe(0);
    // The node is told to stop what it ran.
    expect((await beat(n)).filter((d) => d.action === "stop").map((d) => d.id).sort()).toEqual([reported, other].sort());

    const refused = await create(mallory.jwt, "static", { files: [{ path: "index.html", contentBase64: btoa("x") }] });
    expect(refused.status).toBe(403);
    expect((await refused.json()).error).toMatchObject({ code: "forbidden", message: expect.stringContaining("this account is suspended: outbound spam") });
    expect((await getBalanceUcld(mallory.addr)).heldUcld).toBe(0);

    // Idempotent: nothing more to stop, the first suspension time stays.
    const again = await (await admin("POST", `/v1/admin/deployments/${reported}/abuse`, { reason: "outbound spam" })).json();
    expect(again).toMatchObject({ stopped: 0 });

    expect((await admin("DELETE", `/v1/admin/accounts/${mallory.addr}/suspend`)).status).toBe(200);
    expect((await admin("DELETE", `/v1/admin/accounts/${mallory.addr}/suspend`)).status).toBe(404);
    await createId(mallory.jwt, "container", CONTAINER());
    expect(await row(reported)).toMatchObject({ status: "stopped" }); // nothing restarts
  });

  it("naming an endpoint replica stops the whole endpoint", async () => {
    const mallory = await user();
    const res = await create(mallory.jwt, "endpoint", { image: "vllm/vllm-openai:v0.6.3", port: 8000, cpu: 1000, memMb: 1024, storageMb: 1024, replicas: 2 });
    expect(res.status).toBe(201);
    const id = (await res.json()).id as string;
    const replicas = (await getD1().prepare("SELECT id FROM deployments WHERE parent_id = ?").bind(id).all<{ id: string }>()).results!;
    expect((await admin("POST", `/v1/admin/deployments/${replicas[0].id}/abuse`, { reason: "phishing" })).status).toBe(200);
    for (const r of [id, ...replicas.map((x) => x.id)]) expect(await row(r)).toMatchObject({ status: "stopped" });
  });
});

describe("node capabilities", () => {
  it("a node announcing sandbox, egress-v2 and relay-streams keeps them", async () => {
    const n = privateKeyToAccount(generatePrivateKey());
    const caps = ["matmul", "container", "relay", "relay-streams", "sandbox", "egress-v2"];
    expect((await signed(n, "/v1/nodes/announce", announceBody(n, caps))).status).toBe(200);
    const stored = await getD1().prepare("SELECT work_types FROM nodes WHERE address = ?").bind(addr(n)).first<{ work_types: string }>();
    expect(JSON.parse(stored!.work_types)).toEqual(expect.arrayContaining(caps));
  });
});
