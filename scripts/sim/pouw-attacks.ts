/**
 * Cloudana PoUW — attack scenarios and costs against the REAL code (docs/POUW_REVIEW.md).
 *
 *   npx tsx scripts/sim/pouw-attacks.ts [--trials 300] [--sizes 8,16,32,64,128,256]
 *
 * Runs pouw/src (solveAssignedJob, verify, freivalds) and the API's actual verdict function
 * (client/api/src/services/work-types.ts `matmul.verify`, the one /v1/work/submit calls) against:
 *   honest · skipped work · partial transcript · stale/copied certificate · plain-matmul answer without proof ·
 *   wrong answers (Freivalds) · answers congruent mod p · a second-preimage of the A/B hash binding · difficulty field.
 * Measures: node cost with and without the proof, orchestrator cost to accept and to reject, Freivalds cost,
 * transcript size; then analytic tables for self-dealing, the 3-attempt griefer and the fee breakdown.
 * Nothing is written. Simulation, not a forecast.
 */
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  solveAssignedJob, solveAssigned, freivalds, chooseBlockSize,
  toFieldMatrix, matHash, PRIME_N, matCreate, matAdd, matMul,
} from "../../pouw/src/index.ts";
import type { Matrix } from "../../pouw/src/matrix.ts";
import type { POUWCertificate } from "../../pouw/src/types.ts";
import { matmul, matMulSigned } from "../../client/api/src/services/work-types.ts";

function opt(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const TRIALS = Number(opt("trials", "300"));
const SIZES = opt("sizes", "8,16,32,64,128,256").split(",").map(Number);

const NODE = "0x" + "11".repeat(20);
const DEVICE = "0x" + "22".repeat(32);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const ms = (f: () => void): number => { const t = performance.now(); f(); return performance.now() - t; };
const fmt = (x: number, d = 1) => x.toFixed(d);

/** A job the way jobs.service.ts stores it: signed ints within maxAbsEntry(n), σ = sha256(jobId‖node‖nonce‖seed). */
function makeJob(n: number, seed = 1) {
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2 ** 31; return s; };
  const bound = Math.floor(Math.sqrt((PRIME_N - 1) / 2 / n));
  const lim = Math.min(bound, 127); // int8-ish inputs (what a quantized workload looks like)
  const matrixA = Array.from({ length: n * n }, () => (rnd() % (2 * lim + 1)) - lim);
  const matrixB = Array.from({ length: n * n }, () => (rnd() % (2 * lim + 1)) - lim);
  const sigma = sha(`job-${n}-${seed}|${NODE}|nonce|0xblockhash`);
  return { n, matrixA, matrixB, sigma };
}

type Job = ReturnType<typeof makeJob>;
const verdict = (job: Job, certificate: POUWCertificate, result: number[]) =>
  matmul.verify({ job, certificate, result });

// ─── 1. Costs: node with/without proof, orchestrator accept/reject, Freivalds ──────────────────

console.log("## 1. Cost of the proof (wall ms on this machine, single thread)\n");
console.log("| n | r | nb | transcript MB | plain C (node, no proof) | solveAssignedJob (node) | API verify (accept) | Freivalds only | verify ÷ plain |");
console.log("|---|---|---|---|---|---|---|---|---|");
const costRows: Record<number, { plain: number; solve: number; verify: number; frei: number }> = {};
for (const n of SIZES) {
  const job = makeJob(n);
  const r = chooseBlockSize(n);
  const nb = n / r;
  const transcriptMB = (nb ** 3 * r * r * 4) / 1e6;
  let C: number[] = [];
  const plain = ms(() => { C = matMulSigned(job.matrixA, job.matrixB, n); });
  let out!: ReturnType<typeof solveAssignedJob>;
  const solve = ms(() => { out = solveAssignedJob(job.sigma, job.matrixA, job.matrixB, n, NODE, DEVICE); });
  const ver = ms(() => { if (!verdict(job, out.certificate, out.result).ok) throw new Error("honest rejected"); });
  const frei = ms(() => { if (!freivalds(job.matrixA, job.matrixB, C, n)) throw new Error("freivalds rejected truth"); });
  costRows[n] = { plain, solve, verify: ver, frei };
  console.log(`| ${n} | ${r} | ${nb} | ${fmt(transcriptMB, 3)} | ${fmt(plain)} | ${fmt(solve)} | ${fmt(ver)} | ${fmt(frei, 2)} | ${fmt(ver / plain)}× |`);
}
// block-size wart: n with few divisors
console.log("\nBlock size is a function of the user's n (cupow.ts:49-54):");
for (const n of [255, 254, 251, 128, 192]) {
  const r = chooseBlockSize(n);
  console.log(`  n=${n}: r=${r}, nb=${n / r}, blocks=${(n / r) ** 3}`);
}

