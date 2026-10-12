// The relay wire protocol between a node agent and its RelayNode Durable Object (docs/V4_RELAY_CONTRACT.md).
// Control messages are JSON text frames; body bytes are binary frames `u32 stream id (big-endian) ‖ ≤ 64 KiB`.
// No dependencies: imported by the agent (Node 22), the relay Worker and the API tests.

export const RELAY_PROTOCOL = 1;

/** Largest body payload in one binary frame (the 4-byte stream id comes on top). */
export const MAX_FRAME_BYTES = 64 * 1024;
/** Bytes a sender may have in flight per stream and direction before it waits for `ack`. */
export const WINDOW_BYTES = 512 * 1024;
/** Open streams per node; the next request gets 503. */
export const MAX_STREAMS = 64;
/** Open streams per deployment, so one app (SSE fans, slow uploads) can't take a node's every slot. */
export const MAX_STREAMS_PER_DEP = 16;
/** Request limits both sides enforce (the hub refuses up front; the agent answers `bad_request`, never silence). */
export const MAX_PATH_CHARS = 8192;
export const MAX_REQUEST_HEADERS = 128;
export const MAX_CONTROL_CHARS = 64 * 1024;
export const METHOD = /^[A-Z]{3,7}$/;

/** Agent keepalive: send the text "ping" this often; reconnect if no "pong" within PONG_TIMEOUT_MS. */
export const PING_INTERVAL_MS = 30_000;
export const PONG_TIMEOUT_MS = 10_000;
export const PING = "ping";
export const PONG = "pong";

/** Two traffic classes: static sites and everything else (containers, workstations, GPU endpoints). */
export type TrafficClass = "site" | "endpoint";
/** The response head must arrive within this long after the request was sent. */
export const HEAD_TIMEOUT_MS: Record<TrafficClass, number> = { site: 30_000, endpoint: 300_000 };
/** A stream with no frame either way for this long is cancelled. */
export const IDLE_TIMEOUT_MS = 300_000;
/** Largest request body forwarded. */
export const BODY_CAP_BYTES: Record<TrafficClass, number> = { site: 1024 * 1024, endpoint: 16 * 1024 * 1024 };

export type ErrCode = "not_serving" | "upstream" | "too_large" | "timeout" | "busy" | "bad_request";
export type Header = [string, string];

/** Hub → node. */
export type HubMessage =
  | { t: "req"; s: number; dep: string; m: string; path: string; h: Header[] }
  | { t: "end"; s: number }
  | { t: "err"; s: number; code: ErrCode }
  | { t: "cancel"; s: number }
  | { t: "ack"; s: number; n: number };

/** Node → hub. */
export type NodeMessage =
  | { t: "res"; s: number; status: number; h: Header[] }
  | { t: "end"; s: number }
  | { t: "err"; s: number; code: ErrCode; message?: string }
  | { t: "ack"; s: number; n: number };

const ERR_CODES = new Set<ErrCode>(["not_serving", "upstream", "too_large", "timeout", "busy", "bad_request"]);
const DEP = /^[A-Za-z0-9_-]{1,64}$/;

const isStream = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0 && (v as number) <= 0xffffffff;
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 0xffffffff;
const isHeaders = (v: unknown): v is Header[] =>
  Array.isArray(v) && v.length <= MAX_REQUEST_HEADERS && v.every((p) => Array.isArray(p) && p.length === 2 && typeof p[0] === "string" && typeof p[1] === "string");

/** Parse a hub→node text frame; null if it is not a valid message (callers ignore it). */
export function parseHubMessage(text: string): HubMessage | null {
  const m = parseJson(text);
  if (!m || !isStream(m.s)) return null;
  switch (m.t) {
    case "req":
      return typeof m.dep === "string" && DEP.test(m.dep) && typeof m.m === "string" && METHOD.test(m.m) &&
        typeof m.path === "string" && m.path.startsWith("/") && m.path.length <= MAX_PATH_CHARS && isHeaders(m.h)
        ? { t: "req", s: m.s, dep: m.dep, m: m.m, path: m.path, h: m.h }
        : null;
    case "end":
    case "cancel":
      return { t: m.t, s: m.s };
    case "err":
      return ERR_CODES.has(m.code as ErrCode) ? { t: "err", s: m.s, code: m.code as ErrCode } : null;
    case "ack":
      return isCount(m.n) ? { t: "ack", s: m.s, n: m.n } : null;
    default:
      return null;
  }
}

