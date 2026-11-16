// Byte streams on the hub (docs/V4_RELAY_CONTRACT.md "Byte streams"): lifecycle, window, limits, and the two bridges
// (raw for SSH, WebSocket passthrough) against a scripted node.
import { describe, it, expect, vi } from "vitest";
import { StreamHub, STREAM_BUFFER_BYTES } from "../src/hub.js";
import { FrameReader, RawBridge, WsBridge, acceptKey, closeCode, encodeFrame, type Peer } from "../src/bridge.js";
import {
  LINGER_MS,
  MAX_STREAMS,
  MAX_TCP_STREAMS,
  MAX_TCP_STREAMS_PER_DEP,
  OPEN_TIMEOUT_MS,
  PROBE_SLOTS,
  TCP_IDLE_TIMEOUT_MS,
  WINDOW_BYTES,
  decodeData,
  encodeData,
  parseHubMessage,
  type HubMessage,
} from "../../shared/relay-protocol.js";

function setup() {
  const sent: (string | Uint8Array)[] = [];
  const hub = new StreamHub((m) => sent.push(m));
  const ctl = () => sent.filter((m): m is string => typeof m === "string").map((m) => parseHubMessage(m)!) as HubMessage[];
  const data = () => sent.filter((m): m is Uint8Array => typeof m !== "string").map((f) => decodeData(f)!);
  const bytesTo = (s: number) => Buffer.concat(data().filter((f) => f.s === s).map((f) => f.data));
  const node = (m: object) => hub.onMessage(JSON.stringify(m));
  const nodeData = (s: number, b: Uint8Array) => hub.onMessage(encodeData(s, b));
  return { hub, sent, ctl, data, bytesTo, node, nodeData };
}

