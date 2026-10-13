/**
 * Certificate Store — read-only views over the D1 registry of legacy POUW certificates
 * (`pouw_certificates`): recent certificates, per-provider stats, network totals.
 * Nothing writes to it since the legacy /pouw/submit path was removed (docs/POUW_REVIEW.md §7).
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

// ─── Public API ──────────────────────────────────────────────────────────────

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
