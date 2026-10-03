/**
 * Full PoUW loop against a local Worker (npx wrangler dev --port 8790 --local):
 *   owner signs in → pays CLD credits for a matrix job → miner claims it →
 *   mines a REAL backed certificate with the pouw module → submits → API verifies
 *   by re-execution, settles, and the owner reads C = A·B.
 *
 * Run from client/api:  npx tsx scripts/dev/e2e-loop.ts
 */
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { solveBacked } from "../../../../pouw/src/workload-bridge.js";

const B = process.env.API_BASE ?? "http://127.0.0.1:8790/v1";
const j = async (p: string, init: RequestInit = {}) => {
  const r = await fetch(B + p, init);
  let b: any = null;
  try { b = await r.json(); } catch { /* no body */ }
  return { s: r.status, b };
};
const H = (t: string) => ({ authorization: `Bearer ${t}`, "content-type": "application/json" });
const must = (cond: unknown, msg: string) => { if (!cond) { console.error("❌", msg); process.exit(1); } console.log("✅", msg); };

async function login(acct: ReturnType<typeof privateKeyToAccount>) {
  const nonce = await j(`/auth/nonce?address=${acct.address}`);
  const signature = await acct.signMessage({ message: nonce.b.message });
  const r = await j("/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: acct.address, message: nonce.b.message, signature }) });
  return r.b.token as string;
}

// The owner's credit balance must be seeded in the local D1 before this runs
// (what a Stripe/crypto deposit would do). See scripts/dev/e2e-loop.sh.
const ownerPk = (process.env.OWNER_PK ?? generatePrivateKey()) as `0x${string}`;
const owner = privateKeyToAccount(ownerPk);
const jwt = await login(owner);
must(jwt, "owner signed in");

const queue0 = await j("/pouw/queue");
must(queue0.s === 200 && typeof queue0.b.queued === "number", `queue depth readable (${queue0.b.queued} queued, 64×64 costs ${queue0.b.priceCldAt64} CLD)`);

const n = 8;
const A = Array.from({ length: n * n }, (_, i) => ((i * 7 + 3) % 9) - 4);
const Bm = Array.from({ length: n * n }, (_, i) => ((i * 5 + 1) % 9) - 4);

must((await j("/pouw/job", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ n, matrixA: A, matrixB: Bm, difficulty: 4 }) })).s === 401, "unauthenticated job submission is rejected (401)");

// n=256 costs 1 × (256/64)^1.5 = 8 CLD — more than the 5 CLD seeded.
const tooBig = await j("/pouw/job", { method: "POST", headers: H(jwt), body: JSON.stringify({ n: 256, matrixA: new Array(65536).fill(1), matrixB: new Array(65536).fill(1), difficulty: 4 }) });
must(tooBig.s === 422 && /Insufficient CLD/.test(tooBig.b?.error?.message ?? ""), `job beyond balance is refused: ${tooBig.b?.error?.message ?? JSON.stringify(tooBig.b)}`);

const paid = await j("/pouw/job", { method: "POST", headers: H(jwt), body: JSON.stringify({ n, matrixA: A, matrixB: Bm, difficulty: 4 }) });
must(paid.s === 200 && paid.b.workloadId, `owner paid ${paid.b.priceCld} CLD for job ${paid.b.workloadId} (balance now ${paid.b.balanceCld})`);
const jobId = paid.b.workloadId as string;

const miner = privateKeyToAccount(generatePrivateKey());
// Older queued jobs (from earlier runs) are claimed first — skip past them to ours.
let claimed = await j(`/pouw/job?provider=${miner.address}`);
for (let i = 0; i < 10 && claimed.b.job && claimed.b.job.workloadId !== jobId; i++) {
  claimed = await j(`/pouw/job?provider=${miner.address}`);
}
must(claimed.s === 200 && claimed.b.job?.workloadId === jobId, "miner claimed the paid job");

const seed = await j("/pouw/seed");
const sigma = seed.s === 200 ? (seed.b.seed as string).replace(/^0x/, "") : "ab".repeat(32);

const backed = solveBacked(
  sigma,
  { workloadId: jobId, A: { rows: n, cols: n, data: claimed.b.job.matrixA }, B: { rows: n, cols: n, data: claimed.b.job.matrixB }, difficulty: claimed.b.job.difficulty, expiresAt: claimed.b.job.expiresAt },
  miner.address,
  "0x" + "22".repeat(32),
  50_000,
);
must(backed, "miner produced a backed certificate on the paid matrices");

const submit = await j("/pouw/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...backed!.certificate, result: backed!.result.data }) });
must(submit.s === 200 && submit.b.backedByWorkload === true, `certificate accepted as BACKED — ${submit.b?.message ?? `${submit.s} ${JSON.stringify(submit.b)}`}`);
must(submit.b.settlement?.reward?.status && submit.b.settlement?.chain?.status, `settlement reported: reward=${submit.b.settlement.reward.status} (${submit.b.settlement.reward.reason}), chain=${submit.b.settlement.chain.status}`);

const replay = await j("/pouw/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...backed!.certificate, result: backed!.result.data }) });
must(replay.s === 422 && /replay/i.test(replay.b.error.message), "replayed certificate rejected (422)");

const anon = await j(`/pouw/job/${jobId}`);
must(anon.s === 200 && anon.b.jobStatus === "done" && anon.b.result === null, "anonymous read sees status but not the result");

const mine = await j(`/pouw/job/${jobId}`, { headers: H(jwt) });
const expected = Array.from({ length: n * n }, (_, idx) => { const i = Math.floor(idx / n), k = idx % n; let s = 0; for (let t = 0; t < n; t++) s += A[i * n + t] * Bm[t * n + k]; return s; });
must(mine.s === 200 && JSON.stringify(mine.b.result) === JSON.stringify(expected), "owner reads C and it equals A·B");

const list = await j("/pouw/jobs", { headers: H(jwt) });
must(list.s === 200 && list.b.jobs.length === 1 && list.b.jobs[0].jobStatus === "done", "owner's job list shows the completed job");

const stats = await j("/pouw/stats");
must(stats.b.totalCertificates >= 1, `network stats count the certificate (${stats.b.totalCertificates})`);

const feed = await j("/pouw/certificates?limit=1");
must(feed.b.certificates[0]?.providerAddress === miner.address.toLowerCase(), "certificate feed lists the miner");
console.log("\n✅ full loop: pay → claim → mine → verify → settle → result delivered");