function fakePeer() {
  const got: (string | Uint8Array)[] = [];
  let closed: { code: number; reason: string } | null = null;
  const peer: Peer = { send: (d) => got.push(d), close: (code, reason) => (closed = { code, reason }) };
  return { peer, got, closed: () => closed };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("byte streams on the hub", () => {
  it("opens to a port class, waits for `opened`, then carries bytes both ways and ends cleanly", async () => {
    const { hub, ctl, bytesTo, node, nodeData } = setup();
    const st = hub.openStream("ws-1", "ssh");
    expect(ctl()[0]).toEqual({ t: "open", s: 1, dep: "ws-1", port: "ssh" });
    st.write(new TextEncoder().encode("early")); // held until opened
    expect(bytesTo(1).length).toBe(0);
    node({ t: "opened", s: 1 });
    expect(await st.opened).toBeNull();
    expect(bytesTo(1).toString()).toBe("early");

    const got: string[] = [];
    let closed: unknown = "open";
    st.onData = (d) => got.push(new TextDecoder().decode(d));
    st.onClose = (e) => (closed = e);
    nodeData(1, new TextEncoder().encode("SSH-2.0-OpenSSH"));
    expect(got).toEqual(["SSH-2.0-OpenSSH"]);
    st.ack(15);
    expect(ctl()).toContainEqual({ t: "ack", s: 1, n: 15 });

    st.end();
    expect(ctl().at(-1)).toEqual({ t: "end", s: 1 });
    expect(closed).toBe("open");
    node({ t: "end", s: 1 });
    expect(closed).toBeNull();
    expect(hub.open).toBe(0);
  });

  it("settles `opened` with the node's refusal for an undeclared port, and frees the slot", async () => {
    const { hub, node } = setup();
    const st = hub.openStream("box-1", "ssh");
    node({ t: "err", s: 1, code: "refused" });
    expect(await st.opened).toBe("refused");
    expect(hub.open).toBe(0);
  });

  it("times out an open the node never answers, and cancels it there", async () => {
    vi.useFakeTimers();
    try {
      const { hub, ctl } = setup();
      const st = hub.openStream("ws-1", "ssh");
      await vi.advanceTimersByTimeAsync(OPEN_TIMEOUT_MS + 1);
      expect(await st.opened).toBe("timeout");
      expect(ctl().at(-1)).toEqual({ t: "cancel", s: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("holds bytes at the 512 KiB window until the node acks, and refuses past the buffer", async () => {
    const { hub, bytesTo, node } = setup();
    const st = hub.openStream("ws-1", "ssh");
    node({ t: "opened", s: 1 });
    await st.opened;
    let acked = 0;
    st.onAck = (n) => (acked += n);
    expect(st.write(new Uint8Array(WINDOW_BYTES + 100_000))).toBe(true);
    expect(bytesTo(1).length).toBe(WINDOW_BYTES);
    node({ t: "ack", s: 1, n: 200_000 });
    expect(acked).toBe(200_000);
    expect(bytesTo(1).length).toBe(WINDOW_BYTES + 100_000);

    let closed: unknown = "open";
    st.onClose = (e) => (closed = e);
    expect(st.write(new Uint8Array(STREAM_BUFFER_BYTES + 1))).toBe(false);
    expect(closed).toBe("too_large");
  });

  it("closes a stream whose node sends past the window (it is not speaking the protocol)", async () => {
    const { hub, ctl, node, nodeData } = setup();
    const st = hub.openStream("ws-1", "ssh");
    node({ t: "opened", s: 1 });
    await st.opened;
    let closed: unknown = "open";
    st.onClose = (e) => (closed = e);
    for (let i = 0; i < 8; i++) nodeData(1, new Uint8Array(64 * 1024));
    expect(closed).toBe("open");
    nodeData(1, new Uint8Array(1));
    expect(closed).toBe("upstream");
    expect(ctl().at(-1)).toEqual({ t: "cancel", s: 1 });
  });

  it("caps byte streams per deployment and per node, inside the visitor slots", async () => {
    const { hub } = setup();
    for (let i = 0; i < MAX_TCP_STREAMS_PER_DEP; i++) hub.openStream("ws-1", "ssh");
    expect(await hub.openStream("ws-1", "ssh").opened).toBe("busy");
    for (let i = MAX_TCP_STREAMS_PER_DEP; i < MAX_TCP_STREAMS; i++) hub.openStream(`ws-${i}`, "web");
    expect(await hub.openStream("other", "web").opened).toBe("busy");
    expect(hub.open).toBe(MAX_TCP_STREAMS);
    // HTTP and byte streams share MAX_STREAMS − PROBE_SLOTS for visitors.
    expect(MAX_TCP_STREAMS).toBeLessThan(MAX_STREAMS - PROBE_SLOTS);
  });

  it("cancels after the idle timeout, and after LINGER_MS when the node never ends its half", async () => {
    vi.useFakeTimers();
    try {
      const { hub, node, ctl } = setup();
      const a = hub.openStream("ws-1", "ssh");
      node({ t: "opened", s: 1 });
      await a.opened;
      let aClosed: unknown = "open";
      a.onClose = (e) => (aClosed = e);
      await vi.advanceTimersByTimeAsync(TCP_IDLE_TIMEOUT_MS - 1000);
      expect(aClosed).toBe("open");
      await vi.advanceTimersByTimeAsync(2000);
      expect(aClosed).toBe("timeout");

      const b = hub.openStream("ws-1", "ssh");
      node({ t: "opened", s: 2 });
      await b.opened;
      let bClosed: unknown = "open";
      b.onClose = (e) => (bClosed = e);
      b.end();
      await vi.advanceTimersByTimeAsync(LINGER_MS + 1);
      expect(bClosed).toBe("timeout");
      expect(ctl().at(-1)).toEqual({ t: "cancel", s: 2 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails every byte stream when the node's socket closes", async () => {
    const { hub, node } = setup();
    const a = hub.openStream("ws-1", "ssh");
    const b = hub.openStream("ws-1", "ssh");
    node({ t: "opened", s: 1 });
    await a.opened;
    let closed: unknown = "open";
    a.onClose = (e) => (closed = e);
    hub.onClose();
    expect(closed).toBe("offline");
    expect(await b.opened).toBe("offline");
    expect(hub.open).toBe(0);
  });
});

describe("RawBridge (SSH)", () => {
  async function opened() {
    const t = setup();
    const st = t.hub.openStream("ws-1", "ssh");
    t.node({ t: "opened", s: 1 });
    await st.opened;
    const p = fakePeer();
    const bridge = new RawBridge(st, p.peer);
    return { ...t, st, bridge, ...p };
  }

  it("passes bytes and acks end to end", async () => {
    const { bridge, nodeData, node, got, ctl, bytesTo } = await opened();
    bridge.message(new TextEncoder().encode("ls\n").buffer as ArrayBuffer);
    expect(bytesTo(1).toString()).toBe("ls\n");
    node({ t: "ack", s: 1, n: 3 });
    expect(got).toContain(JSON.stringify({ t: "ack", n: 3 }));
    nodeData(1, new TextEncoder().encode("file\n"));
    expect(new TextDecoder().decode(got.at(-1) as Uint8Array)).toBe("file\n");
    // The node hears of the bytes only when the client acks them.
    expect(ctl().some((m) => m.t === "ack")).toBe(false);
    bridge.message(JSON.stringify({ t: "ack", n: 5 }));
    expect(ctl()).toContainEqual({ t: "ack", s: 1, n: 5 });
  });

  it("closes a client that overruns the window with 1008", async () => {
    const { bridge, closed, ctl } = await opened();
    bridge.message(new Uint8Array(WINDOW_BYTES));
    expect(closed()).toBeNull();
    bridge.message(new Uint8Array(1));
    expect(closed()).toEqual({ code: 1008, reason: "window exceeded" });
    expect(ctl().at(-1)).toEqual({ t: "cancel", s: 1 });
  });

  it("closes the client 1000 when sshd closes, and 1011 with the code on an error", async () => {
    const a = await opened();
    a.node({ t: "end", s: 1 });
    expect(a.ctl().at(-1)).toEqual({ t: "end", s: 1 });
    expect(a.closed()).toEqual({ code: 1000, reason: "closed" });

    const b = await opened();
    b.node({ t: "err", s: 1, code: "upstream" });
    expect(b.closed()).toEqual({ code: 1011, reason: "upstream" });
  });

  it("ends the stream gracefully when the client goes away", async () => {
    const { bridge, ctl, node, hub } = await opened();
    bridge.message(new Uint8Array([1, 2, 3]));
    bridge.closed();
    expect(ctl().at(-1)).toEqual({ t: "end", s: 1 });
    node({ t: "end", s: 1 });
    expect(hub.open).toBe(0);
  });
});

describe("WebSocket frames", () => {
  it("round-trips masked and unmasked frames of every length class, fragmented reads included", () => {
    for (const n of [0, 5, 125, 126, 65535, 65536, 200_000]) {
      const payload = new Uint8Array(n).map((_, i) => i % 251);
      for (const mask of [null, new Uint8Array([1, 2, 3, 4])]) {
        const frame = encodeFrame(2, payload, mask);
        const r = new FrameReader(1 << 20);
        const out = [...r.push(frame.subarray(0, 3)), ...r.push(frame.subarray(3))];
        expect(out).toHaveLength(1);
        expect(out[0].opcode).toBe(2);
        expect(Buffer.from(out[0].payload).equals(Buffer.from(payload))).toBe(true);
      }
    }
  });

  it("refuses reserved bits, oversize frames and fragmented control frames", () => {
    expect(() => new FrameReader(10).push(new Uint8Array([0xc1, 0]))).toThrow(/reserved/);
    expect(() => new FrameReader(10).push(encodeFrame(2, new Uint8Array(11), null))).toThrow(/too large/);
    expect(() => new FrameReader(10).push(encodeFrame(9, new Uint8Array(1), null, false))).toThrow(/control/);
  });

  it("sends only close codes a socket may send", () => {
    expect(closeCode(1000)).toBe(1000);
    expect(closeCode(4001)).toBe(4001);
    expect(closeCode(1005)).toBe(1000);
    expect(closeCode(1006)).toBe(1000);
  });
});

describe("WsBridge (web passthrough)", () => {
  /** Opens a stream, runs the bridge's handshake against a scripted app, returns what the app saw. */
  async function handshake(answer: (key: string) => Promise<string>, extra: Uint8Array = new Uint8Array()) {
    const t = setup();
    const st = t.hub.openStream("box-1", "web");
    t.node({ t: "opened", s: 1 });
    await st.opened;
    const bridge = new WsBridge(st);
    const hs = bridge.handshake({
      path: "/api/kernels/k1/channels?session_id=1",
      host: "abc.cloudana.run",
      headers: [["Cookie", "_xsrf=1"], ["Origin", "https://abc.cloudana.run"], ["Sec-WebSocket-Key", "visitor"], ["Sec-WebSocket-Extensions", "permessage-deflate"], ["Sec-WebSocket-Protocol", "v1.kernel.websocket.jupyter.org"], ["Upgrade", "websocket"]],
    });
    await tick();
    const request = t.bytesTo(1).toString();
    const key = /Sec-WebSocket-Key: (\S+)/.exec(request)![1];
    const head = new TextEncoder().encode(await answer(key));
    const both = new Uint8Array(head.byteLength + extra.byteLength);
    both.set(head);
    both.set(extra, head.byteLength);
    t.nodeData(1, both);
    return { ...t, st, bridge, request, result: await hs };
  }
  const ok = async (key: string, proto = "v1.kernel.websocket.jupyter.org") =>
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${await acceptKey(key)}\r\nSec-WebSocket-Protocol: ${proto}\r\n\r\n`;

  it("writes the upgrade with the public host, the visitor's headers and a fresh key, never its key or extensions", async () => {
    const { request, result } = await handshake((k) => ok(k));
    expect(result).toEqual({ status: 101, protocol: "v1.kernel.websocket.jupyter.org" });
    expect(request.startsWith("GET /api/kernels/k1/channels?session_id=1 HTTP/1.1\r\nHost: abc.cloudana.run\r\n")).toBe(true);
    expect(request).toContain("cookie: _xsrf=1");
    expect(request).toContain("origin: https://abc.cloudana.run");
    expect(request).not.toContain("visitor");
    expect(request.toLowerCase()).not.toContain("permessage-deflate");
    expect(request.endsWith("\r\n\r\n")).toBe(true);
  });

  it("refuses a wrong accept key, a protocol nobody offered, and passes an app's refusal status on", async () => {
    expect((await handshake(async () => "HTTP/1.1 101 OK\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: nope\r\n\r\n")).result.status).toBe(502);
    expect((await handshake((k) => ok(k, "other"))).result.status).toBe(502);
    const denied = await handshake(async () => "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
    expect(denied.result.status).toBe(403);
    expect(denied.ctl().at(-1)).toEqual({ t: "cancel", s: 1 });
  });

  it("maps messages to frames both ways, answers pings, and relays the app's close", async () => {
    const early = encodeFrame(1, new TextEncoder().encode("hello"), null);
    const { bridge, nodeData, bytesTo, ctl, node } = await handshake((k) => ok(k), early);
    const p = fakePeer();
    bridge.attach(p.peer);
    expect(p.got).toEqual(["hello"]); // sent by the app right after its 101

    const before = bytesTo(1).length;
    bridge.message("ping?");
    bridge.message(new Uint8Array([9, 8, 7]).buffer as ArrayBuffer);
    const frames = new FrameReader(1 << 20).push(bytesTo(1).subarray(before));
    expect(frames.map((f) => [f.opcode, Buffer.from(f.payload).toString("hex")])).toEqual([[1, Buffer.from("ping?").toString("hex")], [2, "090807"]]);
    // Toward the app every frame is masked (RFC 6455 §5.3).
    expect(bytesTo(1)[before + 1] & 0x80).toBe(0x80);

    // A message in two fragments, then a ping.
    nodeData(1, encodeFrame(2, new Uint8Array([1]), null, false));
    nodeData(1, encodeFrame(0, new Uint8Array([2]), null, true));
    expect(Array.from(p.got.at(-1) as Uint8Array)).toEqual([1, 2]);
    const beforePing = bytesTo(1).length;
    nodeData(1, encodeFrame(9, new Uint8Array([42]), null));
    expect(new FrameReader(1 << 20).push(bytesTo(1).subarray(beforePing))[0]).toMatchObject({ opcode: 10, payload: new Uint8Array([42]) });
    // App bytes are acked as they are delivered.
    expect(ctl().filter((m) => m.t === "ack").length).toBeGreaterThan(0);

    const close = new Uint8Array([0x0f, 0xa1, ...new TextEncoder().encode("bye")]); // 4001 "bye"
    nodeData(1, encodeFrame(8, close, null));
    expect(p.closed()).toEqual({ code: 4001, reason: "bye" });
    expect(ctl().at(-1)).toEqual({ t: "end", s: 1 });
    node({ t: "end", s: 1 });
  });

  it("closes 1009 on an oversize message and 1002 on a protocol error from the app", async () => {
    const a = await handshake((k) => ok(k));
    const pa = fakePeer();
    a.bridge.attach(pa.peer);
    a.bridge.message(new Uint8Array(1024 * 1024 + 1));
    expect(pa.closed()?.code).toBe(1009);

    const b = await handshake((k) => ok(k));
    const pb = fakePeer();
    b.bridge.attach(pb.peer);
    b.nodeData(1, encodeFrame(0, new Uint8Array([1]), null));
    expect(pb.closed()?.code).toBe(1002);
  });

  it("sends a close frame to the app when the visitor leaves", async () => {
    const { bridge, bytesTo, ctl } = await handshake((k) => ok(k));
    bridge.attach(fakePeer().peer);
    const before = bytesTo(1).length;
    bridge.closed(1001, "going away");
    const [f] = new FrameReader(1 << 20).push(bytesTo(1).subarray(before));
    expect(f.opcode).toBe(8);
    expect(new DataView(f.payload.buffer, f.payload.byteOffset).getUint16(0)).toBe(1001);
    expect(ctl().at(-1)).toEqual({ t: "end", s: 1 });
  });
});
