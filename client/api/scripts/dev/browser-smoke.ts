/**
 * Browser smoke run of the console against the local stack (TEST_EVIDENCE.md §4): real Chromium, the built console
 * with the burner signer, the Node API runtime and two fake nodes (scripts/dev/fake-node.ts). It signs in, takes
 * test credits, binds a home node by its printed link, joins a fleet node by token, deploys a static site (served
 * and content-probed), deploys a container with a secret (sealed in the browser to the assigned node, opened by that
 * node for that deployment only), reads the logs error path, mints and revokes an API key, drains and resumes a
 * node, signs out and proves the session is dead.
 *
 * Needs: a console build made with VITE_DEV_BURNER=true VITE_API_URL=http://127.0.0.1:8790 (dist/public), Chromium
 * at CHROMIUM (default /opt/pw-browsers/chromium-1194/chrome-linux/chrome) and playwright-core (set PLAYWRIGHT_CORE
 * to its directory when it is not installed in this package). Ports 8790 (API) and 7003 (console) must be free.
 *
 *   cd client/api && PLAYWRIGHT_CORE=/path/node_modules/playwright-core SMOKE_OUT=/tmp/smoke npx tsx scripts/dev/browser-smoke.ts
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generatePrivateKey } from "viem/accounts";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? "playwright-core") as typeof import("playwright-core");

const apiDir = fileURLToPath(new URL("../../", import.meta.url));
const repoRoot = path.resolve(apiDir, "../..");
const OUT = process.env.SMOKE_OUT ?? path.join(repoRoot, ".smoke");
const API = "http://127.0.0.1:8790";
const WEB = "http://127.0.0.1:7003";
const INTERNAL_KEY = "smoke-internal-key-0123456789abcdef";
const CHROMIUM = process.env.CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
mkdirSync(OUT, { recursive: true });

let failed = 0;
let total = 0;
const checks: string[] = [];
function check(cond: unknown, what: string) {
  total++;
  const line = `${cond ? "ok  " : "FAIL"} ${what}`;
  checks.push(line);
  console.log(line);
  if (!cond) failed++;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => Promise<T> | T, what: string, ms = 60_000, every = 500): Promise<T> {
  const t0 = Date.now();
  let last: unknown;
  while (Date.now() - t0 < ms) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await sleep(every);
  }
  throw new Error(`timed out waiting for ${what}${last ? ` (last error: ${(last as Error).message})` : ""}`);
}

const children: ChildProcess[] = [];
function run(name: string, cmd: string, args: string[], opts: { cwd: string; env?: Record<string, string> }): ChildProcess {
  const log = openSync(path.join(OUT, `${name}.log`), "w");
  const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, stdio: ["ignore", log, log] });
  children.push(child);
  return child;
}
function stopAll() {
  for (const c of children) {
    try {
      c.kill("SIGTERM");
    } catch {
      /* gone */
    }
  }
}
process.on("exit", stopAll);
process.on("SIGINT", () => {
  stopAll();
  process.exit(130);
});

