/**
 * cloudana-gateway — serves hosted sites at https://{deploymentId}.{SITES_DOMAIN}/… (docs/IMPL_SPEC_2026-10.md).
 *
 *   host label → deployment id → GET {API_URL}/v1/deployments/{id}/route (cached 30 s in caches.default)
 *   → proxy GET/HEAD to the node endpoint (10 s timeout) with security headers; branded 404/503 otherwise.
 *
 * Tenant isolation: Set-Cookie from the origin is dropped and every response gets `CSP: sandbox allow-scripts
 * allow-forms allow-popups`, so a site's scripts run in an opaque origin and cannot read another tenant's cookies or storage.
 *
 * Relay (docs/V4_RELAY_CONTRACT.md): a relayed deployment has no address; the gateway asks the RelayNode Durable
 * Object of the node serving it (`RELAY`, script_name binding to cloudana-relay), which carries the request over the
 * node's own outbound socket. Containers and workstations are full web apps on their own origin, so every method,
 * their cookies and auth headers pass through; static sites stay GET/HEAD, cookie-less and sandboxed.
 *
 * GPU endpoints (docs/V4_ENDPOINTS_CONTRACT.md): the route lists one target per running replica; a key-protected
 * endpoint needs `Authorization: Bearer cld_ek_…` (checked against the route's key hashes, rate-limited per key),
 * requests start at a random replica and are retried on another only when none was reached. Errors are JSON.
 */
import { errorPage } from "./pages.js";
import { forwardableHeaders } from "../../shared/relay-protocol.js";

/** The Workers rate-limiting binding (wrangler.toml `[[unsafe.bindings]] type = "ratelimit"`). */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  /** The Cloudana API origin. */
  API_URL?: string;
  /** Sites are served under *.{SITES_DOMAIN}. */
  SITES_DOMAIN?: string;
  /** Secret: the API's route lookup is internal (it names the serving node). */
  INTERNAL_API_KEY?: string;
  /** Node relay objects (script_name = cloudana-relay). */
  RELAY?: DurableObjectNamespace;
  /** The console/API's registrable domain. Tenant apps under it stay sandboxed and cookie-less (same-site, cookie tossing). */
  FIRST_PARTY_DOMAIN?: string;
  /** Per-endpoint-key request limit (docs/V4_ENDPOINTS_CONTRACT.md); absent locally and in tests. */
  KEY_LIMIT?: RateLimiter;
}

/**
 * True when SITES_DOMAIN is a separate registrable domain (e.g. cloudana.run), so a tenant app on its own subdomain
 * cannot set cookies for, or count as same-site with, the console and the API. Under the first-party domain
 * (*.sites.cloudana.io) it is false: containers then get the static-site isolation (sandbox, no cookies).
 */
export function isolatedContentDomain(env: Env): boolean {
  const sites = (env.SITES_DOMAIN ?? DEFAULT_DOMAIN).toLowerCase();
  const first = (env.FIRST_PARTY_DOMAIN ?? "cloudana.io").toLowerCase();
  return sites !== first && !sites.endsWith(`.${first}`);
}

/** Reaches one node's RelayNode: `fetch("https://relay/proxy", …)`. */
export type RelayStub = { fetch(input: string, init?: RequestInit): Promise<Response> };

/** Test seams: fetch and the route cache (caches.default on Workers). */
export interface Deps {
  fetch: typeof fetch;
  cache: Pick<Cache, "match" | "put"> | null;
  waitUntil?: (p: Promise<unknown>) => void;
  /** The relay object of `node`; null when no relay is bound. */
  relay?: (node: string) => RelayStub | null;
}

export type RouteState = "queued" | "assigned" | "running" | "unreachable" | "stopped" | "failed";
/** One serving replica: the node whose RelayNode to ask, and the deployment id it serves it under. */
export interface Target {
  node: string;
  dep: string;
}
export interface Route {
  found: boolean;
  state?: RouteState;
  kind?: "static" | "container" | "endpoint";
  relayed?: boolean;
  /** Replicas serving a relayed deployment (one for sites and containers), in the order to try. */
  targets?: Target[];
  /** Legacy direct nodes: the node's http endpoint while running. */
  endpoint?: string | null;
  /** Endpoints: who may call it; with "key", the sha256 hex of every live key. */
  auth?: "public" | "key";
  keys?: string[];
}

