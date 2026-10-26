/**
 * Challenge-mode inputs in the artifact store (B-26 follow-up): stored there at enqueue with only the key and hash in
 * D1 (in D1 when no store is configured); served by GET /v1/work/jobs/{id}/input only to the node the job is assigned
 * to; heartbeats of agents ≥ 1.9.0 carry the hash, not the input, older agents still get it inline; and a large
 * int8-model job (d = h = 128, L = 8) end to end over HTTP on the Node runtime.
 */
import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { privateKeyToAccount, generatePrivateKey, type PrivateKeyAccount } from "viem/accounts";
import { buildApp } from "../src/app.js";
import { getD1 } from "../src/lib/storage.js";
import { memoryArtifacts, setArtifactStore } from "../src/lib/artifacts.js";
import { nodeSigningMessage } from "../src/middleware/node-auth.js";
import { generateToken } from "../src/middleware/auth.js";
import { creditUcld } from "../src/services/balance.service.js";
import { enqueueWorkJob, getWorkJob, sha256 } from "../src/services/jobs.service.js";
import { makeCommitment, type SegmentOpening, type Tensor, type TensorRef } from "../../../shared/verification.js";
import { randomInt8MlpInput } from "../../../shared/work-int8-mlp.js";
import { executeInt8Model, int8ModelInputs, int8ModelPlan, randomInt8ModelInput } from "../../../shared/work-int8-model.js";
import { ENV, user } from "./helpers/sampled.js";

let app: ReturnType<typeof buildApp>;
let store: ReturnType<typeof memoryArtifacts>;
let seq = 0;

function call(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", `198.51.100.${++seq % 250}`);
  return app.request(path, { ...init, headers });
}

async function signed(node: PrivateKeyAccount, method: "GET" | "POST", path: string, payload?: unknown) {
  const body = method === "GET" ? "" : JSON.stringify(payload ?? {});
  const ts = String(Date.now());
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const signature = await node.signMessage({ message: nodeSigningMessage(method, path, ts, body, nonce) });
  return call(path, {
    method,
    headers: { "Content-Type": "application/json", "X-Node": node.address, "X-Node-Timestamp": ts, "X-Nonce": nonce, "X-Node-Signature": signature },
    ...(method === "POST" ? { body } : {}),
  });
}

/** An announced, bound node on `agent`; the only one online. */
async function onlyNode(agent: string): Promise<PrivateKeyAccount> {
  const n = privateKeyToAccount(generatePrivateKey());
  const res = await signed(n, "POST", "/v1/nodes/announce", {
    manifest: { cpuThreads: 8, ramGB: 16, gpus: [], os: "linux" },
    benchmarkMmacPerSec: 100,
    workTypes: ["matmul", "int8-mlp", "int8-model"],
    agentVersion: agent,
  });
  expect(res.status).toBe(200);
  await getD1().prepare("UPDATE work_jobs SET status = 'failed' WHERE status IN ('queued','assigned')").run();
  await getD1().prepare("UPDATE nodes SET last_seen = 0").run();
  await getD1().prepare("UPDATE nodes SET payout = ?, last_seen = ? WHERE address = ?").bind("0x" + (++seq).toString(16).padStart(40, "d"), Date.now(), n.address.toLowerCase()).run();
  return n;
}

const heartbeat = async (n: PrivateKeyAccount, agentVersion: string) => (await (await signed(n, "POST", "/v1/nodes/heartbeat", { agentVersion })).json()) as any;

beforeAll(async () => {
  await setupV1Db({ ...ENV, JWT_SECRET: "challenge-inputs-test-".padEnd(40, "c"), CHALLENGE_TTL_SECONDS: "60" });
  app = buildApp({ runtime: "node" });
  await creditUcld(user, 1_000_000_000_000);
});
beforeEach(() => {
  store = memoryArtifacts();
  setArtifactStore(store);
});
afterAll(() => setArtifactStore(null));

describe("challenge-mode inputs: stored", () => {
  it("int8-mlp and int8-model: the input is in the artifact store; D1 keeps only its key and hash", async () => {
    for (const [workType, input] of [["int8-mlp", randomInt8MlpInput(3, 2, 16, 32)], ["int8-model", randomInt8ModelInput(4, 3)]] as const) {
      const q = await enqueueWorkJob({ owner: user, workType, input });
      if (!q.ok) throw new Error(q.message);
      const row = (await getWorkJob(q.jobId))!;
      expect(row).toMatchObject({ input_json: null, input_ref: `jobs/${q.jobId}.input.json` });
      const text = new TextDecoder().decode((await store.get(row.input_ref!))!);
      expect(JSON.parse(text)).toEqual(input);
      expect(row.input_hash).toBe(sha256(text));
    }
  });

  it("with no artifact store (Node runtime default) the input stays in D1, with its hash", async () => {
    setArtifactStore(null);
    const input = randomInt8ModelInput(5, 2);
    const q = await enqueueWorkJob({ owner: user, workType: "int8-model", input });
    if (!q.ok) throw new Error(q.message);
    const row = (await getWorkJob(q.jobId))!;
    expect(row).toMatchObject({ input_ref: null, input_hash: sha256(row.input_json!) });
    expect(JSON.parse(row.input_json!)).toEqual(input);
  });

  it("a failed put queues nothing and releases the hold", async () => {
    setArtifactStore({ ...memoryArtifacts(), put: async () => Promise.reject(new Error("r2 down")) });
    const before = await getD1().prepare("SELECT held_ucld FROM balances WHERE address = ?").bind(user).first<{ held_ucld: number }>();
    await expect(enqueueWorkJob({ owner: user, workType: "int8-model", input: randomInt8ModelInput(6, 2) })).rejects.toThrow(/r2 down/);
    const after = await getD1().prepare("SELECT held_ucld FROM balances WHERE address = ?").bind(user).first<{ held_ucld: number }>();
    expect(after!.held_ucld).toBe(before!.held_ucld);
  });
});

