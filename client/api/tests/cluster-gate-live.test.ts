/**
 * The cluster gate counts live operators, busy ones too (owner decision D2, 2026-10-28): three operators online and
 * two of them on a job still make a cluster of three. Before, the gate saw only the idle nodes and withheld lane B on
 * 68–80 % of jobs in the three-node simulation (docs/POUW_SIMULATION_REPORT.md).
 */
import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll } from "vitest";
import { getD1 } from "../src/lib/storage.js";
import { creditUcld } from "../src/services/balance.service.js";
import { enqueueWorkJob } from "../src/services/jobs.service.js";
import { A, B, freshNode, n, user } from "./helpers/sampled.js";

describe("cluster gate over live operators", () => {
  beforeAll(async () => {
    await setupV1Db({ CLUSTER_N_MIN: "3", CLUSTER_S_CAP: "0.5", VERIFY_WARMUP_JOBS: "0" });
    await creditUcld(user, 1_000_000);
  });

  it("three operators, jobs queued back to back: every job keeps its subsidy", async () => {
    const nodes = [await freshNode(), await freshNode(), await freshNode()];
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const q = await enqueueWorkJob({ owner: user, workType: "matmul", n, matrixA: A, matrixB: B });
      if (!q.ok) throw new Error(q.message);
      ids.push(q.jobId);
    }
    const rows = await getD1()
      .prepare(`SELECT id, status, node, cluster_ok FROM work_jobs WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY created_at`)
      .bind(...ids)
      .all<{ id: string; status: string; node: string; cluster_ok: number }>();
    // Each job took one node at enqueue, so the second and third draws had two and one idle nodes.
    expect(rows.results!.map((r) => r.status)).toEqual(["assigned", "assigned", "assigned"]);
    expect(new Set(rows.results!.map((r) => r.node)).size).toBe(3);
    expect(rows.results!.map((r) => r.cluster_ok)).toEqual([1, 1, 1]);
    expect(nodes.length).toBe(3);
  });

  it("two operators only: lane B withheld, however many nodes are idle", async () => {
    await getD1().prepare("UPDATE nodes SET last_seen = 0").run();
    const wallet = await freshNode();
    await freshNode(wallet.payout);
    await freshNode();
    const q = await enqueueWorkJob({ owner: user, workType: "matmul", n, matrixA: A, matrixB: B });
    if (!q.ok) throw new Error(q.message);
    const row = await getD1().prepare("SELECT status, cluster_ok FROM work_jobs WHERE id = ?").bind(q.jobId).first<{ status: string; cluster_ok: number }>();
    expect(row).toEqual({ status: "assigned", cluster_ok: 0 });
  });
});
