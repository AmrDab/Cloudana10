/**
 * Relay, API side (docs/V4_RELAY_CONTRACT.md): tickets, the `relay` capability, placement only while the socket is
 * fresh, running reports without an endpoint, probes through the relay, the internal route, workstation webPath.
 */
import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { privateKeyToAccount, generatePrivateKey, type PrivateKeyAccount } from "viem/accounts";
import { createHash } from "node:crypto";
import { buildApp } from "../src/app.js";
import { getD1 } from "../src/lib/storage.js";
import { resetEnv } from "../src/config/env.js";
import { setRelay, type RelayFetch } from "../src/lib/relay.js";
import { generateToken } from "../src/middleware/auth.js";
import { nodeSigningMessage } from "../src/middleware/node-auth.js";
import { creditUcld } from "../src/services/balance.service.js";
import { preemptForOnDemand, reportDeploymentStatus } from "../src/services/deployment-duties.service.js";
import { verifyTicket } from "../../../shared/relay-ticket.js";

const SECRET = "r".repeat(40);
const INTERNAL_KEY = "k".repeat(32);
let app: ReturnType<typeof buildApp>;
let seq = 0;

const b64 = (s: string) => Buffer.from(s).toString("base64");
const INDEX = "<h1>relayed</h1>";
const SITE = { files: [{ path: "index.html", contentBase64: b64(INDEX) }] };

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

const announce = (node: PrivateKeyAccount, workTypes: string[], publicHost = "127.0.0.1") =>
  signed(node, "/v1/nodes/announce", {
    manifest: { cpuThreads: 8, ramGB: 16, gpus: [], os: "linux" }, benchmarkMmacPerSec: 100, workTypes, pubkey: node.publicKey.slice(2), publicHost,
  });

const nodeRow = (n: PrivateKeyAccount) => getD1().prepare("SELECT * FROM nodes WHERE address = ?").bind(n.address.toLowerCase()).first<Record<string, any>>();
const depRow = (id: string) => getD1().prepare("SELECT * FROM deployments WHERE id = ?").bind(id).first<Record<string, any>>();

async function relayNode(): Promise<PrivateKeyAccount> {
  const node = privateKeyToAccount(generatePrivateKey());
  expect((await announce(node, ["matmul", "hosting", "relay"])).status).toBe(200);
  await getD1().prepare("UPDATE nodes SET payout = ? WHERE address = ?").bind("0x" + "e".repeat(40), node.address.toLowerCase()).run();
  return node;
}

