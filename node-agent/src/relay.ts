/**
 * Relay client (docs/V4_RELAY_CONTRACT.md): one outbound WebSocket from this node to its RelayNode Durable Object.
 * Visitors' HTTP requests for this node's deployments arrive over it as streams and are forwarded to the
 * deployment's port on 127.0.0.1, so a relayed node needs no open ports.
 *
 * Mode: "relay" while the API runs a relay (the agent announced the "relay" capability at boot); "legacy" once the
 * ticket route answers 404 or 503 not_configured — today's direct serving on the public host, with the ticket asked
 * for again every 5 min. Each mode change re-announces the node first, so the API places work the way the node
 * will serve it.
 *
 * Streams (both directions at most WINDOW_BYTES unacked): `req` → http.request to 127.0.0.1:<port> (never fetch:
 * undici would decompress), request body from binary frames, acked once written upstream; the response goes back as
 * `res`, binary frames batched for up to 50 ms / 64 KiB, then `end`. The upstream response is paused while the
 * window is full. `cancel` aborts; failures are `err` with the contract's codes.
 */
import http from "node:http";
import {
  BODY_CAP_BYTES,
  decodeData,
  encodeData,
  forwardableHeaders,
  MAX_FRAME_BYTES,
  MAX_STREAMS,
  parseHubMessage,
  rejectedRequestStream,
  PING,
  PING_INTERVAL_MS,
  PONG,
  PONG_TIMEOUT_MS,
  WINDOW_BYTES,
  type ErrCode,
  type Header,
  type HubMessage,
  type NodeMessage,
} from "../../shared/relay-protocol.ts";
import type { Kind } from "./deployments.ts";

/** Capability announced while this node serves through the relay. */
export const RELAY_CAPABILITY = "relay";
export const TICKET_PATH = "/v1/nodes/relay/ticket";
const DEFAULT_URL = "wss://relay.cloudana.io/connect";
/** Legacy mode asks for a ticket again this often (the API may gain a relay). */
const LEGACY_RETRY_MS = 5 * 60_000;
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
/** A socket that stayed up this long resets the backoff. */
const STABLE_MS = 60_000;
/** connected() needs a pong at most this old. */
const PONG_FRESH_MS = 45_000;
const CONNECT_TIMEOUT_MS = 15_000;
/** Response bytes wait up to this long to fill a frame: every WebSocket message is billed. */
const BATCH_MS = 50;
/** What the hub's parser accepts in one text frame / one `res`. */
const MAX_TEXT = 64 * 1024;
const MAX_HEADERS = 128;

export interface RelayOptions {
  /** Signed POST to the API (index.ts request()); errors for non-2xx answers carry `status` and `code`. */
  request: (path: string, body: unknown) => Promise<any>;
  /** Re-announce the node with (true) or without (false) the "relay" capability. */
  announce: (relay: boolean) => Promise<void>;
  /** Local port and kind of a deployment this node serves (DeploymentManager.localTarget); null: not here. */
  target: (dep: string) => { port: number; kind: Kind } | null;
  log: (msg: string) => void;
}

interface Stream {
  s: number;
  up: http.ClientRequest;
  cap: number; // request body cap
  received: number; // request body bytes from the hub
  unacked: number; // of those, written upstream but not acked yet
  reqDone: boolean; // the hub sent `end` for the request body
  res?: http.IncomingMessage;
  out: Buffer[]; // response bytes not sent yet
  queued: number;
  inflight: number; // response bytes sent and not acked
  due: boolean; // the batch timer fired: partial frames go out too
  timer?: NodeJS.Timeout;
  ended: boolean; // the upstream response is complete
}

export class RelayClient {
  /** The boot announce carries "relay" (contract): relay mode until the API says it has none. */
  private state: "relay" | "legacy" = "relay";
  private ws?: WebSocket;
  private openedAt = 0;
  private lastPong = 0;
  private attempt = 0;
  private stopped = false;
  private lastNoise = 0;
  private retry?: NodeJS.Timeout;
  private connectTimer?: NodeJS.Timeout;
  private pingTimer?: NodeJS.Timeout;
  private pongTimer?: NodeJS.Timeout;
  private streams = new Map<number, Stream>();

  constructor(private o: RelayOptions) {}

  mode(): "relay" | "legacy" {
    return this.state;
  }

