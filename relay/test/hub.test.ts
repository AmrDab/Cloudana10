import { describe, it, expect, vi } from "vitest";
import { StreamHub } from "../src/hub.js";
import { HEAD_TIMEOUT_MS, MAX_FRAME_BYTES, MAX_STREAMS, PROBE_SLOTS, WINDOW_BYTES, decodeData, encodeData, parseHubMessage, type HubMessage } from "../../shared/relay-protocol.js";

/** A hub wired to a scripted fake node: `sent` collects everything the hub sends. */
function setup() {
  const sent: (string | Uint8Array)[] = [];
  let offline = false;
  const hub = new StreamHub((m) => {
    if (offline) throw new Error("socket closed");
    sent.push(m);
  });
  const ctl = () => sent.filter((m): m is string => typeof m === "string").map((m) => parseHubMessage(m)!) as HubMessage[];
  const data = () => sent.filter((m): m is Uint8Array => typeof m !== "string").map((f) => decodeData(f)!);
  const node = (m: object) => hub.onMessage(JSON.stringify(m));
  return { hub, sent, ctl, data, node, goOffline: () => (offline = true) };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const body = (bytes: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes);
      c.close();
    },
  });

describe("StreamHub", () => {
  it("gives a storage check (class storage) 15 s for the head, then fails it with timeout", async () => {
    vi.useFakeTimers();
    try {
      const { hub } = setup();
      const p = hub.proxy({ dep: "storage", cls: "storage", probe: true, method: "GET", path: "/proof?copy=c1&i=0", headers: [], body: null });
      expect(HEAD_TIMEOUT_MS.storage).toBe(15_000);
      await vi.advanceTimersByTimeAsync(14_999);
      let settled = false;
      void p.then(() => (settled = true));
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      const res = await p;
      expect(res.headers.get("x-relay-error")).toBe("timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends req + body + end, and streams the node's response back", async () => {
    const { hub, ctl, data, node } = setup();
    const p = hub.proxy({ dep: "d1", cls: "endpoint", method: "POST", path: "/v1/x?a=1", headers: [["Content-Type", "application/json"], ["Host", "h"]], body: body(new TextEncoder().encode('{"q":1}')) });
    await tick();
    const [req] = ctl();
    expect(req).toEqual({ t: "req", s: 1, dep: "d1", m: "POST", path: "/v1/x?a=1", h: [["content-type", "application/json"]] });
    expect(new TextDecoder().decode(data()[0].data)).toBe('{"q":1}');
    expect(ctl()[1]).toEqual({ t: "end", s: 1 });

    node({ t: "res", s: 1, status: 201, h: [["content-type", "text/plain"], ["x-a", "b"]] });
    const res = await p;
    expect(res.status).toBe(201);
    expect(res.headers.get("x-a")).toBe("b");
    const reader = res.body!.getReader();
    hub.onMessage(encodeData(1, new TextEncoder().encode("hel")));
    hub.onMessage(encodeData(1, new TextEncoder().encode("lo")));
    const got = [new TextDecoder().decode((await reader.read()).value), new TextDecoder().decode((await reader.read()).value)];
    expect(got.join("")).toBe("hello");
    await tick();
    // Bytes are acked once the client has taken them, so the node can keep sending.
    expect(ctl().filter((m) => m.t === "ack").reduce((n, m) => n + (m as { n: number }).n, 0)).toBe(5);
    node({ t: "end", s: 1 });
    expect((await reader.read()).done).toBe(true);
    expect(hub.open).toBe(0);
  });

  it("maps a node error before the head to a relay error the gateway can act on", async () => {
    const { hub, node } = setup();
    const p = hub.proxy({ dep: "d1", cls: "site", method: "GET", path: "/", headers: [], body: null });
    await tick();
    node({ t: "err", s: 1, code: "not_serving" });
    const res = await p;
    expect(res.status).toBe(502);
    expect(res.headers.get("x-relay-error")).toBe("not_serving");
  });

  it("returns 503 offline when the socket is gone, and fails open streams when it closes", async () => {
    const a = setup();
    a.goOffline();
    const r1 = await a.hub.proxy({ dep: "d1", cls: "site", method: "GET", path: "/", headers: [], body: null });
    expect(r1.headers.get("x-relay-error")).toBe("offline");

    const b = setup();
    const p = b.hub.proxy({ dep: "d1", cls: "site", method: "GET", path: "/", headers: [], body: null });
    await tick();
    b.hub.onClose();
    expect((await p).headers.get("x-relay-error")).toBe("offline");
  });

  it("caps visitor streams at MAX_STREAMS − PROBE_SLOTS and keeps the rest for probes", async () => {
    const { hub } = setup();
    for (let i = 0; i < MAX_STREAMS - PROBE_SLOTS; i++) void hub.proxy({ dep: `d${i % 8}`, cls: "site", method: "GET", path: "/", headers: [], body: null });
    await tick();
    const extra = await hub.proxy({ dep: "d", cls: "site", method: "GET", path: "/", headers: [], body: null });
    expect(extra.headers.get("x-relay-error")).toBe("busy");
    for (let i = 0; i < PROBE_SLOTS; i++) void hub.proxy({ dep: "d0", cls: "site", method: "GET", path: "/", headers: [], body: null, probe: true });
    await tick();
    expect(hub.open).toBe(MAX_STREAMS);
    const third = await hub.proxy({ dep: "d0", cls: "site", method: "GET", path: "/", headers: [], body: null, probe: true });
    expect(third.headers.get("x-relay-error")).toBe("busy"); // the node is full even for probes
  });

  it("lets a probe past a deployment's full per-app cap", async () => {
    const { hub } = setup();
    for (let i = 0; i < 16; i++) void hub.proxy({ dep: "busy-app", cls: "endpoint", method: "GET", path: "/sse", headers: [], body: null });
    await tick();
    expect((await hub.proxy({ dep: "busy-app", cls: "endpoint", method: "GET", path: "/", headers: [], body: null })).headers.get("x-relay-error")).toBe("busy");
    void hub.proxy({ dep: "busy-app", cls: "endpoint", method: "GET", path: "/health", headers: [], body: null, probe: true });
    await tick();
    expect(hub.open).toBe(17);
  });

  it("refuses request bodies over the class cap with 413 and cancels the stream", async () => {
    const { hub, ctl } = setup();
    // Declared too large: refused before anything is sent.
    const declared = await hub.proxy({ dep: "d", cls: "site", method: "POST", path: "/", headers: [["content-length", String(1024 * 1024 + 1)]], body: body(new Uint8Array(8)) });
    expect(declared.status).toBe(413);
    expect(ctl()).toEqual([]);
    // Streamed without a length: cut off when it crosses the cap (the node keeps acking).
    const p = hub.proxy({ dep: "d", cls: "site", method: "POST", path: "/", headers: [], body: body(new Uint8Array(1024 * 1024 + 1)) });
    const acker = setInterval(() => hub.onMessage(JSON.stringify({ t: "ack", s: 1, n: 1024 * 1024 })), 1);
    const res = await p;
    clearInterval(acker);
    expect(res.status).toBe(413);
    expect(ctl().some((m) => m.t === "cancel")).toBe(true);
  });

  it("holds request bytes at the 512 KiB window until the node acks", async () => {
    const { hub, data, node } = setup();
    void hub.proxy({ dep: "d", cls: "endpoint", method: "POST", path: "/", headers: [], body: body(new Uint8Array(WINDOW_BYTES + 3 * MAX_FRAME_BYTES)) });
    await new Promise((r) => setTimeout(r, 20));
    const sentBytes = () => data().reduce((n, f) => n + f.data.byteLength, 0);
    expect(sentBytes()).toBe(WINDOW_BYTES);
    node({ t: "ack", s: 1, n: 2 * MAX_FRAME_BYTES });
    await new Promise((r) => setTimeout(r, 20));
    expect(sentBytes()).toBe(WINDOW_BYTES + 2 * MAX_FRAME_BYTES);
  });

  it("tells the node to cancel when the client goes away mid-response", async () => {
    const { hub, ctl, node } = setup();
    const p = hub.proxy({ dep: "d", cls: "endpoint", method: "GET", path: "/stream", headers: [], body: null });
    await tick();
    node({ t: "res", s: 1, status: 200, h: [["content-type", "text/event-stream"]] });
    const res = await p;
    hub.onMessage(encodeData(1, new TextEncoder().encode("data: 1\n\n")));
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    await new Promise((r) => setTimeout(r, 10));
    expect(ctl().some((m) => m.t === "cancel" && m.s === 1)).toBe(true);
    expect(hub.open).toBe(0);
  });

  it("returns body-less responses and HEAD without a body", async () => {
    const { hub, node } = setup();
    const p = hub.proxy({ dep: "d", cls: "site", method: "GET", path: "/", headers: [], body: null });
    await tick();
    node({ t: "res", s: 1, status: 304, h: [["etag", '"x"']] });
    const res = await p;
    expect(res.status).toBe(304);
    expect(res.body).toBeNull();
  });

  it("ignores frames for unknown streams and garbage", () => {
    const { hub } = setup();
    expect(() => {
      hub.onMessage(encodeData(99, new Uint8Array([1])));
      hub.onMessage("not json");
      hub.onMessage('{"t":"res","s":5,"status":200,"h":[]}');
    }).not.toThrow();
  });
});

describe("StreamHub request limits (review fixes)", () => {
  it("refuses at once what the agent can't parse — never a slot held until the head timeout", async () => {
    const { hub, ctl } = setup();
    const long = await hub.proxy({ dep: "d", cls: "site", method: "GET", path: "/" + "a".repeat(9000), headers: [], body: null });
    expect([long.status, long.headers.get("x-relay-error")]).toEqual([400, "bad_request"]);
    const verb = await hub.proxy({ dep: "d", cls: "endpoint", method: "PROPFIND", path: "/", headers: [], body: null });
    expect(verb.status).toBe(400);
    const many = await hub.proxy({ dep: "d", cls: "site", method: "GET", path: "/", headers: Array.from({ length: 200 }, (_, i) => [`x-h${i}`, "v"] as [string, string]), body: null });
    expect(many.status).toBe(400);
    const huge = await hub.proxy({ dep: "d", cls: "site", method: "GET", path: "/", headers: [["x-big", "v".repeat(70_000)]], body: null });
    expect(huge.status).toBe(400);
    expect(ctl()).toEqual([]);
    expect(hub.open).toBe(0);
  });

  it("caps streams per deployment so one app can't take every slot on the node", async () => {
    const { hub } = setup();
    for (let i = 0; i < 16; i++) void hub.proxy({ dep: "hog", cls: "endpoint", method: "GET", path: "/sse", headers: [], body: null });
    await tick();
    const hog = await hub.proxy({ dep: "hog", cls: "endpoint", method: "GET", path: "/sse", headers: [], body: null });
    expect(hog.headers.get("x-relay-error")).toBe("busy");
    void hub.proxy({ dep: "other", cls: "site", method: "GET", path: "/", headers: [], body: null });
    await tick();
    expect(hub.open).toBe(17); // another tenant still gets through
  });

  it("keeps the request Content-Length for the app", async () => {
    const { hub, ctl } = setup();
    void hub.proxy({ dep: "d", cls: "endpoint", method: "POST", path: "/", headers: [["content-length", "3"]], body: body(new Uint8Array(3)) });
    await tick();
    const req = ctl()[0] as { h: [string, string][] };
    expect(req.h).toContainEqual(["content-length", "3"]);
  });
});
