/**
 * Certificate Store — in-memory registry of verified POUW certificates.
 *
 * Tracks:
 *   - All verified certificates (recent window)
 *   - Per-provider stats (hash rate, difficulty, count)
 *   - Replay protection (seen z hashes)
 *
 * For testnet: in-memory only. For mainnet: persist to DB + emit on-chain.
 */

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
  recentHashRate: number; // certs per minute (last 5 min)
}

// ─── State ───────────────────────────────────────────────────────────────────

const MAX_STORED = 10_000;
const REPLAY_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

const certificates: StoredCertificate[] = [];
const seenZ = new Map<string, number>(); // z → timestamp
const providerStats = new Map<string, ProviderMiningStats>();
let nextId = 1;

// ─── Public API ──────────────────────────────────────────────────────────────

/** Returns true if this z hash has already been accepted (replay protection). */
export function isCertificateReplayed(z: string): boolean {
  const seen = seenZ.get(z);
  if (!seen) return false;
  // Expire old entries
  if (Date.now() - seen > REPLAY_WINDOW_MS) {
    seenZ.delete(z);
    return false;
  }
  return true;
}

/** Store a verified certificate and update provider stats. Returns certificate ID. */
export function storeCertificate(cert: POUWCertificate): string {
  const id = `cert-${nextId++}`;
  const now = Date.now();

  // Mark z as seen
  seenZ.set(cert.z, now);

  // Store certificate (rolling window)
  certificates.push({ id, cert, verifiedAt: now });
  if (certificates.length > MAX_STORED) certificates.shift();

  // Update provider stats
  const key = cert.providerAddress.toLowerCase();
  const existing = providerStats.get(key);
  if (existing) {
    existing.totalCertificates++;
    existing.totalDifficulty += cert.difficulty;
    existing.lastSeen = now;
  } else {
    providerStats.set(key, {
      providerAddress: cert.providerAddress,
      deviceId: cert.deviceId,
      totalCertificates: 1,
      totalDifficulty: cert.difficulty,
      lastSeen: now,
      firstSeen: now,
      recentHashRate: 0,
    });
  }

  return id;
}

/** Get all stored certificates (most recent first), optionally filtered by provider. */
export function getCertificates(opts?: {
  providerAddress?: string;
  limit?: number;
}): StoredCertificate[] {
  let result = certificates.slice().reverse();
  if (opts?.providerAddress) {
    const addr = opts.providerAddress.toLowerCase();
    result = result.filter((c) => c.cert.providerAddress.toLowerCase() === addr);
  }
  return result.slice(0, opts?.limit ?? 100);
}

/** Get mining leaderboard — providers sorted by total difficulty. */
export function getMiningLeaderboard(): ProviderMiningStats[] {
  const now = Date.now();
  const fiveMinAgo = now - 5 * 60 * 1000;

  // Calculate recent hash rate for each provider
  for (const [key, stats] of providerStats) {
    const recentCerts = certificates.filter(
      (c) => c.cert.providerAddress.toLowerCase() === key && c.verifiedAt > fiveMinAgo,
    );
    stats.recentHashRate = recentCerts.length; // certs in last 5 min
  }

  return Array.from(providerStats.values()).sort(
    (a, b) => b.totalDifficulty - a.totalDifficulty,
  );
}

/** Get aggregate network mining stats. */
export function getNetworkStats() {
  const now = Date.now();
  const oneMinAgo = now - 60 * 1000;
  const fiveMinAgo = now - 5 * 60 * 1000;

  const recentCerts1m = certificates.filter((c) => c.verifiedAt > oneMinAgo);
  const recentCerts5m = certificates.filter((c) => c.verifiedAt > fiveMinAgo);

  return {
    totalCertificates: certificates.length,
    activeProviders: providerStats.size,
    certsLast1Min: recentCerts1m.length,
    certsLast5Min: recentCerts5m.length,
    networkHashRate: recentCerts5m.length / 5, // certs per minute
    totalDifficultyMined: Array.from(providerStats.values()).reduce(
      (s, p) => s + p.totalDifficulty,
      0,
    ),
  };
}
