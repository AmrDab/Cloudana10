/**
 * Golden snapshot of the matmul pipeline (Phase 0 step 1, recorded on main before the general verifier refactor):
 * every response of POST /v1/jobs and POST /v1/work/submit across the honest, refused, give-up and caught paths, and
 * the rows they leave in work_jobs, reward_entries, reward_claws, nodes and balances. Time, ids and keys are fixed, so
 * any change in what the matmul path does — a reason string, an SQL effect, a response field — changes the snapshot.
 */
import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { solveAssignedJob } from "../../../pouw/src/index.js";
import type { POUWCertificate } from "../../../pouw/src/types.js";
import { buildApp } from "../src/app.js";
import { getD1 } from "../src/lib/storage.js";
import { resetEnv } from "../src/config/env.js";
import { generateToken } from "../src/middleware/auth.js";
import { nodeSigningMessage } from "../src/middleware/node-auth.js";
import { creditUcld } from "../src/services/balance.service.js";
import { announceNode, touchNode } from "../src/services/nodes.service.js";
import { getActiveAssignment, sampledForCheck } from "../src/services/jobs.service.js";

const T0 = Date.UTC(2026, 9, 1, 12, 0, 0);
const P = 1_000_000_007;
const n = 8;
const A = Array.from({ length: n * n }, (_, i) => ((i * 7919) % 41) - 20);
const B = Array.from({ length: n * n }, (_, i) => ((i * 104_729) % 37) - 18);
const user = "0x" + "5e".repeat(20);
const nodeKey = privateKeyToAccount(("0x" + "11".repeat(32)) as `0x${string}`);
const node = nodeKey.address.toLowerCase();
const payout = "0x" + "77".repeat(20);
const device = "0x" + "22".repeat(32);
const SAMPLED = "1"; // VERIFY_SAMPLE_K = 1: every job's transcript is re-executed
const UNSAMPLED = "1000000000";

const WORK_JOB_COLS = [
  "id", "owner", "work_type", "n", "a_json", "b_json", "price_ucld", "public", "status", "node", "sigma", "seed_source",
  "draw_seed", "eligible_hash", "cluster_ok", "assigned_at", "expires_at", "result_json", "cert_z", "created_at",
  "completed_at", "attempts", "artifact", "eligible_json", "fee_captured_at", "sample_check",
];

let app: ReturnType<typeof buildApp>;
let now = T0;
let ip = 0;
let uuid = 0;
let jwt = "";

const digest = (s: string | null) => (s === null ? null : createHash("sha256").update(s).digest("hex").slice(0, 16));
/** Ten minutes later; the node is still online (heartbeats are not part of the snapshot). */
async function tick() {
  vi.setSystemTime((now += 10 * 60_000));
  await touchNode(node);
}
const setK = (k: string) => {
  process.env.VERIFY_SAMPLE_K = k;
  resetEnv();
};

function call(path: string, init: RequestInit) {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", `10.9.0.${ip++ % 250}`);
  return app.request(path, { ...init, headers });
}

async function json(res: Response) {
  return { http: res.status, body: await res.json() };
}

async function createJob() {
  const res = await call("/v1/jobs", {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify({ workType: "matmul", n, matrixA: A, matrixB: B }),
  });
  return json(res);
}

async function submit(payload: unknown) {
  const body = JSON.stringify(payload);
  const ts = String(Date.now());
  const nonce = randomBytes(16).toString("hex");
  const signature = await nodeKey.signMessage({ message: nodeSigningMessage("POST", "/v1/work/submit", ts, body, nonce) });
  return json(
    await call("/v1/work/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Node": nodeKey.address, "X-Node-Timestamp": ts, "X-Nonce": nonce, "X-Node-Signature": signature },
      body,
    }),
  );
}

async function assignment() {
  const a = await getActiveAssignment(node);
  expect(a).not.toBeNull();
  return a!;
}

/** Re-queued by a refusal: assign it to the node again (the node is the only one online). */
async function reassign() {
  await tick();
  const { runAssignment } = await import("../src/services/jobs.service.js");
  await runAssignment();
  return assignment();
}

const forged = (c: POUWCertificate): POUWCertificate => ({ ...c, transcriptHash: (c.transcriptHash[0] === "0" ? "1" : "0") + c.transcriptHash.slice(1) });

async function tables() {
  const db = getD1();
  const jobs = (await db.prepare(`SELECT ${WORK_JOB_COLS.join(", ")} FROM work_jobs ORDER BY created_at`).all<Record<string, string | null>>()).results ?? [];
  const entries = (await db.prepare("SELECT * FROM reward_entries ORDER BY job_id, lane").all<Record<string, unknown>>()).results ?? [];
  const label = new Map(entries.map((e) => [e.id as string, `${e.job_id}:${e.lane}`]));
  const claws = (await db.prepare("SELECT * FROM reward_claws").all<{ entry_id: string; job_id: string }>()).results ?? [];
  return {
    work_jobs: jobs.map((j) => ({ ...j, a_json: digest(j.a_json), b_json: digest(j.b_json), result_json: digest(j.result_json) })),
    reward_entries: entries.map(({ id: _id, ...e }) => e),
    reward_claws: claws.map((c) => ({ entry: label.get(c.entry_id), job_id: c.job_id })).sort((a, b) => `${a.entry}`.localeCompare(`${b.entry}`)),
    // bind_code is random per announce and not part of the work path.
    nodes: ((await db.prepare("SELECT * FROM nodes ORDER BY address").all<Record<string, unknown>>()).results ?? []).map((r) => ({ ...r, bind_code: "<random>" })),
    balances: (await db.prepare("SELECT * FROM balances ORDER BY address").all()).results,
  };
}