export const ROUTE_TTL_SECONDS = 30;
export const ORIGIN_TIMEOUT_MS = 10_000;
const API_TIMEOUT_MS = 5_000;
const DEFAULT_API = "https://api.cloudana.io";
const DEFAULT_DOMAIN = "sites.cloudana.io";
/** Statuses whose Response must be constructed without a body. */
const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Request headers worth forwarding to the origin (never cookies or auth). */
const FORWARD_REQUEST = ["accept", "accept-encoding", "accept-language", "if-none-match", "if-modified-since", "range", "user-agent"];
/** Response headers passed through from the origin (Set-Cookie is deliberately absent). */
const FORWARD_RESPONSE = [
  "content-type", "content-length", "content-encoding", "content-language", "content-disposition", "content-range",
  "accept-ranges", "cache-control", "etag", "last-modified", "vary", "location",
];

/** The deployment id named by `host` under `domain`, or null. */
export function deploymentIdFromHost(host: string, domain: string): string | null {
  const h = host.toLowerCase().replace(/:\d+$/, "");
  const suffix = `.${domain.toLowerCase()}`;
  if (!h.endsWith(suffix)) return null;
  const label = h.slice(0, -suffix.length);
  return UUID.test(label) ? label : null;
}

/** http(s) with no credentials on a public host (mirrors the API's endpointAllowed; names are not resolved). */
export function isPublicHttpEndpoint(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return false;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return !(
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
    );
  }
  if (host.includes(":")) {
    return !(host === "::" || host === "::1" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith("::ffff:"));
  }
  return true;
}

async function lookupRoute(id: string, env: Env, deps: Deps): Promise<Route> {
  const api = (env.API_URL ?? DEFAULT_API).replace(/\/$/, "");
  const key = new Request(`${api}/v1/deployments/${id}/route`);
  const hit = await deps.cache?.match(key).catch(() => undefined);
  if (hit) return (await hit.json()) as Route;

  let route: Route;
  try {
    const res = await deps.fetch(key.url, {
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
      headers: { accept: "application/json", ...(env.INTERNAL_API_KEY && { "x-internal-key": env.INTERNAL_API_KEY }) },
    });
    if (res.status === 404) route = { found: false };
    else if (!res.ok) throw new Error(`api ${res.status}`);
    else {
      const body = (await res.json()) as {
        state: RouteState; endpoint: string | null; kind?: Route["kind"]; relayed?: boolean; targets?: Target[]; auth?: Route["auth"]; keys?: string[];
      };
      route = {
        found: true,
        state: body.state,
        endpoint: body.endpoint,
        kind: body.kind ?? "static",
        relayed: !!body.relayed,
        targets: Array.isArray(body.targets) ? body.targets.filter((t) => t && typeof t.node === "string" && typeof t.dep === "string") : [],
        ...(body.auth && { auth: body.auth }),
        ...(Array.isArray(body.keys) && { keys: body.keys }),
      };
    }
  } catch {
    // Not cached: the next request asks again.
    throw new ApiUnavailable();
  }
  if (deps.cache) {
    const stored = new Response(JSON.stringify(route), {
      headers: { "content-type": "application/json", "cache-control": `public, max-age=${ROUTE_TTL_SECONDS}` },
    });
    const put = deps.cache.put(key, stored).catch(() => undefined);
    deps.waitUntil ? deps.waitUntil(put) : await put;
  }
  return route;
}

class ApiUnavailable extends Error {}

/** Endpoints are called by programs: their errors are JSON, never a branded page. */
const jsonError = (status: number, code: string, message: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error: { code, message, ...extra } }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers },
  });

