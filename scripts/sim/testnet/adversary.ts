/**
 * The cheating provider (docs/POUW_SIMULATION_PLAN.md §5): a fake node that follows the real node protocol but cheats
 * in one selectable way per run. It announces, binds a payout wallet, heartbeats, and for each assignment either does
 * honest work or runs the chosen cheat; it records every assignment and, on exit, the payout wallet's ledger so the
 * P&L of the strategy can be read off.
 *
 *   node --import tsx scripts/sim/testnet/adversary.ts --cheat <name> [--jobs 20] [--rate 1] [--name adv-<cheat>] [--payout <seed>] [--out <file>]
 *
 * It only ever drives the LOCAL testnet-in-a-box on 127.0.0.1 (the keys are throwaway seed-derived wallets). It never
 * modifies any other node, never touches the API/agents/keeper, and a suspended key is never reused (give each run its
 * own --name / --payout). The orchestrator's defences are the thing under test: a cheat that pays is a defect.
 */
import os from "node:os";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

import { API, RUN, api, log, sleep, until, wallet } from "./common.ts";
import { makeJob } from "./user.ts";
import { signRequest } from "../../../node-agent/src/signing.ts";
import { detectHardware, benchmarkMmacPerSec } from "../../../node-agent/src/hardware.ts";
import { CHALLENGE_TYPES, openSegments, type ChallengeWork } from "../../../node-agent/src/work.ts";
import { publicKeyOf } from "../../../shared/sealed.ts";
import {
  chainRoot, inputHash, makeCommitment, tensorHash,
  type Commitment, type SegmentOpening, type Tensor,
} from "../../../shared/verification.ts";
import { solveAssignedJob, chooseBlockSize, fieldHash, toFieldMatrix, matCreate, matMul, matAdd } from "../../../pouw/src/index.ts";
import type { Matrix } from "../../../pouw/src/matrix.ts";
import type { POUWCertificate } from "../../../pouw/src/types.ts";
import { matMulSigned } from "../../../client/api/src/services/work-types.ts";

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const opt = (name: string, def?: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};

const CHEATS = [
  "none", "wrong-result", "lazy-transcript", "partial-transcript", "replay", "steal",
  "wrong-segment", "lazy-commit", "late-answer", "rational", "double-commit",
] as const;
type Cheat = (typeof CHEATS)[number];

const CHEAT = opt("cheat") as Cheat | undefined;
if (!CHEAT || !CHEATS.includes(CHEAT)) {
  console.error(`--cheat must be one of: ${CHEATS.join(", ")}`);
  process.exit(1);
}
const MAX_JOBS = Number(opt("jobs", "20"));
const RATE = Number(opt("rate", CHEAT === "rational" ? "0.1" : "1"));
const NAME = opt("name", `adv-${CHEAT}`)!;
const PAYOUT_SEED = opt("payout", `adversary-${CHEAT}`)!;
const OUT = path.join(RUN, opt("out", `adversary-${CHEAT}.jsonl`)!);

const HEARTBEAT_MS = 5000;
const AGENT_VERSION = "1.9.0";
const WORK_TYPES = ["matmul", "int8-mlp", "int8-model"];
const IDLE_TIMEOUT_MS = 10 * 60_000;

// ── This node's key (never under node-agent/.data; a throwaway under .dev-run-sim) ───────────────────────────────────
function loadNodeKey(name: string): { account: PrivateKeyAccount; privateKey: `0x${string}` } {
  mkdirSync(RUN, { recursive: true });
  const file = path.join(RUN, `${name}.key`);
  let privateKey: `0x${string}`;
  if (existsSync(file)) privateKey = JSON.parse(readFileSync(file, "utf8")).privateKey;
  else {
    privateKey = generatePrivateKey();
    writeFileSync(file, JSON.stringify({ privateKey }, null, 2), { mode: 0o600 });
  }
  return { account: privateKeyToAccount(privateKey), privateKey };
}

