/**
 * End-to-end check of the v1 work pipeline against a running API (default: a local `wrangler dev --port 8790 --local`;
 * the Node runtime works too: `DEV_MODE=true CLUSTER_N_MIN=1 EPOCH_SECONDS=10 VEST_B_SECONDS=5 INTERNAL_API_KEY=… PORT=8790 npx tsx src/index.ts`).
 *
 * Run: API=http://127.0.0.1:8790 INTERNAL_API_KEY=… npx tsx scripts/dev/e2e-v1.ts
 * (INTERNAL_API_KEY / EPOCH_SECONDS are read from .dev.vars when not in the environment.)
 * For a quick run set EPOCH_SECONDS=10 and VEST_B_SECONDS=5 on the API.
 *
 * What it proves (TEST_EVIDENCE.md scenarios 2–7, off-chain part): wallet sign-in; test credits; a node announces
 * (signed, nonce'd requests) and binds a payout wallet with the bind code; a job is priced, held, assigned by the
 * draw, solved with the σ-bound transcript, verified (transcript + Freivalds) and paid exactly once; a non-owner
 * cannot read the result; a malformed certificate is refused; the browser verifier grades a planted task; the epoch
 * closes with the payout wallet as a leaf and a treasury amount, is marked posted (root must match) and settled.
 */
import { existsSync, readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { privateKeyToAccount, generatePrivateKey, type PrivateKeyAccount } from "viem/accounts";
import { solveAssignedJob } from "../../../../pouw/src/index.ts";

const API = process.env.API ?? "http://127.0.0.1:8790";
const devVarsPath = new URL("../../.dev.vars", import.meta.url);
const vars: Record<string, string> = existsSync(devVarsPath)
  ? Object.fromEntries(
      readFileSync(devVarsPath, "utf8")
        .split(/\r?\n/)
        .filter((l) => l.includes("=") && !l.startsWith("#"))
        .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
    )
  : {};
const INTERNAL_KEY = process.env.INTERNAL_API_KEY ?? vars.INTERNAL_API_KEY;
const EPOCH_MS = Number(process.env.EPOCH_SECONDS ?? vars.EPOCH_SECONDS ?? 3600) * 1000;
if (!INTERNAL_KEY) {
  console.error("INTERNAL_API_KEY is needed (env or client/api/.dev.vars)");
  process.exit(1);
}

type Res = { s: number; b: any };
async function call(path: string, init: RequestInit = {}): Promise<Res> {
  const r = await fetch(API + path, init);
  let b: any = null;
  try {
    b = await r.json();
  } catch {}
  return { s: r.status, b };
}
const jsonH = (jwt?: string) => ({ "content-type": "application/json", ...(jwt ? { authorization: `Bearer ${jwt}` } : {}) });

let passed = 0;
function check(cond: unknown, label: string, detail?: unknown): void {
  if (!cond) {
    console.error(`FAIL ${label}`, detail !== undefined ? JSON.stringify(detail) : "");
    process.exit(1);
  }
  passed++;
  console.log(`ok   ${label}`);
}

async function login(acct: PrivateKeyAccount): Promise<string> {
  const nonce = await call(`/v1/auth/nonce?address=${acct.address}`);
  const signature = await acct.signMessage({ message: nonce.b.message });
  const r = await call("/v1/auth/login", {
    method: "POST",
    headers: jsonH(),
    body: JSON.stringify({ address: acct.address, message: nonce.b.message, signature }),
  });
  return r.b.token;
}

/** A node-signed request (middleware/node-auth.ts): "<METHOD> <path> <ts> <sha256(body)> <nonce>", nonce single use. */
async function nodeCall(node: PrivateKeyAccount, path: string, body: unknown): Promise<Res> {
  const raw = JSON.stringify(body);
  const ts = String(Date.now());
  const nonce = randomBytes(16).toString("hex");
  const digest = createHash("sha256").update(raw).digest("hex");
  const signature = await node.signMessage({ message: `POST ${path} ${ts} ${digest} ${nonce}` });
  return call(path, {
    method: "POST",
    body: raw,
    headers: { "content-type": "application/json", "X-Node": node.address, "X-Node-Timestamp": ts, "X-Nonce": nonce, "X-Node-Signature": signature },
  });
}

function matMul(A: number[], B: number[], n: number): number[] {
  const C = new Array(n * n).fill(0);
  for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) C[i * n + j] += A[i * n + k] * B[k * n + j];
  return C;
}
const randMatrix = (n: number, bound: number) => Array.from({ length: n * n }, () => Math.floor(Math.random() * (2 * bound + 1)) - bound);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Jobs this node solved honestly, with what each earned (side jobs included: the single node takes whatever the draw assigns). */
const solved = new Map<string, { laneAUcld: number; laneBUcld: number; priceUcld: number }>();
const prices = new Map<string, number>();

