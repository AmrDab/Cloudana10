// Relay end to end: the REAL hub logic (relay/src/hub.ts, as the RelayNode Durable Object runs it) behind a local
// WebSocket server, the REAL agent RelayClient connected to it with a ticket, and a real HTTP app on 127.0.0.1.
// Proves both halves speak the same protocol: streaming both ways, the 512 KiB window, SSE, cancel, not_serving,
// forwarded host. Needs neither Docker, Cloudflare nor a network.
import http from "node:http";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";
import { PING, PONG } from "../../shared/relay-protocol.ts";
import { StreamHub } from "../../relay/src/hub.ts";
import { RelayClient } from "./relay.ts";

let passed = 0;
function check(cond: unknown, msg: string) {
  if (!cond) {
    console.error(`✗ relay e2e selftest failed: ${msg}`);
    process.exit(1);
  }
  passed++;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

// ── The app the node serves (a "container" on 127.0.0.1) ────────────────────────────────────────────────────
let lastHost = "";
let lastForwardedHost = "";
let streamAborted = false;
const app = http.createServer((req, res) => {
  lastHost = req.headers.host ?? "";
  lastForwardedHost = String(req.headers["x-forwarded-host"] ?? "");
  if (req.url === "/hello") {
    res.writeHead(200, { "content-type": "text/plain" }).end("hello from the node");
    return;
  }
  if (req.url === "/echo" && req.method === "POST") {
    // Read the whole upload, then answer with its hash and a 3 MiB body (both directions cross the window).
    const parts: Buffer[] = [];
    req.on("data", (c: Buffer) => parts.push(c));
    req.on("end", () => {
      const body = Buffer.concat(parts);
      res.writeHead(200, { "content-type": "application/octet-stream", "x-upload-sha": sha(body), "x-upload-len": String(body.length) });
      res.end(Buffer.alloc(3 * 1024 * 1024, 7));
    });
    return;
  }
  if (req.url === "/sse") {
    res.writeHead(200, { "content-type": "text/event-stream" });
    let n = 0;
    const t = setInterval(() => {
      if (res.destroyed) return clearInterval(t);
      res.write(`data: ${++n}\n\n`);
      if (n === 50) {
        clearInterval(t);
        res.end();
      }
    }, 20);
    res.on("close", () => {
      if (!res.writableEnded) streamAborted = true;
      clearInterval(t);
    });
    return;
  }
  res.writeHead(404).end();
});
await new Promise<void>((r) => app.listen(0, "127.0.0.1", r));
const appPort = (app.address() as AddressInfo).port;

// ── The hub: a WebSocket server running StreamHub, like the RelayNode Durable Object ───────────────────────
let hub: StreamHub | null = null;
const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
await new Promise<void>((r) => wss.once("listening", () => r()));
const relayPort = (wss.address() as AddressInfo).port;
let ticketsSeen: string[] = [];
wss.on("connection", (ws, req) => {
  ticketsSeen.push(new URL(req.url ?? "/", "http://x").searchParams.get("ticket") ?? "");
  hub = new StreamHub((m) => ws.send(m));
  ws.on("message", (data: Buffer, isBinary: boolean) => {
    const text = isBinary ? null : data.toString("utf8");
    if (text === PING) return ws.send(PONG); // the Durable Object's auto-response
    hub!.onMessage(isBinary ? new Uint8Array(data) : text!);
  });
  ws.on("close", () => hub?.onClose());
});

// ── The agent's relay client, pointed at the hub by its ticket ────────────────────────────────────────────
const client = new RelayClient({
  request: async () => ({ status: "success", ticket: "t-123", url: `ws://127.0.0.1:${relayPort}/connect`, expiresAt: Date.now() + 60_000 }),
  announce: async () => {},
  target: (dep) => (dep === "dep-1" ? { port: appPort, kind: "container" } : null),
  log: () => {},
});
await client.start();
for (let i = 0; i < 100 && !hub; i++) await sleep(20);
check(hub, "the agent connected to the hub");
check(ticketsSeen[0] === "t-123", "the ticket rode in the connect URL");
check(client.mode() === "relay", "relay mode");

const proxy = (path: string, init: { method?: string; body?: Uint8Array; headers?: [string, string][]; signal?: AbortSignal; dep?: string } = {}) =>
  hub!.proxy({
    dep: init.dep ?? "dep-1",
    cls: "endpoint",
    method: init.method ?? "GET",
    path,
    headers: init.headers ?? [],
    body: init.body
      ? new ReadableStream<Uint8Array>({
          start(c) {
            // Several chunks, like a real upload.
            for (let i = 0; i < init.body!.byteLength; i += 100_000) c.enqueue(init.body!.subarray(i, i + 100_000));
            c.close();
          },
        })
      : null,
    signal: init.signal,
  });

// 1. A plain GET through hub → socket → agent → app, with the visitor's host forwarded.
{
  const res = await proxy("/hello", { headers: [["x-forwarded-host", "abc.cloudana.run"], ["host", "evil"]] });
  check(res.status === 200, `GET status ${res.status}`);
  check((await res.text()) === "hello from the node", "GET body");
  check(lastForwardedHost === "abc.cloudana.run", "x-forwarded-host reached the app");
  check(lastHost === `127.0.0.1:${appPort}`, `the app saw its local host, not the visitor's (${lastHost})`);
}

// 2. 2 MiB up, 3 MiB down: both directions cross the 512 KiB window and still arrive intact.
{
  const upload = Buffer.alloc(2 * 1024 * 1024);
  for (let i = 0; i < upload.length; i++) upload[i] = (i * 31) % 251;
  const res = await proxy("/echo", { method: "POST", body: new Uint8Array(upload), headers: [["content-type", "application/octet-stream"]] });
  check(res.status === 200, `POST status ${res.status}`);
  check(res.headers.get("x-upload-len") === String(upload.length), `upload length ${res.headers.get("x-upload-len")}`);
  check(res.headers.get("x-upload-sha") === sha(upload), "upload arrived byte-for-byte");
  const down = Buffer.from(await res.arrayBuffer());
  check(down.length === 3 * 1024 * 1024 && down.every((b) => b === 7), `download intact (${down.length} bytes)`);
}

// 3. Server-sent events stream incrementally (first event long before the stream ends).
{
  const t0 = Date.now();
  const res = await proxy("/sse");
  const reader = res.body!.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  check(first.startsWith("data: 1"), `first SSE event (${JSON.stringify(first)})`);
  check(Date.now() - t0 < 600, `first event arrived early (${Date.now() - t0} ms), not after the whole stream`);
  let all = first;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    all += new TextDecoder().decode(value);
  }
  check(all.includes("data: 50"), "the stream completed");
}

