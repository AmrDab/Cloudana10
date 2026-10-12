// The hub side of the relay protocol (docs/V4_RELAY_CONTRACT.md): turns an HTTP request into a stream on the node's
// socket and the node's frames back into a streaming Response. Pure logic over an injected `send`, so it runs the
// same in the Durable Object and in Node tests.
import {
  BODY_CAP_BYTES,
  HEAD_TIMEOUT_MS,
  IDLE_TIMEOUT_MS,
  MAX_STREAMS,
  WINDOW_BYTES,
  chunks,
  decodeData,
  encodeData,
  forwardableHeaders,
  parseNodeMessage,
  type ErrCode,
  type HubMessage,
  type TrafficClass,
} from "../../shared/relay-protocol.js";

export type RelayError = "offline" | "busy" | "timeout" | "too_large" | ErrCode;

const ERROR_STATUS: Record<RelayError, number> = {
  offline: 503,
  busy: 503,
  timeout: 504,
  too_large: 413,
  not_serving: 502,
  upstream: 502,
  bad_request: 400,
};

/** A relay-generated error response; `x-relay-error` tells the gateway whether another replica may be tried. */
export function relayError(code: RelayError): Response {
  return new Response(JSON.stringify({ error: code }), {
    status: ERROR_STATUS[code],
    headers: { "content-type": "application/json", "x-relay-error": code, "cache-control": "no-store" },
  });
}

/** Statuses whose Response must have no body. */
const NULL_BODY = new Set([101, 103, 204, 205, 304]);

export interface ProxyRequest {
  dep: string;
  cls: TrafficClass;
  method: string;
  /** Path and query, starting with "/". */
  path: string;
  headers: Iterable<[string, string]>;
  body: ReadableStream<Uint8Array> | null;
  signal?: AbortSignal;
}

interface Stream {
  head: (r: Response) => void;
  headDone: boolean;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  /** Response writes are chained so frames land in order even though each write is awaited. */
  chain: Promise<void>;
  /** Request bytes sent and not yet acked by the node. */
  unacked: number;
  waiters: (() => void)[];
  idle: ReturnType<typeof setTimeout> | null;
  headTimer: ReturnType<typeof setTimeout> | null;
  closed: boolean;
}

export class StreamHub {
  private streams = new Map<number, Stream>();
  private next = 1;

  /** `send` writes one WebSocket message to the node; it throws if the socket is gone. */
  constructor(private send: (msg: string | Uint8Array) => void, private now: () => number = Date.now) {}

  get open(): number {
    return this.streams.size;
  }

  private sendCtl(m: HubMessage) {
    this.send(JSON.stringify(m));
  }

  private id(): number {
    for (;;) {
      const s = this.next;
      this.next = this.next >= 0xfffffff0 ? 1 : this.next + 1;
      if (!this.streams.has(s)) return s;
    }
  }

  /** Send a request to the node and resolve with its response (streaming) or a relay error. */
  async proxy(req: ProxyRequest): Promise<Response> {
    if (this.streams.size >= MAX_STREAMS) return relayError("busy");
    // A declared length over the cap is refused before anything reaches the node.
    for (const [k, v] of req.headers) {
      if (k.toLowerCase() === "content-length" && Number(v) > BODY_CAP_BYTES[req.cls]) {
        req.body?.cancel().catch(() => {});
        return relayError("too_large");
      }
    }
    const s = this.id();
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    let head!: (r: Response) => void;
    const headP = new Promise<Response>((r) => (head = r));
    const st: Stream = {
      head: (r) => {
        if (st.headDone) return;
        st.headDone = true;
        if (st.headTimer) clearTimeout(st.headTimer);
        head(r);
      },
      headDone: false,
      writer: writable.getWriter(),
      chain: Promise.resolve(),
      unacked: 0,
      waiters: [],
      idle: null,
      headTimer: null,
      closed: false,
    };
    this.streams.set(s, st);
    // The client went away (or the gateway aborted): tell the node and forget the stream.
    st.writer.closed.catch(() => this.cancel(s));
    req.signal?.addEventListener("abort", () => this.cancel(s), { once: true });

    try {
      this.sendCtl({ t: "req", s, dep: req.dep, m: req.method, path: req.path, h: forwardableHeaders(req.headers) });
    } catch {
      this.forget(s);
      return relayError("offline");
    }
    st.headTimer = setTimeout(() => this.fail(s, "timeout", true), HEAD_TIMEOUT_MS[req.cls]);
    this.touch(s);
    void this.pump(s, req.body, BODY_CAP_BYTES[req.cls]);

    const res = await headP;
    // Relay errors and body-less statuses come back as they are; everything else streams the node's body.
    if (res.headers.has("x-relay-error") || NULL_BODY.has(res.status) || req.method === "HEAD") return res;
    return new Response(readable, { status: res.status, headers: res.headers });
  }

