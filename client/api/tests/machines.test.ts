/**
 * Machines (docs/WORKSTATIONS.md §11): the `machine-ubuntu` template, its spec rules (CPU only, SSH only, an encrypted
 * /root volume of 10–100 GB, login root by key), the curated allowlist, the `encrypted-volumes` capability at announce, and
 * placement — a machine goes only to a node with both `encrypted-volumes` and `sandbox`, and its start carries a volume
 * key sealed to that node (one per deployment per node, stable across heartbeats). The API's sealing is the agent's
 * format byte for byte (a golden payload; node-agent/src/volumes.selftest.ts opens the same one).
 */
import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { randomBytes } from "node:crypto";
import { privateKeyToAccount, generatePrivateKey, type PrivateKeyAccount } from "viem/accounts";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { buildApp } from "../src/app.js";
import { getD1 } from "../src/lib/storage.js";
import { generateToken } from "../src/middleware/auth.js";
import { nodeSigningMessage } from "../src/middleware/node-auth.js";
import { creditUcld } from "../src/services/balance.service.js";
import { imageAllowed, requiredCapabilities } from "../src/services/deployment-spec.js";
import { MACHINE_IMAGE, WORKSTATION_TEMPLATES } from "../src/services/template-workstations.js";
import { sealV2, volumeKeyAad } from "../src/lib/sealed.js";

const INTERNAL_KEY = "k".repeat(32);
const KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGq0 me@laptop";
let app: ReturnType<typeof buildApp>;
let seq = 0;

