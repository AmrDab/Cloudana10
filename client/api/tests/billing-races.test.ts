/**
 * Hosting bills under concurrency (SECURITY_AUDIT F10): every path that captures from an owner's hold claims the
 * exact amount and billing clock it read, so two writers that read the same row never charge the same hour twice,
 * a stop that lands mid-bill never leaves an hour stranded on a stopped row, and an hour that could not be charged
 * is said so instead of "billed".
 */
import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { privateKeyToAccount, generatePrivateKey, type PrivateKeyAccount } from "viem/accounts";

// `hold` with a trap: the test arms a function that runs right before the next hold — the window inside bill()
// between its claim of the hour and its re-hold, where a stop can land.
const trap = vi.hoisted(() => ({ fn: null as null | (() => Promise<void>) }));
vi.mock("../src/services/balance.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/balance.service.js")>();
  return {
    ...actual,
    hold: async (address: string, ucld: number) => {
      const t = trap.fn;
      trap.fn = null;
      if (t) await t();
      return actual.hold(address, ucld);
    },
  };
});

import { buildApp } from "../src/app.js";
import { getD1 } from "../src/lib/storage.js";
import { generateToken } from "../src/middleware/auth.js";
import { nodeSigningMessage } from "../src/middleware/node-auth.js";
import { creditUcld, getBalanceUcld } from "../src/services/balance.service.js";
import { endDeployment, getDeploymentRow } from "../src/services/deployments.service.js";

let app: ReturnType<typeof buildApp>;
let ipSeq = 0;
let userSeq = 0;
const MIN = 60_000;