async function solveAndSubmit(node: PrivateKeyAccount, assignment: any): Promise<Res> {
  const { certificate, result } = solveAssignedJob(assignment.sigma, assignment.matrixA, assignment.matrixB, assignment.n, node.address, "e2e");
  const submit = await nodeCall(node, "/v1/work/submit", { jobId: assignment.jobId, certificate, result });
  if (submit.s === 200) solved.set(assignment.jobId, { ...submit.b.earned, priceUcld: prices.get(assignment.jobId) ?? 0 });
  return submit;
}

/**
 * Queue a job and work heartbeats until this node has dealt with it. The draw hands the node the oldest queued job,
 * which may be an earlier (re-queued) one: those are solved honestly on the way. Assignment runs after each enqueue
 * and on the cron (every 60 s on the Node runtime), so a job can wait up to a minute.
 */
async function runJob(jwt: string, node: PrivateKeyAccount, n: number, tamper = false) {
  const A = randMatrix(n, 50);
  const B = randMatrix(n, 50);
  const job = await call("/v1/jobs", { method: "POST", headers: jsonH(jwt), body: JSON.stringify({ workType: "matmul", n, matrixA: A, matrixB: B }) });
  check(job.s === 200, `POST /jobs n=${n} → priceUcld ${job.b?.priceUcld}`, job.b);
  const jobId = job.b.jobId as string;
  prices.set(jobId, job.b.priceUcld);

  let heartbeat: any = null;
  for (let i = 0; i < 45; i++) {
    const hb = await nodeCall(node, "/v1/nodes/heartbeat", { agentVersion: "1.5.0" });
    heartbeat = hb.b;
    const assignment = hb.b?.assignment;
    if (!assignment) {
      await sleep(2000);
      continue;
    }
    if (assignment.jobId !== jobId) {
      const side = await solveAndSubmit(node, assignment);
      check(side.s === 200, `side job ${assignment.jobId.slice(0, 8)}… (re-queued earlier) solved honestly → earned ${JSON.stringify(side.b?.earned)}`, side.b);
      continue;
    }
    check(typeof heartbeat?.sig === "string" || heartbeat?.sig === undefined, `heartbeat returned the assignment (sigma ${String(assignment.sigma).slice(0, 12)}…)`);
    if (!heartbeat?.sig) console.log("     note: API has no INSTRUCTION_SIGNING_KEY — a real agent would ignore this assignment");
    if (tamper) {
      // The verifier must refuse a wrong answer. The protocol then re-queues the job for another draw (the node is
      // charged a failure); the single node here will be handed it again later and solve it honestly.
      const { certificate, result } = solveAssignedJob(assignment.sigma, assignment.matrixA, assignment.matrixB, n, node.address, "e2e");
      const wrong = result.slice();
      wrong[0] += 1;
      const rejected = await nodeCall(node, "/v1/work/submit", { jobId, certificate, result: wrong });
      check(rejected.s === 422 && /Freivalds/.test(rejected.b?.error?.message ?? ""), `tampered result → 422 (${rejected.b?.error?.message})`, rejected.b);
      const after = await call(`/v1/jobs/${jobId}`, { headers: jsonH(jwt) });
      check(after.b?.job?.status === "queued" && after.b.job.node === null, "the rejected job is back in the queue for another draw", after.b);
      return { jobId, A, B, n, priceUcld: job.b.priceUcld as number };
    }
    const submit = await solveAndSubmit(node, assignment);
    check(submit.s === 200, `POST /work/submit → units ${submit.b?.units}, earned ${JSON.stringify(submit.b?.earned)}`, submit.b);
    // Exactly once: a second submit of the same job is a conflict, not a second payment.
    const { certificate, result } = solveAssignedJob(assignment.sigma, assignment.matrixA, assignment.matrixB, n, node.address, "e2e");
    const again = await nodeCall(node, "/v1/work/submit", { jobId, certificate, result });
    check(again.s === 409, "re-submitting the same job → 409 (paid once)", again.b);
    return { jobId, A, B, n, priceUcld: job.b.priceUcld as number };
  }
  check(false, `job ${jobId} was never assigned to the node`, heartbeat);
  throw new Error("unreachable");
}

