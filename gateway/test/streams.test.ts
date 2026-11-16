// Byte streams at the gateway (docs/V4_RELAY_CONTRACT.md "Byte streams"): /_cld/ssh auth through the API, and
// WebSocket passthrough to relayed containers. The relay object is a stub; Node cannot build a 101 Response, so the
// stub's "upgrade accepted" answer is a 200 the gateway must pass through untouched.
import { describe, it, expect, vi } from "vitest";
import { handle, sshCredential, SSH_PATH, type Deps, type Env } from "../src/index.js";

const ID = "6f1c2a3e-1111-4222-8333-444455556666";
const ENV: Env = { API_URL: "https://api.example.test", SITES_DOMAIN: "sites.example.test", INTERNAL_API_KEY: "ik" };
const NODE = "0x" + "a".repeat(40);
const KEY = "cld_sk_" + "1".repeat(48);

type Call = { url: string; init?: RequestInit };

/** The API: /ssh answers `ssh`, /route answers `route`. */
function api(ssh: { status: number; body: unknown }, route: { status: number; body: unknown } = { status: 404, body: {} }) {
  const calls: Call[] = [];
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const r = url.endsWith("/ssh") ? ssh : route;
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}

function relays(answer: () => Response = () => new Response("upgraded", { status: 200, headers: { "x-test": "from-relay" } })) {
  const asked: { node: string; url: string; headers: Headers }[] = [];
  const relay = (node: string) => ({
    fetch: async (url: string, init?: RequestInit) => {
      asked.push({ node, url, headers: new Headers(init?.headers) });
      return answer();
    },
  });
  return { relay, asked };
}

const wsReq = (path: string, headers: Record<string, string> = {}) =>
  new Request(`https://${ID}.sites.example.test${path}`, {
    headers: { host: `${ID}.sites.example.test`, upgrade: "websocket", connection: "Upgrade", "sec-websocket-key": "k", "sec-websocket-version": "13", ...headers },
  });
const target = { status: 200, body: { status: "success", target: { node: NODE, dep: ID } } };
const deps = (f: typeof fetch, relay: Deps["relay"]): Deps => ({ fetch: f, cache: null, relay });

describe("SSH through the relay (/_cld/ssh)", () => {
  it("asks the API with the visitor's key and the internal key, then opens a raw ssh stream on the named node", async () => {
    const a = api(target);
    const r = relays();
    const res = await handle(wsReq(SSH_PATH, { authorization: `Bearer ${KEY}`, "sec-websocket-protocol": "cloudana-tcp.v1" }), ENV, deps(a.fetch, r.relay));
    expect(res.headers.get("x-test")).toBe("from-relay"); // the relay's answer, untouched
    expect(a.calls).toHaveLength(1);
    expect(a.calls[0].url).toBe(`https://api.example.test/v1/deployments/${ID}/ssh`);
    expect(a.calls[0].init?.method).toBe("POST");
    const h = new Headers(a.calls[0].init?.headers);
    expect([h.get("authorization"), h.get("x-internal-key")]).toEqual([`Bearer ${KEY}`, "ik"]);
    expect(r.asked).toHaveLength(1);
    const rh = r.asked[0].headers;
    expect([r.asked[0].node, r.asked[0].url]).toEqual([NODE, "https://relay/stream"]);
    expect([rh.get("upgrade"), rh.get("x-relay-dep"), rh.get("x-relay-port"), rh.get("x-relay-mode"), rh.get("sec-websocket-protocol")]).toEqual(["websocket", ID, "ssh", "raw", "cloudana-tcp.v1"]);
    // The credential never travels on to the relay or the node.
    expect(rh.get("authorization")).toBeNull();
  });

  it("takes the token from a `bearer.` subprotocol and never forwards it", async () => {
    const a = api(target);
    const r = relays();
    await handle(wsReq(SSH_PATH, { "sec-websocket-protocol": `cloudana-tcp.v1, bearer.${KEY}` }), ENV, deps(a.fetch, r.relay));
    expect(new Headers(a.calls[0].init?.headers).get("authorization")).toBe(`Bearer ${KEY}`);
    expect(r.asked[0].headers.get("sec-websocket-protocol")).toBe("cloudana-tcp.v1");
    expect(sshCredential(wsReq(SSH_PATH, { "sec-websocket-protocol": "a, bearer.t0k" }))).toEqual({ token: "t0k", protocols: ["a"] });
  });

  it("refuses without a token, and without a WebSocket, before asking anyone", async () => {
    const a = api(target);
    const r = relays();
    const none = await handle(wsReq(SSH_PATH), ENV, deps(a.fetch, r.relay));
    expect(none.status).toBe(401);
    const plain = await handle(new Request(`https://${ID}.sites.example.test${SSH_PATH}`, { headers: { host: `${ID}.sites.example.test`, authorization: `Bearer ${KEY}` } }), ENV, deps(a.fetch, r.relay));
    expect(plain.status).toBe(426);
    expect(a.calls).toHaveLength(0);
    expect(r.asked).toHaveLength(0);
  });

  it("passes the API's refusal on (not the owner → 404, bad key → 401, wrong scope → 403, not relayed → 409) and opens nothing", async () => {
    for (const status of [401, 403, 404, 409]) {
      const a = api({ status, body: { status: "error", error: { code: "x", message: `refused ${status}` } } });
      const r = relays();
      const res = await handle(wsReq(SSH_PATH, { authorization: `Bearer ${KEY}` }), ENV, deps(a.fetch, r.relay));
      expect(res.status).toBe(status);
      expect(((await res.json()) as { error: { message: string } }).error.message).toBe(`refused ${status}`);
      expect(r.asked).toHaveLength(0);
    }
    const down = api({ status: 500, body: {} });
    expect((await handle(wsReq(SSH_PATH, { authorization: `Bearer ${KEY}` }), ENV, deps(down.fetch, relays().relay))).status).toBe(503);
  });

  it("maps relay errors: offline → 503, refused → 403, timeout → 504", async () => {
    for (const [code, status] of [["offline", 503], ["refused", 403], ["timeout", 504], ["busy", 503]] as const) {
      const r = relays(() => new Response("{}", { status: 502, headers: { "x-relay-error": code } }));
      const res = await handle(wsReq(SSH_PATH, { authorization: `Bearer ${KEY}` }), ENV, deps(api(target).fetch, r.relay));
      expect(res.status, code).toBe(status);
    }
  });
});

