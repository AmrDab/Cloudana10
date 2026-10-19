/**
 * Storage phase 1, part B (docs/V4_STORAGE_PHASE1_CONTRACT.md §B): copy encryption, placement, signed instructions,
 * downloads, reports, checks (through a simulated node behind the relay), audits and expiry.
 */
import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { privateKeyToAccount, generatePrivateKey, type PrivateKeyAccount } from "viem/accounts";
import { buildApp } from "../src/app.js";
import { getD1 } from "../src/lib/storage.js";
import { setRelay, type RelayFetch } from "../src/lib/relay.js";
import { memoryArtifacts, setArtifactStore } from "../src/lib/artifacts.js";
import { nodeSigningMessage } from "../src/middleware/node-auth.js";
import { instructionDigest } from "../src/services/instruction-signing.service.js";
import {
  applyReports, auditSuspects, decryptCopy, encryptCopy, expireCopies, netPrefix, registerObject, runChecks, runStorageCron,
} from "../src/services/storage.service.js";
import { leafRange, merkleLevels, merklePath, merkleRoot, LEAF_PLAIN_BYTES } from "../../../shared/storage-proof.js";
import { recoverMessageAddress } from "viem";

const SECRET = "r".repeat(40);
const SIGNER = generatePrivateKey();
let app: ReturnType<typeof buildApp>;
let seq = 0;
let store: ReturnType<typeof memoryArtifacts>;

function call(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", `198.51.100.${++seq % 250}`);
  return app.request(path, { ...init, headers });
}

async function signed(node: PrivateKeyAccount, method: "GET" | "POST", path: string, payload?: unknown) {
  const body = method === "GET" ? "" : JSON.stringify(payload ?? {});
  const ts = String(Date.now());
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const signature = await node.signMessage({ message: nodeSigningMessage(method, path, ts, body, nonce) });
  return call(path, {
    method,
    headers: { "Content-Type": "application/json", "X-Node": node.address, "X-Node-Timestamp": ts, "X-Nonce": nonce, "X-Node-Signature": signature },
    ...(method === "POST" ? { body } : {}),
  });
}

/** A bound relay node; `storageGb` > 0 with agent 1.4.0 makes it a storage node. Network identity set explicitly. */
async function node(opts: { storageGb?: number; agent?: string; prefix?: string; asn?: number } = {}) {
  const n = privateKeyToAccount(generatePrivateKey());
  const res = await signed(n, "POST", "/v1/nodes/announce", {
    manifest: { cpuThreads: 8, ramGB: 16, gpus: [], os: "linux" },
    benchmarkMmacPerSec: 100,
    workTypes: ["matmul", "relay", "storage"],
    pubkey: n.publicKey.slice(2),
    agentVersion: opts.agent ?? "1.4.0",
    ...(opts.storageGb !== undefined ? { storageGb: opts.storageGb } : { storageGb: 10 }),
  });
  expect(res.status).toBe(200);
  const s = ++seq;
  await getD1()
    .prepare("UPDATE nodes SET payout = ?, relay_at = ?, last_seen = ?, net_prefix = ?, asn = ? WHERE address = ?")
    .bind("0x" + s.toString(16).padStart(40, "e"), Date.now(), Date.now(), opts.prefix ?? `10.${s}.0.0/24`, opts.asn ?? 64_000 + s, addr(n))
    .run();
  return n;
}
const addr = (n: PrivateKeyAccount) => n.address.toLowerCase();
const nodeRow = (n: PrivateKeyAccount) => getD1().prepare("SELECT * FROM nodes WHERE address = ?").bind(addr(n)).first<Record<string, any>>();
const copiesOf = (objectId: string) =>
  getD1().prepare("SELECT * FROM storage_copies WHERE object_id = ? ORDER BY copy_idx").bind(objectId).all<Record<string, any>>().then((r) => r.results!);

/** A stored artifact of `size` bytes registered as a storage object. */
async function object(size = 100_000, now = Date.now()) {
  const id = `jobs/obj-${++seq}.json`;
  const bytes = new Uint8Array(size).map((_, i) => (i * 31 + seq) & 0xff);
  await store.put(id, bytes);
  await registerObject(id, size, now);
  return { id, bytes };
}

/** What simulated nodes hold: copy id → ciphertext. */
const disks = new Map<string, Map<string, Uint8Array>>();

