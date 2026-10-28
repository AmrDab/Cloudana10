/**
 * Phase 4 (owner decisions D1–D4, 2026-10-28) numbers from the API's SQLite: protocol work issued and verified, lane B
 * per epoch (paid subsidy vs protocol), the cluster gate's pass rate on user jobs, and what happened to the adversary.
 *   npx tsx scripts/sim/testnet/phase4-stats.ts
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { RUN } from "./common.ts";

const db = new DatabaseSync(path.join(RUN, "sim.sqlite"), { readOnly: true });
const one = <T>(sql: string) => db.prepare(sql).get() as T;
const all = <T>(sql: string) => db.prepare(sql).all() as T[];

const p = one<{ issued: number; done: number; failed: number; queued: number; nodes: number }>(
  "SELECT COUNT(*) AS issued, SUM(status = 'done') AS done, SUM(status = 'failed') AS failed, SUM(status = 'queued') AS queued, COUNT(DISTINCT node) AS nodes FROM work_jobs WHERE protocol = 1",
);
const u = one<{ jobs: number; done: number; gate: number }>("SELECT COUNT(*) AS jobs, SUM(status = 'done') AS done, SUM(cluster_ok = 1) AS gate FROM work_jobs WHERE protocol = 0");
const first = one<{ t: number }>("SELECT MIN(created_at) AS t FROM work_jobs WHERE protocol = 1");
const last = one<{ t: number }>("SELECT MAX(completed_at) AS t FROM work_jobs WHERE protocol = 1");
console.log(`# Phase 4 — ${new Date().toISOString()}\n`);
console.log(`Protocol jobs: ${p.issued} issued, ${p.done} done, ${p.failed} failed, ${p.queued} queued, on ${p.nodes} nodes, over ${(((last.t ?? 0) - (first.t ?? 0)) / 60_000).toFixed(1)} min.`);
console.log(`User jobs: ${u.jobs} (${u.done} done); cluster gate passed on ${u.gate} of ${u.jobs} (${u.jobs ? ((100 * u.gate) / u.jobs).toFixed(0) : 0} %).\n`);

console.log("| epoch | status | fees burned | lane A | lane B paid | lane B protocol | protocol jobs | wallets |");
console.log("|---|---|---|---|---|---|---|---|");
for (const e of all<{ id: number; status: string; fees: number; a: number; paid: number; proto: number; jobs: number; wallets: number }>(
  "SELECT e.id, e.status, e.fees_burned_ucld AS fees, e.mint_a_ucld AS a, " +
    "COALESCE((SELECT SUM(amount_ucld) FROM reward_entries r WHERE r.epoch = e.id AND r.lane = 'B' AND r.units IS NULL AND r.status <> 'clawed'), 0) AS paid, " +
    "COALESCE((SELECT SUM(amount_ucld) FROM reward_entries r WHERE r.epoch = e.id AND r.lane = 'B' AND r.units IS NOT NULL AND r.status <> 'clawed'), 0) AS proto, " +
    "(SELECT COUNT(*) FROM reward_entries r WHERE r.epoch = e.id AND r.units IS NOT NULL AND r.status <> 'clawed') AS jobs, " +
    "(SELECT COUNT(DISTINCT address) FROM reward_entries r WHERE r.epoch = e.id AND r.units IS NOT NULL AND r.status <> 'clawed') AS wallets " +
    "FROM epochs e ORDER BY e.id",
)) {
  console.log(`| ${e.id} | ${e.status} | ${e.fees} | ${e.a} | ${e.paid} | ${e.proto} | ${e.jobs} | ${e.wallets} |`);
}

console.log("\n| payout wallet | protocol jobs | lane B from protocol (µCLD, settled + posted + pending) |");
console.log("|---|---|---|");
for (const w of all<{ address: string; jobs: number; ucld: number }>(
  "SELECT address, COUNT(*) AS jobs, SUM(amount_ucld) AS ucld FROM reward_entries WHERE units IS NOT NULL AND status <> 'clawed' GROUP BY address ORDER BY ucld DESC",
)) {
  console.log(`| ${w.address} | ${w.jobs} | ${w.ucld} |`);
}

console.log("\n## Adversary (hit-and-run with a lazy transcript, warm-up on)\n");
for (const n of all<{ address: string; name: string; state: string; reason: string; done: number; failed: number }>(
  "SELECT address, name, state, state_reason AS reason, jobs_done AS done, jobs_failed AS failed FROM nodes WHERE name LIKE 'adv-%' ORDER BY state_at",
)) {
  const claws = one<{ c: number; ucld: number }>(`SELECT COUNT(*) AS c, COALESCE(SUM(amount_ucld), 0) AS ucld FROM reward_entries WHERE status = 'clawed' AND address = (SELECT payout FROM nodes WHERE address = '${n.address}')`);
  console.log(`- ${n.name} (${n.address.slice(0, 10)}…): ${n.state}${n.reason ? ` — ${n.reason}` : ""}; jobs done ${n.done}, failed ${n.failed}; entries clawed ${claws.c} (${claws.ucld} µCLD)`);
}
