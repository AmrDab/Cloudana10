// Relay selftest: the relay client against a local hub (a `ws` server — the package viem already installs) and a real
// upstream HTTP server on 127.0.0.1. Ticket / legacy-mode handling, keepalive, request forwarding with header
// filtering, request-body acks, the response window and batching, cancel, every err code, socket loss + fresh-ticket
// reconnect; then relay-mode deployments (127.0.0.1 listeners/publishes, no endpoint, webPath, SSH rule, resume).
// Needs neither Docker nor a network.
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { chunks, encodeData, decodeData, MAX_FRAME_BYTES, MAX_STREAMS, parseNodeMessage, PING, PONG, WINDOW_BYTES, type NodeMessage } from "../../shared/relay-protocol.ts";
import { RelayClient, TICKET_PATH } from "./relay.ts";
import { DeploymentManager, type StatusBody } from "./deployments.ts";
import { serveSite } from "./hosting.ts";
import { dockerRunArgs, type DockerOps } from "./container.ts";
import { isPublicIp, SSH_NEEDS_PUBLIC_IP, workstationReport, type WorkstationSpec } from "./workstation.ts";

let passed = 0;
function check(cond: unknown, msg: string) {
  if (!cond) {
    console.error(`✗ relay selftest failed: ${msg}`);
    process.exit(1);
  }
  passed++;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, what: string, ms = 5000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) check(false, `timed out waiting for ${what}`);
    await sleep(5);
  }
}
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const b64 = (s: string) => Buffer.from(s).toString("base64");
const after = (args: string[], flag: string) => args.flatMap((a, i) => (a === flag ? [args[i + 1]] : []));

// ── Hub: what the RelayNode Durable Object does, as far as the agent can tell ──────────────────────────────
interface HubStream {
  msgs: NodeMessage[];
  body: Buffer[];
  bytes: number; // response bytes received
  frames: number[]; // payload size of each binary frame
  unacked: number; // response bytes received and not acked
  maxUnacked: number;
  acksIn: number; // request bytes the node acked
}
async function startHub() {
  const { WebSocketServer } = await import("ws" as string);
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((r) => wss.once("listening", r));
  const streams = new Map<number, HubStream>();
  const hub = {
    url: `ws://127.0.0.1:${(wss.address() as AddressInfo).port}/connect`,
    tickets: [] as string[],
    pings: 0,
    bad: [] as string[],
    autoAck: true,
    sock: null as any,
    st(s: number): HubStream {
      let x = streams.get(s);
      if (!x) streams.set(s, (x = { msgs: [], body: [], bytes: 0, frames: [], unacked: 0, maxUnacked: 0, acksIn: 0 }));
      return x;
    },
    send(m: object) {
      hub.sock.send(JSON.stringify(m));
    },
    sendData(s: number, b: Uint8Array) {
      hub.sock.send(encodeData(s, b));
    },
    ack(s: number, n: number) {
      hub.st(s).unacked -= n;
      hub.send({ t: "ack", s, n });
    },
    has: (s: number, t: NodeMessage["t"]) => hub.st(s).msgs.some((m) => m.t === t),
    get: <T extends NodeMessage["t"]>(s: number, t: T) => hub.st(s).msgs.find((m) => m.t === t) as Extract<NodeMessage, { t: T }> | undefined,
    kill() {
      hub.sock.terminate();
    },
    close() {
      for (const c of wss.clients) c.terminate();
      return new Promise((r) => wss.close(r));
    },
  };
  wss.on("connection", (ws: any, req: http.IncomingMessage) => {
    hub.tickets.push(new URL(req.url ?? "/", "http://hub").searchParams.get("ticket") ?? "");
    hub.sock = ws;
    ws.on("message", (data: Buffer, isBinary: boolean) => {
      if (!isBinary) {
        const text = data.toString("utf8");
        if (text === PING) {
          hub.pings++;
          return ws.send(PONG);
        }
        const m = parseNodeMessage(text);
        if (!m) return void hub.bad.push(text);
        hub.st(m.s).msgs.push(m);
        if (m.t === "ack") hub.st(m.s).acksIn += m.n;
        return;
      }
      const f = decodeData(data);
      if (!f) return void hub.bad.push(`binary ${data.length}`);
      const st = hub.st(f.s);
      st.body.push(Buffer.from(f.data));
      st.bytes += f.data.byteLength;
      st.frames.push(f.data.byteLength);
      st.unacked += f.data.byteLength;
      st.maxUnacked = Math.max(st.maxUnacked, st.unacked);
      if (hub.autoAck) hub.ack(f.s, f.data.byteLength);
    });
  });
  return hub;
}