describe("WebSocket passthrough", () => {
  const route = (extra: Record<string, unknown>) => ({
    status: 200,
    body: { status: "success", id: ID, state: "running", kind: "container", workstation: true, relayed: true, targets: [{ node: NODE, dep: ID }], endpoint: null, ...extra },
  });

  it("opens a ws stream to the web port with the visitor's path, cookies and subprotocols on a relay-streams node", async () => {
    const a = api(target, route({ streams: true }));
    const r = relays();
    const env = { ...ENV, SITES_DOMAIN: "sites.example.test", FIRST_PARTY_DOMAIN: "example.com" };
    const res = await handle(wsReq("/api/kernels/k/channels?s=1", { cookie: "_xsrf=1", origin: `https://${ID}.sites.example.test`, "sec-websocket-protocol": "v1.kernel" }), env, deps(a.fetch, r.relay));
    expect(res.headers.get("x-test")).toBe("from-relay");
    const h = r.asked[0].headers;
    expect([h.get("x-relay-mode"), h.get("x-relay-port"), h.get("x-relay-path"), h.get("x-relay-dep")]).toEqual(["ws", "web", "/api/kernels/k/channels?s=1", ID]);
    expect([h.get("cookie"), h.get("sec-websocket-protocol"), h.get("x-forwarded-host"), h.get("upgrade")]).toEqual(["_xsrf=1", "v1.kernel", `${ID}.sites.example.test`, "websocket"]);
  });

  it("keeps cookies out while user content shares the first-party domain", async () => {
    const r = relays();
    const env = { ...ENV, FIRST_PARTY_DOMAIN: "example.test" }; // sites.example.test is under it: not isolated
    await handle(wsReq("/ws", { cookie: "session=1", "sec-websocket-protocol": "p1" }), env, deps(api(target, route({ streams: true })).fetch, r.relay));
    expect(r.asked[0].headers.get("cookie")).toBeNull();
    expect([r.asked[0].headers.get("x-relay-mode"), r.asked[0].headers.get("sec-websocket-protocol")]).toEqual(["ws", "p1"]);
  });

  it("sends an upgrade as an ordinary request when the node lacks relay-streams, and never upgrades sites or endpoints", async () => {
    for (const extra of [{}, { kind: "static", workstation: false, streams: true }, { kind: "endpoint", workstation: false, streams: true }]) {
      const r = relays(() => new Response("plain", { status: 200 }));
      await handle(wsReq("/ws"), ENV, deps(api(target, route(extra)).fetch, r.relay));
      expect(r.asked[0].url, JSON.stringify(extra)).toBe("https://relay/proxy");
    }
  });

  it("maps a relay refusal to an error page", async () => {
    const r = relays(() => new Response("{}", { status: 503, headers: { "x-relay-error": "offline" } }));
    const res = await handle(wsReq("/ws"), ENV, deps(api(target, route({ streams: true })).fetch, r.relay));
    expect(res.status).toBe(503);
  });
});
