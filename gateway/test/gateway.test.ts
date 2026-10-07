import { describe, it, expect, vi } from "vitest";
import { handle, deploymentIdFromHost, isPublicHttpEndpoint, ORIGIN_TIMEOUT_MS, type Deps, type Env } from "../src/index.js";

const ID = "6f1c2a3e-1111-4222-8333-444455556666";
const ENV: Env = { API_URL: "https://api.example.test", SITES_DOMAIN: "sites.example.test" };
const ORIGIN = "http://203.0.113.10:42001";

type Hit = { url: string; init?: RequestInit };

/** A fetch mock: the API answers from `route`; the origin answers from `origin(path)`. Records every call. */
function mockFetch(route: { status: number; body?: unknown }, origin: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Hit[] = [];
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    if (url.startsWith(ENV.API_URL!)) {
      return new Response(JSON.stringify(route.body ?? { status: "error" }), { status: route.status, headers: { "content-type": "application/json" } });
    }
    return origin(new URL(url), init);
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}

/** An in-memory stand-in for caches.default. */
function memCache(): Pick<Cache, "match" | "put"> & { store: Map<string, Response> } {
  const store = new Map<string, Response>();
  return {
    store,
    match: async (req) => store.get((req as Request).url)?.clone(),
    put: async (req, res) => void store.set((req as Request).url, res),
  };
}

const running = { status: 200, body: { status: "success", id: ID, state: "running", endpoint: ORIGIN, kind: "static" } };
const html = (body: string, headers: Record<string, string> = {}) =>
  new Response(body, { headers: { "content-type": "text/html; charset=utf-8", ...headers } });

const req = (path = "/", init: RequestInit = {}, host = `${ID}.sites.example.test`) =>
  new Request(`https://${host}${path}`, { ...init, headers: { host, ...(init.headers as Record<string, string>) } });

const deps = (f: typeof globalThis.fetch, cache: Deps["cache"] = null): Deps => ({ fetch: f, cache });

describe("host parsing", () => {
  it("maps the first label to a deployment id", () => {
    expect(deploymentIdFromHost(`${ID}.sites.example.test`, "sites.example.test")).toBe(ID);
    expect(deploymentIdFromHost(`${ID.toUpperCase()}.sites.example.test:443`, "sites.example.test")).toBe(ID);
    expect(deploymentIdFromHost("sites.example.test", "sites.example.test")).toBeNull();
    expect(deploymentIdFromHost("notauuid.sites.example.test", "sites.example.test")).toBeNull();
    expect(deploymentIdFromHost(`${ID}.evil.example.test`, "sites.example.test")).toBeNull();
    expect(deploymentIdFromHost(`a.${ID}.sites.example.test`, "sites.example.test")).toBeNull();
  });

  it("rejects private and non-http endpoints", () => {
    for (const ok of ["http://203.0.113.10:42001", "https://node.example.com", "http://[2001:db8::1]:8080"]) expect(isPublicHttpEndpoint(ok)).toBe(true);
    for (const bad of [
      "http://127.0.0.1:42001", "http://10.1.2.3", "http://192.168.1.1", "http://172.16.0.1", "http://169.254.169.254",
      "http://100.64.0.1", "http://localhost:3000", "http://host.internal", "http://[::1]", "http://[fd00::1]",
      "ftp://203.0.113.10", "http://user:pw@203.0.113.10", "not a url",
    ]) expect(isPublicHttpEndpoint(bad), bad).toBe(false);
  });
});