const sha256hex = (s: string) => createHash("sha256").update(s).digest("hex");
const randHex64 = () => sha256hex(`${Math.random()}:${Date.now()}:${Math.random()}`);

// ── A node-signed request that returns the raw outcome (status, code, body) instead of throwing ──────────────────────
interface Outcome { status: number; code: string | null; message: string | null; body: any }
async function nodeRequest(account: PrivateKeyAccount, method: "POST" | "GET", p: string, body?: unknown): Promise<Outcome> {
  const bodyStr = method === "GET" ? "" : body === undefined ? "{}" : JSON.stringify(body);
  const headers = await signRequest(account, method, p, bodyStr);
  let res: Response;
  try {
    res = await fetch(`${API}${p}`, {
      method,
      headers: { ...headers, ...(method === "POST" ? { "content-type": "application/json" } : {}) },
      ...(method === "POST" ? { body: bodyStr } : {}),
    });
  } catch (err) {
    return { status: 0, code: "unreachable", message: (err as Error).message, body: null };
  }
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, code: json?.error?.code ?? null, message: json?.error?.message ?? null, body: json };
}

// ── matmul cheat constructions (copied from scripts/sim/pouw-attacks.ts, against the real verdict function) ───────────
/** An honest-looking certificate for a job: real binding (σ, n, r, A/B hashes), the given transcript and z. */
function certFor(sigma: string, n: number, A: number[], B: number[], transcriptHash: string, z: string, addr: string, deviceId: string): POUWCertificate {
  return {
    sigma, n, r: chooseBlockSize(n),
    matrixAHash: fieldHash(A, n), matrixBHash: fieldHash(B, n),
    transcriptHash, z, difficulty: 0, timestamp: Date.now(),
    providerAddress: addr, deviceId, matrixA: [], matrixB: [],
  } as POUWCertificate;
}

/**
 * pouw-attacks.ts `lazyTranscript`: the same block loop as matmul.ts over the field inputs, with the final block product
 * skipped (A2). `half = true` fakes every block product in the second half of the (i,j) grid (A5, partial transcript):
 * either way the transcript differs from the honest one in ≥ 1 block, so the sampled re-execution catches it.
 */
function fakeTranscript(A: Matrix, B: Matrix, r: number, half: boolean): string {
  const nn = A.rows, nb = nn / r;
  const hasher = createHash("sha256");
  const get = (m: Matrix, rs: number, cs: number) => {
    const b = matCreate(r, r);
    for (let i = 0; i < r; i++) for (let k = 0; k < r; k++) b.data[i * r + k] = m.data[(rs + i) * m.cols + cs + k];
    return b;
  };
  let cell = 0;
  const totalCells = nb * nb;
  for (let i = 0; i < nb; i++) for (let jj = 0; jj < nb; jj++) {
    const fakeCell = half ? cell >= Math.floor(totalCells / 2) : false;
    let Cij = matCreate(r, r);
    for (let l = 0; l < nb; l++) {
      const lastBlock = i === nb - 1 && jj === nb - 1 && l === nb - 1;
      const skip = half ? fakeCell : lastBlock; // A5: fake the cell; A2: only the very last product
      if (!skip) Cij = matAdd(Cij, matMul(get(A, i * r, l * r), get(B, l * r, jj * r)));
      const buf = Buffer.alloc(r * r * 4);
      for (let k = 0; k < r * r; k++) buf.writeInt32BE(Cij.data[k] | 0, k * 4);
      hasher.update(buf);
    }
    cell++;
  }
  return hasher.digest("hex");
}

