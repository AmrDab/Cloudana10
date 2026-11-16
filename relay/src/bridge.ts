// Bridges between a client's WebSocket (accepted by the RelayNode Durable Object) and a byte stream to a node
// (docs/V4_RELAY_CONTRACT.md "Byte streams"). Pure logic over a `Peer`, so the Durable Object and Node tests run the
// same code.
//   RawBridge (SSH): the client's binary messages are the bytes; `{"t":"ack","n":N}` text messages carry the window
//     end to end (the node's acks to the client, the client's to the node).
//   WsBridge (web passthrough): the hub is the app's WebSocket client over the byte stream: HTTP/1.1 upgrade, then
//     client messages ↔ RFC 6455 frames (masked toward the app).
import { MAX_PATH_CHARS, MAX_REQUEST_HEADERS, OPEN_TIMEOUT_MS, WINDOW_BYTES, forwardableHeaders } from "../../shared/relay-protocol.js";
import type { ByteStream } from "./stream.js";
import type { RelayError } from "./hub.js";

/** The client's side of a WebSocket, as the bridges use it. */
export interface Peer {
  send(data: string | Uint8Array): void;
  close(code: number, reason: string): void;
}

/** Close codes a WebSocket may send (1005/1006/1015 are reserved for "none was sent"). */
export function closeCode(code: number): number {
  return (code >= 1000 && code <= 1003) || (code >= 1007 && code <= 1014) || (code >= 3000 && code <= 4999) ? code : 1000;
}

/** How a relay error closes the client's socket. */
const errorClose = (err: RelayError) => (err === "too_large" ? 1009 : 1011);

/** Closes the peer at most once; a socket already gone is fine. */
function closer(peer: Peer) {
  let done = false;
  return (code: number, reason: string) => {
    if (done) return;
    done = true;
    try {
      peer.close(closeCode(code), reason.slice(0, 120));
    } catch {
      /* already closed */
    }
  };
}

// ── Raw (SSH) ───────────────────────────────────────────────────────────────────────────────────────────────

export class RawBridge {
  /** Client bytes passed to the stream and not yet acked by the node. */
  private clientUnacked = 0;
  private gone = false;
  private readonly closePeer: (code: number, reason: string) => void;

  constructor(private stream: ByteStream, private peer: Peer) {
    this.closePeer = closer(peer);
    // Bytes from the node go to the client at once; the node hears of them when the client acks.
    stream.onData = (d) => {
      try {
        this.peer.send(d);
      } catch {
        this.closed();
      }
    };
    stream.onAck = (n) => {
      this.clientUnacked = Math.max(0, this.clientUnacked - n);
      try {
        this.peer.send(JSON.stringify({ t: "ack", n }));
      } catch {
        this.closed();
      }
    };
    // The app closed its side: close ours too; onClose then closes the client.
    stream.onEnd = () => stream.end();
    stream.onClose = (err) => this.closePeer(err ? errorClose(err) : 1000, err ?? "closed");
  }

  /** A message from the client. */
  message(data: string | ArrayBuffer | Uint8Array): void {
    if (this.gone) return;
    if (typeof data === "string") {
      const n = ackOf(data);
      if (n !== null) this.stream.ack(n);
      return;
    }
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (this.clientUnacked + bytes.byteLength > WINDOW_BYTES) {
      this.gone = true;
      this.closePeer(1008, "window exceeded");
      this.stream.close();
      return;
    }
    this.clientUnacked += bytes.byteLength;
    this.stream.write(bytes);
  }

  /** The client's socket closed: what it sent still goes out, then `end`. */
  closed(): void {
    if (this.gone) return;
    this.gone = true;
    this.stream.end();
  }
}

/** n of a `{"t":"ack","n":N}` text message; null for anything else. */
function ackOf(text: string): number | null {
  if (text.length > 64) return null;
  try {
    const m = JSON.parse(text) as { t?: unknown; n?: unknown };
    return m && m.t === "ack" && Number.isInteger(m.n) && (m.n as number) > 0 ? (m.n as number) : null;
  } catch {
    return null;
  }
}

// ── WebSocket passthrough ───────────────────────────────────────────────────────────────────────────────────

/** Largest WebSocket message either way (Cloudflare's own limit is 1 MiB for a message to a Worker). */
export const WS_MESSAGE_MAX = 1024 * 1024;
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
/** Largest response head the app may send before its 101. */
const HEAD_MAX = 16 * 1024;
const HOST = /^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$/;

