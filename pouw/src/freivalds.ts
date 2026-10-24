/**
 * Freivalds' check — confirms C = A·B in O(n²) instead of recomputing O(n³).
 *
 * Pick a random vector r; if A·(B·r) = C·r then C = A·B, except with probability
 * ≤ 1/p per round (p = 1,000,000,007, arithmetic mod p). This checks the ANSWER.
 * It does not check the WORK — the cuPOW transcript does that.
 *
 * Inputs are the user's signed integers (n×n, row-major).
 */
import { randomBytes } from "node:crypto";
import { PRIME } from "./matrix.js";

const P = PRIME;

function mod(x: bigint): bigint {
  const m = x % P;
  return m < 0n ? m + P : m;
}

function randomFieldVector(n: number): bigint[] {
  const bytes = randomBytes(n * 8);
  const out = new Array<bigint>(n);
  for (let i = 0; i < n; i++) out[i] = bytes.readBigUInt64BE(i * 8) % P;
  return out;
}

/** Multiply an n×n signed matrix by a field vector, mod p. */
function matVec(M: number[], v: bigint[], n: number): bigint[] {
  const out = new Array<bigint>(n);
  for (let i = 0; i < n; i++) {
    let s = 0n;
    const row = i * n;
    for (let k = 0; k < n; k++) {
      const a = M[row + k];
      if (a !== 0) s += BigInt(a) * v[k];
    }
    out[i] = mod(s);
  }
  return out;
}

/**
 * True if C = A·B (with overwhelming probability). `rounds` = 1 already gives a
 * false-accept probability ≤ 1/p ≈ 10⁻⁹; use 2 for ≈ 10⁻¹⁸.
 */
export function freivalds(A: number[], B: number[], C: number[], n: number, rounds = 2): boolean {
  if (A.length !== n * n || B.length !== n * n || C.length !== n * n) return false;
  for (let t = 0; t < rounds; t++) {
    const r = randomFieldVector(n);
    const Br = matVec(B, r, n);
    const ABr = matVec(A, Br, n);
    const Cr = matVec(C, r, n);
    for (let i = 0; i < n; i++) if (ABr[i] !== Cr[i]) return false;
  }
  return true;
}

// ─── Rectangular Freivalds in plain doubles (B-26) ───────────────────────────
// The int8-mlp segment checks run on the Worker per answer, so this one avoids BigInt (≈ 4× faster at b = 64,
// d = h = 256). Every product is kept below 2⁵³: an entry with |a| < 2²² times r < 2³⁰ is exact as is; a larger one is
// split, a·r = (a·r_hi mod p)·2¹⁵ + a·r_lo with r = r_hi·2¹⁵ + r_lo, each part < 2⁴⁶.
const PN = 1_000_000_007;
const SMALL = 2 ** 22;

function mulmodN(a: number, r: number): number {
  if (a > -SMALL && a < SMALL) return (a * r) % PN;
  const x = a % PN;
  const hi = Math.floor(r / 32768);
  const lo = r - hi * 32768;
  return (((x * hi) % PN) * 32768 + x * lo) % PN;
}

/** r_i uniform in [0, p) from 48 random bits each (bias < p / 2⁴⁸). */
function randomFieldVectorN(n: number): number[] {
  const bytes = randomBytes(n * 6);
  return Array.from({ length: n }, (_, i) => bytes.readUIntBE(i * 6, 6) % PN);
}

/** Multiply a rows×cols signed integer matrix (|entries| < 2³¹) by a field vector, mod p, into [0, p). */
function matVecRect(M: number[], v: number[], rows: number, cols: number): number[] {
  const out = new Array<number>(rows);
  for (let i = 0; i < rows; i++) {
    // Each term is in (−p, p): 2²² of them stay below 2⁵², so reduce that often.
    let s = 0;
    const row = i * cols;
    for (let k = 0; k < cols; k++) {
      const a = M[row + k];
      if (a !== 0) s += mulmodN(a, v[k]);
      if ((k & 0x3fffff) === 0x3fffff) s %= PN;
    }
    s %= PN;
    out[i] = s < 0 ? s + PN : s;
  }
  return out;
}

/**
 * Rectangular Freivalds: true if C = A·B (A m×k, B k×n, C m×n, row-major signed integers below 2³¹ in absolute value)
 * with overwhelming probability — false-accept ≤ (1/p)^rounds. Exact over the integers only when every entry of A·B
 * and of C is within ±(p−1)/2; the caller enforces that bound.
 */
export function freivaldsRect(A: number[], B: number[], C: number[], m: number, k: number, n: number, rounds = 2): boolean {
  if (A.length !== m * k || B.length !== k * n || C.length !== m * n) return false;
  for (let t = 0; t < rounds; t++) {
    const r = randomFieldVectorN(n);
    const ABr = matVecRect(A, matVecRect(B, r, k, n), m, k);
    const Cr = matVecRect(C, r, m, n);
    for (let i = 0; i < m; i++) if (ABr[i] !== Cr[i]) return false;
  }
  return true;
}