const notRunning = (id: string, state: RouteState | undefined, endpoint: boolean) => {
  const ended = !state || state === "stopped" || state === "failed";
  if (endpoint) {
    return ended
      ? jsonError(404, "not_found", `No running endpoint at this address (${state ?? "unknown"}).`, { state: state ?? null })
      : jsonError(503, "unavailable", `No replica of this endpoint is running yet (${state}).`, { state }, { "retry-after": "30" });
  }
  if (ended) return errorPage(404, "This site is not here", `No running site is published at this address (${state ?? "unknown"}).`, id);
  return errorPage(503, "Starting up", `This site is ${state}. It is usually reachable within a minute.`, id, { "retry-after": "30" });
};

export const sha256Hex = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, "0")).join("");

/** The sha256 of a `Bearer cld_ek_…` key when it is one of `keys`; null otherwise. */
export async function authorizedKey(request: Request, keys: string[]): Promise<string | null> {
  const m = /^Bearer\s+(cld_ek_[0-9a-f]{48})$/i.exec(request.headers.get("authorization") ?? "");
  if (!m) return null;
  const hash = await sha256Hex(m[1]);
  return keys.includes(hash) ? hash : null;
}

export async function handle(request: Request, env: Env, deps: Deps): Promise<Response> {
  const url = new URL(request.url);
  const id = deploymentIdFromHost(request.headers.get("host") ?? url.hostname, env.SITES_DOMAIN ?? DEFAULT_DOMAIN);
  if (!id) return errorPage(404, "This site is not here", "The address does not name a Cloudana site.");

  let route: Route;
  try {
    route = await lookupRoute(id, env, deps);
  } catch {
    return errorPage(503, "Temporarily unavailable", "The site directory did not answer. Try again shortly.", id, { "retry-after": "15" });
  }
  if (!route.found) return errorPage(404, "This site is not here", "No site is published at this address.", id);
  const endpoint = route.kind === "endpoint";
  const site = route.kind === "static";
  // Only relayed containers and endpoints carry other methods and bodies; static sites and legacy direct origins stay GET/HEAD.
  if ((site || !route.relayed) && request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  }
  if (endpoint && route.auth === "key") {
    const key = await authorizedKey(request, route.keys ?? []);
    if (!key) return jsonError(401, "unauthorized", "This endpoint needs a valid key: Authorization: Bearer cld_ek_…", {}, { "www-authenticate": 'Bearer realm="cloudana"' });
    if (env.KEY_LIMIT && !(await env.KEY_LIMIT.limit({ key }).then((r) => r.success, () => true))) {
      return jsonError(429, "rate_limited", "Too many requests for this key; slow down.", {}, { "retry-after": "10" });
    }
  }
  if (route.relayed) {
    if (route.state !== "running" || !route.targets?.length) return notRunning(id, route.state, endpoint);
    return viaRelay(request, url, { id, site, endpoint, keyed: route.auth === "key" }, route.targets, deps, isolatedContentDomain(env));
  }
  if (route.state !== "running" || !route.endpoint) return notRunning(id, route.state, false);
  if (!isPublicHttpEndpoint(route.endpoint)) {
    return errorPage(502, "Bad origin", "The node reported an address this gateway will not reach.", id);
  }

  const origin = new URL(route.endpoint);
  // Copy the visitor's path and query onto the node's origin by assignment, never by URL resolution: a path such
  // as "//evil.com/x" resolved against a base would replace the host (open proxy under a tenant hostname).
  // The endpoint's own path is not a base path: sites are served from the node's root.
  const target = new URL(route.endpoint);
  target.pathname = url.pathname;
  target.search = url.search;
  target.hash = "";
  const headers = new Headers();
  for (const h of FORWARD_REQUEST) {
    const v = request.headers.get(h);
    if (v) headers.set(h, v);
  }
  headers.set("x-forwarded-host", url.host);
  headers.set("x-forwarded-proto", url.protocol.replace(":", ""));

  // The timeout bounds time-to-headers only; once the origin answered, the body streams at its own pace.
  // cacheTtl 0: a node host:port can be reused by another tenant later, so nothing from it may come from Cloudflare's cache.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), ORIGIN_TIMEOUT_MS);
  let upstream: Response;
  try {
    upstream = await deps.fetch(target.toString(), { method: request.method, headers, redirect: "manual", signal: abort.signal, cf: { cacheTtl: 0 } });
  } catch {
    return errorPage(503, "Site unreachable", "The node serving this site did not answer in time.", id, { "retry-after": "30" });
  } finally {
    clearTimeout(timer);
  }

  const out = new Headers();
  for (const h of FORWARD_RESPONSE) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  // The runtime may transcode an encoded body, so a forwarded content-length would be wrong.
  if (out.has("content-encoding")) out.delete("content-length");
  // A redirect to the node's own address must not leak it: keep the visitor on the public host.
  const loc = out.get("location");
  if (loc && loc.startsWith(`${origin.protocol}//${origin.host}`)) out.set("location", `${url.protocol}//${url.host}${loc.slice(`${origin.protocol}//${origin.host}`.length)}`);
  out.set("x-content-type-options", "nosniff");
  out.set("referrer-policy", "strict-origin-when-cross-origin");
  // Every response, not only text/html: SVG, XHTML, XML and untyped bodies execute scripts too.
  out.set("content-security-policy", "sandbox allow-scripts allow-forms allow-popups");
  // A Response with a body is invalid for these statuses (and for HEAD); the runtime hands us an empty stream, not null.
  const nullBody = request.method === "HEAD" || NULL_BODY_STATUS.has(upstream.status);
  return new Response(nullBody ? null : upstream.body, { status: upstream.status, headers: out });
}

/** Errors after which the next node may be tried: the request never reached an app. */
const RETRYABLE = new Set(["offline", "not_serving", "busy"]);
/** Bodies up to this size are buffered so a request can be retried on another replica. */
export const RETRY_BODY_MAX = 1024 * 1024;
const LOCAL_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(?=[/?#]|$)/i;
/** Sandboxed containers (no separate content domain yet) still get what an API call needs, never cookies. */
const FORWARD_REQUEST_API = [...FORWARD_REQUEST, "content-type", "content-length", "authorization"];

/** A Set-Cookie value without any Domain attribute (however it is spaced or cased): host-only, never a parent domain. */
export function hostOnlyCookie(value: string): string {
  return value
    .split(";")
    .filter((part, i) => i === 0 || part.split("=")[0].trim().toLowerCase() !== "domain")
    .join(";");
}

interface RelayedTarget {
  id: string;
  site: boolean;
  endpoint: boolean;
  /** The visitor's Authorization header was the endpoint key: it is consumed here, never forwarded. */
  keyed: boolean;
}

/**
 * Relayed: through a serving node's relay socket. A request is retried on the next replica only when the relay says
 * it never reached an app (RETRYABLE): always for body-less GET/HEAD; for other methods when the body fits
 * RETRY_BODY_MAX (buffered). Larger bodies stream to one replica. Endpoints start at a random replica.
 */
async function viaRelay(request: Request, url: URL, t: RelayedTarget, targets: Target[], deps: Deps, isolated: boolean): Promise<Response> {
  const { id, site } = t;
  // A full web app (cookies, auth headers, its own scripts) only on a separate user-content domain.
  const app = !site && isolated;
  const headers = new Headers();
  if (!app) {
    for (const h of site ? FORWARD_REQUEST : FORWARD_REQUEST_API) {
      const v = request.headers.get(h);
      if (v) headers.set(h, v);
    }
  } else {
    for (const [k, v] of forwardableHeaders(request.headers, { keepLength: true })) headers.append(k, v);
  }
  if (t.keyed) headers.delete("authorization");
  // Ask the app for plain bytes: Cloudflare compresses for the visitor, and nothing gets encoded twice on the way.
  headers.set("accept-encoding", "identity");
  headers.set("x-forwarded-host", url.host);
  headers.set("x-forwarded-proto", url.protocol.replace(":", ""));
  headers.set("x-relay-class", site ? "site" : "endpoint");
  headers.set("x-relay-path", `${url.pathname}${url.search}`);

  const bodyless = request.method === "GET" || request.method === "HEAD";
  // A body that fits RETRY_BODY_MAX is buffered (replayable); a larger one streams on, once.
  const body = bodyless ? undefined : request.body ? await bufferUpTo(request.body, RETRY_BODY_MAX) : null;
  const retryable = bodyless || body === null || body instanceof ArrayBuffer;
  const order = t.endpoint && targets.length > 1 ? rotate(targets, Math.floor(Math.random() * targets.length)) : targets;
  let res: Response | null = null;
  for (const target of retryable ? order : order.slice(0, 1)) {
    const stub = deps.relay?.(target.node);
    if (!stub) break;
    headers.set("x-relay-dep", target.dep);
    try {
      res = await stub.fetch("https://relay/proxy", {
        method: request.method,
        headers,
        body: body instanceof ArrayBuffer ? body.slice(0) : body,
        redirect: "manual",
      });
    } catch {
      res = null;
      continue;
    }
    const err = res.headers.get("x-relay-error");
    if (!err || !RETRYABLE.has(err)) break;
  }
  const err = res?.headers.get("x-relay-error");
  if (!res || err) {
    if (t.endpoint) {
      if (err === "too_large") return jsonError(413, "payload_too_large", "The request body is larger than this endpoint accepts.");
      if (err === "timeout") return jsonError(504, "timeout", "The endpoint did not answer in time.", {}, { "retry-after": "30" });
      return jsonError(503, "unavailable", "No replica of this endpoint could take the request right now.", { relay: err ?? null }, { "retry-after": "30" });
    }
    if (err === "too_large") return errorPage(413, "Too large", "The request body is larger than this deployment accepts.", id);
    if (err === "timeout") return errorPage(504, "Timed out", "The deployment did not answer in time.", id, { "retry-after": "30" });
    return errorPage(503, "Unreachable", "The node serving this address is not connected right now.", id, { "retry-after": "30" });
  }

  const out = new Headers();
  if (!app) {
    for (const h of FORWARD_RESPONSE) {
      const v = res.headers.get(h);
      if (v) out.set(h, v);
    }
    out.set("content-security-policy", "sandbox allow-scripts allow-forms allow-popups");
  } else {
    for (const [k, v] of res.headers) {
      if (k === "x-relay-error") continue;
      // Own origin, so the app's cookies are fine — but never for a parent domain.
      if (k === "set-cookie") out.append(k, hostOnlyCookie(v));
      else out.append(k, v);
    }
  }
  if (out.has("content-encoding")) out.delete("content-length");
  // The app sees itself at 127.0.0.1:port on its node: never leak that in redirects.
  const loc = out.get("location");
  if (loc && LOCAL_ORIGIN.test(loc)) out.set("location", loc.replace(LOCAL_ORIGIN, `${url.protocol}//${url.host}`));
  out.set("x-content-type-options", "nosniff");
  out.set("referrer-policy", "strict-origin-when-cross-origin");
  const nullBody = request.method === "HEAD" || NULL_BODY_STATUS.has(res.status);
  // An app that compresses anyway: its bytes pass as-is under its Content-Encoding (encodeBody is Workers-only).
  const init: ResponseInit & { encodeBody?: "manual" | "automatic" } = { status: res.status, headers: out };
  if (out.has("content-encoding")) init.encodeBody = "manual";
  return new Response(nullBody ? null : res.body, init);
}

const rotate = <T>(items: T[], start: number): T[] => [...items.slice(start), ...items.slice(0, start)];

/** The whole body as bytes when it is at most `max` long; otherwise a stream of what was read plus the rest. */
export async function bufferUpTo(stream: ReadableStream<Uint8Array>, max: number): Promise<ArrayBuffer | ReadableStream<Uint8Array>> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
    if (size > max) {
      let i = 0;
      return new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (i < chunks.length) return controller.enqueue(chunks[i++]);
          const next = await reader.read();
          if (next.done) controller.close();
          else controller.enqueue(next.value);
        },
        cancel: (reason) => reader.cancel(reason),
      });
    }
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out.buffer;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const ns = env.RELAY;
    return handle(request, env, {
      fetch: globalThis.fetch.bind(globalThis),
      cache: caches.default,
      waitUntil: (p) => ctx.waitUntil(p),
      relay: ns ? (node) => ns.get(ns.idFromName(node)) : () => null,
    });
  },
};