// ── Records ─────────────────────────────────────────────────────────────────────────────────────────────────────────
interface Record_ {
  ts: string; cheat: Cheat; cheatedThisJob: boolean; jobId: string; workType: string; n: number | null;
  step: "submit" | "answer"; httpStatus: number; code: string | null; message: string | null;
  earned: { laneAUcld: number; laneBUcld: number } | null; computeMs: number;
}
const clip = (s: string | null) => (s == null ? null : s.length > 200 ? s.slice(0, 200) : s);
function record(r: Omit<Record_, "ts" | "cheat">): Record_ {
  const rec: Record_ = { ts: new Date().toISOString(), cheat: CHEAT!, ...r, message: clip(r.message) };
  appendFileSync(OUT, JSON.stringify(rec) + "\n");
  return rec;
}

// ── Main ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const { account, privateKey } = loadNodeKey(NAME);
const payout = wallet(PAYOUT_SEED);
const deviceId = ("0x" + sha256hex(account.address + os.hostname())) as `0x${string}`;
const manifest = detectHardware();
const mmac = benchmarkMmacPerSec();

let assignmentsHandled = 0;
let accepted = 0;
let suspended = false;
let lastHonestMatmul: { certificate: POUWCertificate; result: number[] } | null = null;
const refusals = new Map<string, number>(); // "<status> <code>: <message>" → count
const handled = new Set<string>(); // jobId:sigma, to skip a re-sent identical assignment
let lastAssignmentAt = Date.now();

function noteRefusal(o: Outcome) {
  const key = `${o.status} ${o.code ?? "-"}: ${clip(o.message) ?? ""}`;
  refusals.set(key, (refusals.get(key) ?? 0) + 1);
}
function noteSuspend(message: string | null) {
  if (message && /suspend/i.test(message)) suspended = true;
}

async function announce(): Promise<Outcome> {
  return nodeRequest(account, "POST", "/v1/nodes/announce", {
    manifest, benchmarkMmacPerSec: mmac, workTypes: WORK_TYPES,
    pubkey: publicKeyOf(privateKey), publicHost: "127.0.0.1", agentVersion: AGENT_VERSION,
  });
}

/** Bind the payout wallet exactly as up.ts / POST /v1/nodes/bind expect. */
async function bind(bindCode: string): Promise<void> {
  const issued = new Date().toISOString();
  const message = `Cloudana node binding\nNode: ${account.address.toLowerCase()}\nPayout: ${payout.address.toLowerCase()}\nIssued: ${issued}`;
  const signature = await payout.signMessage({ message });
  const r = await api("/v1/nodes/bind", { json: { node: account.address, payout: payout.address, message, signature, code: bindCode } });
  if (r.status !== 200) throw new Error(`bind failed: ${r.status} ${JSON.stringify(r.body)}`);
  log(NAME, `bound ${account.address} → payout ${payout.address}`);
}

/**
 * Fetch a challenge job's input (node-signed GET; agents ≥ 1.9.0 fetch it rather than get it in the heartbeat). The
 * stored JSON is the inner input object (b, d, h, X, W1…), exactly what the executor/plan expect. The adversary does
 * not bother to check it against inputHash — nothing it does depends on that check.
 */
async function fetchInput(a: any): Promise<any> {
  if (a.input !== undefined) return a.input;
  const o = await nodeRequest(account, "GET", `/v1/work/jobs/${encodeURIComponent(a.jobId)}/input`);
  if (o.status !== 200) throw new Error(`input fetch: HTTP ${o.status} ${o.message ?? ""}`);
  return o.body;
}