export class WsError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
  }
}

export interface Frame {
  fin: boolean;
  opcode: number;
  payload: Uint8Array;
}

/** One RFC 6455 frame; `mask` (4 bytes) for client → server frames. */
export function encodeFrame(opcode: number, payload: Uint8Array, mask: Uint8Array | null, fin = true): Uint8Array {
  const n = payload.byteLength;
  const ext = n < 126 ? 0 : n < 65536 ? 2 : 8;
  const out = new Uint8Array(2 + ext + (mask ? 4 : 0) + n);
  const dv = new DataView(out.buffer);
  out[0] = (fin ? 0x80 : 0) | opcode;
  out[1] = (mask ? 0x80 : 0) | (ext === 0 ? n : ext === 2 ? 126 : 127);
  if (ext === 2) dv.setUint16(2, n);
  if (ext === 8) {
    dv.setUint32(2, Math.floor(n / 2 ** 32));
    dv.setUint32(6, n >>> 0);
  }
  let o = 2 + ext;
  if (!mask) {
    out.set(payload, o);
    return out;
  }
  out.set(mask, o);
  o += 4;
  for (let i = 0; i < n; i++) out[o + i] = payload[i] ^ mask[i & 3];
  return out;
}

/** Cuts a byte stream into frames; throws WsError (close code) on a protocol violation or an oversize frame. */
export class FrameReader {
  private buf = new Uint8Array(0);
  constructor(private max: number) {}

  push(data: Uint8Array): Frame[] {
    const joined = new Uint8Array(this.buf.byteLength + data.byteLength);
    joined.set(this.buf);
    joined.set(data, this.buf.byteLength);
    let buf = joined;
    const frames: Frame[] = [];
    for (;;) {
      if (buf.byteLength < 2) break;
      const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      const fin = (buf[0] & 0x80) !== 0;
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      if (buf[0] & 0x70) throw new WsError(1002, "reserved bits set (no extension was negotiated)");
      if (![0, 1, 2, 8, 9, 10].includes(opcode)) throw new WsError(1002, `unknown opcode ${opcode}`);
      let len = buf[1] & 0x7f;
      let o = 2;
      if (len === 126) {
        if (buf.byteLength < 4) break;
        len = dv.getUint16(2);
        o = 4;
      } else if (len === 127) {
        if (buf.byteLength < 10) break;
        if (dv.getUint32(2) !== 0) throw new WsError(1009, "frame too large");
        len = dv.getUint32(6);
        o = 10;
      }
      if (opcode >= 8 && (len > 125 || !fin)) throw new WsError(1002, "bad control frame");
      if (len > this.max) throw new WsError(1009, "frame too large");
      const start = o + (masked ? 4 : 0);
      if (buf.byteLength < start + len) break;
      const payload = buf.slice(start, start + len);
      if (masked) for (let i = 0; i < len; i++) payload[i] ^= buf[o + (i & 3)];
      frames.push({ fin, opcode, payload });
      buf = buf.subarray(start + len);
    }
    this.buf = buf.slice();
    return frames;
  }
}

const randomMask = () => crypto.getRandomValues(new Uint8Array(4));
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/** Sec-WebSocket-Accept for `key` (RFC 6455 §4.2.2). */
export async function acceptKey(key: string): Promise<string> {
  return b64(new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(key + WS_GUID))));
}

export interface UpgradeRequest {
  /** Path and query, starting with "/". */
  path: string;
  /** The public host the visitor used (the app's Origin check compares against it). */
  host: string | null;
  /** The visitor's headers as the gateway forwards them (hop-by-hop ones are dropped here). */
  headers: Iterable<[string, string]>;
}

/** The handshake's outcome: 101 with the app's subprotocol, or the status to answer the visitor with. */
export type Handshake = { status: 101; protocol: string | null } | { status: number };

export class WsBridge {
  private phase: "head" | "open" | "done" = "head";
  private head = new Uint8Array(0);
  /** Frame bytes that arrived after the 101 and before the visitor's socket existed. */
  private early: Uint8Array[] = [];
  private reader = new FrameReader(WS_MESSAGE_MAX);
  private parts: Uint8Array[] = [];
  private partsBytes = 0;
  private partsText = false;
  private peer: Peer | null = null;
  private closePeer: (code: number, reason: string) => void = () => {};
  private sentClose = false;
  private onHead: ((h: Handshake) => void) | null = null;