/** Download every fetch op in `ops` as `n` and report it held (the agent's job). */
async function fetchAll(n: PrivateKeyAccount, ops: { op: string; copy: string; root?: string }[], report = true) {
  const disk = disks.get(addr(n)) ?? new Map<string, Uint8Array>();
  disks.set(addr(n), disk);
  for (const o of ops.filter((x) => x.op === "fetch")) {
    const res = await signed(n, "GET", `/v1/nodes/storage/copies/${o.copy}`);
    expect(res.status).toBe(200);
    const ct = new Uint8Array(await res.arrayBuffer());
    expect(await merkleRoot(ct)).toBe(o.root);
    disk.set(o.copy, ct);
  }
  if (report) {
    const held = ops.filter((x) => x.op === "fetch").map((x) => ({ id: x.copy, state: "held" }));
    if (held.length) expect((await signed(n, "POST", "/v1/nodes/storage/report", { copies: held })).status).toBe(200);
  }
}

async function beat(n: PrivateKeyAccount) {
  const res = await signed(n, "POST", "/v1/nodes/heartbeat", { relay: true, agentVersion: "1.4.0" });
  expect(res.status).toBe(200);
  return res.json();
}

/** The relay as a set of honest simulated nodes: proofs from what each node holds (`lie` corrupts one node's leaves). */
function honestRelay(opts: { lie?: string; seen?: string[] } = {}): RelayFetch {
  return async (nodeAddr, _path, init) => {
    const h = init?.headers ?? {};
    opts.seen?.push(`${nodeAddr} ${h["x-relay-class"]} ${h["x-relay-dep"]} ${h["x-relay-probe"]}`);
    const u = new URL(`http://x${h["x-relay-path"]}`);
    const ct = disks.get(nodeAddr)?.get(u.searchParams.get("copy") ?? "");
    if (!ct) return new Response("", { status: 502, headers: { "x-relay-error": "not_serving" } });
    const levels = await merkleLevels(ct);
    const proofs = u.searchParams.get("i")!.split(",").map(Number).map((i) => {
      const leaf = ct.slice(...leafRange(i, ct.byteLength));
      if (opts.lie === nodeAddr) leaf[0] ^= 1;
      return { i, leaf: Buffer.from(leaf).toString("base64"), path: merklePath(levels, i) };
    });
    return new Response(JSON.stringify({ proofs }), { status: 200 });
  };
}

beforeAll(async () => {
  await setupV1Db({ DEV_MODE: "true", RELAY_TICKET_SECRET: SECRET, INSTRUCTION_SIGNING_KEY: SIGNER, NODE_ACTIVE_SECONDS: "60", RELAY_FRESH_SECONDS: "60" });
  app = buildApp({ runtime: "node" });
});
beforeEach(async () => {
  store = memoryArtifacts();
  setArtifactStore(store);
  disks.clear();
  // Every test starts with no objects and no storage-capable nodes from earlier tests.
  await getD1().batch([
    getD1().prepare("DELETE FROM storage_copies"),
    getD1().prepare("DELETE FROM storage_objects"),
    getD1().prepare("DELETE FROM storage_checks"),
    getD1().prepare("UPDATE nodes SET storage_quota_mb = 0, storage_next_check_at = NULL"),
  ]);
});
afterEach(() => setRelay(null));

describe("copy encryption", () => {
  it("round-trips; two copies of one object differ in ciphertext and root; the copy id is bound", async () => {
    const master = new Uint8Array(32).fill(7);
    const plain = new Uint8Array(LEAF_PLAIN_BYTES * 2 + 10).map((_, i) => i & 0xff);
    const a = { id: crypto.randomUUID(), object_id: "jobs/x.json", copy_idx: 0, nonce: "0011223344556677" };
    const b = { ...a, id: crypto.randomUUID(), copy_idx: 1, nonce: "8899aabbccddeeff" };
    const ca = await encryptCopy(plain, a, master);
    const cb = await encryptCopy(plain, b, master);
    expect(ca.byteLength).toBe(plain.byteLength + 3 * 16);
    expect(await merkleRoot(ca)).not.toBe(await merkleRoot(cb));
    expect(await decryptCopy(ca, a, master)).toEqual(plain);
    await expect(decryptCopy(ca, { ...a, id: b.id }, master)).rejects.toThrow();
    await expect(decryptCopy(ca, a, new Uint8Array(32).fill(8))).rejects.toThrow();
  });

  it("network prefixes: /24 and /48", () => {
    expect(netPrefix("203.0.113.77")).toBe("203.0.113.0/24");
    expect(netPrefix("::ffff:203.0.113.77")).toBe("203.0.113.0/24");
    expect(netPrefix("2001:db8:abcd:12::1")).toBe("2001:db8:abcd::/48");
    expect(netPrefix("2001:db8::1")).toBe("2001:db8:0::/48");
    expect(netPrefix("unknown")).toBeNull();
    expect(netPrefix("1:2:3:4:5:6:7:8:9")).toBeNull();
  });
});

