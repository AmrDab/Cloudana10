var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// ../shared/relay-ticket.ts
var TICKET_TTL_MS = 6e4;
var enc = new TextEncoder();
var ADDRESS = /^0x[0-9a-f]{40}$/;
var NONCE = /^[0-9a-f]{32}$/;
var SIG = /^[0-9a-f]{64}$/;
var hex = /* @__PURE__ */ __name((b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join(""), "hex");
async function hmac(secret, message) {
  if (secret.length < 32) throw new Error("relay ticket secret must be at least 32 characters");
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}
__name(hmac, "hmac");
async function verifyTicket(secret, ticket, now = Date.now()) {
  const parts = ticket.split(".");
  if (parts.length !== 4) return null;
  const [node, exp, nonce, sig] = parts;
  if (!ADDRESS.test(node) || !/^\d{13}$/.test(exp) || !NONCE.test(nonce) || !SIG.test(sig)) return null;
  const expiresAt = Number(exp);
  if (expiresAt <= now || expiresAt > now + TICKET_TTL_MS + 5e3) return null;
  const want = await hmac(secret, `${node}.${exp}.${nonce}`);
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? { node, expiresAt, nonce } : null;
}
__name(verifyTicket, "verifyTicket");

// src/node.ts
import { DurableObject } from "cloudflare:workers";

// ../shared/relay-protocol.ts
var MAX_FRAME_BYTES = 64 * 1024;
var WINDOW_BYTES = 512 * 1024;
var MAX_STREAMS = 64;
var MAX_STREAMS_PER_DEP = 16;
var MAX_PATH_CHARS = 8192;
var MAX_REQUEST_HEADERS = 128;
var MAX_CONTROL_CHARS = 64 * 1024;
var METHOD = /^[A-Z]{3,7}$/;
var PING = "ping";
var PONG = "pong";
var HEAD_TIMEOUT_MS = { site: 3e4, endpoint: 3e5 };
var IDLE_TIMEOUT_MS = 3e5;
var BODY_CAP_BYTES = { site: 1024 * 1024, endpoint: 16 * 1024 * 1024 };
var ERR_CODES = /* @__PURE__ */ new Set(["not_serving", "upstream", "too_large", "timeout", "busy", "bad_request"]);
var isStream = /* @__PURE__ */ __name((v) => Number.isInteger(v) && v > 0 && v <= 4294967295, "isStream");
var isCount = /* @__PURE__ */ __name((v) => Number.isInteger(v) && v >= 0 && v <= 4294967295, "isCount");
var isHeaders = /* @__PURE__ */ __name((v) => Array.isArray(v) && v.length <= MAX_REQUEST_HEADERS && v.every((p) => Array.isArray(p) && p.length === 2 && typeof p[0] === "string" && typeof p[1] === "string"), "isHeaders");
function parseNodeMessage(text) {
  const m = parseJson(text);
  if (!m || !isStream(m.s)) return null;
  switch (m.t) {
    case "res":
      return Number.isInteger(m.status) && m.status >= 100 && m.status <= 599 && isHeaders(m.h) ? { t: "res", s: m.s, status: m.status, h: m.h } : null;
    case "end":
      return { t: "end", s: m.s };
    case "err":
      return ERR_CODES.has(m.code) ? { t: "err", s: m.s, code: m.code, ...typeof m.message === "string" && { message: m.message.slice(0, 300) } } : null;
    case "ack":
      return isCount(m.n) ? { t: "ack", s: m.s, n: m.n } : null;
    default:
      return null;
  }
}
__name(parseNodeMessage, "parseNodeMessage");
function parseJson(text) {
  if (text.length > MAX_CONTROL_CHARS) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}
__name(parseJson, "parseJson");
function encodeData(stream, payload) {
  if (!isStream(stream)) throw new RangeError(`bad stream id ${stream}`);
  if (payload.byteLength > MAX_FRAME_BYTES) throw new RangeError(`frame payload ${payload.byteLength} > ${MAX_FRAME_BYTES}`);
  const out = new Uint8Array(4 + payload.byteLength);
  new DataView(out.buffer).setUint32(0, stream, false);
  out.set(payload, 4);
  return out;
}
__name(encodeData, "encodeData");
function decodeData(frame) {
  const bytes = frame instanceof Uint8Array ? frame : new Uint8Array(frame);
  if (bytes.byteLength < 4 || bytes.byteLength > 4 + MAX_FRAME_BYTES) return null;
  const s = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, false);
  return isStream(s) ? { s, data: bytes.subarray(4) } : null;
}
__name(decodeData, "decodeData");
function* chunks(data) {
  for (let i = 0; i < data.byteLength; i += MAX_FRAME_BYTES) yield data.subarray(i, i + MAX_FRAME_BYTES);
}
__name(chunks, "chunks");
var DROP = /* @__PURE__ */ new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
  "proxy-authorization",
  "proxy-authenticate",
  "host",
  "content-length"
]);
function forwardableHeaders(h, opts = {}) {
  const out = [];
  for (const [k, v] of h) {
    const key = k.toLowerCase();
    if (key === "content-length" && opts.keepLength) {
      out.push([key, v]);
      continue;
    }
    if (DROP.has(key) || key.startsWith("x-relay-") || key.startsWith("cf-")) continue;
    out.push([key, v]);
  }
  return out;
}
__name(forwardableHeaders, "forwardableHeaders");