// ─── 2. Attack scenarios through the API verdict ──────────────────────────────────────────────

console.log("\n## 2. Attacks through matmul.verify (the /v1/work/submit verdict), n=64 unless noted\n");
console.log("| # | Scenario | Verdict | Rejected at | Orchestrator cost (ms) | Attacker compute |");
console.log("|---|---|---|---|---|---|");

const n = 64;
const job = makeJob(n);
const honest = solveAssignedJob(job.sigma, job.matrixA, job.matrixB, n, NODE, DEVICE);
const trueC = matMulSigned(job.matrixA, job.matrixB, n);

function row(id: string, name: string, cert: POUWCertificate, result: number[], attackerCompute: string, j: Job = job) {
  let v!: ReturnType<typeof verdict>;
  const t = ms(() => { v = verdict(j, cert, result); });
  const at = v.ok ? "—" : v.reason;
  console.log(`| ${id} | ${name} | ${v.ok ? "ACCEPTED" : "rejected"} | ${at} | ${fmt(t)} | ${attackerCompute} |`);
  return v.ok;
}

row("a", "honest", honest.certificate, honest.result, "3n³ + hash");

// b. skip the work: C computed plainly, transcript hash invented
row("b", "skip work: plain C, random transcriptHash", { ...honest.certificate, transcriptHash: sha("x"), z: sha("y") }, trueC, "n³ (plain C only)");

// c. partial transcript: compute every block but the last product (one block product skipped)
function lazyTranscript(sigma: string, A: Matrix, B: Matrix, r: number): string {
  // same loop as matmul.ts:405-422 with the final (i,j,l) product skipped
  const nn = A.rows, nb = nn / r;
  const hasher = createHash("sha256");
  const get = (m: Matrix, rs: number, cs: number) => {
    const b = matCreate(r, r);
    for (let i = 0; i < r; i++) for (let k = 0; k < r; k++) b.data[i * r + k] = m.data[(rs + i) * m.cols + cs + k];
    return b;
  };
  for (let i = 0; i < nb; i++) for (let jj = 0; jj < nb; jj++) {
    let Cij = matCreate(r, r);
    for (let l = 0; l < nb; l++) {
      const last = i === nb - 1 && jj === nb - 1 && l === nb - 1;
      if (!last) Cij = matAdd(Cij, matMul(get(A, i * r, l * r), get(B, l * r, jj * r)));
      const buf = Buffer.alloc(r * r * 4);
      for (let k = 0; k < r * r; k++) buf.writeInt32BE(Cij.data[k] | 0, k * 4);
      hasher.update(buf);
    }
  }
  return hasher.digest("hex");
}
{
  // encode()'s noise is not exported, so this transcript is the same block loop over the un-noised field inputs with
  // one block product skipped: a transcript that differs from the honest one in (at least) one block. verify()
  // re-executes every block (cupow.ts:296-300), so any such deviation is caught the same way at the same cost.
  const Af = toFieldMatrix(job.matrixA, n), Bf = toFieldMatrix(job.matrixB, n);
  const th = lazyTranscript(job.sigma, Af, Bf, chooseBlockSize(n));
  const cert = { ...honest.certificate, transcriptHash: th };
  cert.z = sha(job.sigma + th + cert.matrixAHash + cert.matrixBHash);
  row("c", "partial: a transcript differing in one block, correct C", cert, trueC, "≈ n³ (all but one block)");
}

// d. stale: a certificate from an earlier assignment (other σ) of the same matrices, with the right C
{
  const old = makeJob(n, 2); old.matrixA = job.matrixA; old.matrixB = job.matrixB; // same A, B, different σ
  const stale = solveAssignedJob(old.sigma, old.matrixA, old.matrixB, n, NODE, DEVICE);
  row("d", "stale cert (same A,B, earlier σ) + right C", stale.certificate, stale.result, "0 now (did it before)");
  // d2: stale transcript relabelled with the current σ
  const relabel = { ...stale.certificate, sigma: job.sigma };
  row("d2", "stale transcript relabelled with current σ", relabel, stale.result, "0 now");
}

// e. copy another node's answer: right C (copied), transcript under the other node's σ
{
  const otherSigma = sha(`job-64-1|0xother|nonce|0xblockhash`);
  const other = solveAssignedJob(otherSigma, job.matrixA, job.matrixB, n, "0x" + "33".repeat(20), DEVICE);
  row("e", "copied: other node's cert + its C", other.certificate, other.result, "0 (copied)");
}