describe("announce", () => {
  it("keeps the storage capability and quota only for agent ≥ 1.4.0 with a quota", async () => {
    const ok = await node({ storageGb: 25 });
    expect(JSON.parse((await nodeRow(ok))!.work_types)).toContain("storage");
    expect((await nodeRow(ok))!.storage_quota_mb).toBe(25 * 1024);
    const old = await node({ agent: "1.3.0" });
    expect(JSON.parse((await nodeRow(old))!.work_types)).not.toContain("storage");
    expect((await nodeRow(old))!.storage_quota_mb).toBe(0);
    const none = await node({ storageGb: 0 });
    expect(JSON.parse((await nodeRow(none))!.work_types)).not.toContain("storage");
  });
});

describe("placement and instructions", () => {
  it("places two copies on different networks, signs a storage key only for storage nodes, and serves each copy only while pending", async () => {
    const a = await node({ prefix: "10.1.1.0/24", asn: 1 });
    const b = await node({ prefix: "10.1.1.0/24", asn: 2 }); // same /24 as a
    const c = await node({ prefix: "10.2.2.0/24", asn: 1 }); // same ASN as a
    const d = await node({ prefix: "10.3.3.0/24", asn: 3 });
    const obj = await object();
    await runStorageCron();
    const copies = await copiesOf(obj.id);
    expect(copies).toHaveLength(2);
    // Whichever node took copy 0, the other copy is on a node sharing neither its /24 nor its ASN.
    const holders = copies.map((x) => x.node);
    const rows = await Promise.all(holders.map((h) => getD1().prepare("SELECT net_prefix, asn FROM nodes WHERE address = ?").bind(h).first<any>()));
    expect(rows[0].net_prefix).not.toBe(rows[1].net_prefix);
    expect(rows[0].asn).not.toBe(rows[1].asn);
    expect(copies.every((x) => x.state === "pending" && x.root.length === 64)).toBe(true);
    expect(new Set([addr(a), addr(b), addr(c), addr(d)])).toEqual(new Set([addr(a), addr(b), addr(c), addr(d)]));

    // The holder's heartbeat carries a signed storage key with a fetch; a plain node's body has no storage key.
    const holder = [a, b, c, d].find((n) => addr(n) === copies[0].node)!;
    const hb = await beat(holder);
    expect(hb.storage).toEqual([{ op: "fetch", copy: copies[0].id, size: obj.bytes.byteLength + 2 * 16, leaves: 2, root: copies[0].root }]);
    const digest = instructionDigest(addr(holder), hb.ts, hb.nonce, { assignment: hb.assignment, deployments: hb.deployments, storage: hb.storage });
    expect((await recoverMessageAddress({ message: { raw: digest }, signature: hb.sig })).toLowerCase()).toBe(privateKeyToAccount(SIGNER).address.toLowerCase());
    const plain = privateKeyToAccount(generatePrivateKey());
    await signed(plain, "POST", "/v1/nodes/announce", { manifest: { cpuThreads: 4, ramGB: 8, gpus: [], os: "linux" }, benchmarkMmacPerSec: 10, workTypes: ["matmul"], agentVersion: "1.3.0" });
    const plainBeat = await beat(plain);
    expect("storage" in plainBeat).toBe(false);
    // `bound` (unsigned): an agent unbound from the console re-announces for a fresh bind link.
    expect(plainBeat.bound).toBe(false);
    expect(hb.bound).toBe(true);

    // Only the assigned node may download, only while pending, at most 3 times.
    const other = [a, b, c, d].find((n) => !holders.includes(addr(n)))!;
    expect((await signed(other, "GET", `/v1/nodes/storage/copies/${copies[0].id}`)).status).toBe(404);
    await fetchAll(holder, hb.storage);
    expect((await copiesOf(obj.id))[0]).toMatchObject({ state: "held", fetches: 1 });
    expect((await signed(holder, "GET", `/v1/nodes/storage/copies/${copies[0].id}`)).status).toBe(409);
  });

  it("refuses held without a download, caps pending per node, and grows a new node's quota with passed days", async () => {
    const a = await node({ storageGb: 100 });
    const objs = [];
    for (let i = 0; i < 10; i++) objs.push(await object(10_000));
    await runStorageCron();
    const pending = (await getD1().prepare("SELECT COUNT(*) AS n FROM storage_copies WHERE node = ? AND state = 'pending'").bind(addr(a)).first<{ n: number }>())!.n;
    expect(pending).toBe(8); // one node, one copy per object, at most 8 pending
    const one = (await getD1().prepare("SELECT id FROM storage_copies WHERE node = ? LIMIT 1").bind(addr(a)).first<{ id: string }>())!.id;
    expect(await applyReports(addr(a), [{ id: one, state: "held" }])).toBe(0); // never downloaded

    // A brand-new node may hold 1 GB whatever it declares (100 GB here): fill it to just under 1 GB, nothing more fits.
    await getD1().prepare("DELETE FROM storage_copies").run();
    await getD1().prepare("UPDATE nodes SET storage_quota_mb = 0 WHERE address <> ?").bind(addr(a)).run();
    await getD1().prepare("UPDATE storage_objects SET next_attempt_at = ?").bind(Date.now()).run();
    await getD1().prepare("INSERT INTO storage_copies (id, object_id, copy_idx, node, nonce, root, state, fetches, assigned_at) VALUES (?, 'filler', 0, ?, '00', '00', 'held', 1, 0)").bind(crypto.randomUUID(), addr(a)).run();
    await getD1().prepare("INSERT INTO storage_objects (id, size, leaves, created_at) VALUES ('filler', ?, 1, ?)").bind(1024 * 1024 * 1024 - 5_000, Date.now()).run();
    await runStorageCron();
    expect((await getD1().prepare("SELECT COUNT(*) AS n FROM storage_copies WHERE node = ? AND state = 'pending'").bind(addr(a)).first<{ n: number }>())!.n).toBe(0);
    const later = Date.now() + 11 * 60_000; // past the 10-minute retry; the node is still online then
    await getD1().prepare("UPDATE nodes SET storage_passed_days = 1, relay_at = ?, last_seen = ? WHERE address = ?").bind(later, later, addr(a)).run();
    await runStorageCron(undefined, later);
    expect((await getD1().prepare("SELECT COUNT(*) AS n FROM storage_copies WHERE node = ? AND state = 'pending'").bind(addr(a)).first<{ n: number }>())!.n).toBe(8);
  });

  it("places nothing without an artifact store or signing key, and leaves big objects to R2", async () => {
    await node();
    await registerObject("jobs/huge.json", 5 * 1024 * 1024);
    expect(await getD1().prepare("SELECT 1 FROM storage_objects WHERE id = 'jobs/huge.json'").first()).toBeNull();
    const obj = await object();
    setArtifactStore(null);
    await runStorageCron();
    expect(await copiesOf(obj.id)).toHaveLength(0);
    setArtifactStore(store);
    const key = process.env.INSTRUCTION_SIGNING_KEY;
    delete process.env.INSTRUCTION_SIGNING_KEY;
    try {
      await runStorageCron();
      expect(await copiesOf(obj.id)).toHaveLength(0);
    } finally {
      process.env.INSTRUCTION_SIGNING_KEY = key;
    }
  });
});