// ── matmul assignment ─────────────────────────────────────────────────────────────────────────────────────────────
async function handleMatmul(a: any): Promise<void> {
  const n: number = a.n;
  const t0 = performance.now();
  let cheated = false;
  let submitBody: { jobId: string; certificate: POUWCertificate; result: number[] };

  if (CHEAT === "none" || (CHEAT === "rational" && Math.random() >= RATE)) {
    const { certificate, result } = solveAssignedJob(a.sigma, a.matrixA, a.matrixB, n, account.address, deviceId);
    lastHonestMatmul = { certificate, result };
    submitBody = { jobId: a.jobId, certificate, result };
  } else if (CHEAT === "wrong-result") {
    // A1: a wrong result C (random small ints) with an otherwise honest-looking certificate. A lazy cheater does no
    // multiply at all, so the transcript is faked too; Freivalds runs first and refuses before the transcript matters.
    cheated = true;
    const result = Array.from({ length: n * n }, () => Math.floor(Math.random() * 255) - 127);
    submitBody = { jobId: a.jobId, certificate: certFor(a.sigma, n, a.matrixA, a.matrixB, randHex64(), randHex64(), account.address, deviceId), result };
  } else if (CHEAT === "lazy-transcript" || CHEAT === "rational") {
    // A2 (and A9's cheated jobs): the correct C with a cheaply-faked transcript. Accepted on unsampled jobs; the
    // sampled 1-in-K re-execution catches it (wallet-wide claw + suspension).
    cheated = true;
    const A = toFieldMatrix(a.matrixA, n), B = toFieldMatrix(a.matrixB, n);
    const th = fakeTranscript(A, B, chooseBlockSize(n), false);
    const result = matMulSigned(a.matrixA, a.matrixB, n);
    const cert = certFor(a.sigma, n, a.matrixA, a.matrixB, th, sha256hex(a.sigma + th + fieldHash(a.matrixA, n) + fieldHash(a.matrixB, n)), account.address, deviceId);
    submitBody = { jobId: a.jobId, certificate: cert, result };
  } else if (CHEAT === "partial-transcript") {
    // A5: the first half of the transcript honest, the rest faked; correct C.
    cheated = true;
    const A = toFieldMatrix(a.matrixA, n), B = toFieldMatrix(a.matrixB, n);
    const th = fakeTranscript(A, B, chooseBlockSize(n), true);
    const result = matMulSigned(a.matrixA, a.matrixB, n);
    const cert = certFor(a.sigma, n, a.matrixA, a.matrixB, th, sha256hex(a.sigma + th + fieldHash(a.matrixA, n) + fieldHash(a.matrixB, n)), account.address, deviceId);
    submitBody = { jobId: a.jobId, certificate: cert, result };
  } else if (CHEAT === "replay") {
    // A3: resubmit an earlier honest certificate (its own) under the current jobId. The first job runs honestly to
    // obtain one; the certificate still carries the OLD σ, so the binding check (certificate σ ≠ assignment σ) refuses.
    if (!lastHonestMatmul) {
      const { certificate, result } = solveAssignedJob(a.sigma, a.matrixA, a.matrixB, n, account.address, deviceId);
      lastHonestMatmul = { certificate, result };
      submitBody = { jobId: a.jobId, certificate, result };
    } else {
      cheated = true;
      submitBody = { jobId: a.jobId, certificate: lastHonestMatmul.certificate, result: lastHonestMatmul.result };
    }
  } else {
    // A cheat that is not matmul-shaped (wrong-segment, lazy-commit, late-answer, double-commit) got a matmul job:
    // do it honestly so the run can continue to challenge jobs.
    const { certificate, result } = solveAssignedJob(a.sigma, a.matrixA, a.matrixB, n, account.address, deviceId);
    lastHonestMatmul = { certificate, result };
    submitBody = { jobId: a.jobId, certificate, result };
  }

  const o = await nodeRequest(account, "POST", "/v1/work/submit", submitBody);
  const computeMs = performance.now() - t0;
  const earned = o.status === 200 && o.body?.earned ? o.body.earned : null;
  if (earned) accepted++;
  if (o.status !== 200) noteRefusal(o);
  noteSuspend(o.message);
  record({ cheatedThisJob: cheated, jobId: a.jobId, workType: a.workType, n, step: "submit", httpStatus: o.status, code: o.code, message: o.message, earned, computeMs });
  log(NAME, `matmul ${a.jobId.slice(0, 8)} n=${n} cheat=${cheated} → ${o.status} ${o.code ?? "ok"}${earned ? ` earned ${earned.laneAUcld}+${earned.laneBUcld}` : ""}`);
}

