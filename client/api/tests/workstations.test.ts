import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { privateKeyToAccount, generatePrivateKey, type PrivateKeyAccount } from "viem/accounts";
import { buildApp } from "../src/app.js";
import { getD1 } from "../src/lib/storage.js";
import { generateToken } from "../src/middleware/auth.js";
import { nodeSigningMessage } from "../src/middleware/node-auth.js";
import { creditUcld, getBalanceUcld } from "../src/services/balance.service.js";
import { SSH_PUBLIC_KEY, checkSpec, priceUcldPerHour, type WorkstationSpec } from "../src/services/deployment-spec.js";
import { gpuClass, gpusFit } from "../src/services/workstation.js";
import { probeTarget } from "../src/services/deployment-duties.service.js";

let app: ReturnType<typeof buildApp>;
let ipSeq = 0;
let userSeq = 0;

function call(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", `10.7.${Math.floor(ipSeq / 250) % 250}.${ipSeq++ % 250}`);
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
  const signature = await node.signMessage({ message: nodeSigningMessage("POST", path, ts, body) });
  return call(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Node": node.address, "X-Node-Timestamp": ts, "X-Node-Signature": signature },
    body,
  });
}

type G = { name: string; vramGB: number };
const A100: G = { name: "NVIDIA A100-SXM4-80GB", vramGB: 80 };
const RTX4090: G = { name: "NVIDIA GeForce RTX 4090", vramGB: 24 };
const GPU_CAPS = ["matmul", "container", "gpu"];

/** A bound node with the given capabilities and GPUs. */
async function boundNode(workTypes: string[], gpus: G[] = []) {
  const node = privateKeyToAccount(generatePrivateKey());
  const manifest = { cpuThreads: 16, ramGB: 64, gpus, os: "linux" };
  const res = await signed(node, "/v1/nodes/announce", { manifest, benchmarkMmacPerSec: 100, workTypes, pubkey: node.publicKey.slice(2) });
  expect(res.status).toBe(200);
  const payout = "0x" + (++userSeq).toString(16).padStart(40, "e");
  await getD1().prepare("UPDATE nodes SET payout = ? WHERE address = ?").bind(payout, node.address.toLowerCase()).run();
  return node;
}

async function user(credits = 100_000) {
  const addr = "0x" + (++userSeq).toString(16).padStart(40, "c");
  if (credits > 0) await creditUcld(addr, credits);
  return { addr, jwt: await generateToken(addr) };
}

const KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl me@laptop";
/** 1 consumer-priced GPU on-demand Jupyter-like workstation: 320 + 2000 = 2320 µCLD/h. */
const WS = (o: Partial<WorkstationSpec> = {}) => ({
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

const create = (jwt: string, spec: unknown, extra: Record<string, unknown> = {}) =>
  authed(jwt, "POST", "/v1/deployments", { name: "ws", kind: "workstation", spec, ...extra });
const createId = async (jwt: string, spec: unknown, extra: Record<string, unknown> = {}) => {
  const res = await create(jwt, spec, extra);
  expect(res.status).toBe(201);
  return (await res.json()).id as string;
};

async function heartbeat(node: PrivateKeyAccount) {
  const res = await signed(node, "/v1/nodes/heartbeat");
  expect(res.status).toBe(200);
  return (await res.json()).deployments as { id: string; action: string; kind: string; spec: Record<string, any> | null }[];
}

const report = (node: PrivateKeyAccount, id: string, body: Record<string, unknown>) => signed(node, `/v1/nodes/deployments/${id}/status`, body);
const row = (id: string) => getD1().prepare("SELECT * FROM deployments WHERE id = ?").bind(id).first<Record<string, any>>();
const shift = (id: string, col: string, ms: number) => getD1().prepare(`UPDATE deployments SET ${col} = ${col} - ? WHERE id = ?`).bind(ms, id).run();
const detail = async (jwt: string, id: string) => (await (await authed(jwt, "GET", `/v1/deployments/${id}`)).json()) as Record<string, any>;

/** Create, assign to `node` on its heartbeat, report running. */
async function running(node: PrivateKeyAccount, jwt: string, spec: unknown, status: Record<string, unknown> = { endpoint: "http://127.0.0.1:42010" }) {
  const id = await createId(jwt, spec);
  expect((await heartbeat(node)).map((d) => d.id)).toContain(id);
  expect((await report(node, id, { status: "running", ...status })).status).toBe(200);
  return id;
}

beforeAll(async () => {
  await setupV1Db({ DEV_MODE: "true" });
  app = buildApp({ runtime: "node" });
});

// Each test starts with no queued/live deployments and every node offline (assignment and preemption are global).
beforeEach(async () => {
  await getD1()
    .prepare("UPDATE deployments SET status = 'stopped', stop_acked_at = 1, purge_pending = 0 WHERE status IN ('queued','assigned','running','unreachable')")
    .run();
  await getD1().prepare("UPDATE nodes SET last_seen = 0").run();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("ok")));
});
afterEach(() => vi.unstubAllGlobals());