  constructor(private stream: ByteStream) {
    stream.onData = (d) => this.fromApp(d);
    stream.onEnd = () => stream.end();
    stream.onClose = (err) => {
      this.resolveHead({ status: 502 });
      this.phase = "done";
      this.closePeer(err ? errorClose(err) : 1000, err ?? "closed");
    };
  }

  /** Write the upgrade request and wait for the app's answer (OPEN_TIMEOUT_MS). Not 101 → the stream is closed. */
  async handshake(req: UpgradeRequest): Promise<Handshake> {
    if (!req.path.startsWith("/") || req.path.length > MAX_PATH_CHARS || /[\s\x00-\x1f\x7f]/.test(req.path)) {
      this.stream.close();
      return { status: 400 };
    }
    const key = b64(crypto.getRandomValues(new Uint8Array(16)));
    const offered: string[] = [];
    const lines = [
      `GET ${req.path} HTTP/1.1`,
      `Host: ${req.host && HOST.test(req.host) ? req.host : "127.0.0.1"}`,
      "Connection: Upgrade",
      "Upgrade: websocket",
      "Sec-WebSocket-Version: 13",
      `Sec-WebSocket-Key: ${key}`,
    ];
    for (const [k, v] of forwardableHeaders(req.headers).slice(0, MAX_REQUEST_HEADERS)) {
      if (k.startsWith("sec-websocket-") && k !== "sec-websocket-protocol") continue;
      if (/[\r\n\0]/.test(k + v)) continue;
      if (k === "sec-websocket-protocol") offered.push(...v.split(",").map((p) => p.trim()).filter(Boolean));
      lines.push(`${k}: ${v}`);
    }
    const head = new Promise<Handshake>((r) => (this.onHead = r));
    const timer = setTimeout(() => this.resolveHead({ status: 504 }), OPEN_TIMEOUT_MS);
    this.stream.write(new TextEncoder().encode(lines.join("\r\n") + "\r\n\r\n"));
    const got = await head;
    clearTimeout(timer);
    if (got.status !== 101) {
      this.phase = "done";
      this.stream.close();
      return { status: got.status };
    }
    const h = got as { status: 101; protocol: string | null; accept?: string };
    if (h.accept !== (await acceptKey(key)) || (h.protocol !== null && !offered.includes(h.protocol))) {
      this.phase = "done";
      this.stream.close();
      return { status: 502 };
    }
    return { status: 101, protocol: h.protocol };
  }

  /** The visitor's socket exists: deliver what the app already sent, then pass messages both ways. */
  attach(peer: Peer): void {
    this.peer = peer;
    this.closePeer = closer(peer);
    if (this.phase === "done") return this.closePeer(1011, "closed");
    for (const d of this.early.splice(0)) this.frames(d);
  }

  /** A message from the visitor: one frame to the app. */
  message(data: string | ArrayBuffer | Uint8Array): void {
    if (this.phase !== "open") return;
    const text = typeof data === "string";
    const payload = text ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
    if (payload.byteLength > WS_MESSAGE_MAX) return this.fail(1009, "message too large");
    this.stream.write(encodeFrame(text ? 1 : 2, payload, randomMask()));
  }

  /** The visitor's socket closed: tell the app, then end the stream. */
  closed(code = 1000, reason = ""): void {
    if (this.phase === "done") return;
    this.phase = "done";
    this.sendClose(closeCode(code), reason);
    this.stream.end();
  }

  private resolveHead(h: Handshake & { accept?: string }) {
    const r = this.onHead;
    this.onHead = null;
    r?.(h);
  }

