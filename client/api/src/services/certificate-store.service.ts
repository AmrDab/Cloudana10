/**
 * Certificate Store — D1-backed registry of verified POUW certificates.
 *
 * Tracks:
 *   - All verified certificates (persisted in D1)
 *   - Per-provider stats (aggregated from D1)
 *   - Replay protection (z uniqueness enforced by DB constraint)
 */

import { getD1 } from "../lib/storage.js";
import type { POUWCertificate } from "../../../../pouw/src/types.js";

export interface StoredCertificate {
  id: string;
  cert: POUWCertificate;
  verifiedAt: number;
}

export interface ProviderMiningStats {
  providerAddress: string;
  deviceId: string;
  totalCertificates: number;
  totalDifficulty: number;
  lastSeen: number;
  firstSeen: number;
  recentHashRate: number;
}

export type RewardStatus = "paid" | "skipped" | "failed" | "disabled" | "not_configured";
export type ChainStatus = "recorded" | "pending" | "failed" | "not_configured";

export interface CertificateSettlement {
  backedByWorkload: boolean;
  workloadId: string | null;
  reward: { status: RewardStatus; wei: string | null; tx: string | null; reason: string | null };
  chain: { status: ChainStatus; tx: string | null; attempts: number; reason: string | null };
}

// ─── Runtime migration ──────────────────────────────────────────────────────
// Databases created before settlement tracking existed lack these columns.
// ALTER TABLE ADD COLUMN is idempotent here: a "duplicate column" error is the
// success case on the second run.

const SETTLEMENT_COLUMNS: Array<[string, string]> = [
  ["backed_by_workload", "INTEGER"],
  ["workload_id", "TEXT"],
  ["reward_status", "TEXT"],
  ["reward_wei", "TEXT"],
  ["reward_tx", "TEXT"],
  ["reward_reason", "TEXT"],
  ["chain_status", "TEXT"],
  ["chain_tx", "TEXT"],
  ["chain_attempts", "INTEGER NOT NULL DEFAULT 0"],
  ["chain_reason", "TEXT"],
];
let settlementColumnsReady = false;

async function ensureSettlementColumns(): Promise<void> {
  if (settlementColumnsReady) return;
  const db = getD1();
  for (const [name, type] of SETTLEMENT_COLUMNS) {
    try {
      await db.prepare(`ALTER TABLE pouw_certificates ADD COLUMN ${name} ${type}`).run();
    } catch (err: any) {
      if (!/duplicate column/i.test(String(err?.message ?? err))) throw err;
    }
  }
  settlementColumnsReady = true;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Record how a verified certificate was settled (reward + on-chain record). */
export async function recordSettlement(id: string, s: CertificateSettlement): Promise<void> {
  await ensureSettlementColumns();
  await getD1()
    .prepare(
      `UPDATE pouw_certificates SET
         backed_by_workload = ?, workload_id = ?,
         reward_status = ?, reward_wei = ?, reward_tx = ?, reward_reason = ?,
         chain_status = ?, chain_tx = ?, chain_attempts = ?, chain_reason = ?
       WHERE id = ?`,
    )
    .bind(
      s.backedByWorkload ? 1 : 0,
      s.workloadId,
      s.reward.status,
      s.reward.wei,
      s.reward.tx,
      s.reward.reason,
      s.chain.status,
      s.chain.tx,
      s.chain.attempts,
      s.chain.reason,
      id,
    )
    .run();
}

/** Update only the on-chain recording outcome (used by retries). */
export async function recordChainOutcome(
  id: string,
  outcome: { status: ChainStatus; tx: string | null; reason: string | null },
): Promise<void> {
  await ensureSettlementColumns();
  await getD1()
    .prepare(
      `UPDATE pouw_certificates
       SET chain_status = ?, chain_tx = ?, chain_reason = ?, chain_attempts = chain_attempts + 1
       WHERE id = ?`,
    )
    .bind(outcome.status, outcome.tx, outcome.reason, id)
    .run();
}

export interface UnrecordedCertificate {
  id: string;
  providerAddress: string;
  deviceId: string;
  n: number;
  difficulty: number;
  transcriptHash: string;
  z: string;
  timestamp: number;
  chainAttempts: number;
}

/** Certificates whose on-chain record is still pending or failed, oldest first. */
export async function listUnrecordedCertificates(limit: number, maxAttempts: number): Promise<UnrecordedCertificate[]> {
  await ensureSettlementColumns();
  const { results } = await getD1()
    .prepare(
      `SELECT id, provider_address, device_id, matrix_size, difficulty, transcript_hash, z, timestamp, chain_attempts
       FROM pouw_certificates
       WHERE chain_status IN ('pending', 'failed') AND chain_attempts < ?
       ORDER BY verified_at ASC LIMIT ?`,
    )
    .bind(maxAttempts, limit)
    .all();
  return (results ?? []).map((row: any) => ({
    id: row.id,
    providerAddress: row.provider_address,
    deviceId: row.device_id,
    n: row.matrix_size,
    difficulty: row.difficulty,
    transcriptHash: row.transcript_hash,
    z: row.z,
    timestamp: row.timestamp,
    chainAttempts: row.chain_attempts ?? 0,
  }));
}

/** Returns true if this z hash has already been accepted (replay protection). */
export async function isCertificateReplayedAsync(z: string): Promise<boolean> {
  try {
    const db = getD1();
    const row = await db.prepare("SELECT 1 FROM pouw_certificates WHERE z = ?").bind(z).first();
    return !!row;
  } catch {
    return false;
  }
}

/** Store a verified certificate. Returns certificate ID, or null if duplicate. */
export async function storeCertificate(cert: POUWCertificate): Promise<string | null> {
  const id = `cert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();

  try {
    const db = getD1();
    await db
      .prepare(
        `INSERT INTO pouw_certificates (id, provider_address, device_id, matrix_size, difficulty, transcript_hash, z, timestamp, verified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        cert.providerAddress.toLowerCase(),
        cert.deviceId,
        cert.n,
        cert.difficulty,
        cert.transcriptHash,
        cert.z,
        cert.timestamp,
        now,
      )
      .run();

    return id;
  } catch (err: any) {
    // UNIQUE constraint violation = replay
    if (err?.message?.includes("UNIQUE")) return null;
    throw err;
  }
}