  /** For the heartbeat `relay` flag: the socket is open and answered a ping within 45 s. */
  connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && Date.now() - this.lastPong < PONG_FRESH_MS;
  }

  /** The first ticket request (it settles the mode before the heartbeat loop); the client then runs on its own. */
  async start(): Promise<void> {
    await this.cycle();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.retry);
    this.drop("stopped");
  }

  // ── Connection ─────────────────────────────────────────────────────────────────────────────────────────────

  /** Ask for a ticket (every connect uses a fresh one), switch mode if the answer says so, then connect. */
  private async cycle(): Promise<void> {
    this.retry = undefined;
    if (this.stopped) return;
    let res: any;
    try {
      res = await this.o.request(TICKET_PATH, {});
    } catch (err) {
      if (this.stopped) return;
      const { status, code } = err as { status?: number; code?: string };
      if (status === 404 || (status === 503 && code === "not_configured")) {
        const ok = await this.switchTo("legacy", `the API runs no relay: HTTP ${status}`);
        return this.later(ok ? LEGACY_RETRY_MS : this.backoff());
      }
      this.noise(`relay: ticket request failed: ${(err as Error).message || "API unreachable"}`);
      return this.later(this.backoff());
    }
    const url = typeof res?.url === "string" && res.url ? res.url : DEFAULT_URL;
    if (typeof res?.ticket !== "string" || !res.ticket || !socketUrlAllowed(url)) {
      this.noise(`relay: unusable ticket response (url ${url})`);
      return this.later(this.backoff());
    }
    if (!(await this.switchTo("relay", "the API runs a relay"))) return this.later(this.backoff());
    this.connect(url, res.ticket);
  }

  /** Re-announce for `mode` before acting in it. false: the announce failed, mode unchanged (retry later). */
  private async switchTo(mode: "relay" | "legacy", why: string): Promise<boolean> {
    if (this.state === mode) return true;
    try {
      await this.o.announce(mode === "relay");
    } catch (err) {
      this.noise(`relay: re-announce for ${mode} mode failed: ${(err as Error).message || "API unreachable"}`);
      return false;
    }
    this.state = mode;
    this.o.log(
      mode === "relay"
        ? `relay: on (${why}) — new deployments are served through the relay, no open ports needed`
        : `relay: legacy mode (${why}) — new deployments listen on the public port range; asking again every 5 min`,
    );
    return true;
  }

  private connect(url: string, ticket: string) {
    if (this.stopped) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${url}?ticket=${encodeURIComponent(ticket)}`);
    } catch (err) {
      this.noise(`relay: cannot open ${url}: ${(err as Error).message}`);
      return this.later(this.backoff());
    }
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    this.openedAt = 0;
    this.connectTimer = setTimeout(() => this.drop("connect timeout"), CONNECT_TIMEOUT_MS);
    ws.onopen = () => {
      if (this.ws !== ws) return;
      clearTimeout(this.connectTimer);
      this.openedAt = Date.now();
      this.o.log(`relay: connected to ${url}`);
      this.ping();
      this.pingTimer = setInterval(() => this.ping(), PING_INTERVAL_MS);
    };
    ws.onmessage = (ev) => {
      if (this.ws === ws) this.onMessage(ev.data);
    };
    // A failed connection fires `error` then `close`; `close` alone carries the reason.
    ws.onclose = (ev) => {
      if (this.ws === ws) this.drop(`closed (${ev.code}${ev.reason ? ` ${ev.reason}` : ""})`);
    };
  }

  private ping() {
    this.send(PING);
    if (!this.pongTimer) this.pongTimer = setTimeout(() => this.drop(`no pong within ${PONG_TIMEOUT_MS / 1000} s`), PONG_TIMEOUT_MS);
  }

  /** Forget the socket (streams die with it) and reconnect after a jittered backoff. Idempotent. */
  private drop(reason: string) {
    const ws = this.ws;
    if (!ws) return;
    this.ws = undefined;
    ws.onopen = ws.onmessage = ws.onclose = null;
    try {
      ws.close();
    } catch {}
    clearTimeout(this.connectTimer);
    clearInterval(this.pingTimer);
    clearTimeout(this.pongTimer);
    this.pongTimer = undefined;
    for (const st of [...this.streams.values()]) this.close(st);
    if (this.stopped) return;
    const wasUp = this.openedAt > 0;
    if (wasUp && Date.now() - this.openedAt >= STABLE_MS) this.attempt = 0;
    const delay = this.backoff();
    const msg = `relay: ${wasUp ? "disconnected" : "could not connect"} (${reason}) — retrying in ${(delay / 1000).toFixed(1)} s`;
    if (wasUp) this.o.log(msg);
    else this.noise(msg);
    this.later(delay);
  }

  private later(ms: number) {
    clearTimeout(this.retry);
    if (!this.stopped) this.retry = setTimeout(() => void this.cycle(), ms);
  }

  /** 1 s → 30 s, doubling, each delay jittered down to half (never below 1 s). */
  private backoff(): number {
    const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** this.attempt++);
    return Math.max(BACKOFF_MIN_MS, Math.round(base * (0.5 + Math.random() / 2)));
  }

  /** Repeated failures: at most one line a minute. */
  private noise(msg: string) {
    const now = Date.now();
    if (now - this.lastNoise < 60_000) return;
    this.lastNoise = now;
    this.o.log(msg);
  }

  private send(data: string | Uint8Array) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(data);
  }

  private sendJson(m: NodeMessage) {
    this.send(JSON.stringify(m));
  }

  private fail(s: number, code: ErrCode, message?: string) {
    this.sendJson({ t: "err", s, code, ...(message && { message: message.slice(0, 300) }) });
  }

  // ── Streams ────────────────────────────────────────────────────────────────────────────────────────────────

  private onMessage(data: unknown) {
    if (typeof data === "string") {
      if (data === PONG) {
        this.lastPong = Date.now();
        clearTimeout(this.pongTimer);
        this.pongTimer = undefined;
        return;
      }
      const m = parseHubMessage(data);
      if (m) return this.onHub(m);
      // A request we can't take (method, path, headers): say so, or the hub holds its slot until the head timeout.
      const s = rejectedRequestStream(data);
      if (s !== null && !this.streams.has(s)) this.fail(s, "bad_request", "request the node cannot parse");
    } else if (data instanceof ArrayBuffer) {
      const frame = decodeData(data);
      if (frame) this.onBody(frame.s, frame.data);
    }
  }

  private onHub(m: HubMessage) {
    if (m.t === "req") return this.onReq(m);
    const st = this.streams.get(m.s);
    if (!st) return; // finished, refused or unknown: nothing to do
    if (m.t === "end") {
      if (!st.reqDone) {
        st.reqDone = true;
        st.up.end();
      }
    } else if (m.t === "ack") {
      st.inflight = Math.max(0, st.inflight - m.n);
      this.pump(st);
    } else {
      this.close(st); // cancel, or the hub gave up on the request (err): abort upstream, no reply
    }
  }

  private onReq(m: Extract<HubMessage, { t: "req" }>) {
    if (this.streams.has(m.s)) return; // the hub reused a live id: ignore the duplicate
    if (this.streams.size >= MAX_STREAMS) return this.fail(m.s, "busy");
    const target = this.o.target(m.dep);
    if (!target) return this.fail(m.s, "not_serving");
    // The gateway's x-relay-class hint never reaches the node: the cap follows what the deployment is.
    const cap = target.kind === "static" ? BODY_CAP_BYTES.site : BODY_CAP_BYTES.endpoint;
    const declared = Number(m.h.find(([k]) => k.toLowerCase() === "content-length")?.[1]);
    if (declared > cap) return this.fail(m.s, "too_large");
    let up: http.ClientRequest;
    try {
      // agent: false — one fresh loopback connection per stream, never a stale keep-alive socket.
      // A framed body for the app: the visitor's Content-Length when there is one (Node then refuses a mismatch),
      // else explicit chunking for methods that may carry a body (servers without chunked uploads get the length).
      const h = forwardableHeaders(m.h, { keepLength: true });
      if (!h.some(([k]) => k === "content-length") && m.m !== "GET" && m.m !== "HEAD") h.push(["transfer-encoding", "chunked"]);
      up = http.request({ host: "127.0.0.1", port: target.port, method: m.m, path: m.path, headers: headerObject(h), agent: false });
    } catch (err) {
      return this.fail(m.s, "bad_request", (err as Error).message); // a path or header Node refuses
    }
    const st: Stream = { s: m.s, up, cap, received: 0, unacked: 0, reqDone: false, out: [], queued: 0, inflight: 0, due: false, ended: false };
    this.streams.set(m.s, st);
    up.on("response", (res) => this.onResponse(st, res));
    up.on("error", (err) => this.close(st, "upstream", err.message));
  }

  /** Request body bytes: written upstream, acked once written (one ack per ≥ 64 KiB). */
  private onBody(s: number, data: Uint8Array) {
    const st = this.streams.get(s);
    if (!st || st.reqDone) return;
    st.received += data.byteLength;
    if (st.received > st.cap) return this.close(st, "too_large");
    const n = data.byteLength;
    st.up.write(data, (err) => {
      if (err || this.streams.get(s) !== st) return;
      st.unacked += n;
      // The hub stalls only with more than WINDOW − 64 KiB unacked, so a 64 KiB threshold always fires first.
      if (st.unacked >= MAX_FRAME_BYTES) {
        this.sendJson({ t: "ack", s, n: st.unacked });
        st.unacked = 0;
      }
    });
  }

  private onResponse(st: Stream, res: http.IncomingMessage) {
    if (this.streams.get(st.s) !== st) return void res.destroy();
    st.res = res;
    const status = res.statusCode ?? 0;
    const head = JSON.stringify({ t: "res", s: st.s, status, h: forwardableHeaders(pairs(res.rawHeaders)).slice(0, MAX_HEADERS) } satisfies NodeMessage);
    if (status < 100 || status > 599 || head.length > MAX_TEXT) return this.close(st, "upstream", "response head the relay cannot carry");
    this.send(head);
    res.on("data", (chunk: Buffer) => this.queue(st, chunk));
    res.on("end", () => {
      st.ended = true;
      this.pump(st);
    });
    res.on("error", (err) => this.close(st, "upstream", err.message));
    res.on("close", () => {
      if (!res.complete) this.close(st, "upstream", "upstream closed the response early");
    });
  }

  private queue(st: Stream, chunk: Buffer) {
    if (this.streams.get(st.s) !== st) return;
    st.out.push(chunk);
    st.queued += chunk.length;
    if (st.inflight + st.queued >= WINDOW_BYTES) st.res?.pause();
    if (!st.timer && !st.due) {
      st.timer = setTimeout(() => {
        st.timer = undefined;
        st.due = true;
        this.pump(st);
      }, BATCH_MS);
    }
    this.pump(st);
  }

  /** Send whole frames as the window allows, the partial tail once the batch is due or the response ended. */
  private pump(st: Stream) {
    if (this.streams.get(st.s) !== st) return;
    while (st.queued > 0) {
      const n = Math.min(MAX_FRAME_BYTES, st.queued);
      if (n < MAX_FRAME_BYTES && !st.due && !st.ended) break;
      if (st.inflight + n > WINDOW_BYTES) break;
      this.send(encodeData(st.s, take(st, n)));
      st.inflight += n;
    }
    if (st.queued === 0) {
      st.due = false;
      clearTimeout(st.timer);
      st.timer = undefined;
    }
    if (st.ended) {
      if (st.queued === 0) {
        this.sendJson({ t: "end", s: st.s });
        this.close(st);
      }
    } else if (st.res?.isPaused() && st.inflight + st.queued < WINDOW_BYTES) {
      st.res.resume();
    }
  }

  /** Forget the stream and abort upstream; with `code`, tell the hub. */
  private close(st: Stream, code?: ErrCode, message?: string) {
    if (this.streams.get(st.s) !== st) return;
    this.streams.delete(st.s);
    clearTimeout(st.timer);
    if (code) this.fail(st.s, code, message);
    st.up.destroy();
  }
}

/** Only TLS, except to this machine (local development), like the API URL rule in index.ts. */
function socketUrlAllowed(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "wss:" || (u.protocol === "ws:" && /^(127\.0\.0\.1|localhost|\[::1\])$/.test(u.hostname));
  } catch {
    return false;
  }
}

/** Header pairs as http.request takes them; repeated names become arrays (Node joins cookies with "; "). */
function headerObject(h: Header[]): http.OutgoingHttpHeaders {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of h) {
    const prev = out[k];
    out[k] = prev === undefined ? v : [...(Array.isArray(prev) ? prev : [prev]), v];
  }
  return out;
}

function pairs(raw: string[]): Header[] {
  const out: Header[] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) out.push([raw[i], raw[i + 1]]);
  return out;
}

/** The next `n` queued response bytes as one buffer. */
function take(st: Stream, n: number): Buffer {
  const out = Buffer.allocUnsafe(n);
  let off = 0;
  while (off < n) {
    const b = st.out[0];
    const k = Math.min(b.length, n - off);
    b.copy(out, off, 0, k);
    off += k;
    if (k === b.length) st.out.shift();
    else st.out[0] = b.subarray(k);
  }
  st.queued -= n;
  return out;
}
