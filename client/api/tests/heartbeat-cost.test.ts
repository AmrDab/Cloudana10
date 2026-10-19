/**
 * How many D1 statements one node heartbeat costs (ENGINEERING_BASELINE.md §8, backlog B-5). Heartbeats are the
 * control plane's dominant write load (every node, every 15 s), so the count is pinned here: a change that adds a
 * statement to the idle path must raise the bound on purpose.
 *
 * Counted: every prepared statement executed (run/first/all/raw) plus each statement inside a batch, through a
 * counting wrapper around the SQLite-backed D1 the tests use. Round trips (what D1 bills and what adds latency) are
 * counted separately: a batch is one round trip.
 */
import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";
import { privateKeyToAccount, generatePrivateKey, type PrivateKeyAccount } from "viem/accounts";
import { buildApp } from "../src/app.js";
import { getD1, getKV, initStorage } from "../src/lib/storage.js";
import { generateToken } from "../src/middleware/auth.js";
import { nodeSigningMessage } from "../src/middleware/node-auth.js";
import { creditUcld } from "../src/services/balance.service.js";

let app: ReturnType<typeof buildApp>;
let ipSeq = 0;
const counter = { statements: 0, roundTrips: 0 };

/** A D1 whose statements are counted; everything else is delegated. */
function countingD1(inner: D1Database): D1Database {
  const wrapStmt = (stmt: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(stmt, {
      get(target, prop, receiver) {
        const v = Reflect.get(target, prop, receiver);
        if (prop === "bind") return (...args: unknown[]) => wrapStmt((target as any).bind(...args));
        if (prop === "run" || prop === "first" || prop === "all" || prop === "raw") {
          return (...args: unknown[]) => {
            counter.statements++;
            counter.roundTrips++;
            return (v as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
  return new Proxy(inner, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver);
      if (prop === "prepare") return (sql: string) => wrapStmt((target as any).prepare(sql));
      if (prop === "batch") {
        return (stmts: D1PreparedStatement[]) => {
          counter.statements += stmts.length;
          counter.roundTrips++;
          return (target as any).batch(stmts);
        };
      }
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

function call(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", `10.8.${Math.floor(ipSeq / 250)}.${ipSeq++ % 250}`);
  return app.request(path, { ...init, headers });
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

async function measure(fn: () => Promise<unknown>) {
  counter.statements = 0;
  counter.roundTrips = 0;
  await fn();
  return { ...counter };
}

/** Numbers go to HEARTBEAT_COST_OUT (a file) when set, so a run can record them (TEST_EVIDENCE.md). */
function record(line: string) {
  console.log(line);
  if (process.env.HEARTBEAT_COST_OUT) appendFileSync(process.env.HEARTBEAT_COST_OUT, line + "\n");
}

const b64 = (s: string) => Buffer.from(s).toString("base64");
const SITE = { files: [{ path: "index.html", contentBase64: b64("<h1>hi</h1>") }] };

describe("heartbeat D1 cost", () => {
  const idle = privateKeyToAccount(generatePrivateKey());
  const busy = privateKeyToAccount(generatePrivateKey());

  beforeAll(async () => {
    await setupV1Db({ DEV_MODE: "true", NODE_ACTIVE_SECONDS: "45" });
    initStorage(countingD1(getD1()), getKV());
    app = buildApp({ runtime: "node" });
    for (const node of [idle, busy]) {
      const res = await signed(node, "/v1/nodes/announce", {
        manifest: { cpuThreads: 8, ramGB: 16, gpus: [], os: "test" },
        benchmarkMmacPerSec: 100,
        workTypes: ["matmul", "hosting"],
        pubkey: node.publicKey.slice(2),
        publicHost: "127.0.0.1",
        agentVersion: "1.5.0",
      });
      expect(res.status).toBe(200);
      await getD1().prepare("UPDATE nodes SET payout = ? WHERE address = ?").bind("0x" + "ab".repeat(20), node.address.toLowerCase()).run();
    }
    // The busy node runs one static site.
    const owner = "0x" + "cd".repeat(20);
    await creditUcld(owner, 10_000);
    const jwt = await generateToken(owner);
    const created = await call("/v1/deployments", {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "site", kind: "static", spec: SITE }),
    });
    expect(created.status).toBe(201);
    const { id } = await created.json();
    const hb = await signed(busy, "/v1/nodes/heartbeat", { agentVersion: "1.5.0" });
    expect((await hb.json()).deployments.map((d: { id: string }) => d.id)).toEqual([id]);
    expect((await signed(busy, `/v1/nodes/deployments/${id}/status`, { status: "running", endpoint: "http://127.0.0.1:42001" })).status).toBe(200);
  });

  it("an idle heartbeat (bound node, nothing live, nothing queued) stays within its statement budget", async () => {
    const warm = await measure(() => signed(idle, "/v1/nodes/heartbeat", { agentVersion: "1.5.0" }));
    const cost = await measure(() => signed(idle, "/v1/nodes/heartbeat", { agentVersion: "1.5.0" }));
    record(`idle heartbeat: ${cost.statements} statements in ${cost.roundTrips} round trips (warm-up ${warm.statements})`);
    expect(cost.statements).toBeLessThanOrEqual(IDLE_BUDGET);
  });

  it("a heartbeat with one running deployment stays within its budget: the beat that probes, and the steady beats after it", async () => {
    // Right after `running` the first probe is due: this beat probes (fetch + record) and re-reads the instructions.
    const probing = await measure(() => signed(busy, "/v1/nodes/heartbeat", { agentVersion: "1.5.0" }));
    record(`busy heartbeat (1 running site, probe due): ${probing.statements} statements in ${probing.roundTrips} round trips`);
    expect(probing.statements).toBeLessThanOrEqual(PROBING_BUDGET);
    // Until the next probe (60 s) or the next billable hour, a node serving a site costs the same as an idle one.
    const steady = await measure(() => signed(busy, "/v1/nodes/heartbeat", { agentVersion: "1.5.0" }));
    record(`busy heartbeat (1 running site, steady): ${steady.statements} statements in ${steady.roundTrips} round trips`);
    expect(steady.statements).toBeLessThanOrEqual(IDLE_BUDGET);
  });
});

// Budgets: raise these only on purpose, with the reason in the commit message (TEST_EVIDENCE.md records the history).
// 2026-10-19 before B-5: idle 13 statements / 12 round trips; with one running site (probe due) 15 / 14.
// 2026-10-19 after B-5:  idle 5 / 4; probing beat 10 / 9; steady beat with a running site 5 / 4.
const IDLE_BUDGET = 6;
const PROBING_BUDGET = 10;
