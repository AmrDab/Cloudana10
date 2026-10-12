// RelayNode: one Durable Object per node (idFromName(nodeAddress)) holding that node's one WebSocket
// (docs/V4_RELAY_CONTRACT.md). Hibernation keeps idle sockets free; the in-memory StreamHub only lives while
// requests are in flight, which also keeps the object awake.
import { DurableObject } from "cloudflare:workers";
import { PING, PONG, type TrafficClass } from "../../shared/relay-protocol.js";
import { StreamHub, relayError } from "./hub.js";

export interface Env {
  RELAY: DurableObjectNamespace<RelayNode>;
  RELAY_TICKET_SECRET?: string;
}

/** Ticket nonces already used, kept until their ticket would have expired anyway. */
const NONCE_KEY = "nonces";

export class RelayNode extends DurableObject<Env> {
  private hub: StreamHub | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answered by the runtime without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  private socket(): WebSocket | null {
    return this.ctx.getWebSockets()[0] ?? null;
  }

  /** The hub for the current socket, created on demand (memory is cleared by hibernation). */
  private hubFor(ws: WebSocket): StreamHub {
    if (!this.hub) this.hub = new StreamHub((m) => ws.send(m));
    return this.hub;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    switch (url.pathname) {
      case "/connect":
        return this.acceptNode(request);
      case "/proxy":
        return this.proxy(request);
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
    const cls = (request.headers.get("x-relay-class") === "site" ? "site" : "endpoint") as TrafficClass;
    const path = request.headers.get("x-relay-path") ?? "/";
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(dep) || !path.startsWith("/")) return relayError("bad_request");
    return this.hubFor(ws).proxy({
      dep,
      cls,
      method: request.method,
      path,
      headers: request.headers,
      body: request.body,
      signal: request.signal,
    });
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
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // After hibernation there is no hub, so no open streams: stray frames are dropped by a fresh hub.
    this.hubFor(ws).onMessage(message);
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    this.hub?.onClose();
    this.hub = null;
    try {
      ws.close(code === 1005 ? 1000 : code, "closed");
    } catch {
      /* already closed */
    }
  }

  async webSocketError(): Promise<void> {
    this.hub?.onClose();
    this.hub = null;
  }
}
