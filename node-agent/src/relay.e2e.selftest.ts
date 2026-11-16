// Relay end to end: the REAL hub logic (relay/src/hub.ts, as the RelayNode Durable Object runs it) behind a local
// WebSocket server, the REAL agent RelayClient connected to it with a ticket, and a real HTTP app on 127.0.0.1.
// Proves both halves speak the same protocol: streaming both ways, the 512 KiB window, SSE, cancel, not_serving,
// forwarded host; and byte streams (relay-streams): the raw bridge (SSH) to a TCP echo server with the window end to
// end, back-pressure, port pinning, clean close both ways, and WebSocket passthrough to a real WebSocket app through
// the hub's bridge (relay/src/bridge.ts). Needs neither Docker, Cloudflare nor a network.
import http from "node:http";
import net from "node:net";
import { OpsServer } from "./ops.ts";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";
import { PING, PONG, WINDOW_BYTES } from "../../shared/relay-protocol.ts";
import { StreamHub } from "../../relay/src/hub.ts";
import { RawBridge, WsBridge, type Peer } from "../../relay/src/bridge.ts";
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
  if (req.url === "/delete" && req.method === "DELETE") {
    const parts: Buffer[] = [];
    req.on("data", (c: Buffer) => parts.push(c));
    req.on("end", () => res.writeHead(200, { "x-len": String(req.headers["content-length"] ?? ""), "x-te": String(req.headers["transfer-encoding"] ?? "") }).end(Buffer.concat(parts)));
    return;
  }
  if (req.url === "/hang") return; // never answers: holds a stream
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

// ── Byte-stream targets: an "sshd" that echoes, a server that floods 4 MiB, a WebSocket app ─────────────────
let echoClosed = 0;
const echo = net.createServer({ allowHalfOpen: true }, (sock) => {
  sock.pipe(sock);
  sock.on("close", () => echoClosed++);
});
await new Promise<void>((r) => echo.listen(0, "127.0.0.1", r));
const echoPort = (echo.address() as AddressInfo).port;
const FLOOD = 4 * 1024 * 1024;
const flood = net.createServer((sock) => {
  sock.on("error", () => {});
  sock.end(Buffer.alloc(FLOOD, 5));
});
await new Promise<void>((r) => flood.listen(0, "127.0.0.1", r));
const floodPort = (flood.address() as AddressInfo).port;
let wsAppHost = "";
let wsAppCookie = "";
const wsApp = new WebSocketServer({ host: "127.0.0.1", port: 0, handleProtocols: (ps) => (ps.has("chat.v1") ? "chat.v1" : false) });
await new Promise<void>((r) => wsApp.once("listening", () => r()));
const wsAppPort = (wsApp.address() as AddressInfo).port;
wsApp.on("connection", (ws, req) => {
  wsAppHost = req.headers.host ?? "";
  wsAppCookie = String(req.headers.cookie ?? "");
  ws.send("welcome");
  ws.on("message", (data, isBinary) => {
    if (!isBinary && data.toString() === "bye") return ws.close(4000, "asked to");
    ws.send(data, { binary: isBinary });
  });
});

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

// The agent's own surface (ops.ts), reached as the reserved dep "agent" (docs/V4_RELAY_CONTRACT.md).
let opsPort = 0;