describe("validation", () => {
  it("accepts ed25519 / rsa / ecdsa keys and refuses anything else", () => {
    for (const k of [KEY, "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQ==", "ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTY= a b c"]) {
      expect(SSH_PUBLIC_KEY.test(k), k).toBe(true);
    }
    for (const k of ["ssh-dss AAAAB3NzaC1kc3M=", "ssh-ed25519", "ssh-ed25519 not*base64", "AAAAC3NzaC1lZDI1NTE5", `${KEY}\nrm -rf /`]) {
      expect(SSH_PUBLIC_KEY.test(k), k).toBe(false);
    }
    expect(checkSpec("workstation", WS({ access: { ssh: { publicKey: "ssh-dss AAAA" } } })).ok).toBe(false);
    expect(checkSpec("workstation", WS({ access: { ssh: { publicKey: KEY } }, ports: [{ container: 22 }] })).ok).toBe(true);
  });

  it("needs web or ssh access, a web port among ports, and bounded hours/volume/GPUs", async () => {
    const u = await user();
    const bad: [unknown, string][] = [
      [WS({ access: {} }), "access.web or access.ssh is required"],
      [WS({ access: { web: { port: 9999 } } }), "access.web.port must be one of ports"],
      [WS({ maxHours: 0 }), "spec.maxHours"],
      [WS({ maxHours: 721 }), "spec.maxHours"],
      [WS({ volume: { sizeGb: 501, keepDays: 1 } }), "spec.volume.sizeGb"],
      [WS({ volume: { sizeGb: 10, keepDays: 31 } }), "spec.volume.keepDays"],
      [WS({ gpu: { count: 9 } }), "spec.gpu.count"],
      [{ ...WS(), tier: "spot" }, "spec.tier"],
    ];
    for (const [spec, msg] of bad) {
      const res = await create(u.jwt, spec);
      expect(res.status, msg).toBe(400);
      expect((await res.json()).error.message, msg).toContain(msg);
    }
    expect(await getBalanceUcld(u.addr)).toEqual({ balanceUcld: 100_000, heldUcld: 0 });
    expect((await create(u.jwt, WS({ volume: { sizeGb: 500, keepDays: 30 }, maxHours: 720, gpu: { count: 8 } }))).status).toBe(201);
  });
});

describe("pricing", () => {
  const base = { cpu: 1000, memMb: 1024, storageMb: 1024 }; // container formula: 200 + 100 + 20 = 320
  const price = (o: Partial<WorkstationSpec>) => priceUcldPerHour("workstation", WS({ ...base, ...o }) as WorkstationSpec);

  it("adds GPUs by class, the volume, and the interruptible discount", () => {
    expect(price({ gpu: { count: 0 } })).toBe(320);
    expect(price({ gpu: { count: 1 } })).toBe(2320); // class unset/any = consumer rate
    expect(price({ gpu: { count: 1, class: "consumer" } })).toBe(2320);
    expect(price({ gpu: { count: 2, class: "datacenter" } })).toBe(12_320);
    expect(price({ gpu: { count: 1 }, volume: { sizeGb: 10, keepDays: 7 } })).toBe(2340);
    expect(price({ gpu: { count: 1 }, volume: { sizeGb: 10, keepDays: 7 }, tier: "interruptible" })).toBe(1170);
    expect(price({ gpu: { count: 2, class: "datacenter" }, tier: "interruptible" })).toBe(6160);
    expect(priceUcldPerHour("workstation", WS({ cpu: 100, memMb: 64, storageMb: 64, gpu: { count: 0 }, tier: "interruptible" }) as WorkstationSpec)).toBe(50);
  });

  it("holds the first hour at that price", async () => {
    const u = await user(10_000);
    const res = await create(u.jwt, WS({ tier: "interruptible" }));
    expect((await res.json()).priceUcldPerHour).toBe(1160);
    expect(await getBalanceUcld(u.addr)).toEqual({ balanceUcld: 8840, heldUcld: 1160 });
  });
});

