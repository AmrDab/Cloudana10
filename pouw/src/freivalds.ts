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
