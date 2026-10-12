// The relay Worker + RelayNode Durable Object in workerd (wrangler dev), with the REAL agent RelayClient connected
// by a real HMAC ticket and a real app on 127.0.0.1 — the Durable Object glue the unit tests can't reach: ticket
// check, single use, acceptWebSocket/hibernation API, kick, status, proxy through a namespace stub (as the gateway
// and the API do, via a script_name binding resolved by wrangler's dev registry).
//
// Needs the relay running locally (in relay/: `npx wrangler dev --port 8799 --ip 127.0.0.1`, secret from
// relay/.dev.vars), then, in relay/:  ../node-agent/node_modules/.bin/tsx test/workerd.e2e.ts
import http from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { getPlatformProxy } from "wrangler";
import { issueTicket } from "../../shared/relay-ticket.ts";
import { RelayClient } from "../../node-agent/src/relay.ts";

const SECRET = /RELAY_TICKET_SECRET=(.+)/.exec(readFileSync(new URL("../.dev.vars", import.meta.url), "utf8"))![1].trim();
const RELAY = "http://127.0.0.1:8799";
const NODE = "0x" + "12".repeat(20);
let passed = 0;
function check(cond: unknown, msg: string) {
  if (!cond) {
    console.error(`✗ workerd e2e failed: ${msg}`);
    process.exit(1);
  }
  passed++;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const filePath = (rel: string) => new URL(rel, import.meta.url).pathname.replace(/^\/(\w:)/, "$1");

/** A raw WebSocket upgrade (Node's fetch refuses the Upgrade header): resolves the HTTP status (101 on success). */
function upgradeStatus(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(`${RELAY}${path}`, {
      headers: { connection: "Upgrade", upgrade: "websocket", "sec-websocket-version": "13", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==" },
    });
    req.on("response", (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("upgrade", (res, socket) => {
      socket.destroy();
      resolve(res.statusCode ?? 101);
    });
    req.on("error", reject);
    req.end();
  });
}

const app = http.createServer((req, res) => {
  if (req.url === "/hello") return void res.writeHead(200, { "content-type": "text/plain" }).end(`hello ${req.headers["x-forwarded-host"] ?? ""}`);
  if (req.url === "/echo") {
    const parts: Buffer[] = [];
    req.on("data", (c: Buffer) => parts.push(c));
    req.on("end", () => res.writeHead(200, { "x-sha": sha(Buffer.concat(parts)) }).end(Buffer.alloc(1024 * 1024, 3)));
    return;
  }
  res.writeHead(404).end();
});
await new Promise<void>((r) => app.listen(0, "127.0.0.1", r));
const appPort = (app.address() as AddressInfo).port;

const platform = await getPlatformProxy<{ RELAY: DurableObjectNamespace }>({ configPath: filePath("./proxy.wrangler.toml"), persist: false });
const ns = platform.env.RELAY;
const stub = ns.get(ns.idFromName(NODE));
const relayCall = (path: string, init: { method?: string; headers?: Record<string, string>; body?: Uint8Array } = {}) =>
  stub.fetch(`https://relay${path}`, { method: init.method ?? "GET", headers: { "x-relay-node": NODE, ...init.headers }, body: init.body });

// Public route.
check((await fetch(`${RELAY}/health`)).status === 200, "health");
check((await upgradeStatus("/connect?ticket=nope")) === 401, "bad ticket → 401");
check((await fetch(`${RELAY}/connect`)).status === 426, "plain GET → 426");

// Nothing connected yet.
{
  const off = await relayCall("/proxy", { headers: { "x-relay-dep": "dep-1", "x-relay-path": "/hello" } });
  check(off.status === 503 && off.headers.get("x-relay-error") === "offline", `offline before connect (${off.status})`);
}

const tickets: string[] = [];
const client = new RelayClient({
  request: async () => {
    const t = await issueTicket(SECRET, NODE);
    tickets.push(t.ticket);
    return { status: "success", ticket: t.ticket, url: `ws://127.0.0.1:8799/connect`, expiresAt: t.expiresAt };
  },
  announce: async () => {},
  target: (dep) => (dep === "dep-1" ? { port: appPort, kind: "container" } : null),
  log: () => {},
});
await client.start();
let status: { connected: boolean; since: number | null } = { connected: false, since: null };
for (let i = 0; i < 100 && !status.connected; i++) {
  await sleep(50);
  status = (await (await relayCall("/status")).json()) as typeof status;
}
check(status.connected && status.since, "the node's object holds its socket");

// Proxy through the Durable Object stub (exactly how the gateway and the API call it).
{
  const res = await relayCall("/proxy", {
    headers: { "x-relay-dep": "dep-1", "x-relay-class": "endpoint", "x-relay-path": "/hello", "x-forwarded-host": "d.cloudana.run" },
  });
  check(res.status === 200, `GET through the object (${res.status})`);
  check((await res.text()) === "hello d.cloudana.run", "body + forwarded host");
}
{
  const up = Buffer.alloc(1536 * 1024);
  for (let i = 0; i < up.length; i++) up[i] = (i * 7) % 253;
  const res = await relayCall("/proxy", {
    method: "POST",
    headers: { "x-relay-dep": "dep-1", "x-relay-class": "endpoint", "x-relay-path": "/echo", "content-type": "application/octet-stream" },
    body: new Uint8Array(up),
  });
  check(res.status === 200 && res.headers.get("x-sha") === sha(up), `1.5 MiB upload intact through workerd (${res.status})`);
  const down = Buffer.from(await res.arrayBuffer());
  check(down.length === 1024 * 1024 && down.every((b) => b === 3), "1 MiB download intact through workerd");
}
{
  const res = await relayCall("/proxy", { headers: { "x-relay-dep": "other", "x-relay-path": "/hello" } });
  check(res.headers.get("x-relay-error") === "not_serving", "not_serving for a deployment the node doesn't run");
  await res.arrayBuffer();
}

// A ticket is single use: replaying the agent's last one is refused.
{
  const replay = await upgradeStatus(`/connect?ticket=${encodeURIComponent(tickets.at(-1)!)}`);
  check(replay === 401, `replayed ticket refused (${replay})`);
}

// Kick (unbind / ban): the socket closes; the agent reconnects with a fresh ticket and works again.
{
  const before = tickets.length;
  await (await relayCall("/kick", { method: "POST" })).arrayBuffer();
  for (let i = 0; i < 200 && tickets.length === before; i++) await sleep(25);
  check(tickets.length > before, "the agent fetched a fresh ticket after the kick");
  let ok = false;
  for (let i = 0; i < 100 && !ok; i++) {
    await sleep(50);
    const r = await relayCall("/proxy", { headers: { "x-relay-dep": "dep-1", "x-relay-path": "/hello" } });
    ok = r.status === 200;
    await r.arrayBuffer();
  }
  check(ok, "requests work again after the reconnect");
}

client.stop();
await platform.dispose();
app.close();
console.log(`✓ workerd e2e passed — ${passed} checks (relay Worker + RelayNode in workerd ↔ real agent ↔ real app)`);
process.exit(0);