describe("proxy", () => {
  it("proxies GET to the origin path with security headers and no cookies", async () => {
    const m = mockFetch(running, (u, init) => {
      expect(u.toString()).toBe(`${ORIGIN}/blog/post?x=1`);
      const h = new Headers(init?.headers);
      expect(h.get("x-forwarded-host")).toBe(`${ID}.sites.example.test`);
      expect(h.get("cookie")).toBeNull();
      expect(h.get("authorization")).toBeNull();
      return html("<h1>hi</h1>", { "set-cookie": "sid=1", "cache-control": "public, max-age=600", etag: '"abc"' });
    });
    const res = await handle(req("/blog/post?x=1", { headers: { cookie: "a=b", authorization: "Bearer x" } }), ENV, deps(m.fetch));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<h1>hi</h1>");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("content-security-policy")).toBe("sandbox allow-scripts allow-forms allow-popups");
    expect(res.headers.get("cache-control")).toBe("public, max-age=600");
    expect(res.headers.get("etag")).toBe('"abc"');
    expect(m.calls.map((c) => c.url)).toEqual([`${ENV.API_URL}/v1/deployments/${ID}/route`, `${ORIGIN}/blog/post?x=1`]);
  });

  it("sandboxes every response, not only HTML (SVG, XML and untyped bodies run scripts too)", async () => {
    for (const ct of ["text/css", "image/svg+xml", "application/xhtml+xml", "text/xml", null]) {
      const m = mockFetch(running, () => new Response("x", { headers: ct ? { "content-type": ct } : {} }));
      const res = await handle(req("/a"), ENV, deps(m.fetch));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-security-policy"), String(ct)).toBe("sandbox allow-scripts allow-forms allow-popups");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    }
  });

  it("never lets the request path pick another host (open proxy / phishing under a tenant hostname)", async () => {
    for (const path of ["//evil.com/x", "/\\evil.com/x", "//evil.com", "/%2F%2Fevil.com/x", "//evil.com:443/x?q=1"]) {
      const m = mockFetch(running, (u) => {
        expect(u.host, path).toBe(new URL(ORIGIN).host);
        expect(u.protocol).toBe("http:");
        return html("ok");
      });
      const res = await handle(req(path), ENV, deps(m.fetch));
      expect(res.status, path).toBe(200);
      const hit = new URL(m.calls[1].url);
      expect(hit.host, path).toBe(new URL(ORIGIN).host);
      expect(hit.pathname + hit.search, path).toBe(new URL(`https://x${path}`).pathname + new URL(`https://x${path}`).search);
    }
  });

  it("builds a bodiless Response for 304 / 204 even when the runtime hands over an empty stream", async () => {
    for (const status of [304, 204, 205]) {
      // Workers (and undici) give fetch results a non-null body stream for these statuses; `new Response(stream, 304)` throws.
      const m = mockFetch(running, () => ({ status, headers: new Headers({ etag: '"abc"' }), body: new ReadableStream() }) as unknown as Response);
      const res = await handle(req("/", { headers: { "if-none-match": '"abc"' } }), ENV, deps(m.fetch));
      expect(res.status, String(status)).toBe(status);
      expect(res.body).toBeNull();
      if (status === 304) expect(res.headers.get("etag")).toBe('"abc"');
    }
  });

  it("drops content-length when content-encoding is forwarded, bypasses the Cloudflare cache, and only bounds time-to-headers", async () => {
    vi.useFakeTimers();
    try {
      let seen: RequestInit | undefined;
      const body = new ReadableStream<Uint8Array>({
        start(ctrl) {
          // The body keeps streaming long after the header timeout would have fired.
          setTimeout(() => {
            ctrl.enqueue(new TextEncoder().encode("late"));
            ctrl.close();
          }, ORIGIN_TIMEOUT_MS * 2);
        },
      });
      const m = mockFetch(running, (_u, init) => {
        seen = init;
        return new Response(body, { headers: { "content-type": "text/plain", "content-encoding": "gzip", "content-length": "10" } });
      });
      const res = await handle(req("/big"), ENV, deps(m.fetch));
      expect(res.headers.get("content-encoding")).toBe("gzip");
      expect(res.headers.get("content-length")).toBeNull();
      expect((seen as { cf?: unknown }).cf).toEqual({ cacheTtl: 0 });
      await vi.advanceTimersByTimeAsync(ORIGIN_TIMEOUT_MS * 3);
      expect(seen!.signal!.aborted).toBe(false);
      expect(await res.text()).toBe("late");
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers HEAD without a body and rewrites redirects to the node's address", async () => {
    const m = mockFetch(running, () => new Response(null, { status: 302, headers: { location: `${ORIGIN}/new/` } }));
    const res = await handle(req("/old", { method: "HEAD" }), ENV, deps(m.fetch));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`https://${ID}.sites.example.test/new/`);
    expect(await res.text()).toBe("");
    expect((m.calls[1].init as RequestInit).method).toBe("HEAD");
  });

  it("refuses other methods", async () => {
    const m = mockFetch(running, () => html(""));
    const res = await handle(req("/", { method: "POST" }), ENV, deps(m.fetch));
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
    expect(m.calls).toHaveLength(0);
  });

  it("uses the route cache so the API is asked once per 30 s", async () => {
    const cache = memCache();
    const m = mockFetch(running, () => html("ok"));
    const d = deps(m.fetch, cache);
    await handle(req("/"), ENV, d);
    await handle(req("/b"), ENV, d);
    expect(m.calls.filter((c) => c.url.startsWith(ENV.API_URL!))).toHaveLength(1);
    expect(cache.store.get(`${ENV.API_URL}/v1/deployments/${ID}/route`)?.headers.get("cache-control")).toBe("public, max-age=30");
  });
});

describe("error pages", () => {
  const isPage = async (res: Response) => {
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("no-store");
    return res.text();
  };

  it("404 for a host that is not a site or an unknown id, without touching an origin", async () => {
    const m = mockFetch({ status: 404 }, () => html("never"));
    const bad = await handle(req("/", {}, "www.sites.example.test"), ENV, deps(m.fetch));
    expect(bad.status).toBe(404);
    expect(await isPage(bad)).toContain("Cloudana");
    const unknown = await handle(req("/"), ENV, deps(m.fetch));
    expect(unknown.status).toBe(404);
    expect(m.calls).toHaveLength(1);
  });

  it("404 when stopped, 503 with Retry-After while queued", async () => {
    const stopped = mockFetch({ status: 200, body: { id: ID, state: "stopped", endpoint: null, kind: "static" } }, () => html("never"));
    expect((await handle(req("/"), ENV, deps(stopped.fetch))).status).toBe(404);
    const queued = mockFetch({ status: 200, body: { id: ID, state: "queued", endpoint: null, kind: "static" } }, () => html("never"));
    const res = await handle(req("/"), ENV, deps(queued.fetch));
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("30");
    expect(await isPage(res)).toContain("queued");
    expect(queued.calls).toHaveLength(1);
  });

  it("502 for a private origin, never fetching it", async () => {
    const m = mockFetch({ status: 200, body: { id: ID, state: "running", endpoint: "http://10.0.0.5:8080", kind: "container" } }, () => html("never"));
    const res = await handle(req("/"), ENV, deps(m.fetch));
    expect(res.status).toBe(502);
    expect(m.calls).toHaveLength(1);
  });

  it("503 when the origin fails or times out, and when the API is down", async () => {
    const down = mockFetch(running, () => Promise.reject(new DOMException("timeout", "TimeoutError")));
    const res = await handle(req("/"), ENV, deps(down.fetch));
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("30");
    expect(await isPage(res)).toContain("did not answer");

    const apiDown = mockFetch({ status: 500 }, () => html("never"));
    const r2 = await handle(req("/"), ENV, deps(apiDown.fetch, memCache()));
    expect(r2.status).toBe(503);
    expect(apiDown.calls).toHaveLength(1);
  });
});