// ── the "steal" cheat (A4) ──────────────────────────────────────────────────────────────────────────────────────────
/** Learn a job id that was assigned to another node from the only public listing, GET /v1/network/recent. */
async function stealTarget(): Promise<{ jobId: string; n: number } | null> {
  const r = await api<{ jobs: { id: string; n: number; node: string | null }[] }>("/v1/network/recent");
  const other = (r.body?.jobs ?? []).find((j) => j.node && j.node.toLowerCase() !== account.address.toLowerCase());
  return other ? { jobId: other.id, n: other.n } : null;
}
async function handleSteal(): Promise<void> {
  const t0 = performance.now();
  const target = await stealTarget();
  if (!target) {
    log(NAME, "steal: no other node's job on /v1/network/recent yet");
    return;
  }
  // A plausible (schema-valid) certificate; the submit never reaches verification — the assignment/node guard refuses
  // first, because the job is not assigned to this node (/v1/network/recent only lists DONE public jobs; there is no
  // public listing of jobs currently assigned to other nodes, so a live steal has no target id to use).
  const n = Math.max(8, target.n);
  const cert = certFor(randHex64(), n, Array(n * n).fill(0), Array(n * n).fill(0), randHex64(), randHex64(), account.address, deviceId);
  const o = await nodeRequest(account, "POST", "/v1/work/submit", { jobId: target.jobId, certificate: cert, result: Array(n * n).fill(0) });
  const computeMs = performance.now() - t0;
  if (o.status !== 200) noteRefusal(o);
  noteSuspend(o.message);
  record({ cheatedThisJob: true, jobId: target.jobId, workType: "matmul", n, step: "submit", httpStatus: o.status, code: o.code, message: o.message, earned: null, computeMs });
  log(NAME, `steal ${target.jobId.slice(0, 8)} (assigned to another node) → ${o.status} ${o.code ?? "ok"}`);
  assignmentsHandled++; // steal is self-driven, not an assignment the API handed us
}