describe("GPU classes", () => {
  it("classifies nvidia-smi names into datacenter and consumer", () => {
    for (const n of ["NVIDIA A100-SXM4-80GB", "NVIDIA H100 80GB HBM3", "Tesla T4", "NVIDIA L40S", "NVIDIA L4", "NVIDIA A10G", "Tesla V100-SXM2-16GB", "NVIDIA RTX 6000 Ada Generation", "NVIDIA RTX A6000"]) {
      expect(gpuClass(n), n).toBe("datacenter");
    }
    for (const n of ["NVIDIA GeForce RTX 4090", "NVIDIA GeForce RTX 3060", "NVIDIA GeForce GTX 1080 Ti", "NVIDIA GeForce RTX 5090", "AMD Radeon RX 7900 XTX"]) {
      expect(gpuClass(n), n).toBe("consumer");
    }
  });

  it("fits by free matching GPUs", () => {
    expect(gpusFit([A100, A100], 1, { count: 1 })).toBe(true);
    expect(gpusFit([A100, A100], 1, { count: 2 })).toBe(false);
    expect(gpusFit([RTX4090], 0, { count: 1, minVramGb: 48 })).toBe(false);
    expect(gpusFit([RTX4090], 0, { count: 1, class: "datacenter" })).toBe(false);
    expect(gpusFit([RTX4090], 0, { count: 1, class: "consumer", minVramGb: 24 })).toBe(true);
    expect(gpusFit([], 0, { count: 0 })).toBe(true);
  });
});

describe("assignment", () => {
  it("skips nodes without gpu, without a matching class/vRAM, and without free GPUs", async () => {
    const u = await user();
    const spec = WS({ gpu: { count: 1, minVramGb: 40, class: "datacenter" } });
    const id = await createId(u.jwt, spec);
    expect((await heartbeat(await boundNode(["matmul", "container"], [A100]))).map((d) => d.id)).not.toContain(id); // no "gpu"
    expect((await heartbeat(await boundNode(GPU_CAPS, [RTX4090]))).map((d) => d.id)).not.toContain(id); // consumer, 24 GB
    expect((await row(id))!.status).toBe("queued");
    const dc = await boundNode(GPU_CAPS, [A100]);
    const hb = await heartbeat(dc);
    expect(hb).toEqual([expect.objectContaining({ id, action: "start", kind: "workstation", spec: expect.objectContaining({ gpu: spec.gpu }) })]);
    // its only GPU is taken: the next one waits
    const next = await createId(u.jwt, spec);
    expect((await heartbeat(dc)).map((d) => d.id)).toEqual([id]);
    expect((await row(next))!.status).toBe("queued");
  });

  it("places a 2-GPU workstation only where 2 are free, and CPU workstations on container nodes", async () => {
    const u = await user();
    const one = await boundNode(GPU_CAPS, [A100]);
    const two = await boundNode(GPU_CAPS, [A100, A100]);
    const big = await createId(u.jwt, WS({ gpu: { count: 2 } }));
    expect((await heartbeat(one)).map((d) => d.id)).not.toContain(big);
    expect((await heartbeat(two)).map((d) => d.id)).toContain(big);
    const cpu = await createId(u.jwt, WS({ gpu: { count: 0 } }));
    expect((await heartbeat(await boundNode(["matmul", "container"]))).map((d) => d.id)).toContain(cpu);
  });

  it("keeps the 5-container cap shared with containers", async () => {
    const u = await user(1_000_000);
    const node = await boundNode(GPU_CAPS, [A100, A100, A100, A100, A100, A100, A100, A100]);
    for (let i = 0; i < 5; i++) await createId(u.jwt, WS({ gpu: { count: 1 } }));
    const sixth = await createId(u.jwt, WS({ gpu: { count: 1 } }));
    const hb = await heartbeat(node);
    expect(hb).toHaveLength(5);
    expect(hb.map((d) => d.id)).not.toContain(sixth);
  });
});

