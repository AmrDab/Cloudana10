// Byte streams through the RelayNode Durable Object in workerd (wrangler dev), with the REAL agent RelayClient and
// a real TCP echo server and WebSocket app on 127.0.0.1: the `/stream` glue the Node tests can't reach (WebSocketPair,
// a 101 returned through a namespace stub, the raw and ws bridges running in the runtime).
//
// Needs the relay running locally (in relay/: `npx wrangler dev --port 8799 --ip 127.0.0.1`, secret from
// relay/.dev.vars), then, in relay/:  ../node-agent/node_modules/.bin/tsx test/workerd.streams.e2e.ts
import net from "node:net";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { getPlatformProxy } from "wrangler";
import { WebSocketServer } from "ws";
import { issueTicket } from "../../shared/relay-ticket.ts";
import { RelayClient } from "../../node-agent/src/relay.ts";

const SECRET = /RELAY_TICKET_SECRET=(.+)/.exec(readFileSync(new URL("../.dev.vars", import.meta.url), "utf8"))![1].trim();
const NODE = "0x" + "34".repeat(20);
let passed = 0;
function check(cond: unknown, msg: string) {
  if (!cond) {
    console.error(`✗ workerd streams e2e failed: ${msg}`);
    process.exit(1);
  }
  passed++;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const filePath = (rel: string) => new URL(rel, import.meta.url).pathname.replace(/^\/(\w:)/, "$1");

const echo = net.createServer({ allowHalfOpen: true }, (s) => s.pipe(s));
await new Promise<void>((r) => echo.listen(0, "127.0.0.1", r));
const echoPort = (echo.address() as AddressInfo).port;
const wsApp = new WebSocketServer({ host: "127.0.0.1", port: 0 });
await new Promise<void>((r) => wsApp.once("listening", () => r()));
const wsPort = (wsApp.address() as AddressInfo).port;
wsApp.on("connection", (ws) => ws.on("message", (d, bin) => ws.send(d, { binary: bin })));

const platform = await getPlatformProxy<{ RELAY: DurableObjectNamespace }>({ configPath: filePath("./proxy.wrangler.toml"), persist: false });
const stub = platform.env.RELAY.get(platform.env.RELAY.idFromName(NODE));

const client = new RelayClient({
  request: async () => {
    const t = await issueTicket(SECRET, NODE);
    return { status: "success", ticket: t.ticket, url: `ws://127.0.0.1:8799/connect`, expiresAt: t.expiresAt };
  },
  announce: async () => {},
  target: () => null,
  streamTarget: (dep, port) => (dep !== "ws-1" ? null : port === "ssh" ? echoPort : wsPort),
  log: () => {},
});
await client.start();
for (let i = 0; i < 100; i++) {
  const s = (await (await stub.fetch("https://relay/status", { headers: { "x-relay-node": NODE } })).json()) as { connected: boolean };
  if (s.connected) break;
  await sleep(50);
}

const open = (headers: Record<string, string>) =>
  stub.fetch("https://relay/stream", { headers: { upgrade: "websocket", "x-relay-node": NODE, "x-relay-dep": "ws-1", ...headers } });

// Raw (SSH): 101 + a socket that echoes 1 MiB through the window, acked end to end.
{
  const res = await open({ "x-relay-port": "ssh", "x-relay-mode": "raw", "sec-websocket-protocol": "cloudana-tcp.v1" });
  check(res.status === 101 && res.webSocket, `raw stream: 101 with a socket (${res.status})`);
  check(res.headers.get("sec-websocket-protocol") === "cloudana-tcp.v1", "subprotocol echoed");
  const ws = res.webSocket!;
  ws.accept();
  const got: Uint8Array[] = [];
  let bytes = 0;
  let closed = 0;
  ws.addEventListener("message", (e) => {
    if (typeof e.data === "string") return;
    const b = new Uint8Array(e.data as ArrayBuffer);
    got.push(b);
    bytes += b.byteLength;
    ws.send(JSON.stringify({ t: "ack", n: b.byteLength }));
  });
  ws.addEventListener("close", (e) => (closed = e.code));
  const sent = new Uint8Array(1024 * 1024).map((_, i) => (i * 13) % 251);
  for (let i = 0; i < sent.length; i += 64 * 1024) ws.send(sent.subarray(i, i + 64 * 1024));
  for (let i = 0; i < 400 && bytes < sent.length; i++) await sleep(10);
  const all = new Uint8Array(bytes);
  let at = 0;
  for (const g of got) (all.set(g, at), (at += g.byteLength));
  check(bytes === sent.length && sha(all) === sha(sent), `1 MiB echoed through workerd (${bytes})`);
  ws.close(1000, "done");
  for (let i = 0; i < 200 && !closed; i++) await sleep(10);
  check(closed === 1000, `clean close from the hub (${closed})`);
}

// Port pinning in the runtime: an unknown deployment is a relay error, not a socket.
{
  const res = await stub.fetch("https://relay/stream", {
    headers: { upgrade: "websocket", "x-relay-node": NODE, "x-relay-dep": "nope", "x-relay-port": "ssh", "x-relay-mode": "raw" },
  });
  check(res.status === 502 && res.headers.get("x-relay-error") === "not_serving", `not_serving (${res.status})`);
}

// WebSocket passthrough: the hub's bridge speaks to a real WebSocket app.
{
  const res = await open({ "x-relay-port": "web", "x-relay-mode": "ws", "x-relay-path": "/socket", "x-forwarded-host": "ws-1.cloudana.run" });
  check(res.status === 101 && res.webSocket, `ws passthrough: 101 (${res.status})`);
  const ws = res.webSocket!;
  ws.accept();
  const got: (string | ArrayBuffer)[] = [];
  ws.addEventListener("message", (e) => got.push(e.data as string | ArrayBuffer));
  ws.send("hello app");
  for (let i = 0; i < 200 && got.length < 1; i++) await sleep(10);
  check(got[0] === "hello app", `text echoed by the app through workerd (${JSON.stringify(got[0])})`);
  ws.close(1000, "bye");
}

client.stop();
echo.close();
wsApp.close();
await platform.dispose();
console.log(`✓ workerd streams e2e passed — ${passed} checks (Durable Object /stream glue in workerd)`);
process.exit(0);
