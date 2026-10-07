/**
 * Reward ledger (docs/IMPL_SPEC_2026-10.md "Fee split", "Epochs"; docs/BUILD_SPEC_V1.md §2–§3).
 * All amounts are integer µCLD. The treasury share rounds UP and lane A is trimmed so A + treasury
 * never exceeds floor(0.98F): the settlement contract enforces treasury ≥ 3% and A + treasury ≤ 98%
 * of fees exactly, so per-job rounding must hold both bounds (summed over an epoch they still hold).
 *
 * Per completed job with fee F:
 *   lane A    provider payout min(floor(0.950F), floor(0.980F) − treasury)   claimable after finalize
 *   treasury  ceil(0.030F)                         posted per epoch as an amount (not a Merkle leaf)
 *   lane B    floor(ρF) if the per-operator cluster gate passed, capped by the epoch budget; vests on-chain
 *   the user's F is burned (epoch fees_burned); the remaining 20‰ is the net burn
 * Browser verifiers earn lane "verify" credits (points) — never minted.
 */
import { getD1 } from "../lib/storage.js";
import { getEnv } from "../config/env.js";
import { normalizeAddress } from "../lib/eth.js";
import { log } from "../lib/logger.js";
import { epochRoot } from "./epoch-merkle.js";

export const LANE_A_PER_MILLE = 950;
export const TREASURY_PER_MILLE = 30;
/** reward_entries.address of treasury-lane entries; the on-chain treasury address is immutable in the contract. */
export const TREASURY_ACCOUNT = "treasury";

export type Lane = "A" | "B" | "treasury" | "verify";

export function epochOf(ms: number, epochSeconds = getEnv().EPOCH_SECONDS): number {
  return Math.floor(ms / (epochSeconds * 1000));
}

export interface LaneSplit {
  laneA: number;
  treasury: number;
  subsidy: number;
}

/** Split fee F into lanes. ρ is applied in parts-per-million so the math stays integer. */
export function splitFee(fee: number, opts: { rho: number; clusterOk: boolean; budgetRemaining: number }): LaneSplit {
  const F = BigInt(fee);
  const rhoPpm = BigInt(Math.round(opts.rho * 1_000_000));
  const treasuryB = (F * BigInt(TREASURY_PER_MILLE) + 999n) / 1000n;
  const capB = (F * BigInt(LANE_A_PER_MILLE + TREASURY_PER_MILLE)) / 1000n - treasuryB;
  const floorA = (F * BigInt(LANE_A_PER_MILLE)) / 1000n;
  const laneA = Number(floorA < capB ? floorA : capB > 0n ? capB : 0n);
  const treasury = Number(treasuryB);
  const wanted = opts.clusterOk ? Number((F * rhoPpm) / 1_000_000n) : 0;
  const subsidy = Math.max(0, Math.min(wanted, opts.budgetRemaining));
  return { laneA, treasury, subsidy };
}

/**
 * Reserve lane-B subsidy atomically: one INSERT … SELECT computes the epoch's
 * remaining budget and writes min(wanted, remaining) in the same statement, so
 * two concurrent submits can never both spend the same budget. (A read-then-insert
 * across two round trips could over-mint, and the contract would then reject the
 * whole epoch's post — freezing every provider's earnings for it.)
 * Returns the amount actually granted (0 if the budget is spent).
 */