describe("preemption", () => {
  it("stops the youngest interruptible workstation for queued on-demand work and bills it pro rata", async () => {
    const u = await user(100_000);
    const node = await boundNode(GPU_CAPS, [A100, A100]);
    const older = await running(node, u.jwt, WS({ tier: "interruptible" }), { endpoint: "http://127.0.0.1:42011" });
    const younger = await running(node, u.jwt, WS({ tier: "interruptible" }), { endpoint: "http://127.0.0.1:42012" });
    await shift(older, "started_at", 2 * 3_600_000);
    await shift(younger, "started_at", 1_800_000);
    await shift(younger, "last_billed_at", 1_800_000); // half an hour into its current hour
    expect(await getBalanceUcld(u.addr)).toEqual({ balanceUcld: 97_680, heldUcld: 2320 });

    const onDemand = await createId(u.jwt, WS());
    const hb = await heartbeat(node);
    expect(hb.map((d) => [d.id, d.action])).toEqual([[younger, "stop"], [onDemand, "start"]]);
    expect(await row(younger)).toMatchObject({ status: "stopped", status_reason: "preempted by on-demand work" });
    expect(await row(older)).toMatchObject({ status: "running" });
    const got = await detail(u.jwt, younger);
    expect(got.events[0].message).toBe("stopped: preempted by on-demand work");
    // younger: 580 of its 1160 hold charged (30 min), 580 released; on-demand holds 2320
    expect(await getBalanceUcld(u.addr)).toEqual({ balanceUcld: 100_000 - 1160 - 580 - 2320, heldUcld: 1160 + 2320 });
  });

  it("never preempts on-demand, and interruptible work does not preempt", async () => {
    const u = await user();
    const node = await boundNode(GPU_CAPS, [A100]);
    const first = await running(node, u.jwt, WS());
    const waiting = await createId(u.jwt, WS());
    await heartbeat(node);
    expect((await row(first))!.status).toBe("running");
    expect((await row(waiting))!.status).toBe("queued");

    await getD1().prepare("UPDATE deployments SET status = 'stopped', stop_acked_at = 1 WHERE id = ?").bind(waiting).run();
    const other = await boundNode(GPU_CAPS, [A100]);
    const spot = await running(other, u.jwt, WS({ tier: "interruptible" }));
    const spot2 = await createId(u.jwt, WS({ tier: "interruptible" }));
    await heartbeat(other);
    expect((await row(spot))!.status).toBe("running");
    expect((await row(spot2))!.status).toBe("queued");
  });

  it("does not preempt when another online node can take the work", async () => {
    const u = await user();
    const busy = await boundNode(GPU_CAPS, [A100]);
    const spot = await running(busy, u.jwt, WS({ tier: "interruptible" }));
    await boundNode(GPU_CAPS, [A100]); // free, online (announce counts as seen)
    await createId(u.jwt, WS());
    await heartbeat(busy);
    expect((await row(spot))!.status).toBe("running");
  });
});

describe("max hours", () => {
  it("auto-stops a workstation once startedAt + maxHours has passed", async () => {
    const u = await user(10_000);
    const node = await boundNode(GPU_CAPS, [A100]);
    const id = await running(node, u.jwt, WS({ maxHours: 1 }));
    await shift(id, "started_at", 3_600_000 + 1000);
    await shift(id, "last_billed_at", 3_600_000 + 1000);
    const hb = await heartbeat(node);
    expect(await row(id)).toMatchObject({ status: "stopped", status_reason: "max hours reached" });
    expect(hb).toEqual([{ id, action: "stop", kind: "workstation", spec: null }]);
    expect(await getBalanceUcld(u.addr)).toEqual({ balanceUcld: 10_000 - 2320, heldUcld: 0 });
  });

  it("PATCH extends maxHours while assigned/running (owner only, upward only)", async () => {
    const u = await user();
    const node = await boundNode(GPU_CAPS, [A100]);
    const id = await running(node, u.jwt, WS({ maxHours: 2 }));
    expect((await authed(u.jwt, "PATCH", `/v1/deployments/${id}`, { maxHours: 5 })).status).toBe(200);
    const got = await detail(u.jwt, id);
    expect(got.deployment).toMatchObject({ maxHours: 5, tier: "on-demand" });
    expect(got.events[0].message).toBe("extended to 5 h");
    expect((await authed(u.jwt, "PATCH", `/v1/deployments/${id}`, { maxHours: 3 })).status).toBe(400);
    expect((await authed(u.jwt, "PATCH", `/v1/deployments/${id}`, { maxHours: 721 })).status).toBe(400);
    const stranger = await user(0);
    expect((await authed(stranger.jwt, "PATCH", `/v1/deployments/${id}`, { maxHours: 6 })).status).toBe(404);

    await shift(id, "started_at", 2.5 * 3_600_000);
    await heartbeat(node);
    expect((await row(id))!.status).toBe("running"); // 2.5 h < 5 h

    const container = (await (await authed(u.jwt, "POST", "/v1/deployments", {
      name: "c", kind: "container", spec: { image: "nginx:alpine", ports: [{ container: 80 }], cpu: 500, memMb: 512, storageMb: 1024 },
    })).json()).id;
    expect((await authed(u.jwt, "PATCH", `/v1/deployments/${container}`, { maxHours: 6 })).status).toBe(400);
    expect((await authed(u.jwt, "DELETE", `/v1/deployments/${id}`)).status).toBe(200);
    expect((await authed(u.jwt, "PATCH", `/v1/deployments/${id}`, { maxHours: 6 })).status).toBe(409);
  });
});