// ── Upstream: the deployment's server on 127.0.0.1 ──────────────────────────────────────────────────────────
const BIG = randomBytes(1536 * 1024);
const up = { echoes: 0, slowAborted: false, hangOpen: 0, hangClosed: 0 };
const upstream = http.createServer((req, res) => {
  req.on("error", () => {}); // aborted uploads (too_large, cancel)
  const url = req.url ?? "/";
  if (url.startsWith("/echo")) {
    up.echoes++;
    const parts: Buffer[] = [];
    req.on("data", (c: Buffer) => parts.push(c));
    req.on("end", () => {
      const body = Buffer.concat(parts);
      res.setHeader("set-cookie", ["a=1", "b=2"]);
      res.writeHead(201, { "x-up": "yes", "content-type": "application/json" });
      res.end(JSON.stringify({ method: req.method, url, headers: req.headers, len: body.length, sha: sha(body) }));
    });
  } else if (url === "/big") {
    res.writeHead(200, { "content-type": "application/octet-stream" });
    let off = 0;
    const write = () => {
      while (off < BIG.length) if (!res.write(BIG.subarray(off, (off += 16 * 1024)))) return void res.once("drain", write);
      res.end();
    };
    write();
  } else if (url === "/drip") {
    res.writeHead(200);
    let i = 0;
    const t = setInterval(() => {
      res.write("x".repeat(100));
      if (++i === 10) {
        clearInterval(t);
        res.end();
      }
    }, 5);
  } else if (url === "/slow") {
    res.writeHead(200);
    res.write("first");
    res.on("close", () => (up.slowAborted = !res.writableFinished));
  } else if (url === "/hang") {
    up.hangOpen++;
    res.on("close", () => up.hangClosed++);
  } else {
    res.writeHead(404).end();
  }
});

/** Can another machine on the LAN reach host:port? (connect to this machine's first non-loopback IPv4) */
function lanReachable(port: number): Promise<boolean | null> {
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .find((i) => i && i.family === "IPv4" && !i.internal)?.address;
  if (!lan) return Promise.resolve(null);
  return new Promise((resolve) => {
    const s = net.connect({ host: lan, port, timeout: 1000 });
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("error", () => resolve(false));
    s.once("timeout", () => (s.destroy(), resolve(false)));
  });
}