async function reserveSubsidy(input: {
  jobId: string;
  epoch: number;
  provider: string;
  workType: string;
  wanted: number;
  budget: number;
  vestsAt: number;
  now: number;
}): Promise<number> {
  if (input.wanted <= 0) return 0;
  const id = crypto.randomUUID();
  const used =
    "COALESCE((SELECT SUM(amount_ucld) FROM reward_entries WHERE epoch = ? AND lane = 'B' AND status != 'clawed'), 0)";
  const db = getD1();
  await db
    .prepare(
      "INSERT INTO reward_entries (id, job_id, epoch, address, lane, work_type, amount_ucld, vests_at, status, created_at) " +
        `SELECT ?, ?, ?, ?, 'B', ?, MIN(?, ? - ${used}), ?, 'pending', ? ` +
        `WHERE ? - ${used} > 0`,
    )
    .bind(
      id, input.jobId, input.epoch, normalizeAddress(input.provider), input.workType,
      input.wanted, input.budget, input.epoch, input.vestsAt, input.now,
      input.budget, input.epoch,
    )
    .run();
  const row = await db.prepare("SELECT amount_ucld FROM reward_entries WHERE id = ?").bind(id).first<{ amount_ucld: number }>();
  return row?.amount_ucld ?? 0;
}

export interface JobRewards {
  laneAUcld: number;
  laneBUcld: number;
  treasuryUcld: number;
  vestsAt: number;
  epoch: number;
}

/** Write the reward entries for one verified job. Zero-amount entries are skipped. */
export async function recordJobRewards(input: {
  jobId: string;
  workType: string;
  provider: string;
  feeUcld: number;
  clusterOk: boolean;
  now?: number;
}): Promise<JobRewards> {
  const env = getEnv();
  const now = input.now ?? Date.now();
  const epoch = epochOf(now);
  // The budget cap is applied atomically in reserveSubsidy, not here.
  const split = splitFee(input.feeUcld, {
    rho: env.SUBSIDY_RHO,
    clusterOk: input.clusterOk,
    budgetRemaining: Number.MAX_SAFE_INTEGER,
  });
  const vestsAt = now + env.VEST_B_SECONDS * 1000;
  await insertLanes(input.jobId, epoch, input.workType, [
    ["A", normalizeAddress(input.provider), split.laneA],
    ["treasury", TREASURY_ACCOUNT, split.treasury],
  ], now);
  const granted = await reserveSubsidy({
    jobId: input.jobId,
    epoch,
    provider: input.provider,
    workType: input.workType,
    wanted: split.subsidy,
    budget: env.EPOCH_SUBSIDY_BUDGET_UCLD,
    vestsAt,
    now,
  });
  return { laneAUcld: split.laneA, laneBUcld: granted, treasuryUcld: split.treasury, vestsAt, epoch };
}

/** Insert the non-zero A/treasury entries of one job or bill (vests_at = now: lane A has no vest). */
async function insertLanes(jobId: string, epoch: number, workType: string, rows: [Lane, string, number][], now: number): Promise<void> {
  const db = getD1();
  const stmts = rows
    .filter(([, , amount]) => amount > 0)
    .map(([lane, address, amount]) =>
      db
        .prepare(
          "INSERT INTO reward_entries (id, job_id, epoch, address, lane, work_type, amount_ucld, vests_at, status, created_at) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)",
        )
        .bind(crypto.randomUUID(), jobId, epoch, address, lane, workType, amount, now, now),
    );
  if (stmts.length) await db.batch(stmts);
}

/**
 * Reward entries for one hosting charge (V3 §4): lane A 0.95F + treasury 0.03F, no lane B —
 * hosting is probed, not proven, so it earns no subsidy. `billId` is a deployment_bills id;
 * epoch close burns that bill's fee.
 */
export async function recordHostingRewards(input: {
  billId: string;
  workType: "hosting" | "container";
  provider: string;
  feeUcld: number;
  now?: number;
}): Promise<{ laneAUcld: number; treasuryUcld: number; epoch: number }> {
  const now = input.now ?? Date.now();
  const epoch = epochOf(now);
  const split = splitFee(input.feeUcld, { rho: 0, clusterOk: false, budgetRemaining: 0 });
  await insertLanes(input.billId, epoch, input.workType, [
    ["A", normalizeAddress(input.provider), split.laneA],
    ["treasury", TREASURY_ACCOUNT, split.treasury],
  ], now);
  return { laneAUcld: split.laneA, treasuryUcld: split.treasury, epoch };
}