function call(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", `10.11.${Math.floor(ipSeq / 250)}.${ipSeq++ % 250}`);
  return app.request(path, { ...init, headers });
}
function authed(jwt: string, method: string, path: string, body?: unknown) {
  return call(path, {
    method,
    headers: { Authorization: `Bearer ${jwt}`, ...(body !== undefined && { "Content-Type": "application/json" }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}
async function signed(node: PrivateKeyAccount, path: string, payload: unknown = {}) {
  const body = JSON.stringify(payload);
  const ts = String(Date.now());
  const nonce = randomBytes(16).toString("hex");
  const signature = await node.signMessage({ message: nodeSigningMessage("POST", path, ts, body, nonce) });
  return call(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Node": node.address, "X-Node-Timestamp": ts, "X-Nonce": nonce, "X-Node-Signature": signature },
    body,
  });
}
async function boundNode() {
  const node = privateKeyToAccount(generatePrivateKey());
  const res = await signed(node, "/v1/nodes/announce", {
    manifest: { cpuThreads: 8, ramGB: 16, gpus: [], os: "linux" },
    benchmarkMmacPerSec: 100,
    workTypes: ["matmul", "hosting"],
    pubkey: node.publicKey.slice(2),
    publicHost: "127.0.0.1",
    agentVersion: "1.5.0",
  });
  expect(res.status).toBe(200);
  const payout = "0x" + (++userSeq).toString(16).padStart(40, "e");
  await getD1().prepare("UPDATE nodes SET payout = ?, fleet_id = 'flt_test' WHERE address = ?").bind(payout, node.address.toLowerCase()).run();
  return node;
}
async function user(credits = 10_000) {
  const addr = "0x" + (++userSeq).toString(16).padStart(40, "b");
  await creditUcld(addr, credits);
  return { addr, jwt: await generateToken(addr) };
}
const b64 = (s: string) => Buffer.from(s).toString("base64");
const SITE = { files: [{ path: "index.html", contentBase64: b64("<h1>hi</h1>") }] };
const row = (id: string) => getD1().prepare("SELECT * FROM deployments WHERE id = ?").bind(id).first<Record<string, any>>();
const shift = (id: string, col: string, ms: number) => getD1().prepare(`UPDATE deployments SET ${col} = ${col} - ? WHERE id = ?`).bind(ms, id).run();
const bills = async (id: string) => (await getD1().prepare("SELECT COUNT(*) AS n FROM deployment_bills WHERE deployment_id = ?").bind(id).first<{ n: number }>())!.n;
const events = async (jwt: string, id: string) => ((await (await authed(jwt, "GET", `/v1/deployments/${id}`)).json()).events as { level: string; message: string }[]).map((e) => `${e.level}: ${e.message}`);

/** A static site running on a fresh node with its hour due; the owner started with 10 000 µCLD (50 held). */
async function siteWithHourDue() {
  const u = await user();
  const node = await boundNode();
  const id = (await (await authed(u.jwt, "POST", "/v1/deployments", { name: "site", kind: "static", spec: SITE })).json()).id as string;
  expect((await signed(node, "/v1/nodes/heartbeat")).status).toBe(200);
  expect((await signed(node, `/v1/nodes/deployments/${id}/status`, { status: "running", endpoint: `http://127.0.0.1:${42100 + userSeq}` })).status).toBe(200);
  const fee = (await row(id))!.price_ucld_per_hour as number;
  expect(fee).toBe(50);
  expect(await getBalanceUcld(u.addr)).toEqual({ balanceUcld: 10_000 - fee, heldUcld: fee });
  await shift(id, "last_billed_at", 61 * MIN);
  return { u, node, id, fee };
}

beforeAll(async () => {
  await setupV1Db({ DEV_MODE: "true" });
  app = buildApp({ runtime: "node" });
});
beforeEach(() => {
  // Probes pass (the site serves its bytes); they are not what these tests are about.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<h1>hi</h1>", { status: 200 })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  trap.fn = null;
});

describe("hosting bills under concurrency", () => {
  it("a stop that read the row before a bill ran settles against the bill's clock, not its own: one hour paid, nothing stranded", async () => {
    const { u, node, id, fee } = await siteWithHourDue();
    const stale = (await getDeploymentRow(id))!; // held 50, the old clock
    expect((await signed(node, "/v1/nodes/heartbeat")).status).toBe(200); // bill: charges the hour, re-holds 50, moves the clock
    expect(await bills(id)).toBe(1);
    expect(await getBalanceUcld(u.addr)).toEqual({ balanceUcld: 10_000 - 2 * fee, heldUcld: fee });
    // The owner's stop, carrying the snapshot from before the bill.
    expect(await endDeployment(stale, "stopped", "stopped by owner", { acked: true })).toBe(true);
    expect(await bills(id)).toBe(1); // the seconds since the bill are not "a full hour"
    expect(await row(id)).toMatchObject({ status: "stopped", held_ucld: 0 });
    expect(await getBalanceUcld(u.addr)).toEqual({ balanceUcld: 10_000 - fee, heldUcld: 0 });
  });

  it("a stop that lands between a bill's claim and its re-hold: the re-hold goes back to the owner instead of onto the stopped row", async () => {
    const { u, node, id, fee } = await siteWithHourDue();
    let stopped = false;
    trap.fn = async () => {
      const fresh = (await getDeploymentRow(id))!;
      expect(fresh).toMatchObject({ status: "running", held_ucld: 0 }); // claimed, not yet re-held
      stopped = await endDeployment(fresh, "stopped", "stopped by owner", { acked: true }); // its settle finds nothing held
    };
    expect((await signed(node, "/v1/nodes/heartbeat")).status).toBe(200);
    expect(stopped).toBe(true);
    expect(await bills(id)).toBe(1);
    expect(await row(id)).toMatchObject({ status: "stopped", held_ucld: 0 });
    expect(await getBalanceUcld(u.addr)).toEqual({ balanceUcld: 10_000 - fee, heldUcld: 0 }); // one hour paid, nothing held for ever
  });

  it("an hour whose hold is missing is reported as not charged — never as billed — and nothing is paid out for it", async () => {
    const { u, node, id, fee } = await siteWithHourDue();
    // The pool no longer holds the hour (a state the claims above make unreachable; here forced).
    await getD1().prepare("UPDATE balances SET held_ucld = 0 WHERE address = ?").bind(u.addr).run();
    expect((await signed(node, "/v1/nodes/heartbeat")).status).toBe(200);
    expect(await bills(id)).toBe(0);
    const log = await events(u.jwt, id);
    expect(log).toContain(`warn: hour of ${fee} µCLD not charged: the owner's hold for it was missing (nothing captured, nothing paid out) — needs reconciliation`);
    expect(log.some((e) => e.includes("billed"))).toBe(false);
    // The next hour is held again and the site keeps running.
    expect(await row(id)).toMatchObject({ status: "running", held_ucld: fee });
    expect(await getBalanceUcld(u.addr)).toEqual({ balanceUcld: 10_000 - 2 * fee, heldUcld: fee });
  });
});
