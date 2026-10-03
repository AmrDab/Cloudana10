/**
 * End-to-end check of the v1 work pipeline against a local `wrangler dev --port 8790 --local`.
 * Run: npx tsx scripts/dev/e2e-v1.ts   (reads INTERNAL_API_KEY / TREASURY_ADDRESS / EPOCH_SECONDS from .dev.vars)
 * For a quick run set EPOCH_SECONDS=10 and VEST_B_SECONDS=5 in .dev.vars.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { privateKeyToAccount, generatePrivateKey, type PrivateKeyAccount } from "viem/accounts";
import { solveAssignedJob } from "../../../../pouw/src/index.ts";

const API = process.env.API ?? "http://127.0.0.1:8790";
const vars = Object.fromEntries(
  readFileSync(new URL("../../.dev.vars", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const INTERNAL_KEY = vars.INTERNAL_API_KEY;
const TREASURY = (vars.TREASURY_ADDRESS ?? "").toLowerCase();
const EPOCH_MS = Number(vars.EPOCH_SECONDS ?? 120) * 1000;

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

function check(cond: unknown, label: string, detail?: unknown): void {
  if (!cond) {
    console.error(`FAIL ${label}`, detail !== undefined ? JSON.stringify(detail) : "");
    process.exit(1);
  }
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

async function nodeCall(node: PrivateKeyAccount, path: string, body: unknown): Promise<Res> {
  const raw = JSON.stringify(body);
  const ts = String(Date.now());
  const digest = createHash("sha256").update(raw).digest("hex");
  const signature = await node.signMessage({ message: `POST ${path} ${ts} ${digest}` });
  return call(path, {
    method: "POST",
    body: raw,
    headers: { "content-type": "application/json", "X-Node": node.address, "X-Node-Timestamp": ts, "X-Node-Signature": signature },
  });
}

function matMul(A: number[], B: number[], n: number): number[] {
  const C = new Array(n * n).fill(0);
  for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) C[i * n + j] += A[i * n + k] * B[k * n + j];
  return C;
}
const randMatrix = (n: number, bound: number) => Array.from({ length: n * n }, () => Math.floor(Math.random() * (2 * bound + 1)) - bound);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runJob(jwt: string, node: PrivateKeyAccount, n: number) {
  const A = randMatrix(n, 50);
  const B = randMatrix(n, 50);
  const job = await call("/v1/jobs", { method: "POST", headers: jsonH(jwt), body: JSON.stringify({ workType: "matmul", n, matrixA: A, matrixB: B }) });
  check(job.s === 200, `POST /jobs n=${n} → priceUcld ${job.b?.priceUcld}`, job.b);

  let assignment: any = null;
  for (let i = 0; i < 10 && !assignment; i++) {
    const hb = await nodeCall(node, "/v1/nodes/heartbeat", {});
    assignment = hb.b?.assignment;
    if (!assignment) await sleep(500);
  }
  check(assignment?.jobId === job.b.jobId, `heartbeat returned the assignment (sigma ${String(assignment?.sigma).slice(0, 12)}…)`, assignment);

  const { certificate, result } = solveAssignedJob(assignment.sigma, assignment.matrixA, assignment.matrixB, n, node.address, "e2e");
  const submit = await nodeCall(node, "/v1/work/submit", { jobId: assignment.jobId, certificate, result });
  check(submit.s === 200, `POST /work/submit → units ${submit.b?.units}, earned ${JSON.stringify(submit.b?.earned)}`, submit.b);
  return { jobId: job.b.jobId as string, A, B, n, submit: submit.b, priceUcld: job.b.priceUcld as number };
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

  const announce = await nodeCall(node, "/v1/nodes/announce", {
    manifest: { cpuThreads: 8, ramGB: 16, gpus: [], os: "e2e" },
    benchmarkMmacPerSec: 50,
    workTypes: ["matmul"],
  });
  check(announce.s === 200 && announce.b.bound === false, "node announced (unbound)", announce.b);

  const badSubmit = await nodeCall(node, "/v1/work/submit", { jobId: "nope", certificate: {}, result: [] });
  check(badSubmit.s === 400, "submit with a malformed certificate → 400", badSubmit.b);

  const message = `Cloudana node binding\nNode: ${node.address.toLowerCase()}\nPayout: ${payout.address.toLowerCase()}\nIssued: ${new Date().toISOString()}`;
  const bind = await call("/v1/nodes/bind", {
    method: "POST",
    headers: jsonH(),
    body: JSON.stringify({ node: node.address, payout: payout.address, message, signature: await payout.signMessage({ message }), code: announce.b.bindCode }),
  });
  check(bind.s === 200, "payout wallet bound", bind.b);

  const job1 = await runJob(jwt, node, 16);
  const job2 = await runJob(jwt, node, 64); // n=64 so the 0.5% treasury lane is ≥ 1 µCLD

  const account = await call("/v1/account", { headers: jsonH(jwt) });
  check(
    account.b?.balanceUcld === 10_000_000 - job1.priceUcld - job2.priceUcld && account.b?.heldUcld === 0,
    `GET /account → ${JSON.stringify({ balanceUcld: account.b?.balanceUcld, heldUcld: account.b?.heldUcld })}`,
    account.b,
  );

  const got = await call(`/v1/jobs/${job1.jobId}`, { headers: jsonH(jwt) });
  const expected = matMul(job1.A, job1.B, job1.n);
  check(got.b?.job?.status === "done" && JSON.stringify(got.b.job.result) === JSON.stringify(expected), "GET /jobs/:id result = A·B (owner)", got.b);
  const outsiderJwt = await login(outsider);
  const hidden = await call(`/v1/jobs/${job1.jobId}`, { headers: jsonH(outsiderJwt) });
  check(hidden.s === 200 && hidden.b.job.result === undefined && hidden.b.job.certificate?.z, "GET /jobs/:id hides result from non-owner, shows certificate");

  const ledger = await call(`/v1/ledger/${payout.address}`);
  console.log("     ledger(payout):", JSON.stringify({ pending: ledger.b.pending, vesting: ledger.b.vesting, settled: ledger.b.settled }));
  check(ledger.b.pending.A === job1.submit.earned.laneAUcld + job2.submit.earned.laneAUcld, "GET /ledger/:payout pending A matches earned");

  const session = crypto.randomUUID();
  const task = await call(`/v1/verify/task?session=${session}`);
  const truth = JSON.stringify(matMul(task.b.matrixA, task.b.matrixB, task.b.n)) === JSON.stringify(task.b.matrixC) ? "valid" : "invalid";
  const verdict = await call("/v1/verify/verdict", {
    method: "POST",
    headers: jsonH(),
    body: JSON.stringify({ taskId: task.b.taskId, session, verdict: truth }),
  });
  check(verdict.b?.correct === true && verdict.b.credits === 1, `verify task (n=${task.b.n}, truth ${truth}) → ${JSON.stringify(verdict.b)}`);

  // Wait until the epoch of the last job has ended and its lane B has vested.
  const doneAt = Date.now();
  const waitUntil = Math.max((Math.floor(doneAt / EPOCH_MS) + 1) * EPOCH_MS, job2.submit.vestsAt) + 1000;
  console.log(`     waiting ${Math.ceil((waitUntil - Date.now()) / 1000)} s for epoch end + vesting…`);
  await sleep(waitUntil - Date.now());

  const noKey = await call("/v1/admin/epochs/close", { method: "POST" });
  check(noKey.s === 401, "epoch close without X-Internal-Key → 401");
  const close = await call("/v1/admin/epochs/close", { method: "POST", headers: { "X-Internal-Key": INTERNAL_KEY } });
  console.log("     epochs:", JSON.stringify(close.b.epochs));
  const leaves = close.b.epochs.flatMap((e: any) => e.leaves.map((l: any) => l.address));
  check(leaves.includes(payout.address.toLowerCase()) && leaves.includes(TREASURY), "epoch leaves include the payout wallet and treasury");

  const hash = (s: string) => "0x" + createHash("sha256").update(s).digest("hex");
  for (const e of close.b.epochs) {
    const posted = await call(`/v1/admin/epochs/${e.id}/posted`, {
      method: "POST",
      headers: { ...jsonH(), "X-Internal-Key": INTERNAL_KEY },
      body: JSON.stringify({ root: hash(`root${e.id}`), txHash: hash(`post${e.id}`) }),
    });
    const settled = await call(`/v1/admin/epochs/${e.id}/settled`, {
      method: "POST",
      headers: { ...jsonH(), "X-Internal-Key": INTERNAL_KEY },
      body: JSON.stringify({ txHash: hash(`settle${e.id}`) }),
    });
    check(posted.s === 200 && settled.s === 200, `epoch ${e.id} posted + settled`);
  }
  const after = await call(`/v1/ledger/${payout.address}`);
  console.log("     ledger(payout) after settle:", JSON.stringify({ pending: after.b.pending, settled: after.b.settled }));
  check(after.b.pending.A === 0 && after.b.settled.A === ledger.b.pending.A, "payout ledger settled");

  const network = await call("/v1/network");
  console.log("     network:", JSON.stringify(network.b));
  console.log("E2E PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
