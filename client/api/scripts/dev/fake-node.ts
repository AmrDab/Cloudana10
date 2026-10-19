/**
 * A fake node for local end-to-end runs (no Docker, no GPU). It announces, binds (bind link or fleet token),
 * heartbeats, serves the static sites it is handed on loopback ports, "runs" containers as a stub page and — the
 * point of it — opens sealed secrets with its own key, bound to the deployment id, recording which keys arrived
 * (never the values). scripts/dev/browser-smoke.ts drives the console against it.
 *
 * It is not an agent: it verifies nothing the real agent verifies (instruction signatures, images, hardening).
 *
 *   API=http://127.0.0.1:8790 STATE_FILE=/tmp/node-a.json [FLEET_TOKEN=cld_ft_…] [CAPS=matmul,hosting,container] \
 *     npx tsx scripts/dev/fake-node.ts
 */
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { open, sealedEnvAad } from "../../../../shared/sealed.js";

const API = process.env.API ?? "http://127.0.0.1:8790";
const STATE_FILE = process.env.STATE_FILE ?? "/tmp/cloudana-fake-node.json";
const CAPS = (process.env.CAPS ?? "matmul,hosting,container").split(",").map((s) => s.trim()).filter(Boolean);
const pk = (process.env.FAKE_NODE_KEY as `0x${string}` | undefined) ?? generatePrivateKey();
const account = privateKeyToAccount(pk);

type Served = { kind: string; port: number; secretKeys?: string[]; boundCheck?: boolean };
const state = {
  address: account.address.toLowerCase(),
  bindCode: null as string | null,
  bound: false,
  payout: null as string | null,
  fleetId: null as string | null,
  serving: {} as Record<string, Served>,
  events: [] as string[],
};
const save = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
const log = (m: string) => {
  const line = `${new Date().toISOString()} ${m}`;
  console.log(line);
  state.events.push(line);
  save();
};

/** Node-signed request (middleware/node-auth.ts): "<METHOD> <path> <ts> <sha256(body)> <nonce>" under personal_sign. */
async function post(path: string, body: unknown): Promise<any> {
  const text = JSON.stringify(body);
  const ts = String(Date.now());
  const nonce = randomBytes(16).toString("hex");
  const message = `POST ${path} ${ts} ${createHash("sha256").update(text).digest("hex")} ${nonce}`;
  const signature = await account.signMessage({ message });
  const res = await fetch(API + path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-node": account.address, "x-node-timestamp": ts, "x-nonce": nonce, "x-node-signature": signature },
    body: text,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
  return json;
}

async function announce(): Promise<void> {
  const r = await post("/v1/nodes/announce", {
    manifest: { cpuThreads: 8, ramGB: 16, gpus: [], os: "linux" },
    benchmarkMmacPerSec: 100,
    workTypes: CAPS,
    pubkey: account.publicKey.slice(2),
    publicHost: "127.0.0.1",
    agentVersion: "1.6.0",
    ...(process.env.FLEET_TOKEN && { fleetToken: process.env.FLEET_TOKEN }),
  });
  state.bound = !!r.bound;
  state.payout = r.payout ?? null;
  state.bindCode = r.bindCode ?? null;
  state.fleetId = r.fleetId ?? null;
  log(`announced ${account.address} bound=${r.bound}${r.bindCode ? ` bindCode=${r.bindCode}` : ""}${r.fleetId ? ` fleet=${r.fleetId}` : ""}`);
}

const servers = new Map<string, http.Server>();
function listen(id: string, handler: http.RequestListener): Promise<number> {
  return new Promise((resolve) => {
    const s = http.createServer(handler);
    servers.set(id, s);
    s.listen(0, "127.0.0.1", () => resolve((s.address() as { port: number }).port));
  });
}

async function start(ins: any): Promise<void> {
  const id = ins.id as string;
  if (servers.has(id)) return;
  if (ins.kind === "static") {
    const files = new Map<string, Buffer>((ins.spec.files as { path: string; contentBase64: string }[]).map((f) => [f.path, Buffer.from(f.contentBase64, "base64")]));
    const port = await listen(id, (req, res) => {
      const p = decodeURIComponent((req.url ?? "/").split("?")[0]).replace(/^\/+/, "") || "index.html";
      const body = files.get(p) ?? files.get(`${p.replace(/\/$/, "")}/index.html`);
      if (!body) return void res.writeHead(404).end();
      const type = p.endsWith(".css") ? "text/css" : p.endsWith(".js") ? "text/javascript" : p.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream";
      res.writeHead(200, { "content-type": type, "content-length": body.length }).end(body);
    });
    state.serving[id] = { kind: "static", port };
    await post(`/v1/nodes/deployments/${id}/status`, { status: "running", endpoint: `http://127.0.0.1:${port}` });
    log(`static ${id}: serving ${files.size} file(s) on :${port}`);
    return;
  }
  const entry: Served = { kind: ins.kind, port: 0 };
  if (ins.sealedEnv) {
    // The real check: the payload opens with this node's key for this deployment id — and for nothing else.
    const plain = JSON.parse(open(pk, ins.sealedEnv, sealedEnvAad(id))) as Record<string, string>;
    entry.secretKeys = Object.keys(plain).sort();
    let refusedOther = false;
    let refusedUnbound = false;
    try {
      open(pk, ins.sealedEnv, sealedEnvAad("00000000-0000-4000-8000-000000000000"));
    } catch {
      refusedOther = true;
    }
    try {
      open(pk, ins.sealedEnv);
    } catch {
      refusedUnbound = true;
    }
    entry.boundCheck = refusedOther && refusedUnbound;
  }
  entry.port = await listen(id, (_req, res) => res.writeHead(200, { "content-type": "text/plain" }).end(`fake container ${id}\n`));
  state.serving[id] = entry;
  await post(`/v1/nodes/deployments/${id}/status`, { status: "running", endpoint: `http://127.0.0.1:${entry.port}` });
  log(`container ${id} (${ins.spec?.image}): "running" on :${entry.port}${entry.secretKeys ? ` · sealed env opened, keys ${entry.secretKeys.join(",")} · bound to this deployment: ${entry.boundCheck}` : ""}`);
}

async function stop(ins: any): Promise<void> {
  servers.get(ins.id)?.close();
  servers.delete(ins.id);
  delete state.serving[ins.id];
  if (ins.action === "stop") await post(`/v1/nodes/deployments/${ins.id}/status`, { status: "stopped" }).catch((e) => log(`stop report failed: ${(e as Error).message}`));
  log(`${ins.action} ${ins.id}`);
}

async function beat(): Promise<void> {
  const r = await post("/v1/nodes/heartbeat", { agentVersion: "1.6.0" });
  for (const ins of (r.deployments ?? []) as any[]) {
    try {
      if (ins.action === "start") await start(ins);
      else await stop(ins);
    } catch (e) {
      log(`${ins.action} ${ins.id} failed: ${(e as Error).message}`);
      await post(`/v1/nodes/deployments/${ins.id}/status`, { status: "failed", message: (e as Error).message.slice(0, 300) }).catch(() => undefined);
    }
  }
}

await announce();
let ticks = 0;
setInterval(() => {
  void (async () => {
    try {
      if (!state.bound && ++ticks % 15 === 0) await announce();
      await beat();
    } catch (e) {
      log(`heartbeat failed: ${(e as Error).message}`);
    }
  })();
}, 2000);