describe("checks", () => {
  /** One storage node holding one copy of a fresh object (downloaded and reported held). */
  async function holding() {
    const n = await node();
    const obj = await object(200_000); // 4 leaves
    await runStorageCron();
    const hb = await beat(n);
    await fetchAll(n, hb.storage);
    const [copy] = await copiesOf(obj.id);
    return { n, obj, copy };
  }

  it("a node that holds its copy passes: probe-class requests through the relay, a sample on the node-day", async () => {
    const { n, copy } = await holding();
    expect((await nodeRow(n))!.storage_next_check_at).toBeLessThanOrEqual(Date.now()); // checked at once after held
    const seen: string[] = [];
    setRelay(honestRelay({ seen }));
    const checked = await runChecks(Date.now());
    expect(checked).toEqual(new Set([addr(n)]));
    expect(seen).toEqual([`${addr(n)} storage storage 1`]);
    const day = Math.floor(Date.now() / 86_400_000);
    expect(await getD1().prepare("SELECT samples, misses, failures FROM storage_checks WHERE node = ? AND day = ?").bind(addr(n), day).first()).toEqual({ samples: 1, misses: 0, failures: 0 });
    expect((await copiesOf(copy.object_id))[0]).toMatchObject({ state: "held", checked_at: expect.any(Number) });
    expect((await nodeRow(n))!.storage_next_check_at).toBeGreaterThan(Date.now() + 30 * 60_000);
  });

  it("a node without the data fails twice: the copy drops, its other copies turn suspect, 24 h cooldown", async () => {
    const { n, copy } = await holding();
    // A second held copy on the same node.
    const obj2 = await object(70_000);
    await runStorageCron();
    await fetchAll(n, (await beat(n)).storage);
    disks.get(addr(n))!.delete(copy.id); // lost one
    await getD1().prepare("UPDATE storage_copies SET checked_at = NULL WHERE id = ?").bind(copy.id).run();
    await getD1().prepare("UPDATE storage_copies SET checked_at = 1 WHERE id <> ?").bind(copy.id).run();
    await getD1().prepare("UPDATE nodes SET storage_next_check_at = 0 WHERE address = ?").bind(addr(n)).run();
    setRelay(honestRelay());
    const now = Date.now();
    await runChecks(now);
    expect((await copiesOf(copy.object_id))[0].state).toBe("dropping");
    expect((await copiesOf(obj2.id))[0].state).toBe("suspect");
    expect(await nodeRow(n)).toMatchObject({ storage_strikes: 1, storage_cooldown_until: now + 24 * 3_600_000 });
    // The dropped copy reaches the node as a signed delete; the object is due for a new copy elsewhere.
    expect((await beat(n)).storage).toContainEqual({ op: "delete", copy: copy.id });
    expect((await getD1().prepare("SELECT next_attempt_at FROM storage_objects WHERE id = ?").bind(copy.object_id).first<any>())!.next_attempt_at).toBe(now);
    // The suspect copy is still on disk: the audit passes it back to held.
    await auditSuspects(now, new Set());
    expect((await copiesOf(obj2.id))[0].state).toBe("held");
  });

  it("a wrong leaf is a failure, a flake is only a miss, and the node can't fetch on demand", async () => {
    const { n, copy } = await holding();
    setRelay(honestRelay({ lie: addr(n) }));
    await getD1().prepare("UPDATE nodes SET storage_next_check_at = 0 WHERE address = ?").bind(addr(n)).run();
    await runChecks(Date.now());
    expect((await copiesOf(copy.object_id))[0].state).toBe("dropping");

    const second = await holding();
    let calls = 0;
    const honest = honestRelay();
    setRelay(async (...args) => (++calls === 1 ? new Response("", { status: 502, headers: { "x-relay-error": "offline" } }) : honest(...args)));
    await getD1().prepare("UPDATE nodes SET storage_next_check_at = 0 WHERE address = ?").bind(addr(second.n)).run();
    await runChecks(Date.now());
    expect((await copiesOf(second.copy.object_id))[0].state).toBe("held");
    expect(await getD1().prepare("SELECT samples, misses, failures FROM storage_checks WHERE node = ?").bind(addr(second.n)).first()).toEqual({ samples: 1, misses: 1, failures: 0 });
    expect((await nodeRow(second.n))!.storage_strikes).toBe(0);
    // A held copy can't be downloaded again to answer a check.
    expect((await signed(second.n, "GET", `/v1/nodes/storage/copies/${second.copy.id}`)).status).toBe(409);
  });

  it("only the relay call failing is inconclusive, and the third in a row counts", async () => {
    const { n, copy } = await holding();
    setRelay(async () => {
      throw new Error("binding exploded");
    });
    for (const streak of [1, 2]) {
      await getD1().prepare("UPDATE nodes SET storage_next_check_at = 0 WHERE address = ?").bind(addr(n)).run();
      await runChecks(Date.now());
      expect((await nodeRow(n))!.storage_inconclusive).toBe(streak);
      expect((await copiesOf(copy.object_id))[0].state).toBe("held");
    }
    await getD1().prepare("UPDATE nodes SET storage_next_check_at = 0 WHERE address = ?").bind(addr(n)).run();
    await runChecks(Date.now());
    // The third counts as a miss; the re-challenge is inconclusive too, so nothing is confirmed yet.
    expect(await getD1().prepare("SELECT misses, failures FROM storage_checks WHERE node = ?").bind(addr(n)).first()).toEqual({ misses: 1, failures: 0 });
    expect((await nodeRow(n))!.storage_inconclusive).toBe(0);
    // A body that breaks off after the 200 is a failure, never inconclusive.
    setRelay(async () => new Response(new ReadableStream({ start: (ctl) => ctl.error(new Error("node sent err")) }), { status: 200 }));
    await getD1().prepare("UPDATE nodes SET storage_next_check_at = 0 WHERE address = ?").bind(addr(n)).run();
    await runChecks(Date.now());
    expect((await copiesOf(copy.object_id))[0].state).toBe("dropping");
  });

  it("a day with samples and no confirmed failure counts as passed when the next day opens", async () => {
    const { n } = await holding();
    setRelay(honestRelay());
    const today = Math.floor(Date.now() / 86_400_000) * 86_400_000;
    await getD1().prepare("UPDATE nodes SET storage_next_check_at = 0 WHERE address = ?").bind(addr(n)).run();
    await runChecks(today + 3_600_000);
    expect((await nodeRow(n))!.storage_passed_days).toBe(0);
    await getD1().prepare("UPDATE nodes SET storage_next_check_at = 0, relay_at = ? WHERE address = ?").bind(today + 86_400_000 + 3_600_000, addr(n)).run();
    await runChecks(today + 86_400_000 + 3_600_000);
    expect((await nodeRow(n))!.storage_passed_days).toBe(1);
  });
});

