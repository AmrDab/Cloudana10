/** The commands against a stub of the API: what the CLI sends, what it prints, and its exit codes. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { run } from "../src/cli.js";

const KEY = "cld_sk_" + "a".repeat(40);
let server: Server;
let api = "";
const seen: { method: string; url: string; auth: string | undefined; body: unknown }[] = [];
let polls = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : undefined;
      seen.push({ method: req.method!, url: req.url!, auth: req.headers.authorization, body });
      const json = (status: number, obj: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      if (req.headers.authorization !== `Bearer ${KEY}`) return json(401, { status: "error", error: { code: "unauthorized", message: "bad key" } });
      if (req.method === "POST" && req.url === "/v1/deployments") return json(201, { status: "success", id: "dep-1", priceUcldPerHour: 50, priceUsdPerHour: 0.000005, usdPerCld: 0.1, deploymentStatus: "queued" });
      if (req.method === "GET" && req.url === "/v1/deployments/dep-1") {
        polls++;
        const status = polls < 3 ? "queued" : "running";
        return json(200, { status: "success", deployment: { id: "dep-1", name: "site", kind: "static", status, url: status === "running" ? "https://dep-1.cloudana.run" : null }, events: [{ at: 1, level: "info", message: "queued" }] });
      }
      if (req.method === "GET" && req.url === "/v1/deployments") return json(200, { status: "success", deployments: [{ id: "dep-1", name: "site", kind: "static", status: "running", url: "https://dep-1.cloudana.run" }] });
      if (req.method === "DELETE" && req.url === "/v1/deployments/dep-1") return json(200, { status: "success", id: "dep-1", deploymentStatus: "stopped" });
      if (req.method === "GET" && req.url === "/v1/deployments/nope") return json(404, { status: "error", error: { code: "not_found", message: "deployment not found" } });
      json(500, { status: "error", error: { code: "internal", message: "unexpected" } });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  api = `http://127.0.0.1:${port}`;
});
afterAll(() => server.close());

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { log: (l: string) => out.push(l), error: (l: string) => err.push(l), sleep: async () => undefined, env: { CLOUDANA_API: api, CLOUDANA_API_KEY: KEY } } };
}

describe("cloudana", () => {
  it("deploy: reads the folder, posts a static spec with the key, waits for running and prints the URL", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cloudana-cli-"));
    await writeFile(path.join(dir, "index.html"), "<h1>hi</h1>");
    const t = io();
    expect(await run(["deploy", dir, "--name", "site"], t.io)).toBe(0);
    const post = seen.find((s) => s.method === "POST")!;
    expect(post.auth).toBe(`Bearer ${KEY}`);
    expect(post.body).toEqual({ name: "site", kind: "static", spec: { files: [{ path: "index.html", contentBase64: Buffer.from("<h1>hi</h1>").toString("base64") }] } });
    expect(t.out).toEqual(["1 files, 0 KB", "deployment dep-1 queued, $0.0000/h", "live at https://dep-1.cloudana.run"]);
    expect(polls).toBe(3);
  });

  it("list, get, stop, and the API's errors as exit code 1", async () => {
    const t = io();
    expect(await run(["list"], t.io)).toBe(0);
    expect(t.out[0]).toMatch(/^dep-1 {2}running {5}static {6}site {2}https:\/\/dep-1\.cloudana\.run$/);
    expect(await run(["get", "dep-1"], t.io)).toBe(0);
    expect(t.out.at(-1)).toMatch(/info queued$/);
    expect(await run(["stop", "dep-1"], t.io)).toBe(0);
    expect(t.out.at(-1)).toBe("stopped dep-1");
    expect(await run(["get", "nope"], t.io)).toBe(1);
    expect(t.err.at(-1)).toBe("not_found: deployment not found");
  });

  it("usage and a missing key", async () => {
    const t = io();
    expect(await run([], t.io)).toBe(2);
    expect(await run(["deploy"], t.io)).toBe(2);
    expect(t.err.at(-2)).toBe("deploy needs a folder");
    const noKey = { ...t.io, env: { CLOUDANA_API: api, CLOUDANA_HOME: path.join(tmpdir(), "no-such-home-" + Date.now()) } };
    expect(await run(["list"], noKey)).toBe(1);
    expect(t.err.at(-1)).toMatch(/no API key/);
  });
});
