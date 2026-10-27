/**
 * Phase 1 / 3 report (docs/POUW_SIMULATION_PLAN.md §4, §6): joins the fake user's job records, the agents' compute
 * times, the API's verify times, the ledger and the chain into Markdown tables.
 *   npx tsx scripts/sim/testnet/report.ts [--jobs .dev-run-sim/jobs.jsonl] > .dev-run-sim/report.md
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createPublicClient, http, parseAbi } from "viem";
import { settlementAbi } from "../../../keeper/src/abi";
import { PROVIDERS, RPC, RUN, addresses, wallet } from "./common.ts";

const opt = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};
const JOBS_FILE = path.resolve(opt("jobs", path.join(RUN, "jobs.jsonl")));
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

type JobRec = { id: string; label: string; workType: string; n: number; priceUcld: number; status: string; node: string; submittedAt: number; assignedAt: number; completedAt: number };
const jobs: JobRec[] = existsSync(JOBS_FILE) ? readFileSync(JOBS_FILE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const byId = new Map(jobs.map((j) => [j.id, j]));

// ── Agent logs: "job <id> …" then "✓ verified … [1.23s]" (or "✗ job <id> failed: …"), sequential per agent ──────
const computeMs = new Map<string, number>();
const agentFails: string[] = [];
for (const f of readdirSync(RUN).filter((f) => /^agent-.*\.log$/.test(f))) {
  let current: string | null = null;
  for (const line of readFileSync(path.join(RUN, f), "utf8").split("\n")) {
    const j = /\] job ([0-9a-f-]{36}) /.exec(line);
    if (j) current = j[1];
    const ok = /✓ verified.*\[([\d.]+)s\]/.exec(line);
    if (ok && current) computeMs.set(current, Number(ok[1]) * 1000);
    const bad = /✗ job ([0-9a-f-]{36}) failed: (.*)/.exec(line);
    if (bad) agentFails.push(`${f}: ${bad[1].slice(0, 8)} ${bad[2]}`);
  }
}

// ── API log: "[work] verify <id> <type> … <ms>ms sampled=… ok=…" (matmul) / "… segment i (kind) <ms>ms cumulative …" ──
const verifyMs = new Map<string, number>();
const sampled = new Map<string, boolean>();
const segments = new Map<string, string>();
const apiLog = path.join(RUN, "api.log");
if (existsSync(apiLog)) {
  for (const raw of readFileSync(apiLog, "utf8").split("\n")) {
    const line = strip(raw);
    const m = /\[work\] verify ([0-9a-f-]{36}) (\S+) n=\d+ ([\d.]+)ms sampled=(true|false)/.exec(line);
    if (m) {
      verifyMs.set(m[1], Number(m[3]));
      sampled.set(m[1], m[4] === "true");
    }
    const s = /\[work\] verify ([0-9a-f-]{36}) (\S+) segment \d+ \(\w+\) ([\d.]+)ms cumulative, (\d+\/\d+) drawn/.exec(line);
    if (s) {
      verifyMs.set(s[1], Number(s[3]));
      segments.set(s[1], s[4]);
    }
  }
}

// ── Ledger + epochs from the API's SQLite ─────────────────────────────────────────────────────────────────────
const db = new DatabaseSync(path.join(RUN, "sim.sqlite"), { readOnly: true });
const rows = db.prepare("SELECT id, work_type, n, status, node, price_ucld, sample_check, cluster_ok, created_at, assigned_at, completed_at FROM work_jobs").all() as any[];
const entries = db.prepare("SELECT job_id, lane, address, amount_ucld, epoch, status FROM reward_entries").all() as any[];
const epochRows = db.prepare("SELECT id, status, fees_burned_ucld, mint_a_ucld, mint_b_ucld, treasury_ucld FROM epochs ORDER BY id").all() as any[];
const lanes = new Map<string, { A: number; B: number; T: number }>();
for (const e of entries) {
  const l = lanes.get(e.job_id) ?? { A: 0, B: 0, T: 0 };
  if (e.lane === "A") l.A += e.amount_ucld;
  else if (e.lane === "B") l.B += e.amount_ucld;
  else if (e.lane === "treasury") l.T += e.amount_ucld;
  lanes.set(e.job_id, l);
}
const macs = (r: any, j?: JobRec) => {
  if (r.work_type === "matmul") return r.n ** 3;
  // int8 types: the meter is 2·b·d·h·L; the label carries d (and L) the user chose; b = 16 in user.ts.
  const label = j?.label ?? "";
  const [, p1, p2] = label.split(":");
  if (r.work_type === "int8-mlp") return 2 * 16 * Number(p1 ?? 64) ** 2;
  if (r.work_type === "int8-model") return 2 * 16 * Number(p2 ?? 64) ** 2 * Number(p1 ?? 2);
  return 0;
};

const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : NaN);
const f = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "–");
const out: string[] = [];
const scope = rows.filter((r) => byId.has(r.id));
out.push(`# Simulation report — ${new Date().toISOString()}`, "");
out.push(`Jobs in this run (from ${path.basename(JOBS_FILE)}): ${scope.length}; in the database overall: ${rows.length}.`, "");

// E1 verifier cost ratio, E3 CLD per unit of work
out.push("## E1 / E3 — per work type and size", "");
out.push("| label | jobs | done | provider compute ms (median) | API verify ms (median) | verify ÷ compute | sampled (matmul) / segments | fee µCLD | lane A µCLD | lane B µCLD | µCLD per TMAC (A) | MACs/job |");
out.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
const labels = [...new Set(jobs.map((j) => j.label))];
for (const label of labels) {
  const js = jobs.filter((j) => j.label === label);
  const rs = js.map((j) => rows.find((r) => r.id === j.id)).filter(Boolean);
  const done = rs.filter((r) => r.status === "done");
  const c = done.map((r) => computeMs.get(r.id)).filter((v): v is number => v !== undefined);
  const vAll = done.map((r) => verifyMs.get(r.id)).filter((v): v is number => v !== undefined);
  const vUnsampled = done.filter((r) => sampled.get(r.id) === false).map((r) => verifyMs.get(r.id)!).filter((v) => v !== undefined);
  const vSampled = done.filter((r) => sampled.get(r.id) === true).map((r) => verifyMs.get(r.id)!).filter((v) => v !== undefined);
  const laneA = done.reduce((s, r) => s + (lanes.get(r.id)?.A ?? 0), 0);
  const laneB = done.reduce((s, r) => s + (lanes.get(r.id)?.B ?? 0), 0);
  const fee = done.reduce((s, r) => s + r.price_ucld, 0);
  const m = done.length ? macs(done[0], js[0]) : 0;
  const tmac = (m * done.length) / 1e12;
  const seg = done.length && segments.has(done[0].id) ? segments.get(done[0].id) : vSampled.length || vUnsampled.length ? `${vSampled.length} of ${done.length} sampled (${f(median(vUnsampled))} / ${f(median(vSampled))} ms)` : "–";
  out.push(`| ${label} | ${js.length} | ${done.length} | ${f(median(c))} | ${f(median(vAll))} | ${f(median(vAll) / median(c), 3)} | ${seg} | ${f(fee / Math.max(done.length, 1), 0)} | ${f(laneA / Math.max(done.length, 1), 0)} | ${f(laneB / Math.max(done.length, 1), 0)} | ${tmac ? f(laneA / tmac, 0) : "–"} | ${m.toExponential(2)} |`);
}
out.push("");

// E2 honest false rejects
const notDone = scope.filter((r) => r.status !== "done");
const sampleFailed = scope.filter((r) => r.sample_check === "failed");
out.push("## E2 — honest false rejects", "");
out.push(`Jobs not done: ${notDone.length} (${notDone.map((r) => `${r.id.slice(0, 8)} ${r.work_type} ${r.status}`).join(", ") || "none"}). Sampled checks failed: ${sampleFailed.length}. Agent-side failures: ${agentFails.length}${agentFails.length ? "\n" + agentFails.map((s) => `- ${s}`).join("\n") : ""}`, "");

// E4 throughput + latency
const doneJobs = scope.filter((r) => r.status === "done");
if (doneJobs.length) {
  const t0 = Math.min(...doneJobs.map((r) => r.created_at));
  const t1 = Math.max(...doneJobs.map((r) => r.completed_at));
  const perNode = new Map<string, number>();
  for (const r of doneJobs) perNode.set(r.node, (perNode.get(r.node) ?? 0) + 1);
  const wait = doneJobs.map((r) => (r.assigned_at - r.created_at) / 1000);
  const run = doneJobs.map((r) => (r.completed_at - r.assigned_at) / 1000);
  out.push("## E4 — throughput and latency", "");
  out.push(`${doneJobs.length} jobs done in ${((t1 - t0) / 60000).toFixed(1)} min = ${(doneJobs.length / ((t1 - t0) / 60000)).toFixed(1)} jobs/min over ${perNode.size} nodes (${[...perNode.values()].join(" / ")} each). ` +
    `Queue wait median ${f(median(wait))} s, assigned→verified median ${f(median(run))} s (the agent polls every 15 s).`, "");
}

// Cluster gate
const gated = doneJobs.filter((r) => r.cluster_ok === 0).length;
out.push("## Cluster gate (lane B)", "", `${gated} of ${doneJobs.length} done jobs had cluster_ok = 0 (no subsidy): the eligible set at the draw had fewer than CLUSTER_N_MIN idle wallets.`, "");

// Epochs + chain
out.push("## Epochs (API) and the chain", "");
out.push("| epoch | API status | fees burned | mint A | mint B | treasury | on-chain status | on-chain minted A | B | treasury | burned |");
out.push("|---|---|---|---|---|---|---|---|---|---|---|");
const a = addresses();
const pub = createPublicClient({ transport: http(RPC) });
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function totalSupply() view returns (uint256)"]);
const U = 10n ** 12n;
let chainMinted = 0n, chainBurned = 0n;
for (const e of epochRows) {
  const r = (await pub.readContract({ address: a.CloudanaSettlementV2, abi: settlementAbi, functionName: "epochs", args: [BigInt(e.id)] })) as any;
  const [, , , treasury, burned, mA, mB, , , status] = r;
  chainMinted += mA + mB + treasury;
  chainBurned += burned;
  out.push(`| ${e.id} | ${e.status} | ${e.fees_burned_ucld} | ${e.mint_a_ucld} | ${e.mint_b_ucld} | ${e.treasury_ucld} | ${status} | ${mA / U} | ${mB / U} | ${treasury / U} | ${burned / U} |`);
}
const supply = await pub.readContract({ address: a.CLDTokenV2, abi: erc20, functionName: "totalSupply" });
const genesis = 1_000_000n * 10n ** 18n;
out.push("", `Total supply ${supply} wei: Δ from genesis ${(supply - genesis) / U} µCLD; on-chain minted ${chainMinted / U} − burned ${chainBurned / U} = ${(chainMinted - chainBurned) / U} µCLD ${(supply - genesis) === chainMinted - chainBurned ? "✓ invariant holds" : "✗ MISMATCH"}.`, "");
out.push("| provider | payout | on-chain balance µCLD | ledger A+B settled | pending | clawed |", "|---|---|---|---|---|---|");
for (const p of PROVIDERS) {
  const w = wallet(`provider-${p}`).address.toLowerCase();
  const bal = (await pub.readContract({ address: a.CLDTokenV2, abi: erc20, functionName: "balanceOf", args: [w as `0x${string}`] })) / U;
  const mine = entries.filter((e) => e.address === w && (e.lane === "A" || e.lane === "B"));
  const sum = (st: string[]) => mine.filter((e) => st.includes(e.status)).reduce((s, e) => s + e.amount_ucld, 0);
  out.push(`| ${p} | ${w} | ${bal} | ${sum(["settled"])} | ${sum(["pending", "posted"])} | ${sum(["clawed"])} |`);
}
console.log(out.join("\n"));
