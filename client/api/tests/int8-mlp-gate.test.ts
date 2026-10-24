/**
 * The int8-mlp assignment gate (B-26 Phase 0 step 6): a work type with minAgent is drawn only among nodes on that
 * agent or newer; the network floor (MIN_AGENT_VERSION) and matmul eligibility are unchanged.
 */
import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import { randomInt8MlpInput } from "../../../shared/work-int8-mlp.js";
import { getD1 } from "../src/lib/storage.js";
import { creditUcld } from "../src/services/balance.service.js";
import { announceNode, touchNode } from "../src/services/nodes.service.js";
import { enqueueWorkJob, getWorkJob, runAssignment } from "../src/services/jobs.service.js";
import { minAgentVersion } from "../src/services/instruction-signing.service.js";

const user = "0x" + "6a".repeat(20);

async function node(agentVersion: string | null, workTypes: string[]) {
  const address = "0x" + randomBytes(20).toString("hex");
  await announceNode(address, { cpuThreads: 8, ramGB: 16, gpus: [], os: "test" }, 100, workTypes, undefined, agentVersion ? { agentVersion } : {});
  await getD1().prepare("UPDATE nodes SET payout = ? WHERE address = ?").bind("0x" + randomBytes(20).toString("hex"), address).run();
  return address;
}

/** Only `online` are online and idle; nothing else is queued. */
async function online(...nodes: string[]) {
  await getD1().prepare("UPDATE work_jobs SET status = 'failed' WHERE status IN ('queued','assigned')").run();
  await getD1().prepare("UPDATE nodes SET last_seen = 0").run();
  for (const n of nodes) await touchNode(n);
}

async function enqueue(workType: "matmul" | "int8-mlp") {
  const q =
    workType === "matmul"
      ? await enqueueWorkJob({ owner: user, workType, n: 8, matrixA: new Array(64).fill(1), matrixB: new Array(64).fill(2) })
      : await enqueueWorkJob({ owner: user, workType, input: randomInt8MlpInput(3) });
  if (!q.ok) throw new Error(q.message);
  await runAssignment();
  return (await getWorkJob(q.jobId))!;
}

describe("int8-mlp is drawn only among agents ≥ 1.7.0", () => {
  beforeAll(async () => {
    await setupV1Db({ CLUSTER_N_MIN: "1" });
    await creditUcld(user, 1_000_000_000);
  });

  it("the network floor is unchanged", () => {
    expect(minAgentVersion()).toBe("1.3.0");
  });

  it("a 1.6.0 node advertising int8-mlp is never drawn for it (the job stays queued)", async () => {
    const old = await node("1.6.0", ["matmul", "int8-mlp"]);
    for (let i = 0; i < 20; i++) {
      await online(old);
      expect(await enqueue("int8-mlp")).toMatchObject({ status: "queued", node: null });
    }
  });

  it("a node that never reported a version is never drawn for it", async () => {
    const unknown = await node(null, ["matmul", "int8-mlp"]);
    await online(unknown);
    expect(await enqueue("int8-mlp")).toMatchObject({ status: "queued", node: null });
  });

  it("a 1.7.0 node is; with both online every draw goes to it, and its eligible set excludes the old node", async () => {
    const old = await node("1.6.0", ["matmul", "int8-mlp"]);
    const fresh = await node("1.7.0", ["matmul", "int8-mlp"]);
    const newer = await node("1.10.0", ["int8-mlp"]);
    for (let i = 0; i < 20; i++) {
      await online(old, fresh, newer);
      const job = await enqueue("int8-mlp");
      expect(job.status).toBe("assigned");
      expect([fresh, newer]).toContain(job.node);
      expect((JSON.parse(job.eligible_json!) as { address: string }[]).map((c) => c.address).sort()).toEqual([fresh, newer].sort());
    }
  });

  it("a 1.7.0 node that does not advertise int8-mlp is not drawn for it", async () => {
    const matmulOnly = await node("1.7.0", ["matmul"]);
    await online(matmulOnly);
    expect(await enqueue("int8-mlp")).toMatchObject({ status: "queued", node: null });
  });

  it("matmul eligibility is unchanged: 1.6.0 and unversioned nodes are still drawn for matmul", async () => {
    const old = await node("1.6.0", ["matmul"]);
    await online(old);
    expect(await enqueue("matmul")).toMatchObject({ status: "assigned", node: old });
    const unknown = await node(null, ["matmul"]);
    await online(unknown);
    expect(await enqueue("matmul")).toMatchObject({ status: "assigned", node: unknown });
  });
});
