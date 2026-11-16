/** `cloudana ssh`: the stdin/stdout pipe with its end-to-end window, proxy mode, and running ssh as ProxyCommand. */
import { describe, it, expect } from "vitest";
import { PassThrough, Writable } from "node:stream";
import { run } from "../src/cli.js";
import { ACK_EVERY, WINDOW_BYTES, hostFromUrl, pipe, proxyCommand, sshProtocols, sshUrl, trustedHost, type SocketLike } from "../src/ssh.js";

const KEY = "cld_sk_" + "a".repeat(40);
const ID = "6f1c2a3e-1111-4222-8333-444455556666";
const HOST = `${ID}.cloudana.run`;

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
    expect(proxyCommand("node", "cli", undefined, ID)).toBe(`"node" "cli" ssh --proxy ${ID}`);
    expect(() => proxyCommand("node", "cli", undefined, "x; rm -rf ~")).toThrow();
  });

  it("sends the key only to <uuid>.<sites domain>, and takes a host from the API only under the deployment's own id", () => {
    expect(trustedHost(HOST.toUpperCase(), "cloudana.run")).toBe(HOST);
    expect(trustedHost(`${ID}.sites.example.test`, "sites.example.test")).toBe(`${ID}.sites.example.test`);
    for (const bad of ["evil.com", `${ID}.cloudana.run.evil.com`, `${ID}.evil.run`, "ws-1.cloudana.run", `x.${ID}.cloudana.run`, `${HOST}:8443`, "cloudana.run"]) {
      expect(() => trustedHost(bad, "cloudana.run"), bad).toThrow(/refusing to send your API key/);
    }
    expect(hostFromUrl(ID, `https://${HOST}`)).toBe(HOST);
    for (const bad of [`http://${HOST}`, `https://${HOST}:444`, "https://6f1c2a3e-0000-4222-8333-444455556666.cloudana.run", "https://evil.com"]) {
      expect(() => hostFromUrl(ID, bad), bad).toThrow(/refusing/);
    }
  });
});