describe("expiry", () => {
  it("drops stale pendings (node backs off), copies on nodes offline 48 h, and copies past retention", async () => {
    const a = await node();
    const obj = await object();
    const t0 = Date.now();
    await runStorageCron(undefined, t0);
    const [p] = await copiesOf(obj.id);
    await expireCopies(t0 + 3_600_001);
    expect((await copiesOf(obj.id))[0].state).toBe("dropping");
    expect((await nodeRow(a))!.storage_backoff_until).toBe(t0 + 3_600_001 + 3_600_000);
    expect(await applyReports(addr(a), [{ id: p.id, state: "deleted" }])).toBe(1);
    expect(await copiesOf(obj.id)).toHaveLength(0);

    const b = await node();
    await getD1().prepare("UPDATE storage_objects SET next_attempt_at = ?").bind(t0).run();
    await runStorageCron(undefined, t0);
    const held = (await copiesOf(obj.id)).find((x) => x.node === addr(b))!;
    await getD1().prepare("UPDATE storage_copies SET state = 'held' WHERE id = ?").bind(held.id).run();
    await getD1().prepare("UPDATE nodes SET last_seen = ? WHERE address = ?").bind(t0 - 49 * 3_600_000, addr(b)).run();
    await expireCopies(t0);
    expect((await copiesOf(obj.id)).find((x) => x.id === held.id)!.state).toBe("dropping");

    // A node that keeps heartbeating but has had no relay socket for 48 h can't be checked: its copies go too.
    const c2 = await node();
    await getD1().prepare("UPDATE storage_objects SET next_attempt_at = ?").bind(t0).run();
    await runStorageCron(undefined, t0);
    const onC = (await copiesOf(obj.id)).find((x) => x.node === addr(c2))!;
    await getD1().prepare("UPDATE nodes SET last_seen = ?, relay_at = ? WHERE address = ?").bind(t0, t0 - 49 * 3_600_000, addr(c2)).run();
    await expireCopies(t0);
    expect((await copiesOf(obj.id)).find((x) => x.id === onC.id)!.state).toBe("dropping");

    await getD1().prepare("UPDATE storage_objects SET created_at = ?").bind(t0 - 31 * 86_400_000).run();
    await expireCopies(t0);
    expect((await copiesOf(obj.id)).every((x) => x.state === "dropping")).toBe(true);
    expect((await getD1().prepare("SELECT next_attempt_at FROM storage_objects WHERE id = ?").bind(obj.id).first<any>())!.next_attempt_at).toBeNull();
  });
});