/** Browser-verifier credit (points, lane "verify"). `address` may be a "session:<id>" key. */
export async function recordVerifyCredit(address: string, taskId: string, points = 1): Promise<void> {
  const now = Date.now();
  await getD1()
    .prepare(
      "INSERT INTO reward_entries (id, job_id, epoch, address, lane, work_type, amount_ucld, vests_at, status, created_at) " +
        "VALUES (?, ?, ?, ?, 'verify', 'verify', ?, ?, 'pending', ?)",
    )
    .bind(crypto.randomUUID(), taskId, epochOf(now), address.toLowerCase(), points, now, now)
    .run();
}

export async function verifyCredits(address: string): Promise<number> {
  const row = await getD1()
    .prepare("SELECT COALESCE(SUM(amount_ucld), 0) AS c FROM reward_entries WHERE address = ? AND lane = 'verify'")
    .bind(address.toLowerCase())
    .first<{ c: number }>();
  return row?.c ?? 0;
}

export interface LedgerSummary {
  pending: { A: number; B: number; treasury: number };
  vesting: { B: number };
  settled: { A: number; B: number };
  credits: number;
  entries: {
    id: string;
    jobId: string;
    epoch: number;
    lane: Lane;
    workType: string;
    amountUcld: number;
    vestsAt: number;
    status: string;
    createdAt: number;
  }[];
}

/**
 * pending = earned, not yet settled on-chain (status pending or posted), per lane.
 * vesting.B = the part of pending B whose vests_at is still in the future.
 */
export async function ledgerSummary(address: string, now = Date.now()): Promise<LedgerSummary> {
  const key = address.toLowerCase();
  const db = getD1();
  const sums = await db
    .prepare(
      "SELECT lane, status, SUM(amount_ucld) AS total, SUM(CASE WHEN vests_at > ? THEN amount_ucld ELSE 0 END) AS unvested " +
        "FROM reward_entries WHERE address = ? GROUP BY lane, status",
    )
    .bind(now, key)
    .all<{ lane: Lane; status: string; total: number; unvested: number }>();

  const out: LedgerSummary = {
    pending: { A: 0, B: 0, treasury: 0 },
    vesting: { B: 0 },
    settled: { A: 0, B: 0 },
    credits: 0,
    entries: [],
  };
  for (const r of sums.results ?? []) {
    if (r.lane === "verify") {
      out.credits += r.total;
    } else if (r.status === "pending" || r.status === "posted") {
      out.pending[r.lane] += r.total;
      if (r.lane === "B") out.vesting.B += r.unvested;
    } else if (r.status === "settled" && (r.lane === "A" || r.lane === "B")) {
      out.settled[r.lane] += r.total;
    }
  }

  const rows = await db
    .prepare("SELECT * FROM reward_entries WHERE address = ? ORDER BY created_at DESC LIMIT 50")
    .bind(key)
    .all<{
      id: string;
      job_id: string;
      epoch: number;
      lane: Lane;
      work_type: string;
      amount_ucld: number;
      vests_at: number;
      status: string;
      created_at: number;
    }>();
  out.entries = (rows.results ?? []).map((r) => ({
    id: r.id,
    jobId: r.job_id,
    epoch: r.epoch,
    lane: r.lane,
    workType: r.work_type,
    amountUcld: r.amount_ucld,
    vestsAt: r.vests_at,
    status: r.status,
    createdAt: r.created_at,
  }));
  return out;
}

// ─── Epoch settlement ─────────────────────────────────────────────────────────

export interface EpochLeaf {
  account: string;
  laneAUcld: number;
  laneBUcld: number;
}

/** What the keeper posts (docs/IMPL_SPEC_2026-10.md "Admin epochs API"). Amounts µCLD; the keeper converts ×1e12. */
export interface EpochPayload {
  epoch: number;
  root: string;
  feesBurnedUcld: number;
  totalLaneAUcld: number;
  totalLaneBUcld: number;
  treasuryUcld: number;
  leaves: EpochLeaf[];
  status: string;
}