describe("cloudana ssh", () => {
  const ws = (status: string, kind = "workstation", url: string | null = `https://${HOST}`) => ({
    status: "success",
    deployment: { id: ID, name: "box", kind, status, url, spec: { access: { ssh: { user: "ubuntu" } } } },
    events: [],
  });
  const fakeFetch = (body: unknown) =>
    (async (url: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${KEY}`);
      expect(String(url)).toBe(`https://api.example.test/v1/deployments/${ID}`);
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
  const env = { CLOUDANA_API_KEY: KEY, CLOUDANA_API: "https://api.example.test" };

  it("runs ssh with this CLI as ProxyCommand and the workstation's user and host", async () => {
    let args: string[] = [];
    const code = await run(["ssh", ID, "--", "-L", "8888:localhost:8888"], {
      log: () => {}, error: () => {}, env, fetch: fakeFetch(ws("running")), runSsh: async (a) => ((args = a), 7),
    });
    expect(code).toBe(7);
    expect(args[0]).toBe("-o");
    expect(args[1]).toMatch(new RegExp(`^ProxyCommand=".+" ".+" ssh --proxy ${ID}$`));
    expect(args.slice(2)).toEqual(["-o", "ServerAliveInterval=30", "-L", "8888:localhost:8888", `ubuntu@${HOST}`]);
  });

  it("--print shows the plain ssh line; -l picks the user", async () => {
    const lines: string[] = [];
    await run(["ssh", ID, "--print", "-l", "root"], { log: (l) => lines.push(l), error: () => {}, env, fetch: fakeFetch(ws("running")) });
    expect(lines).toEqual([`ssh -o 'ProxyCommand=cloudana ssh --proxy %h' -o ServerAliveInterval=30 root@${HOST}`]);
  });

  it("refuses what is not a running relayed workstation", async () => {
    const errors: string[] = [];
    const io = (body: unknown) => ({ log: () => {}, error: (l: string) => errors.push(l), env, fetch: fakeFetch(body), runSsh: async () => 0 });
    expect(await run(["ssh", ID], io(ws("queued")))).toBe(1);
    expect(await run(["ssh", ID], io(ws("running", "container")))).toBe(1);
    expect(await run(["ssh", ID], io(ws("running", "workstation", null)))).toBe(1);
    expect(errors.join("\n")).toMatch(/queued[\s\S]*not a workstation[\s\S]*direct workstation/);
  });

  it("--proxy opens the socket to the host ssh names, with the key as subprotocol, and pipes until it closes", async () => {
    const f = fakeSocket();
    let opened: { url: string; protocols: string[] } | null = null;
    const out = sink();
    const p = run(["ssh", "--proxy", HOST], {
      log: () => { throw new Error("stdout is the SSH channel: nothing may be logged there"); },
      error: () => {},
      env,
      webSocket: (url, protocols) => ((opened = { url, protocols }), f.ws),
      stdin: new PassThrough(),
      stdout: out.out,
    });
    await tick();
    expect(opened).toEqual({ url: `wss://${HOST}/_cld/ssh`, protocols: ["cloudana-tcp.v1", `bearer.${KEY}`] });
    f.ws.onopen!({});
    f.ws.onmessage!({ data: new TextEncoder().encode("banner").buffer });
    await tick();
    f.ws.onclose!({ code: 1000, reason: "" });
    expect(await p).toBe(0);
    expect(out.bytes().toString()).toBe("banner");
  });

  it("--proxy says so on Node without a WebSocket client", async () => {
    const errors: string[] = [];
    expect(await run(["ssh", "--proxy", HOST], { log: () => {}, error: (l) => errors.push(l), env, webSocket: null })).toBe(1);
    expect(errors[0]).toMatch(/Node 22/);
  });

  it("--proxy refuses a foreign host and sends nothing: no socket, no API call", async () => {
    for (const host of ["evil.com", `${ID}.cloudana.run.evil.com`, `${ID}.evil.run`]) {
      const errors: string[] = [];
      let sockets = 0;
      let calls = 0;
      const code = await run(["ssh", "--proxy", host], {
        log: () => {},
        error: (l) => errors.push(l),
        env,
        fetch: (async () => ((calls++), new Response("{}"))) as unknown as typeof fetch,
        webSocket: () => ((sockets++), fakeSocket().ws),
      });
      expect(code, host).toBe(1);
      expect([sockets, calls], host).toEqual([0, 0]);
      expect(errors.join(" "), host).toMatch(/refusing to send your API key/);
    }
  });

  it("--proxy honours a configured sites domain, and with an id takes the host from the API's URL for it", async () => {
    const opened: string[] = [];
    const io = (extraEnv: Record<string, string>, fetchBody?: unknown) => ({
      log: () => {},
      error: () => {},
      env: { ...env, ...extraEnv },
      fetch: fetchBody ? fakeFetch(fetchBody) : undefined,
      webSocket: (url: string) => {
        opened.push(url);
        const f = fakeSocket();
        queueMicrotask(() => f.ws.onclose!({ code: 1000, reason: "" }));
        return f.ws;
      },
      stdin: new PassThrough(),
      stdout: sink().out,
    });
    await run(["ssh", "--proxy", `${ID}.sites.example.test`], io({ CLOUDANA_SITES_DOMAIN: "sites.example.test" }));
    await run(["ssh", "--proxy", ID], io({}, ws("running")));
    expect(opened).toEqual([`wss://${ID}.sites.example.test/_cld/ssh`, `wss://${HOST}/_cld/ssh`]);
    // The API's answer is checked too: a URL that is not the deployment's own address is refused.
    const errors: string[] = [];
    const evil = { ...io({}, { ...ws("running"), deployment: { ...ws("running").deployment, url: "https://evil.com" } }), error: (l: string) => errors.push(l) };
    expect(await run(["ssh", "--proxy", ID], evil)).toBe(1);
    expect(opened).toHaveLength(2);
  });
});