describe("matmul golden snapshot (responses + rows)", () => {
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(
      () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}` as `${string}-${string}-${string}-${string}-${string}`,
    );
    await setupV1Db({
      CLUSTER_N_MIN: "1",
      EPOCH_SECONDS: "3600",
      PAY_HOLD_SECONDS: "86400",
      VERIFY_SAMPLE_K: SAMPLED,
      VERIFY_WARMUP_JOBS: "0", // the snapshot covers the unsampled path; the warm-up has its own test (sampled-verification)
      JWT_SECRET: "golden-snapshot-secret-".padEnd(40, "g"),
      EPOCH_SUBSIDY_BUDGET_UCLD: "300000",
    });
    delete process.env.CHAIN_RPC_URL;
    resetEnv();
    app = buildApp({ runtime: "node" });
    jwt = await generateToken(user);
    await creditUcld(user, 1_000_000);
    await announceNode(node, { cpuThreads: 8, ramGB: 16, gpus: [], os: "test" }, 100, ["matmul"], undefined, { agentVersion: "1.6.0" });
    await getD1().prepare("UPDATE nodes SET payout = ? WHERE address = ?").bind(payout, node).run();
  });
  afterAll(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("records every response and the final rows", async () => {
    const out: Record<string, unknown> = {};

    // 1. honest, sampled → paid, sample_check 'passed'
    setK(SAMPLED);
    await tick();
    out.honestSampledCreate = await createJob();
    let a = await assignment();
    expect(sampledForCheck(a.jobId, a.sigma)).toBe(true);
    let s = solveAssignedJob(a.sigma, A, B, n, node, device);
    out.honestSampled = await submit({ jobId: a.jobId, certificate: s.certificate, result: s.result });

    // 2. honest, not sampled → paid, sample_check null
    setK(UNSAMPLED);
    await tick();
    out.honestUnsampledCreate = await createJob();
    a = await assignment();
    expect(sampledForCheck(a.jobId, a.sigma)).toBe(false);
    s = solveAssignedJob(a.sigma, A, B, n, node, device);
    out.honestUnsampled = await submit({ jobId: a.jobId, certificate: s.certificate, result: s.result });

    // 3. one job refused three times: wrong C, C + p, a certificate under another σ → failed, hold released
    setK(SAMPLED);
    await tick();
    out.refusedCreate = await createJob();
    a = await assignment();
    s = solveAssignedJob(a.sigma, A, B, n, node, device);
    const wrong = s.result.slice();
    wrong[5] += 1;
    out.wrongC = await submit({ jobId: a.jobId, certificate: s.certificate, result: wrong });
    a = await reassign();
    s = solveAssignedJob(a.sigma, A, B, n, node, device);
    const shifted = s.result.slice();
    shifted[3] += P;
    out.cPlusP = await submit({ jobId: a.jobId, certificate: s.certificate, result: shifted });
    a = await reassign();
    s = solveAssignedJob("f".repeat(64), A, B, n, node, device);
    out.badSigmaGiveUp = await submit({ jobId: a.jobId, certificate: s.certificate, result: s.result });

    // 4. A-hash mismatch → refused, re-queued; then solved honestly
    await tick();
    out.aHashCreate = await createJob();
    a = await assignment();
    s = solveAssignedJob(a.sigma, A.map((v) => -v), B, n, node, device);
    out.aHashMismatch = await submit({ jobId: a.jobId, certificate: s.certificate, result: s.result });
    a = await reassign();
    s = solveAssignedJob(a.sigma, A, B, n, node, device);
    out.aHashThenHonest = await submit({ jobId: a.jobId, certificate: s.certificate, result: s.result });

    // 5. corrupt transcript, not sampled → accepted
    setK(UNSAMPLED);
    await tick();
    out.forgedUnsampledCreate = await createJob();
    a = await assignment();
    expect(sampledForCheck(a.jobId, a.sigma)).toBe(false);
    s = solveAssignedJob(a.sigma, A, B, n, node, device);
    out.forgedUnsampled = await submit({ jobId: a.jobId, certificate: forged(s.certificate), result: s.result });

    // 6. corrupt transcript, sampled → caught: result kept, wallet's held pay clawed, node suspended
    setK(SAMPLED);
    await tick();
    out.forgedSampledCreate = await createJob();
    a = await assignment();
    s = solveAssignedJob(a.sigma, A, B, n, node, device);
    out.forgedSampled = await submit({ jobId: a.jobId, certificate: forged(s.certificate), result: s.result });

    out.tables = await tables();
    expect(out).toMatchSnapshot();
  }, 60_000);
});