// f. plain answer, no proof at all (what a user actually needs): correct C, honest-looking cert fields but no transcript
row("f", "plain matmul C, transcript field blank", { ...honest.certificate, transcriptHash: "", z: "" }, trueC, "n³");

// g. wrong answers: Freivalds
{
  const bad1 = trueC.slice(); bad1[7] += 1;
  row("g1", "right transcript, C with one entry +1", honest.certificate, bad1, "3n³ + hash");
  const badAll = trueC.map((v) => v + 1);
  row("g2", "right transcript, every entry of C +1", honest.certificate, badAll, "3n³ + hash");
  const wrapAll = trueC.map((v) => v + PRIME_N);
  const okWrap = row("g3", "right transcript, C + p (every entry) — wrong over Z, equal mod p", honest.certificate, wrapAll, "3n³ + hash");
  const wrapOne = trueC.slice(); wrapOne[0] += PRIME_N;
  const okWrap1 = row("g4", "right transcript, C with one entry + p", honest.certificate, wrapOne, "3n³ + hash");
  const wrapK = trueC.map((v, i) => v + PRIME_N * ((i * 7) % 5 - 2));
  const okWrapK = row("g5", "right transcript, C + p·K (K random small ints)", honest.certificate, wrapK, "3n³ + hash");
  if (okWrap || okWrap1 || okWrapK) console.log("  → Freivalds runs mod p (freivalds.ts:325-350); work-types.ts:199 bounds C only to safe integers.");
}

// h. hash-binding second preimage: cert.matrixA = field(A) + 2^32 per entry (matToBytes uses `| 0`, matrix.ts:538)
{
  const Af = toFieldMatrix(job.matrixA, n), Bf = toFieldMatrix(job.matrixB, n);
  const A2: Matrix = { rows: n, cols: n, data: Af.data.map((v) => v + 2 ** 32) };
  const same = matHash(A2) === matHash(Af);
  const forged = solveAssigned(job.sigma, A2, Bf, NODE, DEVICE); // transcript over (A + 2^32 mod p) ≠ A
  const differs = forged.certificate.transcriptHash !== honest.certificate.transcriptHash;
  const ok = row("h", `A-hash 2nd preimage: cert.matrixA = A+2³² (hash equal: ${same}, transcript differs: ${differs}) + true C`, forged.certificate, trueC, "3n³ on the WRONG matrix");
  if (ok) console.log("  → the certificate proves work on a different matrix than the job's and still binds (matrix.ts:538 `| 0`).");
}

// i. difficulty field
{
  row("i1", "difficulty field = 0 (protocol)", { ...honest.certificate, difficulty: 0 }, honest.result, "—");
  row("i2", "difficulty field = 8 (legacy minimum)", { ...honest.certificate, difficulty: 8 }, honest.result, "—");
  row("i3", "difficulty field = 256", { ...honest.certificate, difficulty: 256 }, honest.result, "—");
}

// j. garbage DoS: what a rejection costs the orchestrator today vs with Freivalds first
{
  const garbage = { ...honest.certificate, transcriptHash: sha("g"), z: sha("gz") };
  const wrongC = trueC.map((v) => v + 3);
  const tNow = ms(() => verdict(job, garbage, wrongC));
  const tFreiFirst = ms(() => { if (freivalds(job.matrixA, job.matrixB, wrongC, n)) verdict(job, garbage, wrongC); });
  console.log(`\nGarbage submission (wrong transcript AND wrong C), n=64: reject costs ${fmt(tNow)} ms today (transcript first, work-types.ts:192-202); ${fmt(tFreiFirst, 2)} ms with Freivalds first.`);
}

// ─── 3. Freivalds trials ──────────────────────────────────────────────────────────────────────