function call(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", `10.68.${Math.floor(seq / 250) % 250}.${seq++ % 250}`);
  return app.request(path, { ...init, headers });
}
function authed(jwt: string, method: string, path: string, body?: unknown) {
  return call(path, {
    method,
    headers: { Authorization: `Bearer ${jwt}`, ...(body !== undefined && { "Content-Type": "application/json" }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}
const admin = (method: string, path: string) => call(path, { method, headers: { "X-Internal-Key": INTERNAL_KEY } });

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
  const addr = "0x" + (++seq).toString(16).padStart(40, "b");
  if (credits > 0) await creditUcld(addr, credits);
  return { addr, jwt: await generateToken(addr) };
}

/** A node of a verified fleet, online and active: 16 threads, 64 GB, no GPU. Returns the account and its private key. */
async function node(workTypes: string[], fleet: { id: string; owner: string }) {
  const priv = generatePrivateKey();
  const n = privateKeyToAccount(priv);
  const res = await signed(n, "/v1/nodes/announce", {
    manifest: { cpuThreads: 16, ramGB: 64, gpus: [], os: "linux" },
    benchmarkMmacPerSec: 100,
    workTypes,
    pubkey: n.publicKey.slice(2),
    publicHost: "127.0.0.1",
    agentVersion: "1.12.0",
  });
  expect(res.status).toBe(200);
  await getD1()
    .prepare("UPDATE nodes SET payout = ?, fleet_id = ?, state = 'active', last_seen = ? WHERE address = ?")
    .bind(fleet.owner, fleet.id, Date.now(), n.address.toLowerCase())
    .run();
  return { n, priv };
}
const MACHINE_NODE = ["matmul", "container", "egress-v2", "sandbox", "encrypted-volumes", "relay", "relay-streams"];

async function verifiedFleet(owner: { addr: string; jwt: string }) {
  const res = await authed(owner.jwt, "POST", "/v1/fleets", { name: `f${seq}` });
  expect(res.status).toBe(201);
  const id = (await res.json()).id as string;
  expect((await admin("POST", `/v1/admin/fleets/${id}/verified`)).status).toBe(200);
  return { id, owner: owner.addr };
}

type Instruction = { id: string; action: string; spec: Record<string, any> | null; volumeKey?: string; relayed?: boolean };
async function beat(n: PrivateKeyAccount) {
  const res = await signed(n, "/v1/nodes/heartbeat", { relay: true, agentVersion: "1.12.0" });
  expect(res.status).toBe(200);
  return (await res.json()).deployments as Instruction[];
}

const MACHINE = (o: Record<string, unknown> = {}) => ({
  image: MACHINE_IMAGE,
  ports: [{ container: 22 }],
  cpu: 1000,
  memMb: 2048,
  storageMb: 10240,
  gpu: { count: 0 },
  tier: "on-demand",
  maxHours: 2,
  access: { ssh: { publicKey: KEY } },
  volume: { sizeGb: 10, keepDays: 1 },
  workdir: "/root",
  sshPort: 22,
  ...o,
});
const create = (jwt: string, spec: unknown) => authed(jwt, "POST", "/v1/deployments", { name: "box", kind: "workstation", spec });
async function createId(jwt: string, spec: unknown) {
  const res = await create(jwt, spec);
  expect(res.status).toBe(201);
  return (await res.json()).id as string;
}
const row = (id: string) => getD1().prepare("SELECT * FROM deployments WHERE id = ?").bind(id).first<Record<string, any>>();

/** shared/sealed.ts open() for a v2 payload, for the test only (the API itself never opens one). */
function openV2(privHex: string, sealedB64: string, aad: string): string {
  const buf = new Uint8Array(Buffer.from(sealedB64, "base64"));
  expect(buf[0]).toBe(0x02);
  const ephPub = buf.subarray(1, 66);
  const nonce = buf.subarray(66, 90);
  const ad = new TextEncoder().encode(aad);
  const shared = secp256k1.getSharedSecret(Buffer.from(privHex.slice(2), "hex"), ephPub, true);
  const info = new Uint8Array([...new TextEncoder().encode("cloudana-sealed-env-v2"), 0, ...ad]);
  const key = hkdf(sha256, shared.slice(1), ephPub, info, 32);
  return new TextDecoder().decode(xchacha20poly1305(key, nonce, ad).decrypt(buf.subarray(90)));
}

let op: { addr: string; jwt: string };

beforeAll(async () => {
  await setupV1Db({ DEV_MODE: "true", INTERNAL_API_KEY: INTERNAL_KEY, RELAY_TICKET_SECRET: "r".repeat(40) });
  app = buildApp({ runtime: "node" });
  op = await user(0);
});

beforeEach(async () => {
  await getD1()
    .prepare("UPDATE deployments SET status = 'stopped', stop_acked_at = 1 WHERE status IN ('queued','assigned','running','unreachable')")
    .run();
  await getD1().prepare("UPDATE nodes SET last_seen = 0").run();
  await getD1().prepare("UPDATE fleets SET revoked_at = 1 WHERE revoked_at IS NULL").run();
});

describe("the machine template", () => {
  it("is a curated CPU, SSH-only workstation template on the Cloudana machine image, and the image is on the allowlist", async () => {
    const t = WORKSTATION_TEMPLATES.find((x) => x.id === "machine-ubuntu")!;
    expect(t).toMatchObject({ kind: "workstation", image: MACHINE_IMAGE, gpu: { count: 0 }, access: { ssh: true }, workdir: "/root", sshPort: 22, ports: [22] });
    expect(MACHINE_IMAGE).toMatch(/^ghcr\.io\/amrdab\/cloudana-machine:\d+\.\d+\.\d+$/);
    expect(imageAllowed(MACHINE_IMAGE)).toBe(true);
    expect(imageAllowed("ghcr.io/amrdab/cloudana-machine:latest")).toBe(false);
    const served = (await (await call("/v1/templates/machine-ubuntu")).json()).data;
    expect(served).toMatchObject({ id: "machine-ubuntu", image: MACHINE_IMAGE });
  });

  it("needs encrypted-volumes, sandbox and the relay with streams; an encrypted volume alone needs encrypted-volumes", () => {
    expect(requiredCapabilities({ image: MACHINE_IMAGE, volume: { encrypted: true } })).toEqual(["encrypted-volumes", "sandbox", "relay", "relay-streams"]);
    expect(requiredCapabilities({ image: "codercom/code-server:latest", volume: { encrypted: true } })).toEqual(["encrypted-volumes"]);
    expect(requiredCapabilities({ image: "codercom/code-server:latest" })).toEqual([]);
  });
});

describe("machine specs", () => {
  it("are CPU-only and SSH-only with an encrypted 10–100 GB volume; the stored spec is encrypted, login root, trust verified", async () => {
    const bob = await user();
    const refused: [Record<string, unknown>, RegExp][] = [
      [{ gpu: { count: 1 } }, /machines are CPU-only/],
      [{ access: { web: { port: 22 } } }, /reached over SSH/],
      [{ access: { ssh: { publicKey: KEY }, web: { port: 22 } } }, /no web access/],
      [{ volume: undefined }, /needs a volume of 10–100 GB/],
      [{ volume: { sizeGb: 9, keepDays: 1 } }, /10–100 GB/],
      [{ volume: { sizeGb: 101, keepDays: 1 } }, /10–100 GB/],
      [{ volume: { sizeGb: 10, keepDays: 1, encrypted: false } }, /always encrypted/],
      [{ user: "1000" }, /spec\.user/],
      [{ access: { ssh: { publicKey: KEY, user: "admin" } } }, /logins are root and cloudana/],
    ];
    for (const [o, re] of refused) {
      const res = await create(bob.jwt, MACHINE(o));
      expect(res.status, JSON.stringify(o)).toBe(400);
      expect((await res.json()).error.message).toMatch(re);
    }
    const id = await createId(bob.jwt, MACHINE());
    const spec = JSON.parse((await row(id))!.spec_json);
    expect(spec.volume).toEqual({ sizeGb: 10, keepDays: 1, encrypted: true });
    expect(spec.access.ssh).toEqual({ publicKey: KEY, user: "root" });
    const asUser = JSON.parse((await row(await createId(bob.jwt, MACHINE({ access: { ssh: { publicKey: KEY, user: "cloudana" } } }))))!.spec_json);
    expect(asUser.access.ssh.user).toBe("cloudana");
    expect(spec.trust).toBe("verified");
  });

  it("other workstations may ask for an encrypted volume; without the flag nothing changes", async () => {
    const bob = await user();
    const ws = { ...MACHINE(), image: "codercom/code-server:latest", ports: [{ container: 8080 }], access: { web: { port: 8080 } } };
    const enc = JSON.parse((await row(await createId(bob.jwt, { ...ws, volume: { sizeGb: 5, keepDays: 0, encrypted: true } })))!.spec_json);
    expect(enc.volume).toEqual({ sizeGb: 5, keepDays: 0, encrypted: true });
    const plain = JSON.parse((await row(await createId(bob.jwt, { ...ws, volume: { sizeGb: 5, keepDays: 0 } })))!.spec_json);
    expect(plain.volume).toEqual({ sizeGb: 5, keepDays: 0 });
  });
});

describe("announce", () => {
  it("keeps encrypted-volumes in the node's capabilities", async () => {
    const { n } = await node(MACHINE_NODE, await verifiedFleet(op));
    const r = await getD1().prepare("SELECT work_types FROM nodes WHERE address = ?").bind(n.address.toLowerCase()).first<{ work_types: string }>();
    expect(JSON.parse(r!.work_types)).toEqual(expect.arrayContaining(["sandbox", "encrypted-volumes"]));
  });
});

describe("placement", () => {
  it("a machine waits for a relay-streams node with encrypted-volumes and sandbox; it is relayed and its start carries a volume key sealed to that node", async () => {
    const fleet = await verifiedFleet(op);
    const bob = await user();
    const id = await createId(bob.jwt, MACHINE());
    const evs = ((await (await authed(bob.jwt, "GET", `/v1/deployments/${id}`)).json()).events as { message: string }[]).map((e) => e.message);
    expect(evs).toContain("waiting for a capable node");

    const without = (c: string) => MACHINE_NODE.filter((x) => x !== c);
    // Each of these has a verified public host, so a plain workstation could be placed on it with SSH on that IP.
    for (const missing of ["encrypted-volumes", "sandbox", "relay-streams", "relay"]) {
      const n = await node(without(missing), fleet);
      expect((await beat(n.n)).map((d) => d.id), `without ${missing}`).not.toContain(id);
    }
    expect(await row(id)).toMatchObject({ status: "queued", node: null });

    const good = await node(MACHINE_NODE, fleet);
    const start = (await beat(good.n)).find((d) => d.id === id)!;
    expect(start).toMatchObject({ action: "start", relayed: true, spec: { volume: { encrypted: true } } });
    expect(await row(id)).toMatchObject({ status: "assigned", node: good.n.address.toLowerCase(), relayed: 1 });
    // The key opens with the node's private key under this deployment's volume aad, and is 32 random bytes in hex.
    const key = openV2(good.priv, start.volumeKey!, volumeKeyAad(id));
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(() => openV2(good.priv, start.volumeKey!, volumeKeyAad("someone-else"))).toThrow();
    // The same key on the next heartbeat (the same volume); only the sealed copy is stored.
    expect((await beat(good.n)).find((d) => d.id === id)!.volumeKey).toBe(start.volumeKey);
    const stored = await getD1().prepare("SELECT sealed FROM deployment_volume_keys WHERE deployment_id = ?").bind(id).all<{ sealed: string }>();
    expect(stored.results).toEqual([{ sealed: start.volumeKey }]);
    expect(JSON.stringify(await row(id))).not.toContain(key);
  });

  it("an unencrypted workstation's start carries no volume key", async () => {
    const fleet = await verifiedFleet(op);
    const bob = await user();
    const id = await createId(bob.jwt, { ...MACHINE(), image: "codercom/code-server:latest", ports: [{ container: 8080 }], access: { web: { port: 8080 } }, volume: { sizeGb: 5, keepDays: 0 } });
    const start = (await beat((await node(["matmul", "container"], fleet)).n)).find((d) => d.id === id)!;
    expect(start.action).toBe("start");
    expect(start.volumeKey).toBeUndefined();
  });
});

describe("sealing", () => {
  it("lib/sealed.ts sealV2 makes the agent's v2 format (golden payload, opened by node-agent/src/volumes.selftest.ts)", () => {
    const pub = Buffer.from(secp256k1.getPublicKey(Buffer.from("11".repeat(32), "hex"), false)).toString("hex");
    const golden = sealV2(pub, "ab".repeat(32), volumeKeyAad("golden"), new Uint8Array(32).fill(0x22), new Uint8Array(24).fill(0x33));
    expect(golden).toBe(
      "AgRGbX/K5WPlywmg0YcLtYA0SARheHmhSUnPIihfG64/J2coF2w8ZDH47tpFONw3yGXieE86nnfQRPM+QHeX4SeKMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMznwGn6DISiLMaVRE1uA14dwv8bpJsZDxmVK0/keSlIu2V6TGt4/q9ElUEfolH9HN3H4fjStNtCQ/tyEv9LTqrhdz2g3NUusVRg4wAWr4Isck=",
    );
    expect(openV2("0x" + "11".repeat(32), golden, volumeKeyAad("golden"))).toBe("ab".repeat(32));
    expect(() => volumeKeyAad("../x")).toThrow();
  });
});