interface EpochRow {
  id: number;
  fees_burned_ucld: number | null;
  mint_a_ucld: number | null;
  mint_b_ucld: number | null;
  treasury_ucld: number | null;
  leaves_json: string | null;
  root: string | null;
  status: string;
}

function toPayload(r: EpochRow): EpochPayload {
  // Rows closed before settlement v2 stored { address, amountUcld } leaves (all lanes summed).
  const raw = JSON.parse(r.leaves_json ?? "[]") as (EpochLeaf | { address: string; amountUcld: number })[];
  const leaves = raw.map((l) => ("account" in l ? l : { account: l.address, laneAUcld: l.amountUcld, laneBUcld: 0 }));
  return {
    epoch: r.id,
    root: r.root ?? epochRoot(r.id, leaves),
    feesBurnedUcld: r.fees_burned_ucld ?? 0,
    totalLaneAUcld: r.mint_a_ucld ?? 0,
    totalLaneBUcld: r.mint_b_ucld ?? 0,
    treasuryUcld: r.treasury_ucld ?? 0,
    leaves,
    status: r.status,
  };
}

/**
 * Close every ended epoch that has pending A/B/treasury entries — as soon as it has ended; lane B
 * vests on-chain, so nothing waits for vests_at. Leaves are { account, laneA, laneB } per address,
 * the treasury lane is an epoch amount, and the root is computed here (the keeper re-verifies it).
 * The entries move to "posted". A vetoed epoch (markEpochVetoed) is closed again under the same id
 * from its remaining pending entries, so the keeper can re-post it; any other closed epoch is skipped.
 */
export async function closeEpochs(now = Date.now()): Promise<EpochPayload[]> {
  const db = getD1();
  const current = epochOf(now);
  const candidates = await db
    .prepare(
      "SELECT DISTINCT epoch FROM reward_entries WHERE status = 'pending' AND lane IN ('A','B','treasury') AND epoch < ? ORDER BY epoch",
    )
    .bind(current)
    .all<{ epoch: number }>();

  const closed: EpochPayload[] = [];
  for (const { epoch } of candidates.results ?? []) {
    const exists = await db.prepare("SELECT status FROM epochs WHERE id = ?").bind(epoch).first<{ status: string }>();
    if (exists && exists.status !== "vetoed") {
      // An epoch is posted once, unless vetoed. Entries that committed after it closed (boundary
      // race) move to the open epoch instead of staying pending forever.
      await db
        .prepare("UPDATE reward_entries SET epoch = ? WHERE epoch = ? AND status = 'pending' AND lane IN ('A','B','treasury')")
        .bind(current, epoch)
        .run();
      continue;
    }

    const pending = "epoch = ?1 AND status = 'pending'";
    const leafRows = await db
      .prepare(
        "SELECT address, SUM(CASE WHEN lane = 'A' THEN amount_ucld ELSE 0 END) AS a, SUM(CASE WHEN lane = 'B' THEN amount_ucld ELSE 0 END) AS b " +
          `FROM reward_entries WHERE ${pending} AND lane IN ('A','B') GROUP BY address ORDER BY address`,
      )
      .bind(epoch)
      .all<{ address: string; a: number; b: number }>();
    // Fees burned = verified jobs' prices + hosting charges (deployment_bills) in this epoch.
    const inEpoch = `(SELECT DISTINCT job_id FROM reward_entries WHERE ${pending} AND lane IN ('A','B','treasury'))`;
    const totals = await db
      .prepare(
        `SELECT COALESCE((SELECT SUM(price_ucld) FROM work_jobs WHERE id IN ${inEpoch}), 0) + ` +
          `COALESCE((SELECT SUM(fee_ucld) FROM deployment_bills WHERE id IN ${inEpoch}), 0) AS fees, ` +
          `COALESCE((SELECT SUM(amount_ucld) FROM reward_entries WHERE ${pending} AND lane = 'treasury'), 0) AS treasury`,
      )
      .bind(epoch)
      .first<{ fees: number; treasury: number }>();

    const leaves: EpochLeaf[] = (leafRows.results ?? []).map((r) => ({ account: r.address, laneAUcld: r.a, laneBUcld: r.b }));
    const out: EpochPayload = {
      epoch,
      root: epochRoot(epoch, leaves),
      feesBurnedUcld: totals?.fees ?? 0,
      totalLaneAUcld: leaves.reduce((s, l) => s + l.laneAUcld, 0),
      totalLaneBUcld: leaves.reduce((s, l) => s + l.laneBUcld, 0),
      treasuryUcld: totals?.treasury ?? 0,
      leaves,
      status: "closed",
    };
    const cols = [now, out.feesBurnedUcld, out.totalLaneAUcld, out.totalLaneBUcld, out.treasuryUcld, JSON.stringify(leaves), out.root];
    await db.batch([
      exists
        ? db
            .prepare(
              "UPDATE epochs SET closed_at = ?, fees_burned_ucld = ?, mint_a_ucld = ?, mint_b_ucld = ?, treasury_ucld = ?, leaves_json = ?, " +
                "root = ?, tx_hash = NULL, status = 'closed' WHERE id = ? AND status = 'vetoed'",
            )
            .bind(...cols, epoch)
        : db
            .prepare(
              "INSERT INTO epochs (closed_at, fees_burned_ucld, mint_a_ucld, mint_b_ucld, treasury_ucld, leaves_json, root, id, status) " +
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'closed')",
            )
            .bind(...cols, epoch),
      db
        .prepare("UPDATE reward_entries SET status = 'posted' WHERE epoch = ? AND status = 'pending' AND lane IN ('A','B','treasury')")
        .bind(epoch),
    ]);
    closed.push(out);
  }
  return closed;
}

