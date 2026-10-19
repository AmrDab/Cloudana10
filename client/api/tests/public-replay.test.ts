/**
 * Independent verifiability (DECENTRALIZATION_ROADMAP.md phase 1): the draw of every job and the payload of every
 * closed epoch are public, and epochs + network stats are signed by the instruction key. These tests replay them the
 * way an outsider would (scripts/verify/replay.ts), with the pure helpers only — never by trusting the API's own
 * `replay` field.
 */
import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { solveAssignedJob } from "../../../pouw/src/index.js";
import { buildApp } from "../src/app.js";
import { getD1 } from "../src/lib/storage.js";
import { creditUcld } from "../src/services/balance.service.js";
import { announceNode, touchNode } from "../src/services/nodes.service.js";
import { eligibleHash, enqueueWorkJob, getActiveAssignment, runAssignment, sha256, submitWork, weightedDraw, type Candidate } from "../src/services/jobs.service.js";
import { closeEpochs, epochOf } from "../src/services/ledger.service.js";
import { epochRoot } from "../src/services/epoch-merkle.js";
import { verifyPublic, type PublicSignature } from "../src/services/public-signing.service.js";

const SIGNING_KEY = generatePrivateKey();
const SIGNER = privateKeyToAccount(SIGNING_KEY).address;
const HOUR = 3_600_000;

let app: ReturnType<typeof buildApp>;
let ipSeq = 0;
const call = (path: string) => app.request(path, { headers: { "cf-connecting-ip": `10.7.0.${ipSeq++ % 250}` } });

const user = "0x" + "77".repeat(20);
const n = 16;
const rand = (k: number) => Array.from({ length: n * n }, (_, i) => ((i * k) % 37) - 18);
const nodes = [privateKeyToAccount(generatePrivateKey()), privateKeyToAccount(generatePrivateKey())].map((a) => a.address.toLowerCase());
const payouts = ["0x" + "a1".repeat(20), "0x" + "b2".repeat(20)];

type Body = Record<string, any>;
/** Everything the API signed: the response without the envelope's status and the signature itself. */
const signedBody = ({ status: _s, signature: _g, ...body }: Body) => body;

