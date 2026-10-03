import http from "node:http";
import os from "node:os";
import path from "node:path";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { DeploymentManager, type ManagerOptions, type StatusBody } from "./deployments.ts";

function fail(msg: string): never {
  console.error(`✗ hosting selftest failed: ${msg}`);
  process.exit(1);
}

/** Raw GET so the path is sent verbatim (fetch would normalise "/../" away). */
function get(port: number, p: string): Promise<{ status: number; type: string; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: p, agent: false }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, type: String(res.headers["content-type"]), body, headers: res.headers }));
      })
      .on("error", reject);
  });
}

const b64 = (s: string) => Buffer.from(s).toString("base64");

async function main() {
  const t0 = Date.now();
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "cld-selftest-"));
  writeFileSync(path.join(dataDir, "key.json"), '{"privateKey":"0xdeadbeef"}'); // must never be served
  const reports: { id: string; body: StatusBody }[] = [];
  const opts: ManagerOptions = {
    dataDir,
    publicHost: "127.0.0.1",
    ports: [42000, 42100],
    privateKey: "0x" + "11".repeat(32),
    log: () => {},
    report: async (id, body) => {
      reports.push({ id, body });
      return true;
    },
  };
  let mgr = new DeploymentManager(opts);

  try {
    const id = "selftest-site";
    const html = "<!doctype html><title>hi</title><h1>Cloudana selftest</h1>";
    await mgr.handle({
      id,
      action: "start",
      kind: "static",
      spec: { files: [{ path: "index.html", contentBase64: b64(html) }, { path: "css/app.css", contentBase64: b64("h1{}") }] },
    });
    const running = reports.at(-1)?.body;
    if (running?.status !== "running" || !running.endpoint) fail(`expected running report, got ${JSON.stringify(reports)}`);
    const port = Number(new URL(running.endpoint).port);

    const root = await get(port, "/");
    if (root.status !== 200 || !root.type.startsWith("text/html") || root.body !== html) fail(`GET / → ${root.status} ${root.type}`);
    if (root.headers["x-content-type-options"] !== "nosniff") fail("missing nosniff header");
    if (root.headers["cache-control"] !== "public, max-age=60") fail("missing cache-control header");
    const css = await get(port, "/css/app.css");
    if (css.status !== 200 || !css.type.startsWith("text/css")) fail(`GET /css/app.css → ${css.status} ${css.type}`);
    for (const p of ["/../key.json", "/%2e%2e/key.json", "/css/..%2f..%2fkey.json", "/..\\key.json"]) {
      const r = await get(port, p).catch((e) => fail(`traversal ${p}: ${(e as Error).message}`));
      if (r.status !== 404 && r.status !== 400) fail(`traversal ${p} → ${r.status}`);
      if (r.body.includes("deadbeef")) fail(`traversal ${p} leaked the key`);
    }
    const missing = await get(port, "/nope.html");
    if (missing.status !== 404) fail(`GET /nope.html → ${missing.status}`);
    const dir = await get(port, "/css/");
    if (dir.status !== 404) fail(`directory listing GET /css/ → ${dir.status}`);

    // Idempotent start, then unsafe paths rejected as failed (not thrown).
    await mgr.handle({ id, action: "start", kind: "static", spec: {} });
    if (reports.at(-1)?.body.status !== "running") fail("repeat start did not re-report running");
    await mgr.handle({ id: "bad", action: "start", kind: "static", spec: { files: [{ path: "../x.html", contentBase64: "" }] } });
    if (reports.at(-1)?.body.status !== "failed") fail("traversal file path was not rejected");

    // Simulated agent restart: a fresh manager resumes from .data/deployments.json.
    await mgr.closeAll();
    mgr = new DeploymentManager(opts);
    await mgr.resume();
    const resumed = reports.at(-1)?.body;
    if (resumed?.status !== "running" || resumed.endpoint !== running.endpoint) fail(`resume → ${JSON.stringify(resumed)}`);
    if ((await get(port, "/")).status !== 200) fail("resumed site not serving");

    await mgr.handle({ id, action: "stop", kind: "static", spec: {} });
    if (reports.at(-1)?.body.status !== "stopped") fail("stop did not report stopped");
    if (existsSync(path.join(dataDir, "sites", id))) fail("site files not deleted on stop");
    const after = await get(port, "/").catch(() => null);
    if (after) fail("server still answering after stop");

    console.log(`✓ hosting selftest passed — served on :${port}, MIME + headers ok, traversal blocked, resumed after restart, stopped (${Date.now() - t0} ms)`);
  } finally {
    await mgr.closeAll();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((err) => fail((err as Error).message));