async function main() {
  const guard = setTimeout(() => check(false, "selftest took over 60 s"), 60_000);
  guard.unref();

  // ── Ticket answers → mode ───────────────────────────────────────────────────────────────────────────────
  const answers: [string, object, boolean][] = [
    ["404 (API without the ticket route)", { status: 404 }, true],
    ["503 not_configured", { status: 503, code: "not_configured" }, true],
    ["503 other", { status: 503, code: "internal" }, false],
    ["429", { status: 429, code: "rate_limited" }, false],
    ["unreachable", {}, false],
  ];
  for (const [what, fields, legacy] of answers) {
    const announced: boolean[] = [];
    const c = new RelayClient({
      request: async () => {
        throw Object.assign(new Error(what), fields);
      },
      announce: async (on) => void announced.push(on),
      target: () => null,
      log: () => {},
    });
    await c.start();
    check(c.mode() === (legacy ? "legacy" : "relay") && announced.join() === (legacy ? "false" : "") && !c.connected(), `${what} → ${legacy ? "legacy mode, re-announced without relay" : "transient: mode kept, no re-announce"}`);
    c.stop();
  }
  {
    const c = new RelayClient({
      request: async () => {
        throw Object.assign(new Error("no"), { status: 404 });
      },
      announce: async () => {
        throw new Error("API unreachable");
      },
      target: () => null,
      log: () => {},
    });
    await c.start();
    check(c.mode() === "relay", "legacy answer but the re-announce failed → mode unchanged until it succeeds");
    c.stop();
    const logs: string[] = [];
    const insecure = new RelayClient({
      request: async () => ({ status: "success", ticket: "t", url: "ws://203.0.113.9/connect" }),
      announce: async () => {},
      target: () => null,
      log: (m) => logs.push(m),
    });
    await insecure.start();
    check(logs.some((l) => /unusable ticket response/.test(l)) && !insecure.connected(), "plain ws:// to a remote host refused (the ticket would travel in clear)");
    insecure.stop();
  }

  // ── Relay-mode deployments (manager) ────────────────────────────────────────────────────────────────────
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "cld-relay-selftest-"));
  const runs: string[][] = [];
  const dk: DockerOps = {
    run: async (args) => (runs.push(args), ""),
    remove: async () => {},
    running: async () => true,
    volumeEnsure: async () => "created",
    volumeRemove: async () => true,
    gpuDevices: async () => null,
    logs: async () => "",
  };
  const reports: { id: string; body: StatusBody }[] = [];
  let relayOn = true;
  const mopts = {
    dataDir,
    publicHost: "127.0.0.1",
    ports: [44000, 44100] as [number, number],
    privateKey: "0x" + "11".repeat(32),
    containersReady: true,
    hardening: async () => ({ ok: true, notes: [] }),
    docker: dk,
    relay: () => relayOn,
    log: () => {},
    report: async (id: string, body: StatusBody) => (reports.push({ id, body }), true),
  };
  const last = (id: string) => JSON.parse(JSON.stringify(reports.filter((r) => r.id === id).at(-1)?.body ?? null));
  let mgr = new DeploymentManager(mopts);

  // ── Hub + client ────────────────────────────────────────────────────────────────────────────────────────
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const upPort = (upstream.address() as AddressInfo).port;
  const dead = net.createServer();
  await new Promise<void>((r) => dead.listen(0, "127.0.0.1", r));
  const deadPort = (dead.address() as AddressInfo).port;
  await new Promise((r) => dead.close(r));
  const fixed: Record<string, { port: number; kind: "static" | "container" }> = {
    site: { port: upPort, kind: "static" },
    app: { port: upPort, kind: "container" },
    dead: { port: deadPort, kind: "container" },
  };
  const hub = await startHub();
  const requests: string[] = [];
  const announced: boolean[] = [];
  let n = 0;
  const client = new RelayClient({
    request: async (p) => (requests.push(p), { status: "success", ticket: `t${++n}`, url: hub.url, expiresAt: Date.now() + 60_000 }),
    announce: async (on) => void announced.push(on),
    target: (dep) => mgr.localTarget(dep) ?? fixed[dep] ?? null,
    log: () => {},
  });
  let sid = 1;

  try {
    await client.start();
    check(requests[0] === TICKET_PATH && client.mode() === "relay" && announced.length === 0, "ticket issued → relay mode (the boot announce already carried relay)");
    await until(() => client.connected(), "first ping answered");
    check(hub.tickets[0] === "t1" && hub.pings >= 1, "connected with ?ticket=, pinged at once, connected() after the pong");

    // Forwarding: method, path, filtered headers, 300 KiB body in frames, acks, response head + body + end.
    let s = sid++;
    const upload = randomBytes(300 * 1024);
    hub.send({
      t: "req", s, dep: "app", m: "POST", path: "/echo?x=1",
      h: [["Content-Type", "application/octet-stream"], ["x-relay-class", "endpoint"], ["host", "evil.example"], ["cf-ray", "1"], ["cookie", "a=1"], ["cookie", "b=2"], ["x-custom", "v"], ["connection", "keep-alive"]],
    });
    for (const c of chunks(upload)) hub.sendData(s, c);
    hub.send({ t: "end", s });
    await until(() => hub.has(s, "end"), "echo response");
    const head = hub.get(s, "res")!;
    const echo = JSON.parse(Buffer.concat(hub.st(s).body).toString());
    check(head.status === 201 && head.h.some(([k, v]) => k === "x-up" && v === "yes"), "status and headers come back");
    check(head.h.filter(([k]) => k === "set-cookie").length === 2, "repeated response headers (set-cookie) kept");
    check(!head.h.some(([k]) => ["content-length", "transfer-encoding", "connection"].includes(k)), "hop-by-hop / length headers not sent to the hub");
    check(echo.method === "POST" && echo.url === "/echo?x=1" && echo.len === upload.length && echo.sha === sha(upload), "method, path and body reach upstream intact");
    check(echo.headers.host === `127.0.0.1:${upPort}` && echo.headers["x-custom"] === "v" && echo.headers["content-type"] === "application/octet-stream", "host is the local upstream; ordinary headers forwarded");
    check(!("x-relay-class" in echo.headers) && !("cf-ray" in echo.headers) && echo.headers.cookie === "a=1; b=2", "x-relay-*/cf-* dropped; cookies joined");
    check(hub.st(s).acksIn >= 256 * 1024 && hub.st(s).acksIn <= upload.length, `request bytes acked after the upstream write, coalesced per 64 KiB (${hub.st(s).acksIn})`);

    // Response flow control: without acks the node stops at exactly the window; with acks the rest follows.
    s = sid++;
    hub.autoAck = false;
    hub.send({ t: "req", s, dep: "app", m: "GET", path: "/big", h: [] });
    hub.send({ t: "end", s });
    await until(() => hub.st(s).bytes >= WINDOW_BYTES, "window filled");
    await sleep(300);
    check(hub.st(s).bytes <= WINDOW_BYTES && !hub.has(s, "end"), `no more than WINDOW_BYTES unacked (${hub.st(s).bytes})`);
    // Acks smaller than a frame: the node may only refill up to the window, never past it.
    for (let i = 0; i < 10; i++) {
      hub.ack(s, 10_000);
      await sleep(30);
    }
    check(hub.st(s).maxUnacked <= WINDOW_BYTES && hub.st(s).bytes > WINDOW_BYTES, `window respected after partial acks (max unacked ${hub.st(s).maxUnacked})`);
    hub.autoAck = true;
    hub.ack(s, hub.st(s).unacked);
    await until(() => hub.has(s, "end"), "big response end");
    const big = Buffer.concat(hub.st(s).body);
    check(big.length === BIG.length && sha(big) === sha(BIG), "1.5 MiB response intact");
    // 24 full frames, plus a few partial ones the 10 000-byte acks above made room for.
    check(hub.st(s).frames.every((f) => f <= MAX_FRAME_BYTES) && hub.st(s).frames.length <= Math.ceil(BIG.length / MAX_FRAME_BYTES) + 12, `16 KiB upstream writes batched into 64 KiB frames (${hub.st(s).frames.length} frames)`);

    // Batching: ten 100-byte writes 5 ms apart go out in a few frames, not ten.
    s = sid++;
    hub.send({ t: "req", s, dep: "app", m: "GET", path: "/drip", h: [] });
    hub.send({ t: "end", s });
    await until(() => hub.has(s, "end"), "drip end");
    check(hub.st(s).bytes === 1000 && hub.st(s).frames.length < 10, `small writes batched for up to 50 ms (${hub.st(s).frames.length} frames)`);

    // Cancel mid-stream: upstream aborted, nothing more from the node for that stream.
    s = sid++;
    hub.send({ t: "req", s, dep: "app", m: "GET", path: "/slow", h: [] });
    hub.send({ t: "end", s });
    await until(() => hub.st(s).bytes > 0, "first bytes of the slow response");
    hub.send({ t: "cancel", s });
    await until(() => up.slowAborted, "upstream sees the abort");
    await sleep(100);
    check(!hub.has(s, "end") && !hub.has(s, "err"), "cancel → upstream aborted, no reply");

    // Error codes.
    s = sid++;
    hub.send({ t: "req", s, dep: "nope", m: "GET", path: "/", h: [] });
    await until(() => hub.has(s, "err"), "not_serving");
    check(hub.get(s, "err")!.code === "not_serving", "unknown deployment → not_serving");
    s = sid++;
    const echoes = up.echoes;
    hub.send({ t: "req", s, dep: "site", m: "POST", path: "/echo", h: [["content-length", String(2 * 1024 * 1024)]] });
    await until(() => hub.has(s, "err"), "declared too_large");
    check(hub.get(s, "err")!.code === "too_large" && up.echoes === echoes, "declared body over the site cap (1 MiB) → too_large before upstream");
    s = sid++;
    hub.send({ t: "req", s, dep: "site", m: "POST", path: "/echo", h: [] });
    for (let i = 0; i < 17; i++) hub.sendData(s, randomBytes(MAX_FRAME_BYTES));
    await until(() => hub.has(s, "err"), "streamed too_large");
    check(hub.get(s, "err")!.code === "too_large", "streamed body past the site cap → too_large");
    s = sid++;
    hub.send({ t: "req", s, dep: "app", m: "POST", path: "/echo", h: [["content-length", String(2 * 1024 * 1024)]] });
    hub.send({ t: "cancel", s });
    await sleep(50);
    check(!hub.has(s, "err"), "endpoint deployments take more than the site cap (16 MiB endpoint cap)");
    s = sid++;
    hub.send({ t: "req", s, dep: "dead", m: "GET", path: "/", h: [] });
    hub.send({ t: "end", s });
    await until(() => hub.has(s, "err"), "upstream error");
    check(hub.get(s, "err")!.code === "upstream" && /ECONNREFUSED/.test(hub.get(s, "err")!.message ?? ""), "nothing listening → upstream");
    s = sid++;
    hub.send({ t: "req", s, dep: "app", m: "GET", path: "/", h: [["x-bad", "a\r\nb"]] });
    await until(() => hub.has(s, "err"), "bad_request");
    check(hub.get(s, "err")!.code === "bad_request", "header Node refuses → bad_request");

    // MAX_STREAMS open → busy; cancelling them frees the upstream connections.
    const open: number[] = [];
    for (let i = 0; i < MAX_STREAMS; i++) {
      open.push((s = sid++));
      hub.send({ t: "req", s, dep: "app", m: "GET", path: "/hang", h: [] });
      hub.send({ t: "end", s });
    }
    s = sid++;
    hub.send({ t: "req", s, dep: "app", m: "GET", path: "/hang", h: [] });
    await until(() => hub.has(s, "err"), "busy");
    check(hub.get(s, "err")!.code === "busy", `stream ${MAX_STREAMS + 1} → busy`);
    await until(() => up.hangOpen === MAX_STREAMS, "all streams reach upstream");
    for (const x of open) hub.send({ t: "cancel", s: x });
    await until(() => up.hangClosed === MAX_STREAMS, "cancelled streams close upstream");

    // Relay-mode deployments, served end to end through the client.
    const html = "<!doctype html><h1>relayed</h1>";
    await mgr.handle({ id: "rs", action: "start", kind: "static", spec: { files: [{ path: "index.html", contentBase64: b64(html) }] } });
    check(last("rs")?.status === "running" && !("endpoint" in last("rs")), "relayed static site: running report without endpoint");
    const rsPort = mgr.localTarget("rs")!.port;
    check(mgr.localTarget("rs")?.kind === "static", "localTarget gives the site's port and kind");
    s = sid++;
    hub.send({ t: "req", s, dep: "rs", m: "GET", path: "/", h: [] });
    hub.send({ t: "end", s });
    await until(() => hub.has(s, "end"), "relayed site response");
    check(hub.get(s, "res")!.status === 200 && Buffer.concat(hub.st(s).body).toString() === html, "static site served through the relay");
    const lan = await lanReachable(rsPort);
    check(lan !== true, `relayed site not reachable on the LAN address (${lan === null ? "no LAN interface, skipped" : lan ? "reachable" : "refused"})`);
    const probe = await serveSite(dataDir, 0, "127.0.0.1");
    check((probe.address() as AddressInfo).address === "127.0.0.1", "serveSite binds 127.0.0.1 when asked");
    await new Promise((r) => probe.close(r));

    const cspec = { image: "nginx:alpine", ports: [{ container: 80 }], cpu: 500, memMb: 256, storageMb: 512 };
    await mgr.handle({ id: "rc", action: "start", kind: "container", spec: cspec, imageAllowed: true });
    const rc = after(runs.at(-1)!, "-p");
    check(rc.length === 1 && rc[0] === `127.0.0.1:${mgr.localTarget("rc")?.port}:80`, `relayed container published on 127.0.0.1 only (${rc})`);
    check(last("rc")?.status === "running" && !("endpoint" in last("rc")) && mgr.localTarget("rc")?.kind === "container", "relayed container: no endpoint, served via localTarget");
    check(dockerRunArgs("x", cspec, {}, [43000], true).includes("127.0.0.1:43000:80") && dockerRunArgs("x", cspec, {}, [43000]).includes("43000:80"), "dockerRunArgs: relayed vs legacy publish");

    const KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGq0 me@laptop";
    const ws: WorkstationSpec = {
      ...cspec, ports: [], image: "quay.io/jupyter/base-notebook", tokenEnv: "JUPYTER_TOKEN",
      access: { web: { port: 8888 }, ssh: { publicKey: KEY } },
    };
    await mgr.handle({ id: "rw", action: "start", kind: "workstation", spec: ws, imageAllowed: true });
    const rw = after(runs.at(-1)!, "-p");
    const rwr = last("rw");
    check(rw.length === 2 && rw[0] === `127.0.0.1:${mgr.localTarget("rw")?.port}:8888` && /^\d+:22$/.test(rw[1]), `relayed workstation: web on 127.0.0.1, SSH stays public (${rw})`);
    check(/^\/\?token=[A-Za-z0-9_-]{32}$/.test(rwr?.webPath ?? "") && !("endpoint" in rwr) && !("webToken" in rwr), `relayed Jupyter: webPath carries the token, no endpoint (${rwr?.webPath?.slice(0, 8)}…)`);
    check(!("sshEndpoint" in rwr) && rwr.message === SSH_NEEDS_PUBLIC_IP, "127.0.0.1 public host → no sshEndpoint, message says why");
    await mgr.handle({ id: "rx", action: "start", kind: "workstation", spec: { ...ws, access: { ssh: { publicKey: KEY } }, tokenEnv: undefined }, imageAllowed: true });
    check(mgr.localTarget("rx") === null && last("rx")?.status === "running", "SSH-only workstation: nothing for the relay to serve");

    const tok = "T".repeat(32);
    const code: WorkstationSpec = { ...ws, tokenEnv: "PASSWORD", access: { web: { port: 8080 }, ssh: { publicKey: KEY } } };
    let r = workstationReport("203.0.113.5", code, { web: 1, ssh: 2 }, tok, true);
    check(r.webPath === "/" && r.webToken === tok && r.sshEndpoint === "203.0.113.5:2" && !r.endpoint && !r.message, "code-server relayed: webPath /, webToken, SSH on a public IP");
    r = workstationReport("h", { ...code, tokenQuery: "tkn", access: { web: { port: 1, path: "/lab" } } }, { web: 9 }, tok, true);
    check(r.webPath === `/lab?tkn=${tok}` && !r.webToken, "path + tokenQuery → webPath");
    r = workstationReport("192.168.1.20", code, { web: 1, ssh: 2 }, tok, false);
    check(r.endpoint === "http://192.168.1.20:1" && r.sshEndpoint === "192.168.1.20:2" && !r.webPath && !r.message, "legacy report unchanged");
    for (const [h, pub] of [
      ["203.0.113.5", true], ["8.8.8.8", true], ["172.32.0.1", true], ["2606:4700::1111", true], ["[2001:db8::1]", true],
      ["127.0.0.1", false], ["10.1.2.3", false], ["172.16.0.1", false], ["192.168.1.1", false], ["100.64.0.1", false],
      ["169.254.169.254", false], ["0.0.0.0", false], ["::1", false], ["fd00::1", false], ["fe80::1", false], ["::ffff:10.0.0.1", false], ["node.example.com", false],
    ] as [string, boolean][]) check(isPublicIp(h) === pub, `isPublicIp(${h}) = ${pub}`);

    // Legacy-mode start on the same manager: public publish + endpoint, as before the relay.
    relayOn = false;
    await mgr.handle({ id: "ls", action: "start", kind: "static", spec: { files: [{ path: "index.html", contentBase64: b64(html) }] } });
    check(last("ls")?.endpoint === `http://127.0.0.1:${mgr.localTarget("ls")?.port}`, "legacy static site: endpoint reported");
    check((await lanReachable(mgr.localTarget("ls")!.port)) !== false, "control: a legacy (0.0.0.0) site is reachable on the LAN address, so the 127.0.0.1 checks mean something");
    await mgr.handle({ id: "lc", action: "start", kind: "container", spec: cspec, imageAllowed: true });
    const lport = mgr.localTarget("lc")!.port;
    check(after(runs.at(-1)!, "-p")[0] === `${lport}:80` && last("lc")?.endpoint === `http://127.0.0.1:${lport}`, "legacy start: 0.0.0.0 publish, endpoint reported");

    // Restart: each deployment keeps the mode it started with, whatever the node's mode is now.
    await mgr.closeAll();
    mgr = new DeploymentManager({ ...mopts, relay: () => false });
    reports.length = 0;
    await mgr.resume();
    check(last("rs")?.status === "running" && !("endpoint" in last("rs")) && !("endpoint" in last("rc")) && last("rw")?.webPath, "resume: relayed deployments re-report without endpoint");
    check(last("lc")?.endpoint === `http://127.0.0.1:${lport}`, "resume: legacy deployment re-reports its endpoint");
    const rsLan = await lanReachable(mgr.localTarget("rs")!.port);
    check(rsLan !== true, "resumed relayed site still listens on 127.0.0.1 only");

    // Socket loss: open streams die (upstream aborted); reconnect with a fresh ticket.
    s = sid++;
    const closedBefore = up.hangClosed;
    hub.send({ t: "req", s, dep: "app", m: "GET", path: "/hang", h: [] });
    hub.send({ t: "end", s });
    await until(() => up.hangOpen === MAX_STREAMS + 1, "stream before the socket drops");
    hub.kill();
    await until(() => up.hangClosed === closedBefore + 1, "socket loss aborts the upstream request");
    await until(() => hub.tickets.length === 2 && client.connected(), "reconnect", 5000);
    check(hub.tickets[1] === "t2", "reconnect fetched a fresh ticket");
    check(hub.bad.length === 0, `every node message parsed by the hub (${hub.bad.slice(0, 2).join(" | ")})`);
  } finally {
    client.stop();
    await mgr.closeAll();
    await hub.close();
    upstream.closeAllConnections();
    await new Promise((r) => upstream.close(r));
    rmSync(dataDir, { recursive: true, force: true });
  }
  console.log(`✓ relay selftest passed — ${passed} checks`);
}

main().catch((err) => {
  console.error(`✗ relay selftest failed: ${(err as Error).stack ?? err}`);
  process.exit(1);
});
