/** Shared fixtures of the sampled-verification tests (ENGINEERING_BACKLOG B-6). Import after ./v1-db.js. */
import { expect } from "vitest";
import { randomBytes } from "node:crypto";
import { solveAssignedJob } from "../../../../pouw/src/index.js";
import type { POUWCertificate } from "../../../../pouw/src/types.js";
import { resetEnv } from "../../src/config/env.js";
import { getD1 } from "../../src/lib/storage.js";
import { announceNode, touchNode } from "../../src/services/nodes.service.js";
import { enqueueWorkJob, getActiveAssignment, runAssignment } from "../../src/services/jobs.service.js";

export const HOUR = 3_600_000;
export const n = 8;
export const A = Array.from({ length: n * n }, (_, i) => ((i * 7919) % 41) - 20);
export const B = Array.from({ length: n * n }, (_, i) => ((i * 104_729) % 37) - 18);
export const user = "0x" + "5e".repeat(20);
export const ENV = { CLUSTER_N_MIN: "1", EPOCH_SECONDS: "3600", PAY_HOLD_SECONDS: "86400", VERIFY_SAMPLE_K: "10" };

export function setEnv(vars: Record<string, string>): void {
  Object.assign(process.env, vars);
  resetEnv();
}

/** A node bound to `payout` (default: a wallet of its own); `fleetId` makes it a fleet-token node. */
export async function freshNode(
  payout = "0x" + randomBytes(20).toString("hex"),
  fleetId: string | null = null,
): Promise<{ node: string; payout: string }> {
  const node = "0x" + randomBytes(20).toString("hex");
  await announceNode(node, { cpuThreads: 8, ramGB: 16, gpus: [], os: "test" }, 100, ["matmul"]);
  await getD1().prepare("UPDATE nodes SET payout = ?, fleet_id = ? WHERE address = ?").bind(payout, fleetId, node).run();
  await touchNode(node);
  return { node, payout };
}

/** The right answer with a transcript hash that is not the one the work produces. */
export const forged = (c: POUWCertificate): POUWCertificate => ({
  ...c,
  transcriptHash: (c.transcriptHash[0] === "0" ? "1" : "0") + c.transcriptHash.slice(1),
});

/**
 * Enqueue a job, let `node` draw it as the only node online (a test file shares one in-memory database), and solve
 * it; `forge` submits a wrong transcript.
 */
export async function nextJob(node: string, forge = false) {
  await getD1().prepare("UPDATE nodes SET last_seen = 0 WHERE address <> ?").bind(node).run();
  await touchNode(node);
  const q = await enqueueWorkJob({ owner: user, workType: "matmul", n, matrixA: A, matrixB: B });
  if (!q.ok) throw new Error(q.message);
  await runAssignment();
  const a = await getActiveAssignment(node);
  expect(a?.jobId).toBe(q.jobId);
  const { certificate, result } = solveAssignedJob(a!.sigma, A, B, n, node, "dev");
  return { jobId: q.jobId, sigma: a!.sigma, certificate: forge ? forged(certificate) : certificate, result };
}

/** lane:status of every reward entry of each job. */
export async function entryStates(jobIds: string[]): Promise<Record<string, string[]>> {
  const rows = await getD1()
    .prepare(`SELECT job_id, lane, status FROM reward_entries WHERE job_id IN (${jobIds.map(() => "?").join(",")}) ORDER BY lane`)
    .bind(...jobIds)
    .all<{ job_id: string; lane: string; status: string }>();
  const out: Record<string, string[]> = Object.fromEntries(jobIds.map((id) => [id, []]));
  for (const r of rows.results ?? []) out[r.job_id].push(`${r.lane}:${r.status}`);
  return out;
}
