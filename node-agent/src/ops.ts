// The agent's own surface through the relay socket (docs/V4_RELAY_CONTRACT.md): the hub addresses it as the reserved
// dep "agent", the way storage checks use dep "storage". Loopback only. The only caller is the API through the node's
// RelayNode — a visitor cannot name this dep: the gateway sets x-relay-dep from the API's route lookup and the relay
// strips every x-relay-* header a visitor sends.
//
//   GET /logs/<deploymentId>?tail=N   text/plain: the last N lines of `docker logs` (stdout + stderr), ≤ 64 KiB.
//                                     404 for anything this agent does not run; nothing is ever stored.
import http from "node:http";

export const OPS_DEP = "agent";
export const LOGS_TAIL_DEFAULT = 200;
export const LOGS_TAIL_MAX = 1000;
/** Most bytes one answer carries (the API keeps the same cap). */
export const LOGS_MAX_BYTES = 64 * 1024;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface OpsOptions {
  /** The last `tail` lines of the container's logs, at most `maxChars`; "" when Docker cannot say. */
  logs: (id: string, tail: number, maxChars: number) => Promise<string>;
  /** Whether this agent runs (or is starting) the deployment: anything else is 404, never a Docker call. */
  serves: (id: string) => boolean;
}

export class OpsServer {
  private server?: http.Server;
  private port = 0;

  constructor(private o: OpsOptions) {}

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => void this.serve(req, res));
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    this.port = (this.server.address() as { port: number }).port;
  }

  stop(): void {
    this.server?.close();
  }

  /** Where the relay client forwards dep "agent" (relay.ts target). */
  target(): { port: number; kind: "container" } | null {
    return this.port ? { port: this.port, kind: "container" } : null;
  }

  private async serve(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const text = (status: number, body: string, headers: Record<string, string> = {}) =>
      void res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...headers }).end(body);
    const url = new URL(req.url ?? "/", "http://agent");
    const m = /^\/logs\/([^/]+)$/.exec(url.pathname);
    if (!m) return text(404, "not found");
    if (req.method !== "GET" && req.method !== "HEAD") return void res.writeHead(405, { allow: "GET, HEAD" }).end();
    const id = m[1];
    if (!ID.test(id) || !this.o.serves(id)) return text(404, "no such deployment on this node");
    const raw = url.searchParams.get("tail");
    const tail = raw === null ? LOGS_TAIL_DEFAULT : Number(raw);
    if (!Number.isInteger(tail) || tail < 1 || tail > LOGS_TAIL_MAX) return text(400, `tail must be 1..${LOGS_TAIL_MAX}`);
    let logs: string;
    try {
      logs = await this.o.logs(id, tail, LOGS_MAX_BYTES);
    } catch (err) {
      return text(502, `docker logs failed: ${(err as Error).message}`);
    }
    const body = Buffer.from(logs, "utf8");
    const out = body.byteLength > LOGS_MAX_BYTES ? body.subarray(body.byteLength - LOGS_MAX_BYTES) : body;
    res.writeHead(200, {
      "content-type": "text/plain; charset=utf-8",
      "content-length": String(out.byteLength),
      "cache-control": "no-store",
      "x-cld-tail": String(tail),
      ...(out.byteLength < body.byteLength && { "x-cld-truncated": "1" }),
    });
    res.end(req.method === "HEAD" ? undefined : out);
  }
}
