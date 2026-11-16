// RelayNode: one Durable Object per node (idFromName(nodeAddress)) holding that node's one WebSocket
// (docs/V4_RELAY_CONTRACT.md). Hibernation keeps idle sockets free; the in-memory StreamHub only lives while
// requests are in flight, which also keeps the object awake.
import { DurableObject } from "cloudflare:workers";
import { PING, PONG, PORT_CLASSES, TCP_SUBPROTOCOL, TRAFFIC_CLASSES, type PortClass, type TrafficClass } from "../../shared/relay-protocol.js";
import { StreamHub, relayError } from "./hub.js";
import { RawBridge, WsBridge, type Peer } from "./bridge.js";

export interface Env {
  RELAY: DurableObjectNamespace<RelayNode>;
  RELAY_TICKET_SECRET?: string;
}

/** Ticket nonces already used, kept until their ticket would have expired anyway. */
const NONCE_KEY = "nonces";

export class RelayNode extends DurableObject<Env> {
  private hub: StreamHub | null = null;
  /** The socket `hub` sends on. */
  private hubSocket: WebSocket | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answered by the runtime without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  /**
   * The newest open socket. After a quick reconnect the replaced one can linger in getWebSockets() (closing) for
   * minutes, and must never carry new requests.
   */
  private socket(): WebSocket | null {
    let best: WebSocket | null = null;
    let bestSince = -1;
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const since = (ws.deserializeAttachment() as { since?: number } | null)?.since ?? 0;
      if (since > bestSince) {
        best = ws;
        bestSince = since;
      }
    }
    return best;
  }

  /** The hub of this socket, created on demand (memory is cleared by hibernation). A new socket gets a new hub. */
  private hubFor(ws: WebSocket): StreamHub {
    if (this.hub && this.hubSocket !== ws) {
      this.hub.onClose(); // streams of a replaced socket can't finish
      this.hub = null;
    }
    if (!this.hub) {
      this.hub = new StreamHub((m) => ws.send(m));
      this.hubSocket = ws;
    }
    return this.hub;
  }

  /** A socket went away: only its own hub's streams fail (a stale socket's late close must not hit the new one). */
  private dropHub(ws: WebSocket) {
    if (this.hub && this.hubSocket === ws) {
      this.hub.onClose();
      this.hub = null;
      this.hubSocket = null;
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    switch (url.pathname) {
      case "/connect":
        return this.acceptNode(request);
      case "/proxy":
        return this.proxy(request);
      case "/stream":
        return this.stream(request);
      case "/status": {
        const ws = this.socket();
        const since = ws ? (ws.deserializeAttachment() as { since?: number } | null)?.since ?? null : null;
        return Response.json({ connected: !!ws, since });
      }
      case "/kick":
        this.closeAll(4001, "kicked");
        return Response.json({ ok: true });
      default:
        return new Response("not found", { status: 404 });
    }
  }

  /** A node opens its socket; the Worker already checked the ticket. One use per nonce; the old socket goes. */
  private async acceptNode(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("expected websocket", { status: 426 });
    const nonce = request.headers.get("x-relay-nonce") ?? "";
    const exp = Number(request.headers.get("x-relay-exp"));
    if (!nonce || !Number.isFinite(exp)) return new Response("bad ticket", { status: 401 });
    const now = Date.now();
    const used = ((await this.ctx.storage.get<Record<string, number>>(NONCE_KEY)) ?? {}) as Record<string, number>;
    for (const [n, e] of Object.entries(used)) if (e < now) delete used[n];
    if (used[nonce]) return new Response("ticket already used", { status: 401 });
    used[nonce] = exp;
    await this.ctx.storage.put(NONCE_KEY, used);

    this.closeAll(4000, "replaced");
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ since: now });
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Gateway / API → node. Headers name the deployment and traffic class; method, path and body are the client's. */
  private async proxy(request: Request): Promise<Response> {
    const ws = this.socket();
    if (!ws) return relayError("offline");
    const dep = request.headers.get("x-relay-dep") ?? "";
    const named = request.headers.get("x-relay-class") as TrafficClass | null;
    const cls: TrafficClass = named && TRAFFIC_CLASSES.includes(named) ? named : "endpoint";
    const path = request.headers.get("x-relay-path") ?? "/";
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(dep) || !path.startsWith("/")) return relayError("bad_request");
    return this.hubFor(ws).proxy({
      dep,
      cls,
      probe: request.headers.get("x-relay-probe") === "1",
      method: request.method,
      path,
      headers: request.headers,
      body: request.body,
      signal: request.signal,
    });
  }

  /**
   * Gateway → node byte stream ("Byte streams" in the contract), a WebSocket upgrade: x-relay-dep, x-relay-port
   * (ssh|web), x-relay-mode (raw: the client's socket is the stream; ws: passthrough to the app's WebSocket, with
   * x-relay-path and the visitor's headers). Answers 101 once the node connected (and the app accepted), else a relay
   * error. The client's socket is a plain (non-hibernating) one: it keeps the object awake while it is open.
   */
  private async stream(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("expected websocket", { status: 426 });
    const ws = this.socket();
    if (!ws) return relayError("offline");
    const dep = request.headers.get("x-relay-dep") ?? "";
    const port = request.headers.get("x-relay-port") as PortClass | null;
    const mode = request.headers.get("x-relay-mode");
    const path = request.headers.get("x-relay-path") ?? "/";
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(dep) || !port || !PORT_CLASSES.includes(port) || (mode !== "raw" && mode !== "ws")) {
      return relayError("bad_request");
    }
    const stream = this.hubFor(ws).openStream(dep, port);
    const err = await stream.opened;
    if (err) return relayError(err);

    if (mode === "raw") {
      const offered = (request.headers.get("sec-websocket-protocol") ?? "").split(",").map((p) => p.trim());
      const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
      server.accept();
      const bridge = new RawBridge(stream, peerOf(server));
      server.addEventListener("message", (e) => bridge.message(e.data as string | ArrayBuffer));
      server.addEventListener("close", () => bridge.closed());
      server.addEventListener("error", () => bridge.closed());
      const headers = offered.includes(TCP_SUBPROTOCOL) ? { "sec-websocket-protocol": TCP_SUBPROTOCOL } : undefined;
      return new Response(null, { status: 101, webSocket: client, headers });
    }

    const bridge = new WsBridge(stream);
    const head = await bridge.handshake({ path, host: request.headers.get("x-forwarded-host"), headers: request.headers });
    if (head.status !== 101) return new Response(null, { status: head.status >= 200 && head.status <= 599 ? head.status : 502, headers: { "x-relay-app-status": String(head.status) } });
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    server.accept();
    bridge.attach(peerOf(server));
    server.addEventListener("message", (e) => bridge.message(e.data as string | ArrayBuffer));
    server.addEventListener("close", (e) => bridge.closed(e.code, e.reason));
    server.addEventListener("error", () => bridge.closed(1011, "error"));
    const protocol = "protocol" in head ? head.protocol : null;
    return new Response(null, { status: 101, webSocket: client, headers: protocol ? { "sec-websocket-protocol": protocol } : undefined });
  }

  private closeAll(code: number, reason: string) {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(code, reason);
      } catch {
        /* already closing */
      }
    }
    this.hub?.onClose();
    this.hub = null;
    this.hubSocket = null;
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // Only the newest open socket speaks for the node; a replaced one's late frames are dropped.
    if (ws !== this.socket()) return;
    // After hibernation there is no hub, so no open streams: stray frames are dropped by a fresh hub.
    this.hubFor(ws).onMessage(message);
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    this.dropHub(ws);
    try {
      ws.close(code === 1005 ? 1000 : code, "closed");
    } catch {
      /* already closed */
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.dropHub(ws);
  }
}

/** A client socket as the bridges use it. */
function peerOf(ws: WebSocket): Peer {
  return { send: (d) => ws.send(d), close: (code, reason) => ws.close(code, reason) };
}
