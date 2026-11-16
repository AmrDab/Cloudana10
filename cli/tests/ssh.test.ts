/** `cloudana ssh`: the stdin/stdout pipe with its end-to-end window, proxy mode, and running ssh as ProxyCommand. */
import { describe, it, expect } from "vitest";
import { PassThrough, Writable } from "node:stream";
import { run } from "../src/cli.js";
import { ACK_EVERY, WINDOW_BYTES, pipe, proxyCommand, sshProtocols, sshUrl, type SocketLike } from "../src/ssh.js";

const KEY = "cld_sk_" + "a".repeat(40);

/** A scripted WebSocket: records what the CLI sends; the test drives open/message/close. */
function fakeSocket() {
  const sent: (string | Uint8Array)[] = [];
  let closed: { code?: number; reason?: string } | null = null;
  const ws: SocketLike = {
    binaryType: "blob",
    send: (d) => void sent.push(d),
    close: (code, reason) => void (closed = { code, reason }),
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  return { ws, sent, closed: () => closed, binary: () => sent.filter((m): m is Uint8Array => typeof m !== "string"), acks: () => sent.filter((m): m is string => typeof m === "string").map((m) => JSON.parse(m).n as number) };
}

function sink() {
  const chunks: Buffer[] = [];
  const out = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.from(chunk));
      cb();
    },
  });
  return { out, bytes: () => Buffer.concat(chunks) };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

describe("pipe (the ProxyCommand transport)", () => {
  it("sends stdin as binary messages only once open, writes received bytes to stdout and acks them in batches", async () => {
    const f = fakeSocket();
    const input = new PassThrough();
    const s = sink();
    const errors: string[] = [];
    const done = pipe(f.ws, input, s.out, (l) => errors.push(l));
    expect(f.ws.binaryType).toBe("arraybuffer");
    input.write("SSH-2.0-client\r\n");
    await tick();
    expect(f.binary()).toHaveLength(0); // nothing before the socket is open
    f.ws.onopen!({});
    await tick();
    expect(Buffer.from(f.binary()[0]).toString()).toBe("SSH-2.0-client\r\n");

    f.ws.onmessage!({ data: new TextEncoder().encode("SSH-2.0-OpenSSH\r\n").buffer });
    await tick();
    expect(s.bytes().toString()).toBe("SSH-2.0-OpenSSH\r\n");
    expect(f.acks()).toEqual([]); // under one batch: not acked yet
    f.ws.onmessage!({ data: new Uint8Array(ACK_EVERY).buffer });
    await tick();
    expect(f.acks()).toEqual([ACK_EVERY + 17]);

    f.ws.onclose!({ code: 1000, reason: "closed" });
    expect(await done).toBe(0);
    expect(errors).toEqual([]);
  });

  it("stops reading stdin at the window and resumes when the node acks", async () => {
    const f = fakeSocket();
    const input = new PassThrough();
    const done = pipe(f.ws, input, sink().out, () => {});
    f.ws.onopen!({});
    for (let i = 0; i < 12; i++) input.write(Buffer.alloc(64 * 1024));
    await tick();
    const sentBytes = () => f.binary().reduce((n, b) => n + b.byteLength, 0);
    expect(sentBytes()).toBe(WINDOW_BYTES); // 8 × 64 KiB, then paused
    f.ws.onmessage!({ data: JSON.stringify({ t: "ack", n: 4 * 64 * 1024 }) });
    await tick();
    expect(sentBytes()).toBe(12 * 64 * 1024);
    f.ws.onclose!({ code: 1000, reason: "" });
    await done;
  });

  it("closes the socket when ssh closes stdin, and fails with the reason on an error close", async () => {
    const a = fakeSocket();
    const input = new PassThrough();
    const pa = pipe(a.ws, input, sink().out, () => {});
    a.ws.onopen!({});
    input.end();
    await tick();
    expect(a.closed()).toEqual({ code: 1000, reason: "done" });
    a.ws.onclose!({ code: 1000, reason: "" });
    expect(await pa).toBe(0);

    const b = fakeSocket();
    const errors: string[] = [];
    const pb = pipe(b.ws, new PassThrough(), sink().out, (l) => errors.push(l));
    b.ws.onopen!({});
    b.ws.onclose!({ code: 1011, reason: "upstream" });
    expect(await pb).toBe(1);
    expect(errors).toEqual(["connection closed: 1011 upstream"]);

    const c = fakeSocket();
    const errs: string[] = [];
    const pc = pipe(c.ws, new PassThrough(), sink().out, (l) => errs.push(l));
    c.ws.onerror!({});
    c.ws.onclose!({ code: 1006, reason: "" });
    expect(await pc).toBe(1);
    expect(errs[0]).toMatch(/could not open the SSH connection/);
  });
});

