/**
 * cloudana-gateway — serves hosted sites at https://{deploymentId}.{SITES_DOMAIN}/… (docs/IMPL_SPEC_2026-10.md).
 *
 *   host label → deployment id → GET {API_URL}/v1/deployments/{id}/route (cached 30 s in caches.default)
 *   → proxy GET/HEAD to the node endpoint (10 s timeout) with security headers; branded 404/503 otherwise.
 *
 * Tenant isolation: Set-Cookie from the origin is dropped and every response gets `CSP: sandbox allow-scripts
 * allow-forms allow-popups`, so a site's scripts run in an opaque origin and cannot read another tenant's cookies or storage.
 */
import { errorPage } from "./pages.js";

export interface Env {
  /** The Cloudana API origin. */
  API_URL?: string;
  /** Sites are served under *.{SITES_DOMAIN}. */
  SITES_DOMAIN?: string;
}

/** Test seams: fetch and the route cache (caches.default on Workers). */
export interface Deps {
  fetch: typeof fetch;
  cache: Pick<Cache, "match" | "put"> | null;
  waitUntil?: (p: Promise<unknown>) => void;
}

export type RouteState = "queued" | "assigned" | "running" | "unreachable" | "stopped" | "failed";
export interface Route {
  found: boolean;
  state?: RouteState;
  endpoint?: string | null;
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
    const res = await deps.fetch(key.url, { signal: AbortSignal.timeout(API_TIMEOUT_MS), headers: { accept: "application/json" } });
    if (res.status === 404) route = { found: false };
    else if (!res.ok) throw new Error(`api ${res.status}`);
    else {
      const body = (await res.json()) as { state: RouteState; endpoint: string | null };
      route = { found: true, state: body.state, endpoint: body.endpoint };
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

const notRunning = (id: string, state: RouteState | undefined) => {
  if (!state || state === "stopped" || state === "failed") return errorPage(404, "This site is not here", `No running site is published at this address (${state ?? "unknown"}).`, id);
  return errorPage(503, "Starting up", `This site is ${state}. It is usually reachable within a minute.`, id, { "retry-after": "30" });
};

export async function handle(request: Request, env: Env, deps: Deps): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  }
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
  if (route.state !== "running" || !route.endpoint) return notRunning(id, route.state);
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

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handle(request, env, { fetch: globalThis.fetch.bind(globalThis), cache: caches.default, waitUntil: (p) => ctx.waitUntil(p) });
  },
};