/** Count a provider's certificates verified since `sinceMs` (reward-cap enforcement). */
export async function countRecentCertificates(providerAddress: string, sinceMs: number): Promise<number> {
  try {
    const db = getD1();
    const row = await db
      .prepare(`SELECT COUNT(*) as c FROM pouw_certificates WHERE provider_address = ? AND verified_at > ?`)
      .bind(providerAddress.toLowerCase(), sinceMs)
      .first();
    return Number((row as any)?.c ?? 0);
  } catch {
    // Fail CLOSED for caps: if we can't count, report a huge number so the
    // capped (filler) path pays nothing rather than paying unbounded.
    return Number.MAX_SAFE_INTEGER;
  }
}

/** Get certificates (most recent first), optionally filtered by provider. */
export async function getCertificates(opts?: {
  providerAddress?: string;
  limit?: number;
}): Promise<StoredCertificate[]> {
  const db = getD1();
  const limit = opts?.limit ?? 100;

  let query: string;
  let params: unknown[];

  if (opts?.providerAddress) {
    query = `SELECT * FROM pouw_certificates WHERE provider_address = ? ORDER BY verified_at DESC LIMIT ?`;
    params = [opts.providerAddress.toLowerCase(), limit];
  } else {
    query = `SELECT * FROM pouw_certificates ORDER BY verified_at DESC LIMIT ?`;
    params = [limit];
  }

  const { results } = await db.prepare(query).bind(...params).all();

  return (results ?? []).map((row: any) => ({
    id: row.id,
    cert: {
      sigma: "",
      n: row.matrix_size,
      r: 0,
      matrixAHash: "",
      matrixBHash: "",
      transcriptHash: row.transcript_hash,
      z: row.z,
      difficulty: row.difficulty,
      timestamp: row.timestamp,
      providerAddress: row.provider_address,
      deviceId: row.device_id,
      matrixA: [],
      matrixB: [],
    },
    verifiedAt: row.verified_at,
  }));
}

/** Get mining leaderboard — providers sorted by total difficulty. */
export async function getMiningLeaderboard(): Promise<ProviderMiningStats[]> {
  const db = getD1();
  const fiveMinAgo = Date.now() - 5 * 60 * 1000;

  const { results } = await db
    .prepare(
      `SELECT
        provider_address,
        device_id,
        COUNT(*) as total_certificates,
        SUM(difficulty) as total_difficulty,
        MAX(verified_at) as last_seen,
        MIN(verified_at) as first_seen
       FROM pouw_certificates
       GROUP BY provider_address
       ORDER BY total_difficulty DESC
       LIMIT 100`,
    )
    .all();

  // Get recent counts for hash rate
  const { results: recentResults } = await db
    .prepare(
      `SELECT provider_address, COUNT(*) as recent_count
       FROM pouw_certificates
       WHERE verified_at > ?
       GROUP BY provider_address`,
    )
    .bind(fiveMinAgo)
    .all();

  const recentMap = new Map<string, number>();
  for (const r of recentResults ?? []) {
    recentMap.set((r as any).provider_address, (r as any).recent_count);
  }

  return (results ?? []).map((row: any) => ({
    providerAddress: row.provider_address,
    deviceId: row.device_id,
    totalCertificates: row.total_certificates,
    totalDifficulty: row.total_difficulty,
    lastSeen: row.last_seen,
    firstSeen: row.first_seen,
    recentHashRate: recentMap.get(row.provider_address) ?? 0,
  }));
}

/** Get aggregate network mining stats. */
export async function getNetworkStats() {
  const db = getD1();
  const now = Date.now();
  const oneMinAgo = now - 60 * 1000;
  const fiveMinAgo = now - 5 * 60 * 1000;

  const [total, providers, certs1m, certs5m] = await Promise.all([
    db.prepare("SELECT COUNT(*) as c, COALESCE(SUM(difficulty),0) as d FROM pouw_certificates").first() as Promise<any>,
    db.prepare("SELECT COUNT(DISTINCT provider_address) as c FROM pouw_certificates").first() as Promise<any>,
    db.prepare("SELECT COUNT(*) as c FROM pouw_certificates WHERE verified_at > ?").bind(oneMinAgo).first() as Promise<any>,
    db.prepare("SELECT COUNT(*) as c FROM pouw_certificates WHERE verified_at > ?").bind(fiveMinAgo).first() as Promise<any>,
  ]);

  return {
    totalCertificates: total?.c ?? 0,
    activeProviders: providers?.c ?? 0,
    certsLast1Min: certs1m?.c ?? 0,
    certsLast5Min: certs5m?.c ?? 0,
    networkHashRate: (certs5m?.c ?? 0) / 5,
    totalDifficultyMined: total?.d ?? 0,
  };
}