/** Epochs by status, oldest first — lets a stateless keeper re-read what it has to post or finalize. */
export async function listEpochs(status: "closed" | "posted" | "settled" | "vetoed"): Promise<EpochPayload[]> {
  const rows = await getD1().prepare("SELECT * FROM epochs WHERE status = ? ORDER BY id").bind(status).all<EpochRow>();
  return (rows.results ?? []).map(toPayload);
}

/** When the most recent epoch was finalized on-chain (ms), or null. */
export async function lastSettledEpochAt(): Promise<number | null> {
  const row = await getD1().prepare("SELECT MAX(settled_at) AS at FROM epochs WHERE status = 'settled'").first<{ at: number | null }>();
  return row?.at ?? null;
}

export type EpochUpdate = { ok: true } | { ok: false; code: "not_found" | "conflict"; message: string };

/** The keeper posted `root` on-chain; it must be the root this API computed at close. */
export async function markEpochPosted(id: number, root: string, txHash: string): Promise<EpochUpdate> {
  const db = getD1();
  const row = await db.prepare("SELECT status, root FROM epochs WHERE id = ?").bind(id).first<{ status: string; root: string | null }>();
  if (!row) return { ok: false, code: "not_found", message: `epoch ${id} is not closed` };
  if (row.status !== "closed") return { ok: false, code: "conflict", message: `epoch ${id} is already ${row.status}` };
  if (row.root && row.root.toLowerCase() !== root.toLowerCase()) {
    return { ok: false, code: "conflict", message: `root ${root} differs from the root computed at close (${row.root})` };
  }
  await db.prepare("UPDATE epochs SET root = ?, tx_hash = ?, status = 'posted' WHERE id = ?").bind(root, txHash, id).run();
  return { ok: true };
}

export async function markEpochSettled(id: number, txHash: string, now = Date.now()): Promise<EpochUpdate> {
  const db = getD1();
  const row = await db.prepare("SELECT status FROM epochs WHERE id = ?").bind(id).first<{ status: string }>();
  if (!row) return { ok: false, code: "not_found", message: `epoch ${id} is not closed` };
  if (row.status === "settled") return { ok: true };
  if (row.status !== "posted") return { ok: false, code: "conflict", message: `epoch ${id} must be posted first` };
  await db.batch([
    db.prepare("UPDATE epochs SET tx_hash = ?, settled_at = ?, status = 'settled' WHERE id = ?").bind(txHash, now, id),
    db
      .prepare("UPDATE reward_entries SET status = 'settled' WHERE epoch = ? AND status = 'posted' AND lane IN ('A','B','treasury')")
      .bind(id),
  ]);
  return { ok: true };
}

