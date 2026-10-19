// Selftest: the agent's ops server (dep "agent" through the relay): logs by deployment id, tail bounds, 404 for
// anything this node does not run, size cap, method check. No Docker: the logs function is a fake.
import { LOGS_MAX_BYTES, LOGS_TAIL_DEFAULT, OpsServer } from "./ops.ts";

let failed = 0;
let total = 0;
function check(cond: unknown, what: string) {
  total++;
  if (cond) console.log(`ok   ${what}`);
  else {
    failed++;
    console.log(`FAIL ${what}`);
  }
}

const calls: [string, number, number][] = [];
const ops = new OpsServer({
  logs: async (id, tail, max) => {
    calls.push([id, tail, max]);
    if (id === "boom") throw new Error("daemon down");
    if (id === "big") return "x".repeat(LOGS_MAX_BYTES + 10);
    return `line 1\nline 2 of ${id} (tail ${tail})\n`;
  },
  serves: (id) => ["dep-1", "big", "boom"].includes(id),
});
await ops.start();
const port = ops.target()!.port;
const get = (path: string, method = "GET") => fetch(`http://127.0.0.1:${port}${path}`, { method });

{
  const res = await get("/logs/dep-1");
  check(res.status === 200, `GET /logs/dep-1 → 200 (${res.status})`);
  check(res.headers.get("content-type")?.startsWith("text/plain"), "text/plain");
  check(res.headers.get("x-cld-tail") === String(LOGS_TAIL_DEFAULT), `default tail ${LOGS_TAIL_DEFAULT}`);
  check((await res.text()).includes(`of dep-1 (tail ${LOGS_TAIL_DEFAULT})`), "body is the fake docker output");
  check(res.headers.get("cache-control") === "no-store", "never cached");
}
{
  await get("/logs/dep-1?tail=5");
  const last = calls.at(-1)!;
  check(last[0] === "dep-1" && last[1] === 5 && last[2] === LOGS_MAX_BYTES, "tail and cap passed to docker logs");
}
for (const bad of ["0", "1001", "abc", "1.5", "-3"]) {
  const before = calls.length;
  const res = await get(`/logs/dep-1?tail=${bad}`);
  check(res.status === 400 && calls.length === before, `tail=${bad} → 400 without calling Docker`);
}
{
  const before = calls.length;
  const res = await get("/logs/dep-9");
  check(res.status === 404 && calls.length === before, "unknown deployment → 404 without calling Docker");
  check((await get("/logs/dep-1/extra")).status === 404, "deeper paths → 404");
  check((await get("/other")).status === 404, "other paths → 404");
  check((await get("/logs/..%2Fetc")).status === 404, "non-id → 404");
  check((await get("/logs/dep-1", "POST")).status === 405, "POST → 405");
}
{
  const res = await get("/logs/big");
  const body = await res.arrayBuffer();
  check(res.status === 200 && body.byteLength === LOGS_MAX_BYTES, `oversize output capped to ${LOGS_MAX_BYTES} bytes (${body.byteLength})`);
  check(res.headers.get("x-cld-truncated") === "1", "truncation flagged");
}
{
  const res = await get("/logs/dep-1", "HEAD");
  check(res.status === 200 && (await res.text()) === "", "HEAD → 200, no body");
}
{
  const res = await get("/logs/boom");
  check(res.status === 502 && (await res.text()).includes("daemon down"), "docker failure → 502 with the reason");
}
ops.stop();
console.log(`\nops selftest: ${total - failed}/${total} checks passed`);
if (failed) process.exit(1);
