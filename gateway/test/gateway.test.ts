import { describe, it, expect, vi, beforeAll } from "vitest";
import { handle, deploymentIdFromHost, isPublicHttpEndpoint, ORIGIN_TIMEOUT_MS, RETRY_BODY_MAX, sha256Hex, STATIC_CACHE_MAX_BYTES, STATIC_CACHE_ORIGIN, STATIC_CACHE_TTL_SECONDS, type Deps, type Env } from "../src/index.js";

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

  it("refuses other methods on a static site, without touching the origin", async () => {
    const m = mockFetch(running, () => html(""));
    const res = await handle(req("/", { method: "POST" }), ENV, deps(m.fetch));
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
    expect(m.calls.map((c) => c.url)).toEqual([`${ENV.API_URL}/v1/deployments/${ID}/route`]); // the route says it is static
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

describe("relay", () => {
  const NODE_A = "0x" + "a".repeat(40);
  const NODE_B = "0x" + "b".repeat(40);
  const relayed = (kind: "static" | "container" | "endpoint", nodes = [NODE_A], extra: Record<string, unknown> = {}) => ({
    status: 200,
    body: { status: "success", id: ID, state: "running", kind, workstation: false, relayed: true, targets: nodes.map((node) => ({ node, dep: ID })), endpoint: null, ...extra },
  });
  /** Relay stubs per node; each records what it was asked. */
  function relays(answer: (node: string, init: RequestInit) => Response | Promise<Response>) {
    const asked: { node: string; init: RequestInit }[] = [];
    const relay = (node: string) => ({
      fetch: async (_u: string, init?: RequestInit) => {
        asked.push({ node, init: init ?? {} });
        return answer(node, init ?? {});
      },
    });
    return { relay, asked };
  }
  const relayErr = (code: string, status = 502) => new Response("{}", { status, headers: { "x-relay-error": code } });

  it("asks the serving node's relay with the deployment, class and path — and sends the internal key to the API", async () => {
    const m = mockFetch(relayed("static"), () => {
      throw new Error("no direct origin for a relayed site");
    });
    const r = relays(() => html("<h1>hi</h1>"));
    const res = await handle(req("/a/b?c=1"), { ...ENV, INTERNAL_API_KEY: "ik" }, { ...deps(m.fetch), relay: r.relay });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<h1>hi</h1>");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(new Headers(m.calls[0].init?.headers).get("x-internal-key")).toBe("ik");
    const h = new Headers(r.asked[0].init.headers);
    expect(r.asked[0].node).toBe(NODE_A);
    expect([h.get("x-relay-dep"), h.get("x-relay-class"), h.get("x-relay-path")]).toEqual([ID, "site", "/a/b?c=1"]);
  });

  it("passes every method, the body, cookies and auth to a container, and keeps its cookies host-only", async () => {
    const m = mockFetch(relayed("container"), () => new Response("x"));
    const r = relays(async (_n, init) => {
      expect(init.method).toBe("POST");
      const h = new Headers(init.headers);
      expect(h.get("authorization")).toBe("Bearer user-token");
      expect(h.get("cookie")).toBe("s=1");
      expect(h.get("x-relay-class")).toBe("endpoint");
      expect(await new Response(init.body).text()).toBe('{"prompt":"hi"}');
      return new Response("ok", { status: 201, headers: { "set-cookie": "sid=1; Domain=.example.run; Path=/", location: "http://127.0.0.1:8000/next" } });
    });
    const res = await handle(
      req("/v1/chat", { method: "POST", body: '{"prompt":"hi"}', headers: { authorization: "Bearer user-token", cookie: "s=1", "content-type": "application/json" } }, `${ID}.example.run`),
      { ...ENV, SITES_DOMAIN: "example.run" },
      { ...deps(m.fetch), relay: r.relay },
    );
    expect(res.status).toBe(201);
    expect(res.headers.get("set-cookie")).toBe("sid=1; Path=/");
    expect(res.headers.get("location")).toBe(`https://${ID}.example.run/next`);
    expect(res.headers.get("content-security-policy")).toBeNull();
  });

  it("tries the next node when one is offline or not serving: GET always, a small body once buffered, a large one never", async () => {
    const m = mockFetch(relayed("static", [NODE_A, NODE_B]), () => new Response("x"));
    const r = relays((node) => (node === NODE_A ? relayErr("offline", 503) : html("from b")));
    const res = await handle(req("/"), ENV, { ...deps(m.fetch), relay: r.relay });
    expect(await res.text()).toBe("from b");
    expect(r.asked.map((a) => a.node)).toEqual([NODE_A, NODE_B]);

    // A 1 KB POST is buffered: the second replica gets the same bytes after not_serving.
    const m2 = mockFetch(relayed("container", [NODE_A, NODE_B]), () => new Response("x"));
    const bodies: string[] = [];
    const r2 = relays(async (node, init) => {
      bodies.push(await new Response(init.body).text());
      return node === NODE_A ? relayErr("not_serving") : new Response("ok");
    });
    const post = await handle(req("/", { method: "POST", body: "x".repeat(1024), headers: { "content-length": "1024" } }), ENV, { ...deps(m2.fetch), relay: r2.relay });
    expect(post.status).toBe(200);
    expect(bodies).toEqual(["x".repeat(1024), "x".repeat(1024)]);

    // Over RETRY_BODY_MAX the body streams to one replica only.
    const m3 = mockFetch(relayed("container", [NODE_A, NODE_B]), () => new Response("x"));
    const r3 = relays(() => relayErr("not_serving"));
    const big = new Uint8Array(RETRY_BODY_MAX + 1);
    const large = await handle(req("/", { method: "POST", body: big, headers: { "content-length": String(big.length) } }), ENV, { ...deps(m3.fetch), relay: r3.relay });
    expect(large.status).toBe(503);
    expect(r3.asked).toHaveLength(1);
    // A timeout is never retried: the app may have done the work.
    const m4 = mockFetch(relayed("container", [NODE_A, NODE_B]), () => new Response("x"));
    const r4 = relays(() => relayErr("timeout", 504));
    expect((await handle(req("/"), ENV, { ...deps(m4.fetch), relay: r4.relay })).status).toBe(504);
    expect(r4.asked).toHaveLength(1);
  });

  it("maps relay errors to clear pages", async () => {
    for (const [code, status] of [["timeout", 504], ["too_large", 413], ["busy", 503]] as const) {
      const m = mockFetch(relayed("container"), () => new Response("x"));
      const r = relays(() => relayErr(code));
      expect((await handle(req("/"), ENV, { ...deps(m.fetch), relay: r.relay })).status).toBe(status);
    }
  });

  it("keeps a container sandboxed and cookie-less while user content shares the first-party domain", async () => {
    const m = mockFetch(relayed("container"), () => new Response("x"));
    let seen: Headers | null = null;
    const r = relays(async (_n, init) => {
      seen = new Headers(init.headers);
      return new Response("{}", { headers: { "content-type": "application/json", "set-cookie": "sid=1" } });
    });
    const env = { ...ENV, SITES_DOMAIN: "sites.cloudana.io" };
    const res = await handle(
      req("/v1/chat", { method: "POST", body: "{}", headers: { cookie: "s=1", authorization: "Bearer t", "content-type": "application/json" } }, `${ID}.sites.cloudana.io`),
      env,
      { ...deps(m.fetch), relay: r.relay },
    );
    expect(res.status).toBe(200);
    // An API call still works (type + the caller's own token), but cookies never cross, either way.
    expect(seen!.get("cookie")).toBeNull();
    expect(seen!.get("authorization")).toBe("Bearer t");
    expect(seen!.get("content-type")).toBe("application/json");
    expect(seen!.get("accept-encoding")).toBe("identity");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("strips Domain from cookies however it is spaced or cased", async () => {
    const { hostOnlyCookie } = await import("../src/index.js");
    expect(hostOnlyCookie("sid=1; Domain=.example.run; Path=/")).toBe("sid=1; Path=/");
    expect(hostOnlyCookie("sid=1; Domain =example.run; Secure")).toBe("sid=1; Secure");
    expect(hostOnlyCookie("sid=1;DOMAIN= x.run ;HttpOnly")).toBe("sid=1;HttpOnly");
    expect(hostOnlyCookie("domain=keep-the-name; Path=/")).toBe("domain=keep-the-name; Path=/"); // the cookie's own name stays
  });

  it("never rewrites a look-alike host in redirects", async () => {
    const m = mockFetch(relayed("container"), () => new Response("x"));
    const r = relays(() => new Response(null, { status: 302, headers: { location: "http://localhost.evil.test/x" } }));
    const res = await handle(req("/", {}, `${ID}.example.run`), { ...ENV, SITES_DOMAIN: "example.run" }, { ...deps(m.fetch), relay: r.relay });
    expect(res.headers.get("location")).toBe("http://localhost.evil.test/x");
  });

  describe("endpoints", () => {
    const KEY = "cld_ek_" + "ab".repeat(24);
    let hashOf: Record<string, string> = {};
    const hash = (k: string) => hashOf[k]!;
    beforeAll(async () => {
      hashOf = { [KEY]: await sha256Hex(KEY) };
    });
    const endpoint = (extra: Record<string, unknown> = {}, nodes = [NODE_A, NODE_B]) => relayed("endpoint", nodes, { auth: "key", keys: [hash(KEY)], ...extra });
    type Json = Record<string, any>;
    const RUN_ENV: Env = { ...ENV, SITES_DOMAIN: "example.run" };
    const ask = (init: RequestInit = {}, fixture = endpoint(), limiter?: Env["KEY_LIMIT"]) => {
      const m = mockFetch(fixture, () => new Response("x"));
      const r = relays(async (node, i) => {
        const h = new Headers(i.headers);
        return new Response(JSON.stringify({ node, dep: h.get("x-relay-dep"), auth: h.get("authorization") }), { headers: { "content-type": "application/json" } });
      });
      return { m, r, run: () => handle(req("/v1/chat/completions", init, `${ID}.example.run`), { ...RUN_ENV, KEY_LIMIT: limiter }, { ...deps(m.fetch), relay: r.relay }) };
    };
    const post = (headers: Record<string, string> = {}) => ({ method: "POST", body: "{}", headers: { "content-type": "application/json", ...headers } });

    it("needs a live key, answers JSON, and never forwards the Cloudana key", async () => {
      for (const headers of [{}, { authorization: "Bearer nope" }, { authorization: `Bearer ${KEY.replace("ab", "cd")}` }] as Record<string, string>[]) {
        const t = ask(post(headers));
        const res = await t.run();
        expect(res.status).toBe(401);
        expect(res.headers.get("www-authenticate")).toContain("Bearer");
        expect(((await res.json()) as Json).error.code).toBe("unauthorized");
        expect(t.r.asked).toHaveLength(0);
      }
      const t = ask(post({ authorization: `Bearer ${KEY}` }));
      const res = await t.run();
      expect(res.status).toBe(200);
      expect(((await res.json()) as Json).auth).toBeNull();
      // A revoked key (gone from the route) is refused.
      expect((await ask(post({ authorization: `Bearer ${KEY}` }), endpoint({ keys: [] })).run()).status).toBe(401);
    });

    it("passes the caller's own Authorization to a public endpoint", async () => {
      const t = ask(post({ authorization: "Bearer the-apps-own-token" }), endpoint({ auth: "public", keys: undefined }));
      expect(((await (await t.run()).json()) as Json).auth).toBe("Bearer the-apps-own-token");
    });

    it("rate-limits per key through the binding", async () => {
      const seen: string[] = [];
      const limiter = { limit: async ({ key }: { key: string }) => (seen.push(key), { success: seen.length < 3 }) };
      for (const expected of [200, 200, 429]) {
        const res = await ask(post({ authorization: `Bearer ${KEY}` }), endpoint(), limiter).run();
        expect(res.status).toBe(expected);
        if (expected === 429) {
          expect(res.headers.get("retry-after")).toBe("10");
          expect(((await res.json()) as Json).error.code).toBe("rate_limited");
        }
      }
      expect(new Set(seen)).toEqual(new Set([hash(KEY)]));
    });

    it("starts at a random replica, sends that replica's deployment id, and falls over to the other", async () => {
      const first = new Set<string>();
      for (let i = 0; i < 40 && first.size < 2; i++) {
        const t = ask(post({ authorization: `Bearer ${KEY}` }));
        const body = (await (await t.run()).json()) as Json;
        first.add(body.node);
        expect(body.dep).toBe(ID);
        expect(t.r.asked).toHaveLength(1);
      }
      expect(first).toEqual(new Set([NODE_A, NODE_B]));
      const m = mockFetch(endpoint({}, [NODE_A, NODE_B]), () => new Response("x"));
      const r = relays((node) => (node === NODE_A ? relayErr("offline", 503) : new Response("from b")));
      const res = await handle(req("/v1/chat/completions", post({ authorization: `Bearer ${KEY}` }), `${ID}.example.run`), RUN_ENV, { ...deps(m.fetch), relay: r.relay });
      expect(await res.text()).toBe("from b");
    });

    it("answers JSON when no replica runs or none can take the request", async () => {
      for (const [state, status, code] of [["assigned", 503, "unavailable"], ["stopped", 404, "not_found"]] as const) {
        const m = mockFetch({ status: 200, body: { ...endpoint().body, state, targets: [] } }, () => new Response("x"));
        const res = await handle(req("/", post({ authorization: `Bearer ${KEY}` }), `${ID}.example.run`), RUN_ENV, { ...deps(m.fetch), relay: () => null });
        expect(res.status).toBe(status);
        expect(res.headers.get("content-type")).toBe("application/json");
        expect(((await res.json()) as Json).error).toMatchObject({ code, state });
      }
      const m = mockFetch(endpoint(), () => new Response("x"));
      const r = relays(() => relayErr("busy"));
      const res = await handle(req("/", post({ authorization: `Bearer ${KEY}` }), `${ID}.example.run`), RUN_ENV, { ...deps(m.fetch), relay: r.relay });
      expect(res.status).toBe(503);
      expect(((await res.json()) as Json).error).toEqual({ code: "unavailable", message: expect.any(String), relay: "busy" });
      expect(r.asked).toHaveLength(2);
    });
  });

  it("tells a separate user-content domain from the first-party one", async () => {
    const { isolatedContentDomain } = await import("../src/index.js");
    expect(isolatedContentDomain({ SITES_DOMAIN: "cloudana.run" })).toBe(true);
    expect(isolatedContentDomain({ SITES_DOMAIN: "sites.cloudana.io" })).toBe(false);
    expect(isolatedContentDomain({ SITES_DOMAIN: "cloudana.io" })).toBe(false);
    expect(isolatedContentDomain({ SITES_DOMAIN: "evilcloudana.io" })).toBe(true);
  });

  it("is 503 when no relay is bound or nothing serves it yet", async () => {
    const m = mockFetch(relayed("static"), () => new Response("x"));
    expect((await handle(req("/"), ENV, deps(m.fetch))).status).toBe(503);
    const m2 = mockFetch(relayed("static", []), () => new Response("x"));
    expect((await handle(req("/"), ENV, deps(m2.fetch))).status).toBe(503);
  });
});

describe("static site cache (B-21)", () => {
  const NODE = "0x" + "c".repeat(40);
  const relayedStatic = (extra: Record<string, unknown> = {}) => ({
    status: 200,
    body: { status: "success", id: ID, state: "running", kind: "static", workstation: false, relayed: true, targets: [{ node: NODE, dep: ID }], endpoint: null, ...extra },
  });
  const page = (body: string, headers: Record<string, string> = {}) =>
    new Response(body, { headers: { "content-type": "text/html; charset=utf-8", "content-length": String(Buffer.byteLength(body)), etag: "\"v1\"", ...headers } });
  function relayStub(answer: (init: RequestInit) => Response) {
    const asked: RequestInit[] = [];
    return { asked, relay: () => ({ fetch: async (_u: string, init?: RequestInit) => { asked.push(init ?? {}); return answer(init ?? {}); } }) };
  }
  const noOrigin = () => { throw new Error("no direct origin for a relayed site"); };
  const relayPath = (init: RequestInit) => new Headers(init.headers).get("x-relay-path") ?? "";

  it("a hit per path while the route says running, with the gateway headers; the put runs off the request path", async () => {
    const cache = memCache();
    const waits: Promise<unknown>[] = [];
    const m = mockFetch(relayedStatic(), noOrigin);
    const r = relayStub((init) => page(`<h1>${relayPath(init)}</h1>`));
    const d: Deps = { ...deps(m.fetch, cache), relay: r.relay, waitUntil: (p) => void waits.push(p) };
    const first = await handle(req("/a"), ENV, d);
    expect(first.status).toBe(200);
    expect(first.headers.get("x-cloudana-cache")).toBe("miss");
    expect(await first.text()).toBe("<h1>/a</h1>");
    await Promise.all(waits);
    const second = await handle(req("/a"), ENV, d);
    expect(second.headers.get("x-cloudana-cache")).toBe("hit");
    expect(second.headers.get("content-security-policy")).toContain("sandbox");
    expect(second.headers.get("etag")).toBe("\"v1\"");
    expect(await second.text()).toBe("<h1>/a</h1>");
    expect(r.asked).toHaveLength(1);
    expect((await handle(req("/b?x=1"), ENV, d)).headers.get("x-cloudana-cache")).toBe("miss");
    await Promise.all(waits);
    expect(r.asked).toHaveLength(2);
    expect([...cache.store.keys()].filter((k) => k.startsWith(STATIC_CACHE_ORIGIN))).toEqual([`${STATIC_CACHE_ORIGIN}/${ID}/a`, `${STATIC_CACHE_ORIGIN}/${ID}/b?x=1`]);
    expect(cache.store.get(`${STATIC_CACHE_ORIGIN}/${ID}/a`)!.headers.get("cache-control")).toBe(`public, max-age=${STATIC_CACHE_TTL_SECONDS}`);
  });

  it("not cached: HEAD, Range, non-200, a body without or over the size cap, containers, legacy direct origins", async () => {
    const cache = memCache();
    const m = mockFetch(relayedStatic(), noOrigin);
    const r = relayStub((init) => {
      const p = relayPath(init);
      if (p === "/missing") return new Response("no", { status: 404 });
      if (p === "/nolen") return new Response("x", { headers: { "content-type": "text/plain" } });
      if (p === "/big") return page("x", { "content-length": String(STATIC_CACHE_MAX_BYTES + 1) });
      return page("ok");
    });
    const d: Deps = { ...deps(m.fetch, cache), relay: r.relay };
    expect((await handle(req("/", { method: "HEAD" }), ENV, d)).status).toBe(200);
    await handle(req("/", { headers: { range: "bytes=0-1" } }), ENV, d);
    await handle(req("/missing"), ENV, d);
    await handle(req("/nolen"), ENV, d);
    await handle(req("/big"), ENV, d);
    expect([...cache.store.keys()].filter((k) => k.startsWith(STATIC_CACHE_ORIGIN))).toEqual([]);
    // Other routes (their own caches: the route above is cached 30 s under this id).
    const containerCache = memCache();
    const c = mockFetch(relayedStatic({ kind: "container" }), noOrigin);
    expect((await handle(req("/"), ENV, { ...deps(c.fetch, containerCache), relay: r.relay })).status).toBe(200);
    expect([...containerCache.store.keys()].filter((k) => k.startsWith(STATIC_CACHE_ORIGIN))).toEqual([]);
    const directCache = memCache();
    const direct = mockFetch(running, () => page("direct"));
    const res = await handle(req("/"), ENV, deps(direct.fetch, directCache));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-cloudana-cache")).toBeNull();
    expect([...directCache.store.keys()].filter((k) => k.startsWith(STATIC_CACHE_ORIGIN))).toEqual([]);
  });

  it("the route is checked before the cache: a site that stopped is not served from it", async () => {
    const cache = memCache();
    const r = relayStub(() => page("v1"));
    const m = mockFetch(relayedStatic(), noOrigin);
    expect((await handle(req("/"), ENV, { ...deps(m.fetch, cache), relay: r.relay })).status).toBe(200);
    // Drop the cached route (its 30 s would otherwise still say running) and keep the cached page.
    for (const k of [...cache.store.keys()]) if (k.startsWith(ENV.API_URL!)) cache.store.delete(k);
    const stopped = mockFetch(relayedStatic({ state: "stopped" }), noOrigin);
    const res = await handle(req("/"), ENV, { ...deps(stopped.fetch, cache), relay: r.relay });
    expect(res.status).toBe(404);
    expect(r.asked).toHaveLength(1);
  });
});
