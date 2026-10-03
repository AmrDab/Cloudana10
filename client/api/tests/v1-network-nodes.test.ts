import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app.js";
import { getD1 } from "../src/lib/storage.js";
import { generateToken } from "../src/middleware/auth.js";
import { announceNode } from "../src/services/nodes.service.js";

let app: ReturnType<typeof buildApp>;
let ipSeq = 0;

function call(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", `10.2.${Math.floor(ipSeq / 250)}.${ipSeq++ % 250}`);
  return app.request(path, { ...init, headers });
}

const payer = "0x" + "11".repeat(20);
const provider = "0x" + "22".repeat(20);
const nodeA = "0x" + "aa".repeat(20);
const nodeB = "0x" + "bb".repeat(20);
const stranger = "0x" + "cc".repeat(20);

async function insertJob(id: string, status: string, completedAt: number | null, opts: { public?: number; node?: string } = {}) {
  await getD1()
    .prepare(
      "INSERT INTO work_jobs (id, owner, work_type, n, a_json, b_json, price_ucld, public, status, node, cert_z, created_at, completed_at) " +
        "VALUES (?, ?, 'matmul', 16, '[]', '[]', 5, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id, payer, opts.public ?? 1, status, opts.node ?? nodeA, status === "done" ? `z-${id}` : null, 1, completedAt)
    .run();
}

async function insertReward(jobId: string, address: string, lane: string, amount: number, status = "pending") {
  await getD1()
    .prepare(
      "INSERT INTO reward_entries (id, job_id, epoch, address, lane, work_type, amount_ucld, vests_at, status, created_at) " +
        "VALUES (?, ?, 1, ?, ?, 'matmul', ?, 0, ?, 0)",
    )
    .bind(crypto.randomUUID(), jobId, address, lane, amount, status)
    .run();
}

beforeAll(async () => {
  await setupV1Db();
  app = buildApp({ runtime: "node" });

  for (let i = 0; i < 14; i++) await insertJob(`done-${i}`, "done", 1_000 + i);
  await insertJob("private-latest", "done", 9_999, { public: 0 });
  await insertJob("queued-1", "queued", null);
  await insertJob("b-job", "done", 500, { node: nodeB });

  // Rewards: lanes A+B count toward earnedUcld; treasury, clawed and other wallets don't.
  await insertReward("done-0", provider, "A", 975);
  await insertReward("done-0", provider, "B", 250);
  await insertReward("done-1", provider, "A", 100, "clawed");
  await insertReward("done-0", "0x" + "99".repeat(20), "treasury", 5);
  await insertReward("b-job", provider, "A", 40);

  const manifest = { cpuThreads: 8, ramGB: 16, gpus: [], os: "linux" };
  await announceNode(nodeA, manifest, 123, ["matmul"]);
  await announceNode(nodeB, manifest, 45, ["matmul"]);
  await announceNode(stranger, manifest, 1, ["matmul"]);
  await getD1().prepare("UPDATE nodes SET payout = ?, bound_at = 1, jobs_done = 14 WHERE address = ?").bind(provider, nodeA).run();
  await getD1().prepare("UPDATE nodes SET payout = ?, bound_at = 2, jobs_done = 1, last_seen = 0 WHERE address = ?").bind(provider, nodeB).run();
});

describe("GET /v1/network/recent", () => {
  it("lists the last 12 finished public jobs, newest first, without owner info", async () => {
    const res = await call("/v1/network/recent");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("60");
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.jobs).toHaveLength(12);
    expect(body.jobs.map((j: { id: string }) => j.id)).toEqual(Array.from({ length: 12 }, (_, i) => `done-${13 - i}`));
    expect(body.jobs[0]).toEqual({ id: "done-13", n: 16, workType: "matmul", node: nodeA, z: "z-done-13", priceUcld: 5, finishedAt: 1013 });
    for (const j of body.jobs) expect(Object.keys(j).sort()).toEqual(["finishedAt", "id", "n", "node", "priceUcld", "workType", "z"]);
    expect(JSON.stringify(body)).not.toContain(payer);
  });
});

describe("GET /v1/nodes/mine", () => {
  it("requires a JWT", async () => {
    expect((await call("/v1/nodes/mine")).status).toBe(401);
    expect((await call("/v1/nodes/mine", { headers: { Authorization: "Bearer nope" } })).status).toBe(401);
  });

  it("lists only the caller's nodes with liveness and earnings", async () => {
    const res = await call("/v1/nodes/mine", { headers: { Authorization: `Bearer ${await generateToken(provider)}` } });
    expect(res.status).toBe(200);
    const { nodes } = await res.json();
    expect(nodes.map((n: { address: string }) => n.address)).toEqual([nodeA, nodeB]);
    expect(nodes[0]).toEqual({
      address: nodeA,
      lastSeen: expect.any(Number),
      online: true,
      boundAt: 1,
      manifest: { cpuThreads: 8, ramGB: 16, gpus: [], os: "linux", benchmarkMmacPerSec: 123 },
      throughputMmacPerSec: 1,
      workTypes: ["matmul"],
      fleetId: null,
      jobsDone: 14,
      jobsFailed: 0,
      earnedUcld: 1225,
      deploymentsRunning: 0,
    });
    expect(nodes[1]).toMatchObject({ address: nodeB, online: false, earnedUcld: 40, jobsDone: 1 });
  });

  it("is empty for a wallet with no nodes", async () => {
    const res = await call("/v1/nodes/mine", { headers: { Authorization: `Bearer ${await generateToken(payer)}` } });
    expect(await res.json()).toEqual({ status: "success", nodes: [] });
  });
});