/** Parse a node→hub text frame; null if it is not a valid message. */
export function parseNodeMessage(text: string): NodeMessage | null {
  const m = parseJson(text);
  if (!m || !isStream(m.s)) return null;
  switch (m.t) {
    case "res":
      return Number.isInteger(m.status) && (m.status as number) >= 100 && (m.status as number) <= 599 && isHeaders(m.h)
        ? { t: "res", s: m.s, status: m.status as number, h: m.h }
        : null;
    case "end":
      return { t: "end", s: m.s };
    case "err":
      return ERR_CODES.has(m.code as ErrCode)
        ? { t: "err", s: m.s, code: m.code as ErrCode, ...(typeof m.message === "string" && { message: m.message.slice(0, 300) }) }
        : null;
    case "ack":
      return isCount(m.n) ? { t: "ack", s: m.s, n: m.n } : null;
    default:
      return null;
  }
}

/**
 * The stream id of a `req` frame that failed validation (bad method, long path, too many headers…), so the agent can
 * answer `err bad_request` instead of dropping it — a dropped request would hold a hub slot until its head timeout.
 */
export function rejectedRequestStream(text: string): number | null {
  const m = /^\{"t":"req","s":(\d{1,10}),/.exec(text);
  const s = m ? Number(m[1]) : NaN;
  return isStream(s) ? s : null;
}

function parseJson(text: string): Record<string, unknown> | null {
  if (text.length > MAX_CONTROL_CHARS) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** One binary body frame: big-endian u32 stream id, then the payload (≤ MAX_FRAME_BYTES). */
export function encodeData(stream: number, payload: Uint8Array): Uint8Array {
  if (!isStream(stream)) throw new RangeError(`bad stream id ${stream}`);
  if (payload.byteLength > MAX_FRAME_BYTES) throw new RangeError(`frame payload ${payload.byteLength} > ${MAX_FRAME_BYTES}`);
  const out = new Uint8Array(4 + payload.byteLength);
  new DataView(out.buffer).setUint32(0, stream, false);
  out.set(payload, 4);
  return out;
}

/** Split a binary frame back into stream id and payload; null if malformed. */
export function decodeData(frame: ArrayBuffer | Uint8Array): { s: number; data: Uint8Array } | null {
  const bytes = frame instanceof Uint8Array ? frame : new Uint8Array(frame);
  if (bytes.byteLength < 4 || bytes.byteLength > 4 + MAX_FRAME_BYTES) return null;
  const s = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, false);
  return isStream(s) ? { s, data: bytes.subarray(4) } : null;
}

/** Cut a chunk into payloads of at most MAX_FRAME_BYTES. */
export function* chunks(data: Uint8Array): Generator<Uint8Array> {
  for (let i = 0; i < data.byteLength; i += MAX_FRAME_BYTES) yield data.subarray(i, i + MAX_FRAME_BYTES);
}

/**
 * Hop-by-hop and relay-internal headers are never forwarded in either direction (RFC 9110 §7.6.1), nor are the
 * gateway's own `x-relay-*` hints.
 */
const DROP = new Set([
  "connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer",
  "proxy-authorization", "proxy-authenticate", "host", "content-length",
]);
export function forwardableHeaders(h: Iterable<[string, string]>, opts: { keepLength?: boolean } = {}): Header[] {
  const out: Header[] = [];
  for (const [k, v] of h) {
    const key = k.toLowerCase();
    // Requests keep their Content-Length so the app gets a framed body (servers without chunked uploads exist);
    // responses drop it (the body is re-streamed).
    if (key === "content-length" && opts.keepLength) {
      out.push([key, v]);
      continue;
    }
    if (DROP.has(key) || key.startsWith("x-relay-") || key.startsWith("cf-")) continue;
    out.push([key, v]);
  }
  return out;
}