describe("review fixes (PR #41)", () => {
  async function holdingOn(n: PrivateKeyAccount) {
    const obj = await object(70_000);
    await runStorageCron();
    await fetchAll(n, (await beat(n)).storage);
    return obj;
  }

  it("keeps checking a node whose copies are all suspect, and an audit pass re-arms its schedule", async () => {
    const n = await node();
    const o1 = await holdingOn(n);
    await getD1().prepare("UPDATE storage_copies SET state = 'suspect' WHERE object_id = ?").bind(o1.id).run();
    await getD1().prepare("UPDATE nodes SET storage_next_check_at = 0 WHERE address = ?").bind(addr(n)).run();
    setRelay(honestRelay());
    await runChecks(Date.now()); // no held copy to sample: the schedule must survive while suspects remain
    expect((await nodeRow(n))!.storage_next_check_at).not.toBeNull();
    await getD1().prepare("UPDATE nodes SET storage_next_check_at = NULL WHERE address = ?").bind(addr(n)).run();
    await auditSuspects(Date.now(), new Set());
    expect((await copiesOf(o1.id))[0].state).toBe("held");
    expect((await nodeRow(n))!.storage_next_check_at).not.toBeNull();
  });

  it("audits one suspect per node, so a node with a backlog can't starve the others", async () => {
    const big = await node();
    for (let i = 0; i < 6; i++) await holdingOn(big); // one copy each (no second node yet; retried in 10 min)
    const small = await node();
    await getD1().prepare("UPDATE nodes SET storage_quota_mb = 0 WHERE address = ?").bind(addr(big)).run();
    const smallObj = await holdingOn(small);
    await getD1().prepare("UPDATE storage_copies SET state = 'suspect', checked_at = NULL WHERE state = 'held'").run();
    setRelay(honestRelay());
    await auditSuspects(Date.now(), new Set());
    expect((await copiesOf(smallObj.id)).find((x) => x.node === addr(small))!.state).toBe("held");
    const bigHeld = (await getD1().prepare("SELECT COUNT(*) AS n FROM storage_copies WHERE node = ? AND state = 'held'").bind(addr(big)).first<{ n: number }>())!.n;
    expect(bigHeld).toBe(1); // one per node per run
  });

  it("credits a day only with a conclusive pass", async () => {
    const n = await node();
    await holdingOn(n);
    const today = Math.floor(Date.now() / 86_400_000) * 86_400_000;
    let calls = 0;
    const honest = honestRelay();
    // Every sample: the first answer fails, the re-challenge passes → misses only, no conclusive pass.
    setRelay(async (...args) => (++calls % 2 === 1 ? new Response("", { status: 502, headers: { "x-relay-error": "offline" } }) : honest(...args)));
    for (const t of [today + 3_600_000, today + 7_200_000]) {
      await getD1().prepare("UPDATE nodes SET storage_next_check_at = 0, relay_at = ? WHERE address = ?").bind(t, addr(n)).run();
      await runChecks(t);
    }
    const tomorrow = today + 86_400_000 + 3_600_000;
    setRelay(honest);
    await getD1().prepare("UPDATE nodes SET storage_next_check_at = 0, relay_at = ? WHERE address = ?").bind(tomorrow, addr(n)).run();
    await runChecks(tomorrow);
    expect((await nodeRow(n))!.storage_passed_days).toBe(0);
  });

  it("skips nodes below the network minimum, refuses reports from unknown nodes, and one bad read doesn't stop placement", async () => {
    const n = await node();
    const obj = await object();
    process.env.MIN_AGENT_VERSION = "1.5.0";
    try {
      await runStorageCron();
      expect(await copiesOf(obj.id)).toHaveLength(0);
    } finally {
      delete process.env.MIN_AGENT_VERSION;
    }
    const stranger = privateKeyToAccount(generatePrivateKey());
    expect((await signed(stranger, "POST", "/v1/nodes/storage/report", { copies: [] })).status).toBe(404);

    const other = await object();
    const failing = { ...store, get: async (k: string) => (k === obj.id ? Promise.reject(new Error("r2 hiccup")) : store.get(k)) };
    setArtifactStore(failing);
    await getD1().prepare("UPDATE storage_objects SET next_attempt_at = 0").run();
    await runStorageCron();
    expect(await copiesOf(obj.id)).toHaveLength(0);
    expect((await copiesOf(other.id)).some((x) => x.node === addr(n))).toBe(true);
  });
});
