/**
 * Relay byte streams, API side (docs/V4_RELAY_CONTRACT.md "Byte streams"): the `relay-streams` capability is kept
 * next to `relay`, workstations become relayed on such nodes only, the route says `streams`, the gateway's SSH lookup
 * answers the owner only, and a relayed workstation's connect.ssh is `cloudana ssh <id>`.
 */
import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll, vi } from "vitest";
import { privateKeyToAccount, generatePrivateKey, type PrivateKeyAccount } from "viem/accounts";
import { buildApp } from "../src/app.js";
import { getD1 } from "../src/lib/storage.js";
import { generateToken } from "../src/middleware/auth.js";
import { nodeSigningMessage } from "../src/middleware/node-auth.js";
import { createApiKey } from "../src/services/api-keys.service.js";
import { preemptForOnDemand } from "../src/services/deployment-duties.service.js";

const SECRET = "r".repeat(40);
const INTERNAL_KEY = "k".repeat(32);
const OWNER = "0x" + "d".repeat(40);
const OTHER = "0x" + "9".repeat(40);
let app: ReturnType<typeof buildApp>;
let seq = 0;

function call(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", `198.51.100.${++seq % 250}`);
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

const announce = (node: PrivateKeyAccount, workTypes: string[]) =>
  signed(node, "/v1/nodes/announce", {
    manifest: { cpuThreads: 8, ramGB: 16, gpus: [], os: "linux" }, benchmarkMmacPerSec: 100, workTypes, pubkey: node.publicKey.slice(2), publicHost: "127.0.0.1",
  });
const nodeRow = (n: PrivateKeyAccount) => getD1().prepare("SELECT * FROM nodes WHERE address = ?").bind(n.address.toLowerCase()).first<Record<string, any>>();
const depRow = (id: string) => getD1().prepare("SELECT * FROM deployments WHERE id = ?").bind(id).first<Record<string, any>>();

/** A bound fleet node on the relay, with or without relay-streams (its host is not public: no direct serving). */
async function fleetNode(streams: boolean): Promise<PrivateKeyAccount> {
  const node = privateKeyToAccount(generatePrivateKey());
  expect((await announce(node, ["matmul", "hosting", "container", "relay", ...(streams ? ["relay-streams"] : [])])).status).toBe(200);
  await getD1().prepare("UPDATE nodes SET payout = ?, fleet_id = 'fleet-1' WHERE address = ?").bind("0x" + "e".repeat(40), node.address.toLowerCase()).run();
  return node;
}

const WS_SPEC = {
  image: "lscr.io/linuxserver/openssh-server", ports: [], cpu: 500, memMb: 256, storageMb: 512, tier: "on-demand", maxHours: 1,
  access: { ssh: { publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGq0 me@laptop" } }, gpu: { count: 0 },
};

async function queueWorkstation(owner = OWNER): Promise<string> {
  await getD1().prepare("UPDATE deployments SET status = 'stopped', stop_acked_at = 1 WHERE status = 'queued'").run();
  const id = crypto.randomUUID();
  await getD1()
    .prepare(
      "INSERT INTO deployments (id, owner, name, kind, spec_json, price_ucld_per_hour, status, created_at, workstation) VALUES (?, ?, 'ws', 'container', ?, 100, 'queued', ?, 1)",
    )
    .bind(id, owner, JSON.stringify(WS_SPEC), Date.now())
    .run();
  return id;
}

/** A running relayed workstation on `node` (as placement + the agent's report leave it). */
async function runningWorkstation(node: PrivateKeyAccount, relayed = 1): Promise<string> {
  const id = await queueWorkstation();
  await getD1()
    .prepare("UPDATE deployments SET status = 'running', node = ?, relayed = ?, started_at = ?, last_billed_at = ? WHERE id = ?")
    .bind(node.address.toLowerCase(), relayed, Date.now(), Date.now(), id)
    .run();
  return id;
}

const sshLookup = (id: string, auth: string | null, internal = true) =>
  call(`/v1/deployments/${id}/ssh`, {
    method: "POST",
    headers: { ...(auth && { Authorization: `Bearer ${auth}` }), ...(internal && { "X-Internal-Key": INTERNAL_KEY }) },
  });

beforeAll(async () => {
  await setupV1Db({ RELAY_TICKET_SECRET: SECRET, INTERNAL_API_KEY: INTERNAL_KEY, SITES_DOMAIN: "example.run" });
  app = buildApp({ runtime: "node" });
});

describe("relay-streams capability", () => {
  it("is kept next to relay, and dropped without it", async () => {
    const withRelay = privateKeyToAccount(generatePrivateKey());
    await announce(withRelay, ["matmul", "hosting", "relay", "relay-streams"]);
    expect(JSON.parse((await nodeRow(withRelay))!.work_types)).toEqual(["matmul", "hosting", "relay", "relay-streams"]);
    const without = privateKeyToAccount(generatePrivateKey());
    await announce(without, ["matmul", "relay-streams"]);
    expect(JSON.parse((await nodeRow(without))!.work_types)).toEqual(["matmul"]);
  });
});

describe("workstation placement", () => {
  it("relays a workstation on a relay-streams node without a public host, and says so in the start", async () => {
    const node = await fleetNode(true);
    const id = await queueWorkstation();
    const hb = await (await signed(node, "/v1/nodes/heartbeat", { relay: true, agentVersion: "9.9.9" })).json();
    expect(await depRow(id)).toMatchObject({ status: "assigned", relayed: 1, node: node.address.toLowerCase() });
    expect(hb.deployments).toContainEqual(expect.objectContaining({ id, action: "start", kind: "workstation", relayed: true }));
  });

  it("leaves it queued on a relay node whose agent lacks relay-streams (no public host either)", async () => {
    const node = await fleetNode(false);
    const id = await queueWorkstation();
    await signed(node, "/v1/nodes/heartbeat", { relay: true, agentVersion: "9.9.9" });
    expect(await depRow(id)).toMatchObject({ status: "queued", relayed: 0 });
  });

  it("preempts for an on-demand workstation on a relay-streams node (it can take one without a public host)", async () => {
    await getD1().prepare("UPDATE deployments SET status = 'stopped', stop_acked_at = 1 WHERE status IN ('queued','running','assigned')").run();
    await getD1().prepare("UPDATE nodes SET last_seen = 0").run(); // only this test's node is a candidate
    const node = await fleetNode(true);
    await getD1().prepare("UPDATE nodes SET state = 'active', last_seen = ? WHERE address = ?").bind(Date.now(), node.address.toLowerCase()).run();
    const big = { ...WS_SPEC, cpu: 8000, memMb: 8192, tier: "interruptible", maxHours: 5 };
    const victim = crypto.randomUUID();
    await getD1()
      .prepare(
        "INSERT INTO deployments (id, owner, name, kind, spec_json, price_ucld_per_hour, status, created_at, started_at, workstation, node) VALUES (?, ?, 'v', 'container', ?, 100, 'running', ?, ?, 1, ?)",
      )
      .bind(victim, OWNER, JSON.stringify(big), Date.now(), Date.now(), node.address.toLowerCase())
      .run();
    await queueWorkstation();
    expect(await preemptForOnDemand()).toBe(1);
    expect(await depRow(victim)).toMatchObject({ status: "stopped" });
  });
});

describe("gateway surfaces", () => {
  it("the route says streams for a running relayed deployment on a relay-streams node only", async () => {
    const route = async (id: string) => (await call(`/v1/deployments/${id}/route`, { headers: { "X-Internal-Key": INTERNAL_KEY } })).json();
    const yes = await runningWorkstation(await fleetNode(true));
    expect(await route(yes)).toMatchObject({ relayed: true, workstation: true, streams: true });
    const no = await runningWorkstation(await fleetNode(false));
    expect((await route(no)).streams).toBeUndefined();
  });

  it("connect.ssh is `cloudana ssh <id>` for a relayed workstation", async () => {
    const id = await runningWorkstation(await fleetNode(true));
    const res = await call(`/v1/deployments/${id}`, { headers: { Authorization: `Bearer ${await generateToken(OWNER)}` } });
    const body = await res.json();
    expect(body.deployment.connect).toEqual({ ssh: `cloudana ssh ${id}` });
    expect(body.deployment.url).toBe(`https://${id}.example.run`);
  });
});

describe("POST /v1/deployments/{id}/ssh (the gateway's SSH lookup)", () => {
  it("answers the owner's session with the node to open the stream on", async () => {
    const node = await fleetNode(true);
    const id = await runningWorkstation(node);
    const res = await sshLookup(id, await generateToken(OWNER));
    expect(res.status).toBe(200);
    expect((await res.json()).target).toEqual({ node: node.address.toLowerCase(), dep: id });
  });

  it("takes an API key with the deployments scope, refuses one with read only", async () => {
    const id = await runningWorkstation(await fleetNode(true));
    const ok = await createApiKey(OWNER, "cli", ["deployments"]);
    const ro = await createApiKey(OWNER, "ro", ["read"]);
    if (!ok.ok || !ro.ok) throw new Error("key");
    expect((await sshLookup(id, ok.key.token)).status).toBe(200);
    expect((await sshLookup(id, ro.key.token)).status).toBe(403);
  });

  it("is 404 for another owner, 401 without a credential or without the internal key", async () => {
    const id = await runningWorkstation(await fleetNode(true));
    expect((await sshLookup(id, await generateToken(OTHER))).status).toBe(404);
    expect((await sshLookup(id, null)).status).toBe(401);
    expect((await sshLookup(id, await generateToken(OWNER), false)).status).toBe(401);
  });

  it("is limited per caller: another wallet exhausting its own bucket does not refuse the owner", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Math.ceil(Date.now() / 60_000) * 60_000 + 1_000); // well inside one rate-limit window
      const id = await runningWorkstation(await fleetNode(true));
      const attacker = await generateToken(OTHER);
      const answers: number[] = [];
      for (let i = 0; i < 61; i++) answers.push((await sshLookup(id, attacker)).status);
      expect(answers.slice(0, 60).every((s) => s === 404)).toBe(true);
      expect(answers[60]).toBe(429);
      expect((await sshLookup(id, await generateToken(OWNER))).status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is 409 for a direct workstation, a node without relay-streams, or one not running", async () => {
    const owner = await generateToken(OWNER);
    expect((await sshLookup(await runningWorkstation(await fleetNode(true), 0), owner)).status).toBe(409);
    expect((await sshLookup(await runningWorkstation(await fleetNode(false)), owner)).status).toBe(409);
    expect((await sshLookup(await queueWorkstation(), owner)).status).toBe(409);
  });
});