async function main() {
  const user = privateKeyToAccount(generatePrivateKey());
  const node = privateKeyToAccount(generatePrivateKey());
  const payout = privateKeyToAccount(generatePrivateKey());
  const outsider = privateKeyToAccount(generatePrivateKey());

  const jwt = await login(user);
  check(!!jwt, "user logged in");
  const credits = await call("/v1/dev/credits", { method: "POST", headers: jsonH(jwt) });
  check(credits.b?.balanceUcld === 10_000_000, `POST /dev/credits → ${credits.b?.balanceUcld} µCLD`, credits.b);

  const announceBody = {
    manifest: { cpuThreads: 8, ramGB: 16, gpus: [], os: "e2e" },
    benchmarkMmacPerSec: 50,
    workTypes: ["matmul"],
    pubkey: node.publicKey.slice(2),
    agentVersion: "1.5.0",
  };
  const announce = await nodeCall(node, "/v1/nodes/announce", announceBody);
  check(announce.s === 200 && announce.b.bound === false, "node announced (unbound)", announce.b);
  // Replay protection: the same signed request again is refused (new nonce → fine, reused → 401).
  const raw = JSON.stringify(announceBody);
  const ts = String(Date.now());
  const nonce = randomBytes(16).toString("hex");
  const sig = await node.signMessage({ message: `POST /v1/nodes/announce ${ts} ${createHash("sha256").update(raw).digest("hex")} ${nonce}` });
  const hdr = { "content-type": "application/json", "X-Node": node.address, "X-Node-Timestamp": ts, "X-Nonce": nonce, "X-Node-Signature": sig };
  const first = await call("/v1/nodes/announce", { method: "POST", body: raw, headers: hdr });
  const replay = await call("/v1/nodes/announce", { method: "POST", body: raw, headers: hdr });
  check(first.s === 200 && replay.s === 401, "replayed node request (same nonce) → 401", replay.b);

  const badSubmit = await nodeCall(node, "/v1/work/submit", { jobId: "nope", certificate: {}, result: [] });
  check(badSubmit.s === 400, "submit with a malformed certificate → 400", badSubmit.b);

  const message = `Cloudana node binding\nNode: ${node.address.toLowerCase()}\nPayout: ${payout.address.toLowerCase()}\nIssued: ${new Date().toISOString()}`;
  const wrongCode = await call("/v1/nodes/bind", {
    method: "POST",
    headers: jsonH(),
    body: JSON.stringify({ node: node.address, payout: payout.address, message, signature: await payout.signMessage({ message }), code: "0000000000000000" }),
  });
  check(wrongCode.s === 401, "bind with the wrong code → 401", wrongCode.b);
  const bind = await call("/v1/nodes/bind", {
    method: "POST",
    headers: jsonH(),
    body: JSON.stringify({ node: node.address, payout: payout.address, message, signature: await payout.signMessage({ message }), code: announce.b.bindCode }),
  });
  check(bind.s === 200, "payout wallet bound", bind.b);

  const job0 = await runJob(jwt, node, 16, true); // a wrong answer: refused and re-queued; solved honestly as a side job later
  const job1 = await runJob(jwt, node, 16);
  const job2 = await runJob(jwt, node, 64);
  for (const j of [job0, job1, job2]) check(solved.has(j.jobId), `job ${j.jobId.slice(0, 8)}… was verified and paid`);
  const spent = job0.priceUcld + job1.priceUcld + job2.priceUcld;

  const account = await call("/v1/account", { headers: jsonH(jwt) });
  check(
    account.b?.balanceUcld === 10_000_000 - spent && account.b?.heldUcld === 0,
    `GET /account → ${JSON.stringify({ balanceUcld: account.b?.balanceUcld, heldUcld: account.b?.heldUcld })} (three fees captured once each, nothing held)`,
    account.b,
  );

  const got = await call(`/v1/jobs/${job1.jobId}`, { headers: jsonH(jwt) });
  const expected = matMul(job1.A, job1.B, job1.n);
  check(got.b?.job?.status === "done" && JSON.stringify(got.b.job.result) === JSON.stringify(expected), "GET /jobs/:id result = A·B (owner)", got.b);
  const outsiderJwt = await login(outsider);
  const hidden = await call(`/v1/jobs/${job1.jobId}`, { headers: jsonH(outsiderJwt) });
  check(hidden.s === 200 && hidden.b.job.result === undefined, "GET /jobs/:id hides the result from a non-owner", hidden.b);
  const notMine = await call("/v1/jobs", { headers: jsonH(outsiderJwt) });
  check(notMine.s === 200 && notMine.b.jobs.length === 0, "GET /jobs lists only the caller's jobs");

  const ledger = await call(`/v1/ledger/${payout.address}`);
  console.log("     ledger(payout):", JSON.stringify({ pending: ledger.b.pending, vesting: ledger.b.vesting, settled: ledger.b.settled }));
  const earnedA = [...solved.values()].reduce((t, e) => t + e.laneAUcld, 0);
  check(ledger.b.pending.A === earnedA, `GET /ledger/:payout pending A (${ledger.b.pending.A}) = sum of what the submits reported`);

  const session = crypto.randomUUID();
  const task = await call(`/v1/verify/task?session=${session}`);
  const truth = JSON.stringify(matMul(task.b.matrixA, task.b.matrixB, task.b.n)) === JSON.stringify(task.b.matrixC) ? "valid" : "invalid";
  const verdict = await call("/v1/verify/verdict", {
    method: "POST",
    headers: jsonH(),
    body: JSON.stringify({ taskId: task.b.taskId, session, verdict: truth }),
  });
  check(verdict.b?.correct === true && verdict.b.credits === 1, `verify task (n=${task.b.n}, truth ${truth}) → ${JSON.stringify(verdict.b)}`);

  // Wait until the epoch of the last job has ended.
  const doneAt = Date.now();
  const waitUntil = (Math.floor(doneAt / EPOCH_MS) + 1) * EPOCH_MS + 1000;
  console.log(`     waiting ${Math.ceil((waitUntil - Date.now()) / 1000)} s for the epoch to end…`);
  await sleep(waitUntil - Date.now());

  const noKey = await call("/v1/admin/epochs/close", { method: "POST" });
  check(noKey.s === 401, "epoch close without X-Internal-Key → 401");
  const close = await call("/v1/admin/epochs/close", { method: "POST", headers: { "X-Internal-Key": INTERNAL_KEY } });
  console.log("     epochs:", JSON.stringify(close.b.epochs.map((e: any) => ({ ...e, leaves: e.leaves.length }))));
  const ours = close.b.epochs.filter((e: any) => e.leaves.some((l: any) => l.account === payout.address.toLowerCase()));
  check(ours.length >= 1, "a closed epoch has the payout wallet as a leaf");
  const fees = ours.reduce((s: number, e: any) => s + e.feesBurnedUcld, 0);
  const laneA = ours.reduce((s: number, e: any) => s + e.totalLaneAUcld, 0);
  const treasury = ours.reduce((s: number, e: any) => s + e.treasuryUcld, 0);
  check(fees === spent, `fees burned ${fees} = the three verified jobs' prices`);
  check(treasury * 10_000 >= fees * 300 && (laneA + treasury) * 10_000 <= fees * 9_800, `fee split within the contract's bounds (A ${laneA}, treasury ${treasury}, fees ${fees})`);

  const hash = (s: string) => "0x" + createHash("sha256").update(s).digest("hex");
  for (const e of close.b.epochs) {
    const wrongRoot = await call(`/v1/admin/epochs/${e.epoch}/posted`, {
      method: "POST",
      headers: { ...jsonH(), "X-Internal-Key": INTERNAL_KEY },
      body: JSON.stringify({ root: hash(`not-the-root${e.epoch}`), txHash: hash(`post${e.epoch}`) }),
    });
    check(wrongRoot.s === 409, `epoch ${e.epoch}: posting a root other than the one computed at close → 409`, wrongRoot.b);
    const posted = await call(`/v1/admin/epochs/${e.epoch}/posted`, {
      method: "POST",
      headers: { ...jsonH(), "X-Internal-Key": INTERNAL_KEY },
      body: JSON.stringify({ root: e.root, txHash: hash(`post${e.epoch}`) }),
    });
    const settled = await call(`/v1/admin/epochs/${e.epoch}/settled`, {
      method: "POST",
      headers: { ...jsonH(), "X-Internal-Key": INTERNAL_KEY },
      body: JSON.stringify({ txHash: hash(`settle${e.epoch}`) }),
    });
    check(posted.s === 200 && settled.s === 200, `epoch ${e.epoch} posted + settled`);
  }
  const after = await call(`/v1/ledger/${payout.address}`);
  console.log("     ledger(payout) after settle:", JSON.stringify({ pending: after.b.pending, settled: after.b.settled }));
  check(after.b.pending.A === 0 && after.b.settled.A === ledger.b.pending.A, "payout ledger settled");
  // Anyone can recompute an epoch: its public job list carries fee and lanes per job.
  const ids = new Set([job0.jobId, job1.jobId, job2.jobId]);
  const listed: string[] = [];
  for (const e of ours) {
    const pub = await call(`/v1/epochs/${e.epoch}/jobs`);
    check(pub.s === 200 && pub.b.epoch?.root === e.root, `GET /epochs/${e.epoch}/jobs (public) returns the closed epoch and its root`, pub.b);
    for (const j of pub.b.jobs) if (ids.has(j.jobId)) listed.push(j.jobId);
    const sum = pub.b.jobs.reduce((t: number, j: any) => t + (j.feeUcld ?? 0), 0);
    check(sum === e.feesBurnedUcld, `epoch ${e.epoch}: the listed jobs' fees (${sum}) add up to feesBurned`);
  }
  check(new Set(listed).size === 3, "the three jobs appear in the public epoch job lists");

  const network = await call("/v1/network");
  console.log("     network:", JSON.stringify(network.b));
  console.log(`E2E PASSED (${passed} checks)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
