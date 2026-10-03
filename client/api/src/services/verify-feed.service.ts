/**
 * Browser verifier feed (docs/BUILD_SPEC_V1.md §5 "Verifiers").
 * Tasks come from done public jobs; about 1 in 6 is planted with a corrupted C.
 * Correct verdicts earn credits (points, lane "verify") — never CLD.
 */
import { getD1 } from "../lib/storage.js";
import { getWorkType } from "./work-types.js";
import { recordVerifyCredit, verifyCredits } from "./ledger.service.js";

export const PLANT_ONE_IN = 6;

export interface VerifyTask {
  taskId: string;
  n: number;
  matrixA: number[];
  matrixB: number[];
  matrixC: number[];
}

function randomBelow(n: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % n;
}

export async function nextVerifyTask(): Promise<VerifyTask> {
  const db = getD1();
  const matmul = getWorkType("matmul")!;
  const job = await db
    .prepare(
      "SELECT id, n, a_json, b_json, result_json FROM work_jobs WHERE status = 'done' AND public = 1 AND work_type = 'matmul' " +
        "ORDER BY RANDOM() LIMIT 1",
    )
    .first<{ id: string; n: number; a_json: string; b_json: string; result_json: string }>();

  let jobId: string | null = null;
  let task;
  if (job) {
    jobId = job.id;
    const base = { n: job.n, matrixA: JSON.parse(job.a_json), matrixB: JSON.parse(job.b_json), matrixC: JSON.parse(job.result_json) };
    const planted = randomBelow(PLANT_ONE_IN) === 0;
    // Real task: C already passed the orchestrator's own verification → "valid".
    task = planted ? matmul.plantedTask(base, true) : { ...base, expected: "valid" as const };
    task = { ...task, planted };
  } else {
    // No public work yet: a generated known-answer task, valid or corrupted at random.
    const corrupt = randomBelow(2) === 0;
    task = { ...matmul.plantedTask(undefined, corrupt), planted: true };
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO verify_tasks (id, job_id, n, a_json, b_json, c_json, planted, expected, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id, jobId, task.n, JSON.stringify(task.matrixA), JSON.stringify(task.matrixB), JSON.stringify(task.matrixC), task.planted ? 1 : 0, task.expected, Date.now())
    .run();
  return { taskId: id, n: task.n, matrixA: task.matrixA, matrixB: task.matrixB, matrixC: task.matrixC };
}

export type VerdictResult =
  | { ok: true; correct: boolean; credits: number }
  | { ok: false; code: "not_found" | "conflict"; message: string };

export async function gradeVerdict(input: {
  taskId: string;
  session: string;
  verdict: "valid" | "invalid";
  address?: string;
}): Promise<VerdictResult> {
  const db = getD1();
  const task = await db.prepare("SELECT expected FROM verify_tasks WHERE id = ?").bind(input.taskId).first<{ expected: string }>();
  if (!task) return { ok: false, code: "not_found", message: "unknown task" };

  const correct = task.expected === input.verdict;
  const who = input.address ? input.address.toLowerCase() : `session:${input.session}`;
  try {
    await db
      .prepare("INSERT INTO verify_verdicts (id, task_id, session, address, verdict, correct, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), input.taskId, input.session, input.address?.toLowerCase() ?? null, input.verdict, correct ? 1 : 0, Date.now())
      .run();
  } catch (err) {
    if (/UNIQUE/i.test(String(err instanceof Error ? err.message : err))) {
      return { ok: false, code: "conflict", message: "this session already answered this task" };
    }
    throw err;
  }
  if (correct) await recordVerifyCredit(who, input.taskId);
  return { ok: true, correct, credits: await verifyCredits(who) };
}