// ── challenge assignment (int8-mlp, int8-model) ─────────────────────────────────────────────────────────────────────
async function handleChallenge(a: any): Promise<void> {
  const t0 = performance.now();
  const type = CHALLENGE_TYPES[a.workType];
  const input = await fetchInput(a);
  const { outputs, result } = type.execute(input);
  const plan = type.plan(input);
  const inputs = type.inputs(input);
  const honestWork: ChallengeWork = { commitment: makeCommitment(a.sigma, inputs, plan, outputs), result, outputs, plan };
  const n: number | null = typeof a.n === "number" ? a.n : null;

  let cheated = false;
  let commitment: Commitment = honestWork.commitment;
  let submitResult: Tensor = result;

  if (CHEAT === "lazy-commit") {
    // A7: commit to garbage (random segment hashes) and a wrong result, so nothing was really computed at commit time.
    // The commitment is still internally consistent (chainRoot folds the garbage hashes, outputHash = the wrong
    // result's hash) so it binds and a challenge is drawn — then the openings cannot hash into it.
    cheated = true;
    const wrongResult: Tensor = { ...result, data: result.data.map((v, i) => (i === 0 ? (v === 127 ? 126 : v + 1) : v)) };
    const garbage = plan.map((_, i) => (i === plan.length - 1 ? tensorHash(wrongResult) : randHex64()));
    const inHash = inputHash(inputs);
    commitment = {
      inputHash: inHash,
      outputHash: tensorHash(wrongResult),
      chainRoot: chainRoot(a.sigma, inHash, plan, garbage),
      segments: plan.map((s, i) => ({ idx: s.idx, outHash: garbage[i] })),
    };
    submitResult = wrongResult;
  }

  const submitBody: any = { jobId: a.jobId, commitment, result: submitResult };
  let o = await nodeRequest(account, "POST", "/v1/work/submit", submitBody);

  if (o.status !== 200 || !o.body?.challenge) {
    // Refused at submit (e.g. a commitment that does not bind). No challenge was drawn.
    noteRefusal(o);
    noteSuspend(o.message);
    record({ cheatedThisJob: cheated, jobId: a.jobId, workType: a.workType, n, step: "submit", httpStatus: o.status, code: o.code, message: o.message, earned: null, computeMs: performance.now() - t0 });
    log(NAME, `${a.workType} ${a.jobId.slice(0, 8)} submit → ${o.status} ${o.code ?? "ok"}`);
    return;
  }

  let submitNote = "";
  if (CHEAT === "double-commit") {
    // A8b: a second submit with a DIFFERENT commitment for the same job — expect 409 (one commitment per assignment).
    const otherResult: Tensor = { ...result, data: result.data.map((v, i) => (i === 0 ? (v === 127 ? 126 : v + 1) : v)) };
    const otherOut = outputs.slice();
    otherOut[otherOut.length - 1] = otherResult;
    const second = makeCommitment(a.sigma, inputs, plan, otherOut);
    const o2 = await nodeRequest(account, "POST", "/v1/work/submit", { jobId: a.jobId, commitment: second, result: otherResult });
    submitNote = ` [2nd commit → ${o2.status} ${o2.code ?? "ok"}]`;
    if (o2.status !== 200) noteRefusal(o2);
    cheated = true;
  }

  const segments: number[] = o.body.challenge.segments;
  const deadline: number = o.body.challenge.deadline;
  let openings: SegmentOpening[] = openSegments(honestWork, segments);

  if (CHEAT === "wrong-segment") {
    // A6: open one drawn segment with a corrupted output tensor (flip one entry). Still a well-formed tensor, so it
    // simply fails to hash to the commitment → a caught segment check.
    cheated = true;
    openings = openings.map((op, k) => {
      if (k !== 0) return op;
      const ref = `seg:${op.idx}` as const;
      const t = op.tensors[ref]!;
      const data = t.data.slice();
      data[0] = data[0] === 127 ? 126 : data[0] + 1;
      return { ...op, tensors: { ...op.tensors, [ref]: { ...t, data } } };
    });
  }

  if (CHEAT === "late-answer") {
    // A8: honest work, but answer after the TTL (CHALLENGE_TTL_SECONDS = 30 s). Sleep just past the deadline.
    cheated = true;
    const waitMs = deadline - Date.now() + 1500;
    if (waitMs > 0) { log(NAME, `late-answer: sleeping ${(waitMs / 1000).toFixed(1)}s past the deadline`); await sleep(waitMs); }
  }

  const o3 = await nodeRequest(account, "POST", "/v1/work/answer", { jobId: a.jobId, openings });
  const computeMs = performance.now() - t0;
  const earned = o3.status === 200 && o3.body?.earned ? o3.body.earned : null;
  if (earned) accepted++;
  if (o3.status !== 200) noteRefusal(o3);
  noteSuspend(o3.message);
  record({ cheatedThisJob: cheated, jobId: a.jobId, workType: a.workType, n, step: "answer", httpStatus: o3.status, code: o3.code, message: (o3.message ?? "") + submitNote, earned, computeMs });
  log(NAME, `${a.workType} ${a.jobId.slice(0, 8)} answer cheat=${cheated} → ${o3.status} ${o3.code ?? "ok"}${earned ? ` earned ${earned.laneAUcld}+${earned.laneBUcld}` : ""}${submitNote}`);
}

async function handleAssignment(a: any): Promise<void> {
  const key = `${a.jobId}:${a.sigma}`;
  if (handled.has(key)) return; // the same assignment re-sent before the job row updated
  handled.add(key);
  assignmentsHandled++;
  lastAssignmentAt = Date.now();
  if (a.workType in CHALLENGE_TYPES) await handleChallenge(a);
  else await handleMatmul(a);
}