const readState = (file: string) => (existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as any) : null);
async function json(url: string, init: RequestInit = {}) {
  const res = await fetch(url, init);
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

async function main() {
  if (!existsSync(path.join(repoRoot, "dist/public/index.html"))) throw new Error("no console build: run VITE_DEV_BURNER=true VITE_API_URL=http://127.0.0.1:8790 npm run build at the repo root");
  if (await fetch(`${API}/health`).then(() => true, () => false)) throw new Error(`${API} already answers: stop it first`);

  // ── Stack ──────────────────────────────────────────────────────────────────────────────────────────
  run("api", process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: apiDir,
    env: {
      PORT: "8790",
      JWT_SECRET: "smoke-jwt-secret-" + "x".repeat(32),
      INTERNAL_API_KEY: INTERNAL_KEY,
      INSTRUCTION_SIGNING_KEY: generatePrivateKey(),
      DEV_MODE: "true",
      CLUSTER_N_MIN: "1",
      DEPLOY_PROBE_SECONDS: "10",
      NODE_ACTIVE_SECONDS: "45",
      CLOUDANA_DB_PATH: path.join(OUT, "smoke.sqlite"),
    },
  });
  await until(() => fetch(`${API}/health`).then((r) => r.ok, () => false), "the API", 60_000);
  run("web", "npx", ["vite", "preview", "--port", "7003", "--strictPort", "--host", "127.0.0.1"], { cwd: repoRoot });
  await until(() => fetch(`${WEB}/control`).then((r) => r.ok, () => false), "the console preview", 60_000);
  check(true, "API and console preview are up");

  const stateA = path.join(OUT, "node-a.json");
  run("node-a", "npx", ["tsx", "scripts/dev/fake-node.ts"], { cwd: apiDir, env: { API, STATE_FILE: stateA, CAPS: "matmul,hosting" } });
  const a = await until(() => readState(stateA)?.bindCode && readState(stateA), "fake node A's bind code", 30_000);
  check(/^[0-9a-f]{16}$/.test(a.bindCode), `fake node A announced unbound with a bind code (${a.address.slice(0, 10)}…)`);

  // ── Browser ────────────────────────────────────────────────────────────────────────────────────────
  const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  const shot = (name: string) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true }).catch(() => undefined);
  const session = () => page.evaluate(() => JSON.parse(sessionStorage.getItem("cld.session") ?? "null") as { token: string; address: string } | null);
  const bearer = async (p: string, init: RequestInit = {}) => {
    const s = await session();
    return json(`${API}/v1${p}`, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${s!.token}`, ...(init.body ? { "content-type": "application/json" } : {}) } });
  };

  // 1. Sign in with the burner wallet.
  await page.goto(`${WEB}/control/run`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /sign in/i }).first().click();
  const s1 = await until(session, "a session after sign-in", 30_000);
  check(/^0x[0-9a-f]{40}$/.test(s1.address) && s1.token.split(".").length === 3, `signed in: session JWT for ${s1.address.slice(0, 10)}…`);
  check((await bearer("/account")).status === 200, "the session token works against the API");
  await shot("01-signed-in");

  // 2. Test credits.
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: /get test credits/i }).click();
    await sleep(800);
  }
  const bal = await until(async () => ((await bearer("/account")).body.balanceUcld >= 20_000_000 ? (await bearer("/account")).body.balanceUcld : 0), "20 CLD of test credits", 20_000);
  check(bal >= 20_000_000, `two clicks on "Get test credits" → balance ${bal} µCLD`);

  // 3. Bind the home node by the link the agent prints.
  await page.goto(`${WEB}/control/provide?node=${a.address}&code=${a.bindCode}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /bind node/i }).click();
  const mineA = await until(async () => (await bearer("/nodes/mine")).body.nodes?.find((n: any) => n.address === a.address), "the home node under this wallet", 30_000);
  check(!!mineA && mineA.fleetId === null, "home node bound by its link (payout = this wallet, no fleet)");
  await until(async () => (await bearer("/nodes/mine")).body.nodes?.find((n: any) => n.address === a.address)?.online, "home node online", 20_000);
  check(true, "home node heartbeats and shows online");
  await shot("02-node-bound");

  // 4. A fleet node joins by token (containers need a fleet).
  const fleet = await bearer("/fleets", { method: "POST", body: JSON.stringify({ name: "smoke" }) });
  check(fleet.status === 201 && /^cft_[0-9a-f]{32}$/.test(fleet.body.token ?? ""), "fleet created, token shown once");
  const stateB = path.join(OUT, "node-b.json");
  run("node-b", "npx", ["tsx", "scripts/dev/fake-node.ts"], { cwd: apiDir, env: { API, STATE_FILE: stateB, CAPS: "matmul,hosting,container", FLEET_TOKEN: fleet.body.token } });
  const b = await until(() => readState(stateB)?.bound && readState(stateB), "fake node B bound through the fleet", 30_000);
  check(b.fleetId === fleet.body.id && b.payout === s1.address, "fleet node bound on announce: payout = fleet owner, no bind link");
  await until(async () => (await bearer("/nodes/mine")).body.nodes?.length === 2, "both nodes under this wallet", 20_000);

  // 5. Static site from pasted HTML: placed, served by node A, content-probed.
  await page.goto(`${WEB}/control/run?tab=deploy`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /paste html/i }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("#dep-name").fill("smoke-site");
  await dialog.getByLabel("index.html").fill("<!doctype html><title>smoke</title><h1>smoke ok</h1>");
  await dialog.getByRole("button", { name: /^deploy$/i }).click();
  const site = await until(async () => (await bearer("/deployments")).body.deployments?.find((d: any) => d.name === "smoke-site"), "the site in the list", 30_000);
  check(site.kind === "static", "static site created from the form");
  await page.keyboard.press("Escape");
  const siteRunning = await until(async () => {
    const d = (await bearer(`/deployments/${site.id}`)).body.deployment;
    return d?.status === "running" ? d : null;
  }, "the site running on node A", 60_000);
  const host = siteRunning.node === a.address ? "home node A" : siteRunning.node === b.address ? "fleet node B" : "an unknown node";
  check(host !== "an unknown node" && /^http:\/\/127\.0\.0\.1:\d+$/.test(siteRunning.endpoint ?? ""), `placed on ${host} and reported running at ${siteRunning.endpoint}`);
  const served = await fetch(`${siteRunning.endpoint}/`).then((r) => r.text());
  check(served.includes("smoke ok"), "the node serves the pasted HTML byte for byte");
  const probed = await until(async () => {
    const d = (await bearer(`/deployments/${site.id}`)).body.deployment;
    return d?.probeOk === true ? d : null;
  }, "a passing content probe", 60_000);
  check(probed.probeOk === true, "the orchestrator's content-hash probe passed against the node");
  await until(() => page.locator("tr", { hasText: "smoke-site" }).getByText("running").isVisible().catch(() => false), "the row to say running", 30_000);
  check(true, "the Deploy tab shows the site running");
  await shot("03-site-running");

  // 6. Container with a secret: sealed in the browser to node B's key, opened by B for this deployment only.
  await page.goto(`${WEB}/control/run?tab=deploy`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /postgresql/i }).first().click();
  await dialog.getByRole("button", { name: /^deploy$/i }).click();
  await dialog.locator("#dep-name").fill("smoke-db");
  const pw = dialog.locator("input[type=password]");
  const n = await pw.count();
  check(n >= 1, `the PostgreSQL template asks for ${n} secret value(s)`);
  for (let i = 0; i < n; i++) await pw.nth(i).fill("s3cret-" + i);
  await dialog.locator("button[type=submit]").click();
  const db = await until(async () => (await bearer("/deployments")).body.deployments?.find((d: any) => d.name === "smoke-db"), "the container in the list", 30_000);
  await page.keyboard.press("Escape");
  const dbRow = page.locator("tr", { hasText: "smoke-db" }).first();
  let rowText = "";
  try {
    await until(async () => {
      rowText = (await dbRow.innerText().catch(() => "")).replace(/\s+/g, " ");
      return /Sealed/.test(rowText) ? rowText : null;
    }, 'the "Sealed" pill in the row', 60_000);
    check(true, `the console sealed the secrets once node B was assigned (row: ${rowText.slice(0, 80)})`);
  } catch {
    await shot("04-no-sealed-pill");
    check(false, `the "Sealed" pill never showed (row: ${rowText.slice(0, 120)})`);
  }
  const opened = await until(() => readState(stateB)?.serving?.[db.id]?.secretKeys && readState(stateB).serving[db.id], "node B to open the sealed env", 60_000);
  check(JSON.stringify(opened.secretKeys) === JSON.stringify(["POSTGRES_PASSWORD"]), `node B opened the env for this deployment: keys ${opened.secretKeys.join(",")}`);
  check(opened.boundCheck === true, "the same payload is refused for another deployment id and without an id (bound sealing)");
  const dbRunning = await until(async () => {
    const d = (await bearer(`/deployments/${db.id}`)).body.deployment;
    return d?.status === "running" ? d : null;
  }, "the container running", 60_000);
  check(dbRunning.node === b.address && dbRunning.awaitingSecrets === false, "container running on the fleet node, no longer awaiting secrets");
  const rowDb = (await bearer(`/deployments/${db.id}`)).body;
  check(!JSON.stringify(rowDb).includes("s3cret-"), "no secret value is visible through the API");
  await shot("04-container-sealed");

  // 7. Logs panel: a direct node cannot serve live logs, and the UI says so.
  await page.locator("tr", { hasText: "smoke-db" }).first().click();
  await page.getByRole("button", { name: /fetch logs of smoke-db/i }).click();
  await until(() => page.getByText(/direct \(public-IP\) node/).first().isVisible().catch(() => false), "the logs error text", 20_000);
  check(true, "the Logs panel names why a direct node has no live logs");
  await shot("05-logs-panel");

  // 8. API keys from Docs: mint, use within scope, refused outside, revoke.
  await page.goto(`${WEB}/control/docs`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("Key name, e.g. ci-deploy").fill("smoke");
  await page.getByRole("button", { name: /create key/i }).click();
  const token = await until(async () => {
    const t = await page.locator("code", { hasText: /^cld_sk_/ }).first().textContent().catch(() => null);
    return t?.trim() || null;
  }, "the minted key", 20_000);
  check(/^cld_sk_[A-Za-z0-9_-]{32}$/.test(token), "a cld_sk_ key was minted and shown once");
  const withKey = (p: string) => json(`${API}/v1${p}`, { headers: { authorization: `Bearer ${token}` } });
  check((await withKey("/jobs")).status === 200, "the key reads jobs (read scope)");
  check((await withKey("/keys")).status === 403, "the key cannot list keys (wallet session only)");
  await page.getByRole("button", { name: /revoke key smoke/i }).click();
  await until(async () => (await withKey("/jobs")).status === 401, "the revoked key to be refused", 20_000);
  check(true, "revoked from the console → refused by the API");
  await shot("06-api-keys");

  // 9. Drain and resume the home node from the Provide page.
  await page.goto(`${WEB}/control/provide`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^drain$/i }).first().click();
  const drained = await until(async () => (await bearer("/nodes/mine")).body.nodes?.find((x: any) => x.state === "draining"), "a draining node", 20_000);
  check(!!drained, `node ${drained?.address.slice(0, 10)}… is draining after one click`);
  await until(() => page.getByText(/draining/).first().isVisible().catch(() => false), "the draining pill", 20_000);
  await page.getByRole("button", { name: /^resume$/i }).first().click();
  await until(async () => !(await bearer("/nodes/mine")).body.nodes?.some((x: any) => x.state !== "active"), "every node active again", 20_000);
  check(true, "resume puts it back to active");
  await shot("07-provide");

  // 10. Sign out ends the session at the API, not just in the tab.
  const old = (await session())!.token;
  await page.getByRole("button", { name: /sign out/i }).click();
  await until(async () => (await session()) === null, "the tab to forget the session", 10_000);
  await until(async () => (await json(`${API}/v1/account`, { headers: { authorization: `Bearer ${old}` } })).status === 401, "the old token to be refused", 20_000);
  check(true, "the session token is revoked at the API on sign-out");

  check(pageErrors.length === 0, `no uncaught page errors (${pageErrors.length})${pageErrors.length ? ": " + pageErrors.slice(0, 3).join(" | ") : ""}`);
  console.log(`console errors seen: ${consoleErrors.length}${consoleErrors.length ? "\n  " + [...new Set(consoleErrors)].slice(0, 8).join("\n  ") : ""}`);
  await browser.close();
}

main()
  .catch((e) => {
    check(false, `aborted: ${(e as Error).message}`);
  })
  .finally(() => {
    const summary = `BROWSER SMOKE: ${total - failed}/${total} checks passed${failed ? ` — ${failed} FAILED` : ""}`;
    console.log(`\n${summary}`);
    console.log(`logs and screenshots: ${OUT}`);
    try {
      writeFileSync(path.join(OUT, "summary.txt"), [...checks, "", summary, ""].join("\n"));
    } catch {
      /* best effort */
    }
    stopAll();
    setTimeout(() => process.exit(failed ? 1 : 0), 500);
  });