// src/hub.ts
var ERROR_STATUS = {
  offline: 503,
  busy: 503,
  timeout: 504,
  too_large: 413,
  not_serving: 502,
  upstream: 502,
  bad_request: 400
};
function relayError(code) {
  return new Response(JSON.stringify({ error: code }), {
    status: ERROR_STATUS[code],
    headers: { "content-type": "application/json", "x-relay-error": code, "cache-control": "no-store" }
  });
}
__name(relayError, "relayError");
var NULL_BODY = /* @__PURE__ */ new Set([101, 103, 204, 205, 304]);
var StreamHub = class {
  /** `send` writes one WebSocket message to the node; it throws if the socket is gone. */
  constructor(send, now = Date.now) {
    this.send = send;
    this.now = now;
  }
  send;
  now;
  static {
    __name(this, "StreamHub");
  }
  streams = /* @__PURE__ */ new Map();
  next = 1;
  get open() {
    return this.streams.size;
  }
  sendCtl(m) {
    this.send(JSON.stringify(m));
  }
  id() {
    for (; ; ) {
      const s = this.next;
      this.next = this.next >= 4294967280 ? 1 : this.next + 1;
      if (!this.streams.has(s)) return s;
    }
  }
  /** Send a request to the node and resolve with its response (streaming) or a relay error. */
  async proxy(req) {
    if (this.streams.size >= MAX_STREAMS) return relayError("busy");
    let ofDep = 0;
    for (const st2 of this.streams.values()) if (st2.dep === req.dep) ofDep++;
    if (ofDep >= MAX_STREAMS_PER_DEP) return relayError("busy");
    const h = forwardableHeaders(req.headers, { keepLength: true });
    if (!METHOD.test(req.method) || req.path.length > MAX_PATH_CHARS || h.length > MAX_REQUEST_HEADERS) {
      req.body?.cancel().catch(() => {
      });
      return relayError("bad_request");
    }
    for (const [k, v] of req.headers) {
      if (k.toLowerCase() === "content-length" && Number(v) > BODY_CAP_BYTES[req.cls]) {
        req.body?.cancel().catch(() => {
        });
        return relayError("too_large");
      }
    }
    const s = this.id();
    const { readable, writable } = new TransformStream();
    let head;
    const headP = new Promise((r) => head = r);
    const st = {
      dep: req.dep,
      head: /* @__PURE__ */ __name((r) => {
        if (st.headDone) return;
        st.headDone = true;
        if (st.headTimer) clearTimeout(st.headTimer);
        head(r);
      }, "head"),
      headDone: false,
      writer: writable.getWriter(),
      chain: Promise.resolve(),
      unacked: 0,
      waiters: [],
      idle: null,
      headTimer: null,
      closed: false
    };
    this.streams.set(s, st);
    st.writer.closed.catch(() => this.cancel(s));
    req.signal?.addEventListener("abort", () => this.cancel(s), { once: true });
    const reqMsg = JSON.stringify({ t: "req", s, dep: req.dep, m: req.method, path: req.path, h });
    if (reqMsg.length > MAX_CONTROL_CHARS) {
      this.forget(s);
      req.body?.cancel().catch(() => {
      });
      return relayError("bad_request");
    }
    try {
      this.send(reqMsg);
    } catch {
      this.forget(s);
      return relayError("offline");
    }
    st.headTimer = setTimeout(() => this.fail(s, "timeout", true), HEAD_TIMEOUT_MS[req.cls]);
    this.touch(s);
    void this.pump(s, req.body, BODY_CAP_BYTES[req.cls]);
    const res = await headP;
    if (res.headers.has("x-relay-error") || NULL_BODY.has(res.status) || req.method === "HEAD") return res;
    const init = { status: res.status, headers: res.headers };
    if (res.headers.has("content-encoding")) init.encodeBody = "manual";
    return new Response(readable, init);
  }
  /** Stream the client's request body to the node within the window, then `end`. */
  async pump(s, body, cap) {
    let total = 0;
    try {
      if (body) {
        const reader = body.getReader();
        for (; ; ) {
          const { value, done } = await reader.read();
          if (done) break;
          for (const part of chunks(value)) {
            total += part.byteLength;
            if (total > cap) {
              reader.cancel().catch(() => {
              });
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
  async window(s, n) {
    for (; ; ) {
      const st = this.streams.get(s);
      if (!st || st.closed || st.unacked + n <= WINDOW_BYTES) return;
      await new Promise((r) => st.waiters.push(r));
    }
  }
  /** One message from the node. */
  onMessage(msg) {
    if (typeof msg !== "string") {
      const frame = decodeData(msg);
      if (!frame) return;
      const st2 = this.streams.get(frame.s);
      if (!st2 || st2.closed || !st2.headDone) return;
      this.touch(frame.s);
      const n = frame.data.byteLength;
      const data = frame.data.slice();
      st2.chain = st2.chain.then(() => st2.writer.write(data)).then(() => {
        if (!st2.closed) this.sendCtl({ t: "ack", s: frame.s, n });
      }).catch(() => this.cancel(frame.s));
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
          }
        }
        st.head(new Response(null, { status: m.status, headers }));
        if (NULL_BODY.has(m.status)) this.finish(m.s);
        return;
      }
      case "end":
        st.chain = st.chain.then(() => st.writer.close()).catch(() => {
        });
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
  onClose() {
    for (const s of [...this.streams.keys()]) this.fail(s, "offline", false);
  }
  touch(s) {
    const st = this.streams.get(s);
    if (!st) return;
    if (st.idle) clearTimeout(st.idle);
    st.idle = setTimeout(() => this.fail(s, "timeout", true), IDLE_TIMEOUT_MS);
  }
  /** Cancel from our side (client gone, timeout): tell the node, drop the stream. */
  cancel(s) {
    const st = this.streams.get(s);
    if (!st || st.closed) return;
    try {
      this.sendCtl({ t: "cancel", s });
    } catch {
    }
    this.forget(s);
  }
  /** End a stream with an error: before the head → an error response; after → the body aborts. */
  fail(s, code, tellNode) {
    const st = this.streams.get(s);
    if (!st || st.closed) return;
    if (tellNode) {
      try {
        this.sendCtl({ t: "cancel", s });
      } catch {
      }
    }
    if (!st.headDone) st.head(relayError(code));
    else st.chain = st.chain.then(() => st.writer.abort(new Error(code))).catch(() => {
    });
    this.forget(s);
  }
  /** Normal completion. `closeBody` is false when `end` already queued the close. */
  finish(s, closeBody = true) {
    const st = this.streams.get(s);
    if (!st) return;
    if (closeBody) st.chain = st.chain.then(() => st.writer.close()).catch(() => {
    });
    this.forget(s);
  }
  forget(s) {
    const st = this.streams.get(s);
    if (!st) return;
    st.closed = true;
    if (st.idle) clearTimeout(st.idle);
    if (st.headTimer) clearTimeout(st.headTimer);
    for (const w of st.waiters.splice(0)) w();
    this.streams.delete(s);
  }
};

// src/node.ts
var NONCE_KEY = "nonces";
var RelayNode = class extends DurableObject {
  static {
    __name(this, "RelayNode");
  }
  hub = null;
  /** The socket `hub` sends on. */
  hubSocket = null;
  constructor(ctx, env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }
  /**
   * The newest open socket. After a quick reconnect the replaced one can linger in getWebSockets() (closing) for
   * minutes, and must never carry new requests.
   */
  socket() {
    let best = null;
    let bestSince = -1;
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const since = ws.deserializeAttachment()?.since ?? 0;
      if (since > bestSince) {
        best = ws;
        bestSince = since;
      }
    }
    return best;
  }
  /** The hub of this socket, created on demand (memory is cleared by hibernation). A new socket gets a new hub. */
  hubFor(ws) {
    if (this.hub && this.hubSocket !== ws) {
      this.hub.onClose();
      this.hub = null;
    }
    if (!this.hub) {
      this.hub = new StreamHub((m) => ws.send(m));
      this.hubSocket = ws;
    }
    return this.hub;
  }
  /** A socket went away: only its own hub's streams fail (a stale socket's late close must not hit the new one). */
  dropHub(ws) {
    if (this.hub && this.hubSocket === ws) {
      this.hub.onClose();
      this.hub = null;
      this.hubSocket = null;
    }
  }
  async fetch(request) {
    const url = new URL(request.url);
    switch (url.pathname) {
      case "/connect":
        return this.acceptNode(request);
      case "/proxy":
        return this.proxy(request);
      case "/status": {
        const ws = this.socket();
        const since = ws ? ws.deserializeAttachment()?.since ?? null : null;
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
  async acceptNode(request) {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("expected websocket", { status: 426 });
    const nonce = request.headers.get("x-relay-nonce") ?? "";
    const exp = Number(request.headers.get("x-relay-exp"));
    if (!nonce || !Number.isFinite(exp)) return new Response("bad ticket", { status: 401 });
    const now = Date.now();
    const used = await this.ctx.storage.get(NONCE_KEY) ?? {};
    for (const [n, e] of Object.entries(used)) if (e < now) delete used[n];
    if (used[nonce]) return new Response("ticket already used", { status: 401 });
    used[nonce] = exp;
    await this.ctx.storage.put(NONCE_KEY, used);
    this.closeAll(4e3, "replaced");
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ since: now });
    return new Response(null, { status: 101, webSocket: client });
  }
  /** Gateway / API → node. Headers name the deployment and traffic class; method, path and body are the client's. */
  async proxy(request) {
    const ws = this.socket();
    if (!ws) return relayError("offline");
    const dep = request.headers.get("x-relay-dep") ?? "";
    const cls = request.headers.get("x-relay-class") === "site" ? "site" : "endpoint";
    const path = request.headers.get("x-relay-path") ?? "/";
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(dep) || !path.startsWith("/")) return relayError("bad_request");
    return this.hubFor(ws).proxy({
      dep,
      cls,
      method: request.method,
      path,
      headers: request.headers,
      body: request.body,
      signal: request.signal
    });
  }
  closeAll(code, reason) {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(code, reason);
      } catch {
      }
    }
    this.hub?.onClose();
    this.hub = null;
    this.hubSocket = null;
  }
  async webSocketMessage(ws, message) {
    if (ws !== this.socket()) return;
    this.hubFor(ws).onMessage(message);
  }
  async webSocketClose(ws, code) {
    this.dropHub(ws);
    try {
      ws.close(code === 1005 ? 1e3 : code, "closed");
    } catch {
    }
  }
  async webSocketError(ws) {
    this.dropHub(ws);
  }
};

// src/index.ts
var src_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return new Response("ok", { headers: { "cache-control": "no-store" } });
    if (url.pathname !== "/connect") return new Response("not found", { status: 404 });
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("expected websocket", { status: 426 });
    if (!env.RELAY_TICKET_SECRET) return new Response("relay not configured", { status: 503 });
    const claims = await verifyTicket(env.RELAY_TICKET_SECRET, url.searchParams.get("ticket") ?? "").catch(() => null);
    if (!claims) return new Response("bad or expired ticket", { status: 401 });
    const headers = new Headers(request.headers);
    headers.set("x-relay-node", claims.node);
    headers.set("x-relay-nonce", claims.nonce);
    headers.set("x-relay-exp", String(claims.expiresAt));
    const stub = env.RELAY.get(env.RELAY.idFromName(claims.node));
    return stub.fetch("https://relay/connect", { headers });
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-SipEtV/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-SipEtV/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  RelayNode,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
