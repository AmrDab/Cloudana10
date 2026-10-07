import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { solveAssignedJob } from "../../../pouw/src/index.js";
import { creditUcld, getBalanceUcld } from "../src/services/balance.service.js";
import { announceNode, bindNode, bindingMessage, getNode, touchNode } from "../src/services/nodes.service.js";
import { enqueueWorkJob, getActiveAssignment, getWorkJob, runAssignment, submitWork, type Assignment } from "../src/services/jobs.service.js";
import { ledgerSummary } from "../src/services/ledger.service.js";

const n = 16;
const rand = () => Array.from({ length: n * n }, (_, i) => ((i * 7919) % 41) - 20);
const A = rand();
const B = rand().reverse();

const user = "0x0000000000000000000000000000000000000001";
const node = privateKeyToAccount(generatePrivateKey());
const payout = privateKeyToAccount(generatePrivateKey());
const nodeAddr = node.address.toLowerCase();

async function assignment(): Promise<Assignment> {
  await touchNode(nodeAddr);
  await runAssignment();
  const a = await getActiveAssignment(nodeAddr);
  expect(a).not.toBeNull();
  return a!;
}

describe("POST /work/submit checks (real certificates, n=16)", () => {
  let jobId = "";
  let bindCode = "";

  beforeAll(async () => {
    // One node, one wallet: CLUSTER_N_MIN=1 keeps lane B flowing (the testnet default of 3 would withhold it).
    await setupV1Db({ EPOCH_SUBSIDY_BUDGET_UCLD: "300000", CLUSTER_N_MIN: "1" });
    await creditUcld(user, 10_000);
    const announced = await announceNode(nodeAddr, { cpuThreads: 8, ramGB: 16, gpus: [], os: "test" }, 100, ["matmul"]);
    bindCode = announced.bind_code!;
    expect(bindCode).toMatch(/^[0-9a-f]{16}$/);
    const message = bindingMessage(nodeAddr, payout.address, new Date().toISOString());
    // Knowing the node address is not enough: a wrong code is refused…
    const guessed = await bindNode(nodeAddr, payout.address, message, await payout.signMessage({ message }), "0".repeat(16));
    expect(guessed).toMatchObject({ ok: false, code: "unauthorized" });
    // …the code the node was issued works.
    const bound = await bindNode(nodeAddr, payout.address, message, await payout.signMessage({ message }), bindCode);
    expect(bound).toEqual({ ok: true });
    const q = await enqueueWorkJob({ owner: user, workType: "matmul", n, matrixA: A, matrixB: B });
    if (!q.ok) throw new Error(q.message);
    jobId = q.jobId;
    expect(q.priceUcld).toBe(1001); // 1000 base + ceil(16³ × 14000 / 1e15)
    expect(await getBalanceUcld(user)).toEqual({ balanceUcld: 8999, heldUcld: 1001 });
  });

  it("rejects a binding signed by someone other than the payout wallet", async () => {
    const other = privateKeyToAccount(generatePrivateKey());
    const message = bindingMessage(nodeAddr, payout.address, new Date().toISOString());
    const r = await bindNode(nodeAddr, payout.address, message, await other.signMessage({ message }), bindCode);
    expect(r).toMatchObject({ ok: false, code: "unauthorized" });
  });

  it("rejects a certificate made under a different sigma, and re-queues the job", async () => {
    const a = await assignment();
    expect(a.jobId).toBe(jobId);
    const { certificate, result } = solveAssignedJob("f".repeat(64), A, B, n, nodeAddr, "dev");
    const r = await submitWork(nodeAddr, { jobId, certificate, result });
    expect(r).toMatchObject({ ok: false, code: "unprocessable" });
    expect((await getWorkJob(jobId))!.status).toBe("queued");
    expect((await getNode(nodeAddr))!.jobs_failed).toBe(1);
    expect(await getBalanceUcld(user)).toEqual({ balanceUcld: 8999, heldUcld: 1001 }); // hold kept
  });

  it("rejects a certificate for other matrices (A-hash binding)", async () => {
    const a = await assignment();
    const otherA = A.map((v) => -v);
    const { certificate, result } = solveAssignedJob(a.sigma, otherA, B, n, nodeAddr, "dev");
    const r = await submitWork(nodeAddr, { jobId, certificate, result });
    expect(r).toMatchObject({ ok: false, code: "unprocessable" });
    if (!r.ok) expect(r.message).toMatch(/hash/);
  });

  it("rejects a wrong answer C (Freivalds)", async () => {
    const a = await assignment();
    const { certificate, result } = solveAssignedJob(a.sigma, A, B, n, nodeAddr, "dev");
    const bad = result.slice();
    bad[17] += 1;
    const r = await submitWork(nodeAddr, { jobId, certificate, result: bad });
    expect(r).toMatchObject({ ok: false, code: "unprocessable" });
    if (!r.ok) expect(r.message).toMatch(/Freivalds/);
  });

  it("rejects a submit from a node the job is not assigned to", async () => {
    const a = await assignment();
    const { certificate, result } = solveAssignedJob(a.sigma, A, B, n, nodeAddr, "dev");
    const r = await submitWork("0x0000000000000000000000000000000000000bad", { jobId, certificate, result });
    expect(r).toMatchObject({ ok: false, code: "conflict" });
  });

  it("accepts the real certificate: job done, fee captured, lanes credited to the payout wallet", async () => {
    const a = await getActiveAssignment(nodeAddr);
    const { certificate, result } = solveAssignedJob(a!.sigma, A, B, n, nodeAddr, "dev");
    const r = await submitWork(nodeAddr, { jobId, certificate, result });
    expect(r).toMatchObject({ ok: true, units: 4096, earned: { laneAUcld: 949, laneBUcld: 250 } });

    const job = (await getWorkJob(jobId))!;
    expect(job.status).toBe("done");
    expect(JSON.parse(job.result_json!)).toEqual(result);
    expect(await getBalanceUcld(user)).toEqual({ balanceUcld: 8999, heldUcld: 0 });
    const ledger = await ledgerSummary(payout.address);
    expect(ledger.pending).toEqual({ A: 949, B: 250, treasury: 0 });
    expect((await getNode(nodeAddr))!.jobs_done).toBe(1);

    const again = await submitWork(nodeAddr, { jobId, certificate, result });
    expect(again).toMatchObject({ ok: false, code: "conflict" });
  });
});