/**
 * The epoch's root was vetoed on-chain: reopen it. Its posted A/B/treasury entries go back to
 * pending and its fees_burned/root are cleared; the next closeEpochs closes it again under the
 * same id (after an operator claws whatever caused the veto). A settled epoch cannot be vetoed.
 */
export async function markEpochVetoed(
  id: number,
  opts: { txHash?: string; reason?: string } = {},
): Promise<{ ok: true; entriesReopened: number } | { ok: false; code: "not_found" | "conflict"; message: string }> {
  const db = getD1();
  const row = await db.prepare("SELECT status FROM epochs WHERE id = ?").bind(id).first<{ status: string }>();
  if (!row) return { ok: false, code: "not_found", message: `epoch ${id} is not closed` };
  if (row.status === "vetoed") return { ok: true, entriesReopened: 0 };
  if (row.status === "settled") return { ok: false, code: "conflict", message: `epoch ${id} is already settled` };
  const [, reopened] = await db.batch([
    db
      .prepare("UPDATE epochs SET status = 'vetoed', root = NULL, fees_burned_ucld = NULL, tx_hash = COALESCE(?, tx_hash) WHERE id = ? AND status IN ('closed','posted')")
      .bind(opts.txHash ?? null, id),
    db
      .prepare("UPDATE reward_entries SET status = 'pending' WHERE epoch = ? AND status = 'posted' AND lane IN ('A','B','treasury')")
      .bind(id),
  ]);
  const entriesReopened = reopened?.meta?.changes ?? 0;
  log.api.warn(
    `[ledger] epoch ${id} vetoed${opts.txHash ? ` (tx ${opts.txHash})` : ""}${opts.reason ? `: ${opts.reason}` : ""} — ` +
      `${entriesReopened} entries back to pending`,
  );
  return { ok: true, entriesReopened };
}

/**
 * Claw one reward entry of an epoch (status 'clawed'): it is left out of the epoch's next close,
 * of /network mintedUcld and of /nodes/mine earnedUcld. Only a pending entry can be clawed — a
 * posted or settled one is already on-chain (veto its epoch first).
 */
export async function clawEntry(epoch: number, entryId: string): Promise<EpochUpdate> {
  const db = getD1();
  const row = await db
    .prepare("SELECT status, lane, address, amount_ucld FROM reward_entries WHERE id = ? AND epoch = ?")
    .bind(entryId, epoch)
    .first<{ status: string; lane: Lane; address: string; amount_ucld: number }>();
  if (!row) return { ok: false, code: "not_found", message: `entry ${entryId} not found in epoch ${epoch}` };
  if (row.status === "clawed") return { ok: true };
  if (row.lane === "treasury") {
    // The fee stays burned, so clawing the treasury share would break the contract's treasury ≥ 3% bound.
    return { ok: false, code: "conflict", message: "treasury entries cannot be clawed; claw the provider's entries instead" };
  }
  if (row.status !== "pending") {
    return { ok: false, code: "conflict", message: `entry is ${row.status}; only pending entries can be clawed (veto the epoch first)` };
  }
  const r = await db.prepare("UPDATE reward_entries SET status = 'clawed' WHERE id = ? AND status = 'pending'").bind(entryId).run();
  if ((r.meta?.changes ?? 0) === 0) return { ok: false, code: "conflict", message: "entry changed — retry" };
  log.api.warn(`[ledger] epoch ${epoch}: clawed entry ${entryId} (lane ${row.lane}, ${row.amount_ucld} µCLD to ${row.address})`);
  return { ok: true };
}
