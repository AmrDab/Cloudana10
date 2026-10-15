/**
 * Job artifacts (docs/V4_STORAGE_PHASE1_CONTRACT.md §A): finished jobs' matrices move from D1 into the artifact
 * store; readers (owner's job view, verify feed) fall back to it; verify tasks no longer copy matrices into D1.
 */
import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { buildApp } from "../src/app.js";
import { getD1 } from "../src/lib/storage.js";
import { generateToken } from "../src/middleware/auth.js";
import { memoryArtifacts, setArtifactStore, type ArtifactStore } from "../src/lib/artifacts.js";
import { jobMatrices, moveJobArtifacts } from "../src/services/jobs.service.js";
import { nextVerifyTask } from "../src/services/verify-feed.service.js";

let app: ReturnType<typeof buildApp>;
let seq = 0;
const A = [1, 2, 3, 4];
const B = [5, 6, 7, 8];
const C = [19, 22, 43, 50];
const OWNER = "0x" + "a1".repeat(20);

/** A finished public 2×2 job, matrices inline, completed `ago` ms before now. */
async function doneJob(ago = 0, status = "done") {
  const id = `job-${++seq}`;
  await getD1()
    .prepare(
      "INSERT INTO work_jobs (id, owner, work_type, n, a_json, b_json, price_ucld, public, status, result_json, created_at, completed_at) " +
        "VALUES (?, ?, 'matmul', 2, ?, ?, 100, 1, ?, ?, ?, ?)",
    )
    .bind(id, OWNER, JSON.stringify(A), JSON.stringify(B), status, status === "done" ? JSON.stringify(C) : null, Date.now() - ago, Date.now() - ago)
    .run();
  return id;
}
const row = (id: string) => getD1().prepare("SELECT * FROM work_jobs WHERE id = ?").bind(id).first<Record<string, any>>();

beforeAll(async () => {
  await setupV1Db({ DEV_MODE: "true" });
  app = buildApp({ runtime: "node" });
});
beforeEach(async () => {
  await getD1().prepare("DELETE FROM work_jobs").run();
  setArtifactStore(null);
});

describe("moving finished jobs out of D1", () => {
  it("puts {n, A, B, C} in the store, then clears the columns; queued and failed jobs stay inline", async () => {
    const store = memoryArtifacts();
    setArtifactStore(store);
    const done = await doneJob();
    const queued = await doneJob(0, "queued");
    const failed = await doneJob(0, "failed");
    expect(await moveJobArtifacts()).toBe(1);
    expect(await row(done)).toMatchObject({ a_json: null, b_json: null, result_json: null, artifact: `jobs/${done}.json` });
    expect(JSON.parse(new TextDecoder().decode((await store.get(`jobs/${done}.json`))!))).toEqual({ n: 2, matrixA: A, matrixB: B, matrixC: C });
    for (const id of [queued, failed]) expect(await row(id)).toMatchObject({ a_json: JSON.stringify(A), artifact: null });
    expect(await jobMatrices((await row(done)) as any)).toEqual({ n: 2, matrixA: A, matrixB: B, matrixC: C });
    expect(await moveJobArtifacts()).toBe(0); // moved once
  });

  it("oldest first, at most `limit` a run", async () => {
    setArtifactStore(memoryArtifacts());
    const old = await doneJob(60_000);
    const fresh = await doneJob(0);
    expect(await moveJobArtifacts(1)).toBe(1);
    expect((await row(old))!.artifact).toBe(`jobs/${old}.json`);
    expect((await row(fresh))!.artifact).toBeNull();
  });

  it("does nothing without a store, and keeps the row when the put fails", async () => {
    const id = await doneJob();
    expect(await moveJobArtifacts()).toBe(0);
    const failing: ArtifactStore = {
      put: async () => {
        throw new Error("r2 down");
      },
      get: async () => null,
      delete: async () => undefined,
    };
    setArtifactStore(failing);
    expect(await moveJobArtifacts()).toBe(0);
    expect(await row(id)).toMatchObject({ a_json: JSON.stringify(A), result_json: JSON.stringify(C), artifact: null });
  });
});

describe("readers", () => {
  it("the owner still gets the result from a moved job; nobody else does", async () => {
    setArtifactStore(memoryArtifacts());
    const id = await doneJob();
    await moveJobArtifacts();
    const owner = await generateToken(OWNER);
    const res = await app.request(`/v1/jobs/${id}`, { headers: { Authorization: `Bearer ${owner}`, "cf-connecting-ip": "203.0.113.7" } });
    expect(res.status).toBe(200);
    expect((await res.json()).job.result).toEqual(C);
    const other = await generateToken("0x" + "b2".repeat(20));
    const res2 = await app.request(`/v1/jobs/${id}`, { headers: { Authorization: `Bearer ${other}`, "cf-connecting-ip": "203.0.113.8" } });
    expect((await res2.json()).job.result).toBeUndefined();
  });

  it("the verify feed serves a moved job and stores no matrices in verify_tasks", async () => {
    setArtifactStore(memoryArtifacts());
    const id = await doneJob();
    await moveJobArtifacts();
    let task;
    // 1 in PLANT_ONE_IN real tasks is planted (C corrupted); A and B always come from the job.
    do task = await nextVerifyTask();
    while (JSON.stringify(task.matrixC) !== JSON.stringify(C) && ++seq < 1000);
    expect(task).toMatchObject({ n: 2, matrixA: A, matrixB: B, matrixC: C });
    const stored = await getD1().prepare("SELECT * FROM verify_tasks WHERE id = ?").bind(task.taskId).first<Record<string, any>>();
    expect(stored).toMatchObject({ job_id: id, a_json: null, b_json: null, c_json: null, expected: "valid" });
  });

  it("a moved job whose artifact can't be read falls back to a generated task", async () => {
    await doneJob();
    setArtifactStore(memoryArtifacts());
    await moveJobArtifacts();
    setArtifactStore(memoryArtifacts()); // empty store: the artifact is gone
    const task = await nextVerifyTask();
    const stored = await getD1().prepare("SELECT job_id FROM verify_tasks WHERE id = ?").bind(task.taskId).first<{ job_id: string | null }>();
    expect(stored!.job_id).toBeNull();
  });
});