describe("connect and hours", () => {
  it("GET shows connect, hours used/left and the GPU names; probes only the endpoint's origin", async () => {
    const u = await user();
    const node = await boundNode(GPU_CAPS, [A100]);
    const spec = WS({ access: { web: { port: 8888, path: "/lab" }, ssh: { publicKey: KEY, user: "jovyan" } } });
    const id = await createId(u.jwt, spec);
    const queued = await detail(u.jwt, id);
    expect(queued.deployment).toMatchObject({ kind: "workstation", hoursUsed: 0, hoursLeft: 4, connect: {}, gpu: null });

    await heartbeat(node);
    const endpoint = "http://127.0.0.1:42010/lab?token=abc123";
    expect((await report(node, id, { status: "running", endpoint, sshEndpoint: "127.0.0.1:42022" })).status).toBe(200);
    await shift(id, "started_at", 1.5 * 3_600_000);
    const got = await detail(u.jwt, id);
    expect(got.deployment).toMatchObject({
      status: "running",
      endpoint,
      hoursUsed: 1.5,
      hoursLeft: 2.5,
      connect: { web: endpoint, ssh: "ssh -p 42022 jovyan@127.0.0.1" },
      gpu: { count: 1, names: [A100.name] },
    });

    const fetchMock = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    await heartbeat(node);
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:42010/", expect.objectContaining({ method: "GET" }));
    expect(probeTarget("http://127.0.0.1:1")).toBe("http://127.0.0.1:1");

    expect((await authed(u.jwt, "DELETE", `/v1/deployments/${id}`)).status).toBe(200);
    expect((await detail(u.jwt, id)).deployment).toMatchObject({ connect: {}, hoursLeft: 0 });
  });

  it("webToken is shown on GET /deployments/{id} only; SSH-only workstations run without a web endpoint", async () => {
    const u = await user();
    const node = await boundNode(GPU_CAPS, [A100]);
    const web = await running(node, u.jwt, WS({ gpu: { count: 0 } }), { endpoint: "http://127.0.0.1:42030", webToken: "s3cret-pass" });
    expect((await detail(u.jwt, web)).deployment.connect).toEqual({ web: "http://127.0.0.1:42030", webToken: "s3cret-pass" });
    const list = await (await authed(u.jwt, "GET", "/v1/deployments")).json();
    expect(JSON.stringify(list)).not.toContain("s3cret-pass");

    const ssh = await createId(u.jwt, WS({ gpu: { count: 0 }, ports: [{ container: 22 }], access: { ssh: { publicKey: KEY } } }));
    await heartbeat(node);
    expect((await report(node, ssh, { status: "running" })).status).toBe(400);
    expect((await report(node, ssh, { status: "running", sshEndpoint: "bad endpoint" })).status).toBe(400);
    expect((await report(node, ssh, { status: "running", sshEndpoint: "127.0.0.1:42023" })).status).toBe(200);
    expect((await detail(u.jwt, ssh)).deployment.connect).toEqual({ ssh: "ssh -p 42023 root@127.0.0.1" });
  });

  it("sshEndpoint and webToken are refused for plain containers", async () => {
    const u = await user();
    const node = await boundNode(["matmul", "container"]);
    const id = (await (await authed(u.jwt, "POST", "/v1/deployments", {
      name: "c", kind: "container", spec: { image: "nginx:alpine", ports: [{ container: 80 }], cpu: 500, memMb: 512, storageMb: 1024 },
    })).json()).id;
    expect((await heartbeat(node))[0]).toMatchObject({ id, kind: "container" });
    expect((await report(node, id, { status: "running", endpoint: "http://127.0.0.1:42040", sshEndpoint: "127.0.0.1:22" })).status).toBe(400);
    expect((await report(node, id, { status: "running", endpoint: "http://127.0.0.1:42040", webToken: "x" })).status).toBe(400);
  });
});