// 4. Cancel mid-stream: the client goes away, the app's request is aborted on the node.
{
  streamAborted = false;
  const res = await proxy("/sse");
  const reader = res.body!.getReader();
  await reader.read();
  await reader.cancel();
  for (let i = 0; i < 100 && !streamAborted; i++) await sleep(20);
  check(streamAborted, "cancel reached the app (upstream request aborted)");
  check(hub!.open === 0, "no stream left open in the hub");
}

// 5. A deployment this node doesn't serve: a not_serving relay error the gateway can retry elsewhere.
{
  const res = await proxy("/hello", { dep: "someone-else" });
  check(res.status === 502 && res.headers.get("x-relay-error") === "not_serving", `not_serving (${res.status} ${res.headers.get("x-relay-error")})`);
}

// 6. The socket drops: open streams fail as offline, and the agent comes back with a fresh connection.
{
  const before = ticketsSeen.length;
  const res = proxy("/sse");
  await sleep(50);
  for (const ws of wss.clients) ws.terminate();
  const r = await res;
  const failed = r.headers.get("x-relay-error") === "offline" || (await r.text().then(() => false, () => true));
  check(failed, "a stream on a dropped socket fails (offline or aborted body)");
  for (let i = 0; i < 200 && ticketsSeen.length === before; i++) await sleep(25);
  check(ticketsSeen.length === before + 1, "the agent reconnected with a fresh ticket");
  await sleep(100);
  const again = await proxy("/hello");
  check((await again.text()) === "hello from the node", "requests work again after the reconnect");
}

client.stop();
wss.close();
app.close();
console.log(`✓ relay e2e selftest passed — ${passed} checks (real hub ↔ real agent client ↔ real app)`);
process.exit(0);
