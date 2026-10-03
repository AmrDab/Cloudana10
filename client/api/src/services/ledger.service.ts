/**
 * Reward ledger (docs/BUILD_SPEC_V1.md §2–§3, CLD_ISSUANCE_DESIGN §5–§6).
 * All amounts are integer µCLD; every split rounds down.
 *
 * Per completed job with fee F:
 *   lane A    provider payout +floor(0.975F)       claimable at epoch settlement
 *   treasury  +floor(0.005F)
 *   lane B    floor(ρF) if the cluster test passed, capped by the epoch budget; vests VEST_B_SECONDS later
 *   the user's F is burned (epoch fees_burned)
 * Browser verifiers earn lane "verify" credits (points) — never minted.
 */
import { getD1 } from "../lib/storage.js";
import { getEnv } from "../config/env.js";
import { normalizeAddress } from "../lib/eth.js";
import { log } from "../lib/logger.js";

export const LANE_A_PER_MILLE = 975;
export const TREASURY_PER_MILLE = 5;

export type Lane = "A" | "B" | "treasury" | "verify";

export function epochOf(ms: number, epochSeconds = getEnv().EPOCH_SECONDS): number {
  return Math.floor(ms / (epochSeconds * 1000));
}

/** price_ucld = max(1, ceil(units × PRICE_UCLD_PER_MMAC / 1e6)). */
export function priceUcld(units: number, pricePerMmac = getEnv().PRICE_UCLD_PER_MMAC): number {
  const numerator = BigInt(units) * BigInt(pricePerMmac);
  const price = (numerator + 999_999n) / 1_000_000n;
  return Math.max(1, Number(price));
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
  const laneA = Number((F * BigInt(LANE_A_PER_MILLE)) / 1000n);
  const treasury = Number((F * BigInt(TREASURY_PER_MILLE)) / 1000n);
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
  const treasury = env.TREASURY_ADDRESS ?? env.CLD_TREASURY_ADDRESS;

  const rows: [Lane, string, number, number][] = [["A", input.provider, split.laneA, now]];
  if (treasury) rows.push(["treasury", treasury, split.treasury, now]);

  const db = getD1();
  const stmts = rows
    .filter(([, , amount]) => amount > 0)
    .map(([lane, address, amount, vests]) =>
      db
        .prepare(
          "INSERT INTO reward_entries (id, job_id, epoch, address, lane, work_type, amount_ucld, vests_at, status, created_at) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)",
        )
        .bind(crypto.randomUUID(), input.jobId, epoch, normalizeAddress(address), lane, input.workType, amount, vests, now),
    );
  if (stmts.length) await db.batch(stmts);
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
  return {
    laneAUcld: split.laneA,
    laneBUcld: granted,
    treasuryUcld: treasury ? split.treasury : 0,
    vestsAt,
    epoch,
  };
}

/**
 * Reward entries for one hosting charge (V3 §4): lane A 0.975F + treasury 0.005F, no lane B —
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
  const env = getEnv();
  const now = input.now ?? Date.now();
  const epoch = epochOf(now);
  const split = splitFee(input.feeUcld, { rho: 0, clusterOk: false, budgetRemaining: 0 });
  const treasury = env.TREASURY_ADDRESS ?? env.CLD_TREASURY_ADDRESS;
  const rows: [Lane, string, number][] = [["A", input.provider, split.laneA]];
  if (treasury) rows.push(["treasury", treasury, split.treasury]);
  const db = getD1();
  const stmts = rows
    .filter(([, , amount]) => amount > 0)
    .map(([lane, address, amount]) =>
      db
        .prepare(
          "INSERT INTO reward_entries (id, job_id, epoch, address, lane, work_type, amount_ucld, vests_at, status, created_at) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)",
        )
        .bind(crypto.randomUUID(), input.billId, epoch, normalizeAddress(address), lane, input.workType, amount, now, now),
    );
  if (stmts.length) await db.batch(stmts);
  return { laneAUcld: split.laneA, treasuryUcld: treasury ? split.treasury : 0, epoch };
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

export interface ClosedEpoch {
  id: number;
  feesBurnedUcld: number;
  mintAUcld: number;
  mintBUcld: number;
  leaves: { address: string; amountUcld: number }[];
}

/**
 * Close every past epoch that has pending A/B/treasury entries, once all of them
 * have vested (an epoch waits for its lane-B vesting so it is posted exactly once).
 * Leaves are aggregated per address; the entries move to "posted".
 * A vetoed epoch (markEpochVetoed) is closed again under the same id from its remaining
 * pending entries, so the keeper can re-post it; any other already-closed epoch is skipped.
 */