describe("volume purge and GPU refusals", () => {
  it("DELETE ?purge=1 sends 'purge' until the node confirms, also after a plain stop", async () => {
    const u = await user();
    const node = await boundNode(GPU_CAPS, [A100]);
    const id = await running(node, u.jwt, WS({ volume: { sizeGb: 20, keepDays: 7 } }));
    expect((await authed(u.jwt, "DELETE", `/v1/deployments/${id}`)).status).toBe(200);
    expect(await heartbeat(node)).toEqual([{ id, action: "stop", kind: "workstation", spec: null }]);
    await report(node, id, { status: "stopped" });
    expect(await heartbeat(node)).toEqual([]);
    expect((await authed(u.jwt, "DELETE", `/v1/deployments/${id}?purge=1`)).status).toBe(200);
    expect(await heartbeat(node)).toEqual([{ id, action: "purge", kind: "workstation", spec: null }]);
    await report(node, id, { status: "stopped" });
    expect(await heartbeat(node)).toEqual([]);
    expect(await row(id)).toMatchObject({ purge_pending: 0, stop_acked_at: expect.any(Number) });
  });

  it("'not enough free GPUs' re-queues on another node instead of failing", async () => {
    const u = await user();
    const first = await boundNode(GPU_CAPS, [A100]);
    const id = await createId(u.jwt, WS());
    await heartbeat(first);
    const res = await report(first, id, { status: "failed", message: "docker: not enough free GPUs (0 of 1)" });
    expect(await res.json()).toEqual({ status: "success", deploymentStatus: "queued" });
    expect(await row(id)).toMatchObject({ status: "queued", node: null, held_ucld: 2320 });
    expect(await heartbeat(first)).toEqual([]); // not straight back to the node that refused it
    const second = await boundNode(GPU_CAPS, [A100]);
    expect((await heartbeat(second)).map((d) => d.id)).toEqual([id]);
  });
});

describe("network and templates", () => {
  it("GET /network counts GPUs on online gpu nodes and running workstations", async () => {
    const before = await (await call("/v1/network")).json();
    const u = await user();
    const node = await boundNode(GPU_CAPS, [A100, RTX4090]);
    await boundNode(["matmul", "container"], [A100]); // GPUs but no gpu capability: not counted
    await running(node, u.jwt, WS());
    const after = await (await call("/v1/network")).json();
    expect(after.gpusOnline - before.gpusOnline).toBe(2);
    expect(after.workstationsRunning - before.workstationsRunning).toBe(1);
  });

  it("serves the 8 workstation templates right after Static sites; create fills run fields from the template", async () => {
    const body = await (await call("/v1/templates")).json();
    expect(body.data.map((c: { title: string }) => c.title).slice(0, 2)).toEqual(["Static sites", "Workstations"]);
    const ws = body.data[1].templates as Record<string, any>[];
    expect(ws.map((t) => t.id)).toEqual([
      "ws-jupyter-cuda", "ws-code-server", "ws-linux-desktop", "ws-pytorch-ssh", "ws-comfyui", "ws-sd-webui", "ws-ollama-webui", "ws-blender",
    ]);
    for (const t of ws) {
      expect(t, t.id).toMatchObject({ kind: "workstation", curated: true, image: expect.any(String), gpu: expect.any(Object), workdir: expect.any(String) });
      expect(t.access.web || t.access.ssh, t.id).toBeTruthy();
      if (t.access.web) expect(t.ports, t.id).toContain(t.access.web.port);
    }
    expect(ws.find((t) => t.id === "ws-pytorch-ssh")).toMatchObject({ access: { ssh: true }, sshPort: 22 });

    const u = await user();
    const node = await boundNode(GPU_CAPS, [A100]);
    const id = await createId(u.jwt, WS(), { templateId: "ws-jupyter-cuda" });
    const [start] = await heartbeat(node);
    expect(start).toMatchObject({ id, kind: "workstation" });
    expect(start.spec).toMatchObject({ workdir: "/home/jovyan/work", tokenEnv: "JUPYTER_TOKEN", tokenQuery: "token" });
    expect(start.spec).not.toHaveProperty("sshPort");
  });
});