// ── The agent's relay client, pointed at the hub by its ticket ────────────────────────────────────────────
const client = new RelayClient({
  request: async () => ({ status: "success", ticket: "t-123", url: `ws://127.0.0.1:${relayPort}/connect`, expiresAt: Date.now() + 60_000 }),
  announce: async () => {},
  target: (dep) => (dep === "dep-1" ? { port: appPort, kind: "container" } : dep === "agent" && opsPort ? { port: opsPort, kind: "container" } : null),
  // dep-1 declares sshd (the echo server) and a web port (the WebSocket app); dep-src a web port that floods; dep-2
  // runs here without SSH.
  streamTarget: (dep, port) =>
    dep === "dep-1" ? (port === "ssh" ? echoPort : wsAppPort) : dep === "dep-src" && port === "web" ? floodPort : dep === "dep-2" ? "refused" : null,
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

// 1b. Owner logs: hub → socket → agent's ops server (dep "agent"), never the app; unknown deployments are 404.
{
  const ops = new OpsServer({ logs: async (id, tail) => `${id}: last ${tail} lines\n`, serves: (id) => id === "dep-1" });
  await ops.start();
  opsPort = ops.target()!.port;
  const res = await proxy("/logs/dep-1?tail=7", { dep: "agent" });
  check(res.status === 200, `logs through the relay: status ${res.status}`);
  check((await res.text()) === "dep-1: last 7 lines\n", "logs body came from the ops server, with the tail");
  const miss = await proxy("/logs/dep-2", { dep: "agent" });
  check(miss.status === 404, `logs of a deployment this node does not run → 404 (${miss.status})`);
  ops.stop();
  opsPort = 0;
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

// 5b. Review fixes: a request the agent couldn't parse is refused at once (no slot held), a DELETE body arrives framed
// with its length, and one deployment can't take every slot.
{
  const t0 = Date.now();
  const long = await proxy("/" + "x".repeat(9000));
  check(long.status === 400 && Date.now() - t0 < 1000, `over-long path refused at once (${long.status}, ${Date.now() - t0} ms)`);
  const del = await proxy("/delete", { method: "DELETE", body: new TextEncoder().encode("bye"), headers: [["content-length", "3"]] });
  check(del.headers.get("x-len") === "3" && (await del.text()) === "bye", "DELETE body arrived framed by its Content-Length");
  const hogs = Array.from({ length: 16 }, () => proxy("/hang", { dep: "dep-1" }));
  await sleep(100);
  const extra = await proxy("/hang", { dep: "dep-1" });
  check(extra.headers.get("x-relay-error") === "busy", "the 17th stream of one deployment is refused");
  check(hub!.open === 16, `other deployments still have room (${hub!.open} open)`);
  void hogs;
  hub!.onClose(); // release the hung streams for the next case
  await Promise.allSettled(hogs);
}

// 7. SSH-like byte stream (raw bridge, as `cloudana ssh` uses it) to a TCP echo: 3 MiB round trip crosses the window
// both ways with acks end to end; the client never has more than WINDOW_BYTES unacked.
{
  const st = hub!.openStream("dep-1", "ssh");
  check((await st.opened) === null, "byte stream opened to the declared ssh port");
  const sent = Buffer.alloc(3 * 1024 * 1024);
  for (let i = 0; i < sent.length; i++) sent[i] = (i * 7) % 253;
  const got: Buffer[] = [];
  let gotBytes = 0;
  let clientUnacked = 0;
  let maxUnacked = 0;
  let closed: { code: number; reason: string } | null = null;
  let bridge!: RawBridge;
  const peer: Peer = {
    send: (d) => {
      if (typeof d === "string") return void (clientUnacked -= JSON.parse(d).n); // the node's ack, passed through
      got.push(Buffer.from(d));
      gotBytes += d.byteLength;
      bridge.message(JSON.stringify({ t: "ack", n: d.byteLength })); // written to "stdout": ack
    },
    close: (code, reason) => (closed = { code, reason }),
  };
  bridge = new RawBridge(st, peer);
  let off = 0;
  while (off < sent.length) {
    const n = Math.min(64 * 1024, sent.length - off);
    if (clientUnacked + n > WINDOW_BYTES) {
      await sleep(2);
      continue;
    }
    bridge.message(new Uint8Array(sent.subarray(off, off + n)));
    clientUnacked += n;
    maxUnacked = Math.max(maxUnacked, clientUnacked);
    off += n;
  }
  for (let i = 0; i < 500 && gotBytes < sent.length; i++) await sleep(10);
  check(gotBytes === sent.length && sha(Buffer.concat(got)) === sha(sent), `3 MiB echoed byte for byte (${gotBytes})`);
  check(maxUnacked <= WINDOW_BYTES, "the client stayed within the window");
  const before = echoClosed;
  bridge.closed(); // the client leaves: end → the echo server ends too → clean close
  for (let i = 0; i < 200 && (closed === null || echoClosed === before); i++) await sleep(10);
  check(closed !== null && (closed as { code: number }).code === 1000, `clean close reached the client (${JSON.stringify(closed)})`);
  check(echoClosed === before + 1 && hub!.open === 0, "the loopback connection closed and the slot is free");
}

// 8. Back-pressure: a server that floods 4 MiB; the hub's consumer acks nothing at first, so the agent must stop at
// the window; then everything arrives once acked.
{
  const st = hub!.openStream("dep-src", "web");
  check((await st.opened) === null, "flood stream opened");
  let got = 0;
  let ended = false;
  let ackNow = false;
  st.onData = (d) => {
    got += d.byteLength;
    if (ackNow) st.ack(d.byteLength);
  };
  st.onEnd = () => {
    ended = true;
    st.end();
  };
  await sleep(300);
  check(got <= WINDOW_BYTES && got > 0, `the node stopped at the window while nothing was acked (${got} bytes)`);
  ackNow = true;
  st.ack(got);
  for (let i = 0; i < 500 && !ended; i++) await sleep(10);
  check(ended && got === FLOOD, `all 4 MiB arrived once acked, then the app's end (${got})`);
  for (let i = 0; i < 100 && hub!.open > 0; i++) await sleep(10);
  check(hub!.open === 0, "the flood stream is gone after both ends");
}

// 9. Port pinning: a class the deployment did not declare is refused; a deployment not here is not_serving.
{
  check((await hub!.openStream("dep-2", "ssh").opened) === "refused", "no ssh port declared → refused");
  check((await hub!.openStream("nobody", "ssh").opened) === "not_serving", "unknown deployment → not_serving");
  check((await hub!.openStream("agent", "web").opened) === "not_serving", "the reserved dep 'agent' is never a stream target");
}

// 10. Cancel from the hub (the client vanished): the loopback connection is destroyed on the node.
{
  const st = hub!.openStream("dep-1", "ssh");
  await st.opened;
  const before = echoClosed;
  st.close();
  for (let i = 0; i < 100 && echoClosed === before; i++) await sleep(10);
  check(echoClosed === before + 1, "cancel closed the loopback connection");
}

// 11. WebSocket passthrough: the hub's bridge does the upgrade over the byte stream to a real WebSocket app.
{
  const st = hub!.openStream("dep-1", "web");
  check((await st.opened) === null, "web byte stream opened");
  const bridge = new WsBridge(st);
  const head = await bridge.handshake({
    path: "/socket?x=1",
    host: "abc.cloudana.run",
    headers: [["cookie", "s=1"], ["sec-websocket-protocol", "chat.v1, other"], ["sec-websocket-key", "visitor-key"]],
  });
  check(head.status === 101 && "protocol" in head && head.protocol === "chat.v1", `the app accepted the upgrade (${JSON.stringify(head)})`);
  check(wsAppHost === "abc.cloudana.run" && wsAppCookie === "s=1", `the app saw the public host and the visitor's cookie (${wsAppHost})`);
  const got: (string | Uint8Array)[] = [];
  let closed: { code: number; reason: string } | null = null;
  bridge.attach({ send: (d) => got.push(d), close: (code, reason) => (closed = { code, reason }) });
  bridge.message("hi there");
  const big = new Uint8Array(300_000).map((_, i) => i % 256);
  bridge.message(big);
  for (let i = 0; i < 200 && got.length < 3; i++) await sleep(10);
  check(got[0] === "welcome" && got[1] === "hi there", `text both ways (${JSON.stringify(got.slice(0, 2))})`);
  check(got[2] instanceof Uint8Array && sha(Buffer.from(got[2] as Uint8Array)) === sha(Buffer.from(big)), "a 300 KB binary message echoed intact (16/64-bit lengths, masking)");
  bridge.message("bye");
  for (let i = 0; i < 200 && !closed; i++) await sleep(10);
  check(closed !== null && (closed as { code: number }).code === 4000, `the app's close reached the visitor (${JSON.stringify(closed)})`);
  for (let i = 0; i < 200 && hub!.open > 0; i++) await sleep(10);
  check(hub!.open === 0, "the passthrough stream is gone after the close");
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
echo.close();
flood.close();
wsApp.close();
console.log(`✓ relay e2e selftest passed — ${passed} checks (real hub ↔ real agent client ↔ real app)`);
process.exit(0);
