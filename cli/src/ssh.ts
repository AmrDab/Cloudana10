/**
 * `cloudana ssh`: SSH to a workstation through the relay (docs/V4_RELAY_CONTRACT.md "Byte streams"), so the machine
 * needs no public IP. The CLI is only the transport: it opens `wss://<id>.<domain>/_cld/ssh` and pipes stdin/stdout,
 * which is what ssh's ProxyCommand expects; SSH itself stays end to end between your ssh and the box's sshd.
 *
 * The socket speaks the relay's raw subprotocol `cloudana-tcp.v1`: binary messages are the bytes, text messages
 * `{"t":"ack","n":N}` acknowledge consumed bytes both ways. At most WINDOW_BYTES may be unacknowledged per direction.
 * Uses the WebSocket client built into Node ≥ 22: no runtime dependency.
 */
import type { Readable, Writable } from "node:stream";

/** Mirrors shared/relay-protocol.ts (the CLI is published on its own). */
export const TCP_SUBPROTOCOL = "cloudana-tcp.v1";
export const WINDOW_BYTES = 512 * 1024;
/** Received bytes are acknowledged in batches of this much (the relay never waits on less than a window). */
export const ACK_EVERY = 64 * 1024;
/** Largest message sent. */
const MAX_MESSAGE = 64 * 1024;
export const SSH_PATH = "/_cld/ssh";

/** The parts of a WebSocket this uses (Node's global WebSocket, or a test double). */
export interface SocketLike {
  binaryType: string;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}
export type SocketFactory = (url: string, protocols: string[]) => SocketLike;

/** The platform's WebSocket client, or null on Node < 22. */
export function platformSocket(): SocketFactory | null {
  const WS = (globalThis as { WebSocket?: new (url: string, protocols: string[]) => SocketLike }).WebSocket;
  return WS ? (url, protocols) => new WS(url, protocols) : null;
}

const HOST = /^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$/;

/** The SSH socket URL of a deployment host (`<id>.cloudana.run`). */
export function sshUrl(host: string): string {
  if (!HOST.test(host)) throw new Error(`not a host name: ${host}`);
  return `wss://${host}${SSH_PATH}`;
}

/**
 * The bearer key rides as the subprotocol `bearer.<key>` (Node's WebSocket client cannot set headers); the gateway
 * takes it from there, checks it with the API and never forwards it.
 */
export function sshProtocols(apiKey: string): string[] {
  if (!/^[\x21-\x7e]+$/.test(apiKey) || /[(),/:;<=>?@[\\\]{}"]/.test(apiKey)) throw new Error("the API key cannot be sent as a WebSocket subprotocol");
  return [TCP_SUBPROTOCOL, `bearer.${apiKey}`];
}

/**
 * Pipe `input` → socket → `output` with the window end to end. Resolves with the exit code: 0 after a normal close,
 * 1 when the connection failed or closed with an error (the reason goes to `error`, never to `output`).
 */
export function pipe(ws: SocketLike, input: Readable, output: Writable, error: (line: string) => void): Promise<number> {
  return new Promise((resolve) => {
    let unacked = 0; // bytes sent and not yet acknowledged by the node
    let toAck = 0; // bytes written to output and not yet acknowledged
    let opened = false;
    let done = false;
    ws.binaryType = "arraybuffer";
    input.pause();

    const finish = (code: number) => {
      if (done) return;
      done = true;
      input.pause();
      input.removeListener("data", onInput);
      input.removeListener("end", onInputEnd);
      resolve(code);
    };
    const onInput = (chunk: Buffer) => {
      for (let i = 0; i < chunk.length; i += MAX_MESSAGE) ws.send(new Uint8Array(chunk.subarray(i, i + MAX_MESSAGE)));
      unacked += chunk.length;
      if (unacked >= WINDOW_BYTES) input.pause();
    };
    // ssh closed our stdin: it is done; what we sent still reaches sshd before the relay closes the connection.
    const onInputEnd = () => ws.close(1000, "done");

    ws.onopen = () => {
      opened = true;
      input.on("data", onInput);
      input.on("end", onInputEnd);
      input.resume();
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        const n = ackOf(ev.data);
        if (n === null) return;
        unacked = Math.max(0, unacked - n);
        if (unacked < WINDOW_BYTES && input.isPaused() && !done) input.resume();
        return;
      }
      const bytes = ev.data instanceof ArrayBuffer ? new Uint8Array(ev.data) : ev.data instanceof Uint8Array ? ev.data : null;
      if (!bytes) return;
      output.write(bytes, (err) => {
        if (err || done) return;
        toAck += bytes.byteLength;
        if (toAck >= ACK_EVERY) {
          ws.send(JSON.stringify({ t: "ack", n: toAck }));
          toAck = 0;
        }
      });
    };
    ws.onerror = () => {
      if (!opened) error("could not open the SSH connection: is the workstation running, relayed, and yours? (cloudana get <id>)");
    };
    ws.onclose = (ev) => {
      if (opened && ev.code !== 1000) error(`connection closed: ${ev.code}${ev.reason ? ` ${ev.reason}` : ""}`);
      finish(opened && ev.code === 1000 ? 0 : 1);
    };
  });
}

function ackOf(text: string): number | null {
  try {
    const m = JSON.parse(text) as { t?: unknown; n?: unknown };
    return m?.t === "ack" && Number.isInteger(m.n) && (m.n as number) > 0 ? (m.n as number) : null;
  } catch {
    return null;
  }
}

/**
 * The ProxyCommand that runs this CLI in proxy mode. Each part is double-quoted (paths with spaces, Windows paths
 * with backslashes kept as they are); a part that itself holds a quote is refused rather than escaped wrongly.
 */
export function proxyCommand(node: string, cli: string, api?: string): string {
  const q = (s: string) => {
    if (/["\r\n]/.test(s)) throw new Error(`cannot quote ${JSON.stringify(s)} for ProxyCommand`);
    return `"${s}"`;
  };
  return [q(node), q(cli), "ssh", "--proxy", ...(api ? ["--api", q(api)] : []), "%h"].join(" ");
}