// ── Ledger / summary ──────────────────────────────────────────────────────────────────────────────────────────────
async function summary(): Promise<void> {
  const led = await api<any>(`/v1/ledger/${payout.address}`);
  const b = led.body ?? {};
  const byStatus = new Map<string, number>();
  for (const e of b.entries ?? []) byStatus.set(`${e.lane}:${e.status}`, (byStatus.get(`${e.lane}:${e.status}`) ?? 0) + 1);

  console.log("\n════════════════════ adversary summary ════════════════════");
  console.log(`cheat: ${CHEAT}  node: ${account.address}  payout: ${payout.address}`);
  console.log(`assignments handled: ${assignmentsHandled}  accepted (200 + earned): ${accepted}  suspended: ${suspended}`);
  console.log("refusals:");
  if (refusals.size === 0) console.log("  (none)");
  for (const [k, n] of refusals) console.log(`  ${n}× ${k}`);
  console.log("\nledger of the payout wallet:");
  if (led.status !== 200) console.log(`  GET /v1/ledger/${payout.address} → ${led.status}`);
  else {
    console.log(`  pending A/B: ${b.pending?.A ?? 0} / ${b.pending?.B ?? 0}  held A/B: ${b.held?.A ?? 0} / ${b.held?.B ?? 0}`);
    console.log(`  settled A/B: ${b.settled?.A ?? 0} / ${b.settled?.B ?? 0}  clawed A/B: ${b.clawed?.A ?? 0} / ${b.clawed?.B ?? 0}`);
    console.log(`  verifySampleK: ${b.verifySampleK}  payHoldSeconds: ${b.payHoldSeconds}  entries: ${(b.entries ?? []).length}`);
    for (const [k, n] of byStatus) console.log(`    ${n}× ${k}`);
  }
  console.log("════════════════════════════════════════════════════════════");
}

async function main(): Promise<void> {
  log(NAME, `cheat=${CHEAT} jobs=${MAX_JOBS} rate=${RATE} out=${OUT}`);
  log(NAME, `node ${account.address}  device ${deviceId.slice(0, 12)}…  ${mmac.toFixed(1)} MMAC/s`);
  writeFileSync(OUT, ""); // fresh log for this run

  // Announce (retry through the announce coming before binding), then bind the payout wallet.
  let ann = await announce();
  for (let i = 0; i < 5 && ann.status !== 200; i++) { await sleep(HEARTBEAT_MS); ann = await announce(); }
  if (ann.status !== 200) throw new Error(`announce failed: ${ann.status} ${JSON.stringify(ann.body)}`);
  if (!ann.body.bound) {
    if (!ann.body.bindCode) throw new Error("announce returned no bindCode and is not bound");
    await bind(ann.body.bindCode);
  } else {
    log(NAME, "already bound (reused key)");
  }

  // `steal` needs no real assignment: it submits against another node's done job id and stops.
  if (CHEAT === "steal") {
    await until(async () => (await stealTarget()) !== null, "another node's job on /v1/network/recent", 120_000, 3000).catch(() => null);
    await handleSteal();
    await summary();
    process.exit(0);
  }

  // Heartbeat loop: read res.assignment (we do not verify the instruction signature — the adversary need not), handle it.
  while (true) {
    const o = await nodeRequest(account, "POST", "/v1/nodes/heartbeat", { agentVersion: AGENT_VERSION, relay: false });
    if (o.status === 200 && o.body?.assignment) {
      await handleAssignment(o.body.assignment);
    }
    if (assignmentsHandled >= MAX_JOBS) { log(NAME, `reached ${MAX_JOBS} assignments`); break; }
    if (suspended) { log(NAME, "node is suspended — stopping"); break; }
    if (Date.now() - lastAssignmentAt > IDLE_TIMEOUT_MS) { log(NAME, "10 min with no assignment — stopping"); break; }
    await sleep(HEARTBEAT_MS);
  }

  await summary();
  process.exit(0);
}

main().catch((err) => { log(NAME, `fatal: ${(err as Error).message}`); process.exit(1); });