export async function closeEpochs(now = Date.now()): Promise<ClosedEpoch[]> {
  const db = getD1();
  const current = epochOf(now);
  const candidates = await db
    .prepare(
      "SELECT epoch, MAX(vests_at) AS last_vest FROM reward_entries " +
        "WHERE status = 'pending' AND lane IN ('A','B','treasury') AND epoch < ? GROUP BY epoch ORDER BY epoch",
    )
    .bind(current)
    .all<{ epoch: number; last_vest: number }>();

  const closed: ClosedEpoch[] = [];
  for (const { epoch, last_vest } of candidates.results ?? []) {
    if (last_vest > now) continue;
    const exists = await db.prepare("SELECT status FROM epochs WHERE id = ?").bind(epoch).first<{ status: string }>();
    if (exists && exists.status !== "vetoed") continue; // an epoch is posted once, unless vetoed

    const leafRows = await db
      .prepare(
        "SELECT address, SUM(amount_ucld) AS amount FROM reward_entries " +
          "WHERE epoch = ? AND status = 'pending' AND lane IN ('A','B','treasury') GROUP BY address ORDER BY address",
      )
      .bind(epoch)
      .all<{ address: string; amount: number }>();
    const laneRows = await db
      .prepare(
        "SELECT lane, SUM(amount_ucld) AS amount FROM reward_entries " +
          "WHERE epoch = ? AND status = 'pending' AND lane IN ('A','B','treasury') GROUP BY lane",
      )
      .bind(epoch)
      .all<{ lane: Lane; amount: number }>();
    // Fees burned = verified jobs' prices + hosting charges (deployment_bills) in this epoch.
    const inEpoch = "(SELECT DISTINCT job_id FROM reward_entries WHERE epoch = ?1 AND status = 'pending' AND lane IN ('A','B','treasury'))";
    const fees = await db
      .prepare(
        `SELECT COALESCE((SELECT SUM(price_ucld) FROM work_jobs WHERE id IN ${inEpoch}), 0) + ` +
          `COALESCE((SELECT SUM(fee_ucld) FROM deployment_bills WHERE id IN ${inEpoch}), 0) AS fees`,
      )
      .bind(epoch)
      .first<{ fees: number }>();

    const byLane = Object.fromEntries((laneRows.results ?? []).map((r) => [r.lane, r.amount]));
    const leaves = (leafRows.results ?? []).map((r) => ({ address: r.address, amountUcld: r.amount }));
    const out: ClosedEpoch = {
      id: epoch,
      feesBurnedUcld: fees?.fees ?? 0,
      // The on-chain invariant bounds lane-A-style minting by fees, so treasury counts with A.
      mintAUcld: (byLane.A ?? 0) + (byLane.treasury ?? 0),
      mintBUcld: byLane.B ?? 0,
      leaves,
    };
    await db.batch([
      exists
        ? db
            .prepare(
              "UPDATE epochs SET closed_at = ?, fees_burned_ucld = ?, mint_a_ucld = ?, mint_b_ucld = ?, leaves_json = ?, " +
                "root = NULL, tx_hash = NULL, status = 'closed' WHERE id = ? AND status = 'vetoed'",
            )
            .bind(now, out.feesBurnedUcld, out.mintAUcld, out.mintBUcld, JSON.stringify(leaves), epoch)
        : db
            .prepare(
              "INSERT INTO epochs (id, closed_at, fees_burned_ucld, mint_a_ucld, mint_b_ucld, leaves_json, status) VALUES (?, ?, ?, ?, ?, ?, 'closed')",
            )
            .bind(epoch, now, out.feesBurnedUcld, out.mintAUcld, out.mintBUcld, JSON.stringify(leaves)),
      db
        .prepare("UPDATE reward_entries SET status = 'posted' WHERE epoch = ? AND status = 'pending' AND lane IN ('A','B','treasury')")
        .bind(epoch),
    ]);
    closed.push(out);
  }
  return closed;
}

export type EpochUpdate = { ok: true } | { ok: false; code: "not_found" | "conflict"; message: string };

export async function markEpochPosted(id: number, root: string, txHash: string): Promise<EpochUpdate> {
  const db = getD1();
  const row = await db.prepare("SELECT status FROM epochs WHERE id = ?").bind(id).first<{ status: string }>();
  if (!row) return { ok: false, code: "not_found", message: `epoch ${id} is not closed` };
  if (row.status !== "closed") return { ok: false, code: "conflict", message: `epoch ${id} is already ${row.status}` };
  await db.prepare("UPDATE epochs SET root = ?, tx_hash = ?, status = 'posted' WHERE id = ?").bind(root, txHash, id).run();
  return { ok: true };
}

export async function markEpochSettled(id: number, txHash: string): Promise<EpochUpdate> {
  const db = getD1();
  const row = await db.prepare("SELECT status FROM epochs WHERE id = ?").bind(id).first<{ status: string }>();
  if (!row) return { ok: false, code: "not_found", message: `epoch ${id} is not closed` };
  if (row.status === "settled") return { ok: true };
  if (row.status !== "posted") return { ok: false, code: "conflict", message: `epoch ${id} must be posted first` };
  await db.batch([
    db.prepare("UPDATE epochs SET tx_hash = ?, status = 'settled' WHERE id = ?").bind(txHash, id),
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
  if (row.status !== "pending") {
    return { ok: false, code: "conflict", message: `entry is ${row.status}; only pending entries can be clawed (veto the epoch first)` };
  }
  const r = await db.prepare("UPDATE reward_entries SET status = 'clawed' WHERE id = ? AND status = 'pending'").bind(entryId).run();
  if ((r.meta?.changes ?? 0) === 0) return { ok: false, code: "conflict", message: "entry changed — retry" };
  log.api.warn(`[ledger] epoch ${epoch}: clawed entry ${entryId} (lane ${row.lane}, ${row.amount_ucld} µCLD to ${row.address})`);
  return { ok: true };
}