describe("challenge-mode inputs: delivered", () => {
  it("an agent below 1.9.0 still gets the input inline (int8-mlp on 1.8.0), read from the store", async () => {
    const n = await onlyNode("1.8.0");
    const input = randomInt8MlpInput(7, 2, 16, 32);
    const q = await enqueueWorkJob({ owner: user, workType: "int8-mlp", input });
    if (!q.ok) throw new Error(q.message);
    const hb = await heartbeat(n, "1.8.0");
    expect(hb.assignment).toMatchObject({ jobId: q.jobId, workType: "int8-mlp", input, inputHash: (await getWorkJob(q.jobId))!.input_hash });
  });

  it("a large int8-model job (d = h = 128, L = 8) end to end: hash in the heartbeat, input fetched by the assigned node only", async () => {
    const node = await onlyNode("1.9.0");
    const other = await onlyNode("1.9.0"); // announced, signed, but not the one drawn
    await getD1().prepare("UPDATE nodes SET last_seen = ? WHERE address = ?").bind(Date.now(), node.address.toLowerCase()).run();
    await getD1().prepare("UPDATE nodes SET last_seen = 0 WHERE address = ?").bind(other.address.toLowerCase()).run();
    const input = randomInt8ModelInput(8, 8, 64, 128, 128);
    const jwt = await generateToken(user);
    const created = await call("/v1/jobs", {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ workType: "int8-model", input }),
    });
    expect(created.status).toBe(200);
    const { jobId } = (await created.json()) as { jobId: string };
    expect((await getWorkJob(jobId))!).toMatchObject({ status: "assigned", node: node.address.toLowerCase(), input_json: null });

    // The heartbeat carries the hash, not the ~0.7 MB input.
    const hbRes = await signed(node, "POST", "/v1/nodes/heartbeat", { agentVersion: "1.9.0" });
    const hbText = await hbRes.text();
    expect(hbText.length).toBeLessThan(10_000);
    const a = JSON.parse(hbText).assignment;
    expect(a).toMatchObject({ jobId, workType: "int8-model", n: 128 });
    expect(a.input).toBeUndefined();

    // Only the assigned node gets the input; it hashes to the signed inputHash.
    const path = `/v1/work/jobs/${jobId}/input`;
    expect((await signed(other, "GET", path)).status).toBe(404);
    expect((await call(path)).status).toBe(401);
    const got = await signed(node, "GET", path);
    expect(got.status).toBe(200);
    const text = await got.text();
    expect(sha256(text)).toBe(a.inputHash);
    expect(JSON.parse(text)).toEqual(input);

    // Commit, challenge, answer over HTTP.
    const fetched = JSON.parse(text);
    const plan = int8ModelPlan(fetched);
    const { outputs, result } = executeInt8Model(fetched);
    const commitment = makeCommitment(a.sigma, int8ModelInputs(fetched), plan, outputs);
    const sub = await signed(node, "POST", "/v1/work/submit", { jobId, commitment, result });
    expect(sub.status).toBe(200);
    const { challenge } = (await sub.json()) as { challenge: { segments: number[] } };
    expect(challenge.segments).toHaveLength(8);
    const openings: SegmentOpening[] = challenge.segments.map((idx) => {
      const tensors: Partial<Record<TensorRef, Tensor>> = { [`seg:${idx}`]: outputs[idx] };
      for (const r of plan[idx].inputs) if (r.startsWith("seg:")) tensors[r] = outputs[Number(r.slice(4))];
      return { idx, tensors };
    });
    const ans = await signed(node, "POST", "/v1/work/answer", { jobId, openings });
    expect(ans.status, await ans.clone().text()).toBe(200);
    expect((await getWorkJob(jobId))!).toMatchObject({ status: "done", sample_check: "passed" });

    const job = (await (await call(`/v1/jobs/${jobId}`, { headers: { Authorization: `Bearer ${jwt}` } })).json()) as any;
    expect(job.job.result).toEqual(result.data);
    // Done: no longer served, not even to the node that ran it.
    expect((await signed(node, "GET", path)).status).toBe(404);
  }, 120_000);
});
