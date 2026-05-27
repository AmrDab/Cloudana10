/**
 * POUW Verifier Service — runs in the orchestrator.
 *
 * Verifies incoming POUW certificates submitted by provider nodes.
 * For testnet: re-runs the full computation (orchestrator is trusted verifier).
 * For mainnet: replace with zkSNARK proof check (O(1) verification).
 *
 * Verification steps:
 *   1. Check matrix hashes match submitted A, B data.
 *   2. Re-derive noise E, F from sigma.
 *   3. Re-run block MatMul_r(A+E, B+F) and check transcript hash.
 *   4. Recompute z and check difficulty.
 *   5. Check sigma freshness (not expired / not replayed).
 */

import type { POUWCertificate } from "../../../../pouw/src/types.js";
import { verify as cupowVerify } from "../../../../pouw/src/cupow.js";
import { storeCertificate, isCertificateReplayedAsync } from "./certificate-store.service.js";
import { log } from "../lib/logger.js";

const L = log.pouw;

/** How long a sigma seed is valid (seconds). Certs older than this are rejected. */
const CERT_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

/** Minimum difficulty we accept from providers. Adjust for testnet. */
const MIN_DIFFICULTY = Number(process.env.POUW_MIN_DIFFICULTY ?? "8");

export interface VerifyResult {
  valid: boolean;
  reason?: string;
  certificateId?: string;
}

/**
 * Verify a submitted POUW certificate.
 * Returns { valid: true, certificateId } on success, or { valid: false, reason } on failure.
 */
export async function verifyCertificate(cert: POUWCertificate): Promise<VerifyResult> {
  const start = Date.now();

  // ── Basic sanity checks ──────────────────────────────────────────────────
  if (!cert.providerAddress || !cert.deviceId) {
    return { valid: false, reason: "Missing provider address or device ID" };
  }

  if (cert.difficulty < MIN_DIFFICULTY) {
    return { valid: false, reason: `Difficulty ${cert.difficulty} below minimum ${MIN_DIFFICULTY}` };
  }

  if (!cert.matrixA || !cert.matrixB) {
    return { valid: false, reason: "Missing matrix data (A or B)" };
  }

  const expectedSize = cert.n * cert.n;
  if (cert.matrixA.length !== expectedSize || cert.matrixB.length !== expectedSize) {
    return { valid: false, reason: `Matrix data size mismatch: expected ${expectedSize}, got A=${cert.matrixA.length} B=${cert.matrixB.length}` };
  }

  // ── Freshness check ──────────────────────────────────────────────────────
  const age = Date.now() - cert.timestamp;
  if (age > CERT_MAX_AGE_MS) {
    return { valid: false, reason: `Certificate expired (age=${Math.round(age / 1000)}s > max=${CERT_MAX_AGE_MS / 1000}s)` };
  }

  // ── Replay check ─────────────────────────────────────────────────────────
  if (await isCertificateReplayedAsync(cert.z)) {
    return { valid: false, reason: "Certificate z already seen (replay attack)" };
  }

  // ── Cryptographic verification ────────────────────────────────────────────
  L.info(`[POUW:verify] Verifying cert from ${cert.providerAddress.slice(0, 10)}... n=${cert.n} r=${cert.r} diff=${cert.difficulty}`);

  let cryptoValid: boolean;
  try {
    cryptoValid = cupowVerify(cert);
  } catch (err) {
    L.error("[POUW:verify] Verification threw:", err);
    return { valid: false, reason: `Verification error: ${err instanceof Error ? err.message : String(err)}` };
  }

  const elapsed = Date.now() - start;

  if (!cryptoValid) {
    L.warn(`[POUW:verify] INVALID certificate from ${cert.providerAddress.slice(0, 10)}... (${elapsed}ms)`);
    return { valid: false, reason: "Cryptographic verification failed" };
  }

  // ── Store and return ──────────────────────────────────────────────────────
  const certificateId = await storeCertificate(cert);
  if (!certificateId) {
    return { valid: false, reason: "Certificate z already seen (replay attack)" };
  }
  L.success(`[POUW:verify] Valid certificate #${certificateId} from ${cert.providerAddress.slice(0, 10)}... (${elapsed}ms)`);

  return { valid: true, certificateId };
}