async function createSite(): Promise<string> {
  const addr = "0x" + (++seq).toString(16).padStart(40, "b");
  await creditUcld(addr, 10_000);
  // Older queued deployments from other tests must not take this node's slot.
  await getD1().prepare("UPDATE deployments SET status = 'stopped', stop_acked_at = 1 WHERE status = 'queued'").run();
  const res = await call("/v1/deployments", {
    method: "POST",
    headers: { Authorization: `Bearer ${await generateToken(addr)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "site", kind: "static", spec: SITE }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).id;
}

beforeAll(async () => {
  await setupV1Db({ RELAY_TICKET_SECRET: SECRET, INTERNAL_API_KEY: INTERNAL_KEY, SITES_DOMAIN: "example.run" });
  app = buildApp({ runtime: "node" });
});

afterEach(() => setRelay(null));

describe("POST /v1/nodes/relay/ticket", () => {
  it("gives a signed node a single-node ticket and the relay URL", async () => {
    const node = privateKeyToAccount(generatePrivateKey());
    await announce(node, ["matmul"]);
    // Unbound: refused with 403 (never 404, which agents read as "no relay here").
    expect((await signed(node, "/v1/nodes/relay/ticket")).status).toBe(403);
    await getD1().prepare("UPDATE nodes SET payout = ? WHERE address = ?").bind("0x" + "e".repeat(40), node.address.toLowerCase()).run();
    const res = await signed(node, "/v1/nodes/relay/ticket");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe("wss://relay.cloudana.io/connect");
    expect(await verifyTicket(SECRET, body.ticket)).toMatchObject({ node: node.address.toLowerCase() });
  });

  it("is 503 not_configured without a secret, so agents stay in legacy mode", async () => {
    const node = privateKeyToAccount(generatePrivateKey());
    delete process.env.RELAY_TICKET_SECRET;
    resetEnv();
    try {
      const res = await signed(node, "/v1/nodes/relay/ticket");
      expect(res.status).toBe(503);
      // …and the relay capability is dropped, so hosting on a private host is refused as before.
      const ann = await announce(node, ["matmul", "hosting", "relay"]);
      expect(ann.status).toBe(200);
      expect(JSON.parse((await nodeRow(node))!.work_types)).toEqual(["matmul"]);
    } finally {
      process.env.RELAY_TICKET_SECRET = SECRET;
      resetEnv();
    }
  });

  it("refuses unsigned requests", async () => {
    expect((await call("/v1/nodes/relay/ticket", { method: "POST", body: "{}" })).status).toBe(401);
  });
});

describe("relay capability and placement", () => {
  it("keeps hosting without a public IP when the node announces relay, and stores no unverified host", async () => {
    const node = await relayNode();
    const row = await nodeRow(node);
    expect(JSON.parse(row!.work_types)).toEqual(["matmul", "hosting", "relay"]);
    expect(row!.public_host).toBeNull();
  });

  it("still strips hosting from a private-host legacy node", async () => {
    const node = privateKeyToAccount(generatePrivateKey());
    await announce(node, ["matmul", "hosting"]);
    expect(JSON.parse((await nodeRow(node))!.work_types)).toEqual(["matmul"]);
  });

  it("places work on a relay node only while its socket is fresh, and marks it relayed", async () => {
    const node = await relayNode();
    const id = await createSite();
    await signed(node, "/v1/nodes/heartbeat", { relay: false });
    expect((await depRow(id))!.status).toBe("queued");
    const hb = await (await signed(node, "/v1/nodes/heartbeat", { relay: true, agentVersion: "9.9.9" })).json();
    expect((await nodeRow(node))!.relay_at).toBeGreaterThan(0);
    expect(await depRow(id)).toMatchObject({ status: "assigned", node: node.address.toLowerCase(), relayed: 1 });
    expect(hb.deployments).toContainEqual(expect.objectContaining({ id, action: "start" }));
  });
});

describe("relayed deployments", () => {
  async function runningRelayed() {
    const node = await relayNode();
    const id = await createSite();
    await signed(node, "/v1/nodes/heartbeat", { relay: true });
    // No endpoint: the site is reached through the relay. A stray endpoint is ignored, never stored.
    const r = await signed(node, `/v1/nodes/deployments/${id}/status`, { status: "running", endpoint: "http://203.0.113.9:42000" });
    expect(r.status).toBe(200);
    return { node, id };
  }

  it("accepts running without an endpoint and serves the route by node, with no address", async () => {
    const { node, id } = await runningRelayed();
    expect(await depRow(id)).toMatchObject({ status: "running", endpoint: null, relayed: 1 });
    const route = await (await call(`/v1/deployments/${id}/route`, { headers: { "x-internal-key": INTERNAL_KEY } })).json();
    expect(route).toMatchObject({ state: "running", relayed: true, targets: [{ node: node.address.toLowerCase(), dep: id }], endpoint: null });
  });

  it("probes through the relay with the content hash", async () => {
    const { node, id } = await runningRelayed();
    const seen: { node: string; headers: Record<string, string> }[] = [];
    const fake: RelayFetch = async (n, path, init) => {
      expect(path).toBe("/proxy");
      seen.push({ node: n, headers: init?.headers ?? {} });
      return new Response(INDEX, { status: 200 });
    };
    setRelay(fake);
    await signed(node, "/v1/nodes/heartbeat", { relay: true });
    expect(seen).toContainEqual({ node: node.address.toLowerCase(), headers: { "x-relay-dep": id, "x-relay-class": "site", "x-relay-path": "/index.html", "x-relay-probe": "1" } });
    expect(await depRow(id)).toMatchObject({ probe_fail: 0 });
    expect((await depRow(id))!.last_probe_at).toBeGreaterThan(0);
    expect(createHash("sha256").update(INDEX).digest("hex")).toBe((await depRow(id))!.probe_hash);
  });

  it("counts a wrong body or no relay as a failed probe", async () => {
    const { node, id } = await runningRelayed();
    setRelay(async () => new Response("<h1>someone else</h1>", { status: 200 }));
    await signed(node, "/v1/nodes/heartbeat", { relay: true });
    expect((await depRow(id))!.probe_fail).toBe(1);
    setRelay(null);
    await getD1().prepare("UPDATE deployments SET last_probe_at = 0 WHERE id = ?").bind(id).run();
    await signed(node, "/v1/nodes/heartbeat", { relay: true });
    expect((await depRow(id))!.probe_fail).toBe(2);
  });

  it("fails a node that answers 200 and breaks off, or sends more than the cap; never 'inconclusive'", async () => {
    const { node, id } = await runningRelayed();
    const reprobe = () => getD1().prepare("UPDATE deployments SET last_probe_at = 0 WHERE id = ?").bind(id).run();
    // The head arrives, then the stream errors (a node aborting after the 200).
    setRelay(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(ctl) {
          ctl.enqueue(new TextEncoder().encode(INDEX.slice(0, 5)));
          ctl.error(new Error("node sent err"));
        },
      });
      return new Response(body, { status: 200 });
    });
    await signed(node, "/v1/nodes/heartbeat", { relay: true });
    expect(await depRow(id)).toMatchObject({ probe_fail: 1, probe_inconclusive: 0 });
    // No content-length through the relay: the cap is enforced while reading.
    let pulled = 0;
    setRelay(async () => {
      const chunk = new Uint8Array(1024 * 1024);
      const body = new ReadableStream<Uint8Array>({
        pull(ctl) {
          pulled++;
          ctl.enqueue(chunk);
        },
      });
      return new Response(body, { status: 200 });
    });
    await reprobe();
    await signed(node, "/v1/nodes/heartbeat", { relay: true });
    expect((await depRow(id))!.probe_fail).toBe(2);
    expect(pulled).toBeLessThanOrEqual(6); // stopped just past 4 MiB, not read to the end
  });

  it("counts the third inconclusive probe in a row as a failure", async () => {
    const { node, id } = await runningRelayed();
    const reprobe = () => getD1().prepare("UPDATE deployments SET last_probe_at = 0 WHERE id = ?").bind(id).run();
    setRelay(async () => {
      throw new Error("binding exploded");
    });
    for (const [inconclusive, fails] of [[1, 0], [2, 0], [0, 1]]) {
      await reprobe();
      await signed(node, "/v1/nodes/heartbeat", { relay: true });
      expect(await depRow(id)).toMatchObject({ probe_inconclusive: inconclusive, probe_fail: fails });
    }
    // A conclusive probe resets the streak.
    setRelay(async () => {
      throw new Error("binding exploded");
    });
    await reprobe();
    await signed(node, "/v1/nodes/heartbeat", { relay: true });
    setRelay(async () => new Response(INDEX, { status: 200 }));
    await reprobe();
    await signed(node, "/v1/nodes/heartbeat", { relay: true });
    expect(await depRow(id)).toMatchObject({ probe_inconclusive: 0, probe_fail: 0 });
  });
});

describe("workstation webPath", () => {
  async function workstationRow(relayed: number) {
    const node = "0x" + (++seq).toString(16).padStart(40, "c");
    const id = crypto.randomUUID();
    await getD1()
      .prepare(
        "INSERT INTO deployments (id, owner, name, kind, spec_json, price_ucld_per_hour, status, node, assigned_at, created_at, workstation, relayed) " +
          "VALUES (?, ?, 'ws', 'container', '{}', 100, 'assigned', ?, ?, ?, 1, ?)",
      )
      .bind(id, "0x" + "d".repeat(40), node, Date.now(), Date.now(), relayed)
      .run();
    return { node, id };
  }

  it("stores a relayed workstation's webPath as its gateway path", async () => {
    const { node, id } = await workstationRow(1);
    expect(await reportDeploymentStatus(node, id, { status: "running", webPath: "/lab?token=abc" })).toMatchObject({ ok: true, status: "running" });
    expect((await depRow(id))!.endpoint).toBe("/lab?token=abc");
  });

  it("refuses webPath on a direct deployment", async () => {
    const { node, id } = await workstationRow(0);
    expect(await reportDeploymentStatus(node, id, { status: "running", webPath: "/lab" })).toMatchObject({ ok: false, code: "validation_failed" });
  });
});

describe("what goes through the relay", () => {
  it("relays a container on a relay node but keeps workstations off nodes without a public host", async () => {
    const node = privateKeyToAccount(generatePrivateKey());
    expect((await announce(node, ["matmul", "hosting", "container", "relay"])).status).toBe(200);
    const addr = node.address.toLowerCase();
    await getD1().prepare("UPDATE nodes SET payout = ?, fleet_id = 'fleet-1' WHERE address = ?").bind("0x" + "e".repeat(40), addr).run();
    await getD1().prepare("UPDATE deployments SET status = 'stopped', stop_acked_at = 1 WHERE status = 'queued'").run();
    const base = { image: "nginx:1", ports: [{ container: 80 }], cpu: 500, memMb: 256, storageMb: 512 };
    const insert = async (workstation: number, spec: object) => {
      const id = crypto.randomUUID();
      await getD1()
        .prepare(
          "INSERT INTO deployments (id, owner, name, kind, spec_json, price_ucld_per_hour, status, created_at, workstation) " +
            "VALUES (?, ?, 'x', 'container', ?, 100, 'queued', ?, ?)",
        )
        .bind(id, "0x" + "d".repeat(40), JSON.stringify(spec), Date.now(), workstation)
        .run();
      return id;
    };
    const ws = await insert(1, { ...base, tier: "on-demand", maxHours: 1, access: { web: { port: 80 } }, gpu: { count: 0 } });
    const box = await insert(0, base);
    const hb = await (await signed(node, "/v1/nodes/heartbeat", { relay: true, agentVersion: "9.9.9" })).json();
    expect(await depRow(box)).toMatchObject({ status: "assigned", relayed: 1 });
    expect(await depRow(ws)).toMatchObject({ status: "queued", relayed: 0 });
    expect(hb.deployments).toContainEqual(expect.objectContaining({ id: box, action: "start", relayed: true }));
  });

  // Owner decision 2026-10-21 (B-13): while the relay runs, direct serving stays only for workstations.
  async function directNode(): Promise<string> {
    const node = privateKeyToAccount(generatePrivateKey());
    expect((await announce(node, ["matmul", "hosting", "container"])).status).toBe(200);
    const addr = node.address.toLowerCase();
    await getD1()
      .prepare("UPDATE nodes SET payout = ?, fleet_id = 'fleet-1', public_host = '203.0.113.7', work_types = ? WHERE address = ?")
      .bind("0x" + "e".repeat(40), JSON.stringify(["matmul", "hosting", "container"]), addr)
      .run();
    directNodes.set(addr, node);
    return addr;
  }
  const directNodes = new Map<string, PrivateKeyAccount>();
  async function queueContainer(workstation: number): Promise<string> {
    const base = { image: "nginx:1", ports: [{ container: 80 }], cpu: 500, memMb: 256, storageMb: 512 };
    const spec = workstation ? { ...base, tier: "on-demand", maxHours: 1, access: { web: { port: 80 } }, gpu: { count: 0 } } : base;
    const id = crypto.randomUUID();
    await getD1()
      .prepare(
        "INSERT INTO deployments (id, owner, name, kind, spec_json, price_ucld_per_hour, status, created_at, workstation) " +
          "VALUES (?, ?, 'x', 'container', ?, 100, 'queued', ?, ?)",
      )
      .bind(id, "0x" + "d".repeat(40), JSON.stringify(spec), Date.now(), workstation)
      .run();
    return id;
  }

  it("while the relay runs, a node off it takes workstations only: no site, no plain container", async () => {
    setRelay(async () => new Response("{}", { status: 200 }));
    const addr = await directNode();
    const site = await createSite();
    const ws = await queueContainer(1);
    const box = await queueContainer(0);
    expect((await signed(directNodes.get(addr)!, "/v1/nodes/heartbeat", { agentVersion: "9.9.9" })).status).toBe(200);
    expect(await depRow(site)).toMatchObject({ status: "queued" });
    expect(await depRow(box)).toMatchObject({ status: "queued" });
    expect(await depRow(ws)).toMatchObject({ status: "assigned", node: addr, relayed: 0 });
  });

  it("while the relay runs, nothing is preempted on a node off it for work that node cannot take", async () => {
    setRelay(async () => new Response("{}", { status: 200 }));
    const addr = await directNode();
    await getD1().prepare("UPDATE nodes SET state = 'active', last_seen = ? WHERE address = ?").bind(Date.now(), addr).run();
    await getD1().prepare("UPDATE deployments SET status = 'stopped', stop_acked_at = 1 WHERE status IN ('queued','running')").run();
    // An interruptible workstation fills the direct node; an on-demand plain container waits.
    const victim = crypto.randomUUID();
    const big = { image: "nginx:1", ports: [{ container: 80 }], cpu: 8000, memMb: 8192, storageMb: 512, tier: "interruptible", maxHours: 5, access: { web: { port: 80 } }, gpu: { count: 0 } };
    await getD1()
      .prepare(
        "INSERT INTO deployments (id, owner, name, kind, spec_json, price_ucld_per_hour, status, created_at, started_at, workstation, node) " +
          "VALUES (?, ?, 'v', 'container', ?, 100, 'running', ?, ?, 1, ?)",
      )
      .bind(victim, "0x" + "d".repeat(40), JSON.stringify(big), Date.now(), Date.now(), addr)
      .run();
    await queueContainer(0);
    expect(await preemptForOnDemand()).toBe(0);
    expect(await depRow(victim)).toMatchObject({ status: "running" });
  });

  it("without a relay (local stacks), a direct node still serves sites and containers", async () => {
    setRelay(null);
    const addr = await directNode();
    const site = await createSite();
    const box = await queueContainer(0);
    expect((await signed(directNodes.get(addr)!, "/v1/nodes/heartbeat", { agentVersion: "9.9.9" })).status).toBe(200);
    expect(await depRow(site)).toMatchObject({ status: "assigned", node: addr, relayed: 0 });
    expect(await depRow(box)).toMatchObject({ status: "assigned", node: addr, relayed: 0 });
  });
});