  private fromApp(d: Uint8Array) {
    if (this.phase === "head") {
      const joined = new Uint8Array(this.head.byteLength + d.byteLength);
      joined.set(this.head);
      joined.set(d, this.head.byteLength);
      const end = indexOfHeadEnd(joined);
      if (end < 0) {
        this.stream.ack(d.byteLength);
        this.head = joined;
        if (joined.byteLength > HEAD_MAX) this.resolveHead({ status: 502 });
        return;
      }
      this.head = new Uint8Array(0);
      // The head's bytes are consumed now; frame bytes after it are acked once delivered.
      const rest = joined.slice(end + 4);
      this.stream.ack(d.byteLength - rest.byteLength);
      const parsed = parseHead(new TextDecoder().decode(joined.subarray(0, end)));
      if (!parsed) return this.resolveHead({ status: 502 });
      if (parsed.status === 101) {
        this.phase = "open";
        if (rest.byteLength) this.early.push(rest);
      }
      const ok = parsed.status === 101 && parsed.headers.get("upgrade")?.toLowerCase() === "websocket";
      return this.resolveHead(
        ok
          ? { status: 101, protocol: parsed.headers.get("sec-websocket-protocol") ?? null, accept: parsed.headers.get("sec-websocket-accept") ?? "" }
          : { status: parsed.status === 101 ? 502 : parsed.status },
      );
    }
    if (this.phase !== "open") return;
    if (!this.peer) {
      this.early.push(d);
      return;
    }
    this.frames(d);
  }

  /** App bytes → frames → visitor messages; acked once handed to the runtime (Workers sockets have no back-pressure). */
  private frames(d: Uint8Array) {
    let frames: Frame[];
    try {
      frames = this.reader.push(d);
    } catch (err) {
      return this.fail(err instanceof WsError ? err.code : 1002, (err as Error).message);
    }
    try {
      for (const f of frames) if (!this.frame(f)) return;
    } catch (err) {
      return this.fail(err instanceof WsError ? err.code : 1011, (err as Error).message);
    }
    this.stream.ack(d.byteLength);
  }

  /** One frame from the app; false once the bridge is done. */
  private frame(f: Frame): boolean {
    if (f.opcode === 8) {
      const code = f.payload.byteLength >= 2 ? new DataView(f.payload.buffer, f.payload.byteOffset).getUint16(0) : 1000;
      const reason = new TextDecoder().decode(f.payload.subarray(2));
      this.phase = "done";
      this.sendClose(closeCode(code), "");
      this.stream.end();
      this.closePeer(code, reason);
      return false;
    }
    if (f.opcode === 9) {
      this.stream.write(encodeFrame(10, f.payload, randomMask()));
      return true;
    }
    if (f.opcode === 10) return true;
    if (f.opcode !== 0) {
      if (this.parts.length) throw new WsError(1002, "new message inside a fragmented one");
      this.partsText = f.opcode === 1;
    } else if (!this.parts.length) {
      throw new WsError(1002, "continuation without a message");
    }
    this.parts.push(f.payload);
    this.partsBytes += f.payload.byteLength;
    if (this.partsBytes > WS_MESSAGE_MAX) throw new WsError(1009, "message too large");
    if (!f.fin) return true;
    const whole = new Uint8Array(this.partsBytes);
    let at = 0;
    for (const p of this.parts) {
      whole.set(p, at);
      at += p.byteLength;
    }
    this.parts = [];
    this.partsBytes = 0;
    let msg: string | Uint8Array = whole;
    if (this.partsText) {
      try {
        msg = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(whole);
      } catch {
        throw new WsError(1007, "invalid UTF-8 in a text message");
      }
    }
    this.peer!.send(msg);
    return true;
  }

  private sendClose(code: number, reason: string) {
    if (this.sentClose) return;
    this.sentClose = true;
    const r = new TextEncoder().encode(reason).subarray(0, 123);
    const payload = new Uint8Array(2 + r.byteLength);
    new DataView(payload.buffer).setUint16(0, code);
    payload.set(r, 2);
    this.stream.write(encodeFrame(8, payload, randomMask()));
  }

  private fail(code: number, reason: string) {
    if (this.phase === "done") return;
    this.phase = "done";
    this.sendClose(closeCode(code), "");
    this.stream.end();
    this.closePeer(code, reason);
  }
}

function indexOfHeadEnd(b: Uint8Array): number {
  for (let i = 0; i + 3 < b.byteLength; i++) if (b[i] === 13 && b[i + 1] === 10 && b[i + 2] === 13 && b[i + 3] === 10) return i;
  return -1;
}

function parseHead(text: string): { status: number; headers: Headers } | null {
  const [statusLine, ...rest] = text.split("\r\n");
  const m = /^HTTP\/1\.[01] (\d{3})/.exec(statusLine ?? "");
  if (!m) return null;
  const headers = new Headers();
  for (const line of rest) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    try {
      headers.append(line.slice(0, i).trim(), line.slice(i + 1).trim());
    } catch {
      /* a header the platform refuses: ignore */
    }
  }
  return { status: Number(m[1]), headers };
}