console.log("\n## 3. Freivalds (2 rounds, p = 1e9+7) — empirical detection over random corruptions\n");
{
  const P = PRIME_N;
  let caught1 = 0, caughtRnd = 0, acceptedWrap = 0;
  const t0 = performance.now();
  for (let t = 0; t < TRIALS; t++) {
    const c1 = trueC.slice(); c1[Math.floor(Math.random() * c1.length)] += 1 + Math.floor(Math.random() * 1000);
    if (!freivalds(job.matrixA, job.matrixB, c1, n)) caught1++;
    const cr = trueC.map(() => Math.floor(Math.random() * 2e6) - 1e6);
    if (!freivalds(job.matrixA, job.matrixB, cr, n)) caughtRnd++;
    const cw = trueC.map((v) => v + P * (Math.random() < 0.5 ? 1 : -1));
    if (freivalds(job.matrixA, job.matrixB, cw, n)) acceptedWrap++;
  }
  const dt = (performance.now() - t0) / (3 * TRIALS);
  console.log(`| Corruption | Trials | Detected | Theoretical false-accept |`);
  console.log(`|---|---|---|---|`);
  console.log(`| one entry off by 1..1000 | ${TRIALS} | ${caught1} (${fmt((100 * caught1) / TRIALS)}%) | ≤ (1/p)² ≈ 1e-18 |`);
  console.log(`| random C | ${TRIALS} | ${caughtRnd} (${fmt((100 * caughtRnd) / TRIALS)}%) | ≤ 1e-18 |`);
  console.log(`| C ± p per entry (wrong integers, same residues) | ${TRIALS} | ${TRIALS - acceptedWrap} (${fmt((100 * (TRIALS - acceptedWrap)) / TRIALS)}%) | 1 (accepted by construction) |`);
  console.log(`Mean Freivalds cost at n=64: ${fmt(dt, 2)} ms. Bound for exact recovery: |C_ij| ≤ n·maxAbsEntry(n)² < p/2, so a magnitude check makes the mod-p equality exact.`);
}

// ─── 4. Analytic economics ───────────────────────────────────────────────────────────────────

console.log("\n## 4. Fee breakdown (pricing.service.ts:25-29; BASE_FEE_UCLD 1000, 14,000 nCLD/TMAC) and orchestrator cost\n");
const feeUcld = (unitsMac: number, price = 14_000, base = 1000) =>
  base + Number((BigInt(unitsMac) * BigInt(price) + 999_999_999_999_999n) / 1_000_000_000_000_000n);
const CF_USD_PER_CPU_S = 0.02 / 1000; // Workers Paid: $0.02 per million CPU-ms (assumption; check current pricing)
const CLD_USD = 0.1; // testnet reference rate (DECISIONS_CONSENSUS superseding note)
console.log("| n | MAC | fee µCLD | of which compute | provider lane A µCLD | lane B max (ρ 0.04) | orchestrator verify s | orchestrator $ ÷ provider $ |");
console.log("|---|---|---|---|---|---|---|---|");
for (const nn of SIZES) {
  const units = nn ** 3;
  const fee = feeUcld(units);
  const laneA = Math.floor((fee * 950) / 1000);
  const laneB = Math.floor(fee * 0.04);
  const vs = (costRows[nn]?.verify ?? 0) / 1000;
  const orchUsd = vs * CF_USD_PER_CPU_S;
  const provUsd = (laneA / 1e6) * CLD_USD;
  console.log(`| ${nn} | ${units.toLocaleString()} | ${fee} | ${fee - 1000} | ${laneA} | ${laneB} | ${fmt(vs, 3)} | ${fmt((100 * orchUsd) / provUsd)}% |`);
}

console.log("\n## 5. Self-dealing: expected return per 1 CLD paid = s·(0.95 + ρ) − 1 (splitFee, ledger.service.ts:45-56; RHO_MAX 0.04)\n");
console.log("| capacity share s | ρ = 0 | ρ = 0.04 (cap) | ρ = 0.25 (whitepaper §6.2 text) | ρ = 1.0 |");
console.log("|---|---|---|---|---|");
for (const s of [0.1, 0.34, 0.5, 0.9, 1.0]) {
  const cells = [0, 0.04, 0.25, 1.0].map((rho) => fmt(100 * (s * (0.95 + rho) - 1), 1) + "%");
  console.log(`| ${s} | ${cells.join(" | ")} |`);
}

console.log("\n## 6. Griefer with share s who fails every assignment (MAX_JOB_ATTEMPTS 3, jobs.service.ts:210,324)\n");
console.log("| s | P(job killed, user refunded) = s³ | expected wasted verifications per job | expected delay (assignment TTL 60 s + heartbeat ≤ 15 s per retry) |");
console.log("|---|---|---|---|");
for (const s of [0.1, 0.3, 0.5, 0.9]) {
  const killed = s ** 3;
  const wasted = s + s * s + s ** 3; // failures before an honest draw or the third failure
  console.log(`| ${s} | ${fmt(100 * killed, 1)}% | ${fmt(wasted, 2)} | up to ${fmt(wasted * 75, 0)} s |`);
}

console.log("\n## 7. Assignment TTL vs node solve time (ASSIGNMENT_TTL_SECONDS 60, heartbeat 15 s)\n");
for (const nn of SIZES) {
  const t = costRows[nn].solve / 1000;
  const note = t > 45 ? "EXPIRES on a node this fast (re-queued forever, hold stuck)" : t > 20 ? "tight" : "ok";
  console.log(`  n=${nn}: solveAssignedJob ${fmt(t, 2)} s → ${note}`);
}