describe("public draw records and signed epochs / network", () => {
  let jobId = "";
  let drawn = "";
  let epoch = 0;

  beforeAll(async () => {
    // No CHAIN_RPC_URL: the seed is the flagged local fallback, which the replay must report as not third-party checkable.
    await setupV1Db({ INSTRUCTION_SIGNING_KEY: SIGNING_KEY, CLUSTER_N_MIN: "1", EPOCH_SECONDS: "3600" });
    app = buildApp({ runtime: "node" });
    await creditUcld(user, 100_000);
    for (const [i, addr] of nodes.entries()) {
      await announceNode(addr, { cpuThreads: 8, ramGB: 16, gpus: [], os: "test" }, 100, ["matmul"], undefined, { agentVersion: "1.5.0" });
      await getD1().prepare("UPDATE nodes SET payout = ?, throughput_mmac_s = ? WHERE address = ?").bind(payouts[i], i + 1, addr).run();
      await touchNode(addr);
    }
    const q = await enqueueWorkJob({ owner: user, workType: "matmul", n, matrixA: rand(7919), matrixB: rand(104729) });
    if (!q.ok) throw new Error(q.message);
    jobId = q.jobId;
    await runAssignment();
  });

  it("publishes the eligible set with the draw, and the draw replays from public data alone", async () => {
    const res = await call(`/v1/draws/${jobId}`);
    expect(res.status).toBe(200);
    const { draw } = await res.json();
    expect(draw.jobStatus).toBe("assigned");
    expect(draw.sigma).toBeNull(); // not before the job is done
    expect(draw.eligible).toHaveLength(2);
    const eligible = draw.eligible as Candidate[];
    expect(eligible.map((c) => c.address)).toEqual([...nodes].sort());
    expect(eligible.map((c) => c.weight)).toEqual(eligible.map((c) => (c.address === nodes[0] ? 1 : 2)));
    // The outsider's replay, with nothing but the record:
    expect(sha256(draw.seedSource + draw.jobId)).toBe(draw.drawSeed);
    expect(eligibleHash(eligible)).toBe(draw.eligibleHash);
    expect(weightedDraw(draw.drawSeed, eligible)).toBe(draw.node);
    expect(nodes).toContain(draw.node);
    drawn = draw.node;
    // No chain here: the seed is the flagged local fallback, so the record says it is not replayable by third parties
    // (they cannot check the seed's origin), even though the arithmetic above holds.
    expect(draw.seedSource.startsWith("local:")).toBe(true);
    expect(draw.replayable).toBe(false);
    expect(draw.replay).toEqual({ seedOk: true, eligibleOk: true, drawOk: true, ok: true });
  });

  it("a tampered record fails the replay: a different winner, weight or seed", async () => {
    const { draw } = await (await call(`/v1/draws/${jobId}`)).json();
    const eligible = draw.eligible as Candidate[];
    const other = nodes.find((a) => a !== draw.node)!;
    expect(weightedDraw(draw.drawSeed, eligible)).not.toBe(other);
    const bumped = eligible.map((c) => (c.address === other ? { ...c, weight: c.weight * 1000 } : c));
    expect(eligibleHash(bumped)).not.toBe(draw.eligibleHash);
    expect(sha256("0xsomeotherblock" + draw.jobId)).not.toBe(draw.drawSeed);
  });

  it("after the job is done the record carries sigma and z; a closed epoch is published with its leaves and a verifying signature", async () => {
    const a = (await getActiveAssignment(drawn))!;
    const { certificate, result } = solveAssignedJob(a.sigma, a.matrixA, a.matrixB, n, drawn, "test");
    const r = await submitWork(drawn, { jobId, certificate, result });
    expect(r.ok).toBe(true);
    const { draw } = await (await call(`/v1/draws/${jobId}`)).json();
    expect(draw).toMatchObject({ jobStatus: "done", sigma: a.sigma, certZ: certificate.z, node: drawn });

    const now = Date.now();
    epoch = epochOf(now);
    expect((await call(`/v1/epochs/${epoch}`)).status).toBe(404); // still open
    const closed = await closeEpochs(now + 2 * HOUR);
    expect(closed.map((e) => e.epoch)).toContain(epoch);

    const res = await call(`/v1/epochs/${epoch}`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ status: "success", epoch, epochStatus: "closed", feesBurnedUcld: 1001 });
    const payout = payouts[nodes.indexOf(drawn)];
    // Lane B depends on the per-operator gate: the drawn wallet holds 1/3 or 2/3 of the eligible weight (S_CAP 0.5).
    const laneB = draw.clusterOk ? 40 : 0;
    expect(json.leaves).toEqual([{ account: payout, laneAUcld: 949, laneBUcld: laneB }]);
    // Recompute the root the keeper will post from the published leaves.
    expect(epochRoot(epoch, json.leaves)).toBe(json.root);
    expect(json.totalLaneAUcld).toBe(949);
    expect(json.totalLaneBUcld).toBe(laneB);
    expect(json.treasuryUcld * 10_000).toBeGreaterThanOrEqual(json.feesBurnedUcld * 300);
    expect((json.totalLaneAUcld + json.treasuryUcld) * 10_000).toBeLessThanOrEqual(json.feesBurnedUcld * 9_800);
    // The signature covers exactly the published body, by the published signer.
    const signature = json.signature as PublicSignature;
    expect(signature.signer).toBe(SIGNER);
    expect(await verifyPublic(signedBody(json), signature)).toBe(true);
    expect(await verifyPublic({ ...signedBody(json), feesBurnedUcld: 1 }, signature)).toBe(false);
    expect(await verifyPublic(signedBody(json), { ...signature, signer: "0x" + "00".repeat(20) })).toBe(false);
    const key = await (await call("/v1/nodes/instruction-key")).json();
    expect(key.signer).toBe(signature.signer);
  });

  it("GET /v1/network is signed over its stats; without a key the data is served unsigned", async () => {
    const json = await (await call("/v1/network")).json();
    expect(json.signature.signer).toBe(SIGNER);
    expect(await verifyPublic(signedBody(json), json.signature)).toBe(true);
    expect(await verifyPublic({ ...signedBody(json), nodesOnline: 999 }, json.signature)).toBe(false);

    const saved = process.env.INSTRUCTION_SIGNING_KEY;
    delete process.env.INSTRUCTION_SIGNING_KEY;
    try {
      expect((await (await call("/v1/network")).json()).signature).toBeNull();
      expect((await (await call(`/v1/epochs/${epoch}`)).json()).signature).toBeNull();
    } finally {
      process.env.INSTRUCTION_SIGNING_KEY = saved;
    }
  });

  it("an unknown job or epoch is 404; records never carry matrices or the owner", async () => {
    expect((await call("/v1/draws/nope")).status).toBe(404);
    expect((await call("/v1/epochs/1")).status).toBe(404);
    const { draw } = await (await call(`/v1/draws/${jobId}`)).json();
    expect(Object.keys(draw)).not.toContain("owner");
    expect(JSON.stringify(draw)).not.toContain(user);
    expect(JSON.stringify(draw)).not.toContain("matrixA");
  });
});