describe("helpers", () => {
  it("builds the socket URL, the subprotocols and a quoted ProxyCommand", () => {
    expect(sshUrl("6f1c.cloudana.run")).toBe("wss://6f1c.cloudana.run/_cld/ssh");
    expect(() => sshUrl("evil.com/x?")).toThrow();
    expect(sshProtocols(KEY)).toEqual(["cloudana-tcp.v1", `bearer.${KEY}`]);
    expect(() => sshProtocols("a b")).toThrow();
    expect(proxyCommand("C:\\Program Files\\nodejs\\node.exe", "/opt/cli.js")).toBe('"C:\\Program Files\\nodejs\\node.exe" "/opt/cli.js" ssh --proxy %h');
    expect(() => proxyCommand('a"b', "c")).toThrow();
  });
});

describe("cloudana ssh", () => {
  const ws = (status: string, kind = "workstation", url: string | null = "https://ws-1.cloudana.run") => ({
    status: "success",
    deployment: { id: "ws-1", name: "box", kind, status, url, spec: { access: { ssh: { user: "ubuntu" } } } },
    events: [],
  });
  const fakeFetch = (body: unknown) =>
    (async (url: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${KEY}`);
      expect(String(url)).toBe("https://api.example.test/v1/deployments/ws-1");
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
  const env = { CLOUDANA_API_KEY: KEY, CLOUDANA_API: "https://api.example.test" };

  it("runs ssh with this CLI as ProxyCommand and the workstation's user and host", async () => {
    let args: string[] = [];
    const code = await run(["ssh", "ws-1", "--", "-L", "8888:localhost:8888"], {
      log: () => {}, error: () => {}, env, fetch: fakeFetch(ws("running")), runSsh: async (a) => ((args = a), 7),
    });
    expect(code).toBe(7);
    expect(args[0]).toBe("-o");
    expect(args[1]).toMatch(/^ProxyCommand=".+" ".+" ssh --proxy %h$/);
    expect(args.slice(2)).toEqual(["-o", "ServerAliveInterval=30", "-L", "8888:localhost:8888", "ubuntu@ws-1.cloudana.run"]);
  });

  it("--print shows the plain ssh line; -l picks the user", async () => {
    const lines: string[] = [];
    await run(["ssh", "ws-1", "--print", "-l", "root"], { log: (l) => lines.push(l), error: () => {}, env, fetch: fakeFetch(ws("running")) });
    expect(lines).toEqual(["ssh -o 'ProxyCommand=cloudana ssh --proxy %h' -o ServerAliveInterval=30 root@ws-1.cloudana.run"]);
  });

  it("refuses what is not a running relayed workstation", async () => {
    const errors: string[] = [];
    const io = (body: unknown) => ({ log: () => {}, error: (l: string) => errors.push(l), env, fetch: fakeFetch(body), runSsh: async () => 0 });
    expect(await run(["ssh", "ws-1"], io(ws("queued")))).toBe(1);
    expect(await run(["ssh", "ws-1"], io(ws("running", "container")))).toBe(1);
    expect(await run(["ssh", "ws-1"], io(ws("running", "workstation", null)))).toBe(1);
    expect(errors.join("\n")).toMatch(/queued[\s\S]*not a workstation[\s\S]*direct workstation/);
  });

  it("--proxy opens the socket to the host ssh names, with the key as subprotocol, and pipes until it closes", async () => {
    const f = fakeSocket();
    let opened: { url: string; protocols: string[] } | null = null;
    const out = sink();
    const p = run(["ssh", "--proxy", "ws-1.cloudana.run"], {
      log: () => { throw new Error("stdout is the SSH channel: nothing may be logged there"); },
      error: () => {},
      env,
      webSocket: (url, protocols) => ((opened = { url, protocols }), f.ws),
      stdin: new PassThrough(),
      stdout: out.out,
    });
    await tick();
    expect(opened).toEqual({ url: "wss://ws-1.cloudana.run/_cld/ssh", protocols: ["cloudana-tcp.v1", `bearer.${KEY}`] });
    f.ws.onopen!({});
    f.ws.onmessage!({ data: new TextEncoder().encode("banner").buffer });
    await tick();
    f.ws.onclose!({ code: 1000, reason: "" });
    expect(await p).toBe(0);
    expect(out.bytes().toString()).toBe("banner");
  });

  it("--proxy says so on Node without a WebSocket client", async () => {
    const errors: string[] = [];
    expect(await run(["ssh", "--proxy", "ws-1.cloudana.run"], { log: () => {}, error: (l) => errors.push(l), env, webSocket: null })).toBe(1);
    expect(errors[0]).toMatch(/Node 22/);
  });
});