  /** Stream the client's request body to the node within the window, then `end`. */
  private async pump(s: number, body: ReadableStream<Uint8Array> | null, cap: number) {
    let total = 0;
    try {
      if (body) {
        const reader = body.getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          for (const part of chunks(value)) {
            total += part.byteLength;
            if (total > cap) {
              reader.cancel().catch(() => {});
              this.fail(s, "too_large", true);
              return;
            }
            await this.window(s, part.byteLength);
            const st = this.streams.get(s);
            if (!st || st.closed) return;
            st.unacked += part.byteLength;
            this.send(encodeData(s, part));
            this.touch(s);
          }
        }
      }
      if (this.streams.get(s)?.closed === false) this.sendCtl({ t: "end", s });
    } catch {
      this.fail(s, "offline", true);
    }
  }

  /** Wait until `n` more request bytes fit in the stream's window. */
  private async window(s: number, n: number) {
    for (;;) {
      const st = this.streams.get(s);
      if (!st || st.closed || st.unacked + n <= WINDOW_BYTES) return;
      await new Promise<void>((r) => st.waiters.push(r));
    }
  }

  /** One message from the node. */
  onMessage(msg: string | ArrayBuffer | Uint8Array): void {
    if (typeof msg !== "string") {
      const frame = decodeData(msg);
      if (!frame) return;
      const st = this.streams.get(frame.s);
      if (!st || st.closed || !st.headDone) return;
      this.touch(frame.s);
      const n = frame.data.byteLength;
      const data = frame.data.slice(); // detach from the socket's buffer
      st.chain = st.chain
        .then(() => st.writer.write(data))
        .then(() => {
          if (!st.closed) this.sendCtl({ t: "ack", s: frame.s, n });
        })
        .catch(() => this.cancel(frame.s));
      return;
    }
    const m = parseNodeMessage(msg);
    if (!m) return;
    const st = this.streams.get(m.s);
    if (!st || st.closed) return;
    this.touch(m.s);
    switch (m.t) {
      case "res": {
        const headers = new Headers();
        for (const [k, v] of m.h) {
          try {
            headers.append(k, v);
          } catch {
            /* invalid header from the node: drop it */
          }
        }
        st.head(new Response(null, { status: m.status, headers }));
        if (NULL_BODY.has(m.status)) this.finish(m.s);
        return;
      }
      case "end":
        st.chain = st.chain.then(() => st.writer.close()).catch(() => {});
        this.finish(m.s, false);
        return;
      case "err":
        this.fail(m.s, m.code, false);
        return;
      case "ack":
        st.unacked = Math.max(0, st.unacked - m.n);
        for (const w of st.waiters.splice(0)) w();
        return;
    }
  }

  /** The socket closed: every open stream fails. */
  onClose(): void {
    for (const s of [...this.streams.keys()]) this.fail(s, "offline", false);
  }

  private touch(s: number) {
    const st = this.streams.get(s);
    if (!st) return;
    if (st.idle) clearTimeout(st.idle);
    st.idle = setTimeout(() => this.fail(s, "timeout", true), IDLE_TIMEOUT_MS);
  }

  /** Cancel from our side (client gone, timeout): tell the node, drop the stream. */
  private cancel(s: number) {
    const st = this.streams.get(s);
    if (!st || st.closed) return;
    try {
      this.sendCtl({ t: "cancel", s });
    } catch {
      /* socket already gone */
    }
    this.forget(s);
  }

  /** End a stream with an error: before the head → an error response; after → the body aborts. */
  private fail(s: number, code: RelayError, tellNode: boolean) {
    const st = this.streams.get(s);
    if (!st || st.closed) return;
    if (tellNode) {
      try {
        this.sendCtl({ t: "cancel", s });
      } catch {
        /* socket gone */
      }
    }
    if (!st.headDone) st.head(relayError(code));
    else st.chain = st.chain.then(() => st.writer.abort(new Error(code))).catch(() => {});
    this.forget(s);
  }

  /** Normal completion. `closeBody` is false when `end` already queued the close. */
  private finish(s: number, closeBody = true) {
    const st = this.streams.get(s);
    if (!st) return;
    if (closeBody) st.chain = st.chain.then(() => st.writer.close()).catch(() => {});
    this.forget(s);
  }

  private forget(s: number) {
    const st = this.streams.get(s);
    if (!st) return;
    st.closed = true;
    if (st.idle) clearTimeout(st.idle);
    if (st.headTimer) clearTimeout(st.headTimer);
    for (const w of st.waiters.splice(0)) w();
    this.streams.delete(s);
  }
}
