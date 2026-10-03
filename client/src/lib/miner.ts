// cuPOW miner at demo scale — ported from client/public/landing.html. NOT a simulation:
// real integer matrices, real blockwise multiplication, every block hashed through real
// SHA-256 (WebCrypto), σ seeded from the latest Base Sepolia block, real leading-zero difficulty.

const enc = new TextEncoder();
export const BASE_SEPOLIA_RPC = "https://sepolia.base.org";

export async function sha(...parts: (string | Uint8Array)[]): Promise<Uint8Array> {
  const bufs = parts.map((p) => (typeof p === "string" ? enc.encode(p) : p));
  let total = 0;
  for (const b of bufs) total += b.length;
  const cat = new Uint8Array(total);
  let o = 0;
  for (const b of bufs) {
    cat.set(b, o);
    o += b.length;
  }
  return new Uint8Array(await crypto.subtle.digest("SHA-256", cat));
}

export const hex = (u8: Uint8Array) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");

/** Leading zero bits of a digest. */
export function lzBits(u8: Uint8Array): number {
  let n = 0;
  for (const b of u8) {
    if (b === 0) {
      n += 8;
      continue;
    }
    for (let i = 7; i >= 0; i--) {
      if ((b >> i) & 1) return n;
      n++;
    }
  }
  return n;
}

/** n×n matrix of small integers (0–9), row-major. */
export function randMat(n: number): Int32Array {
  const m = new Int32Array(n * n);
  const r = new Uint8Array(n * n);
  crypto.getRandomValues(r);
  for (let i = 0; i < n * n; i++) m[i] = r[i] % 10;
  return m;
}

/** The r×r output block (bi, bj) of A·B. */
export function blockMul(A: Int32Array, B: Int32Array, n: number, r: number, bi: number, bj: number): Int32Array {
  const out = new Int32Array(r * r);
  for (let i = 0; i < r; i++) {
    const row = (bi * r + i) * n;
    for (let j = 0; j < r; j++) {
      let s = 0;
      const col = bj * r + j;
      for (let k = 0; k < n; k++) s += A[row + k] * B[k * n + col];
      out[i * r + j] = s;
    }
  }
  return out;
}

const u8of = (ta: Int32Array) => new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength);
const yieldUI = () => new Promise<void>((res) => setTimeout(res, 0));

export type Certificate = {
  t: Uint8Array;
  hA: Uint8Array;
  hB: Uint8Array;
  sigma: string;
  nonce: number;
  z: Uint8Array;
  bits: number;
  attempts: number;
  msBlocks: number;
  msGrind: number;
};

export type MineHooks = {
  /** Called after each output block is hashed into the transcript. May be async (pacing). */
  onBlock?: (bi: number, bj: number, blockHash: Uint8Array, transcript: Uint8Array) => void | Promise<void>;
  onAttempts?: (attempts: number, ms: number) => void;
  /** Checked between blocks and grind batches; return true to abandon. */
  cancelled?: () => boolean;
};

export class MineCancelled extends Error {}

/** Mine one certificate: transcript t over all output blocks, then grind z = H(σ‖nonce‖t‖hA‖hB) to d bits. */
export async function mine(n: number, r: number, d: number, sigma: string, hooks: MineHooks = {}): Promise<Certificate> {
  const nb = n / r;
  const A = randMat(n);
  const B = randMat(n);
  const hA = await sha(u8of(A));
  const hB = await sha(u8of(B));
  let t: Uint8Array = new Uint8Array(32);
  const t0 = performance.now();
  for (let bi = 0; bi < nb; bi++) {
    for (let bj = 0; bj < nb; bj++) {
      if (hooks.cancelled?.()) throw new MineCancelled();
      const blk = blockMul(A, B, n, r, bi, bj);
      const bh = await sha(u8of(blk));
      t = await sha(t, bh);
      await hooks.onBlock?.(bi, bj, bh, t);
    }
  }
  const msBlocks = performance.now() - t0;
  const g0 = performance.now();
  let nonce = 0;
  let z: Uint8Array;
  let bits: number;
  for (;;) {
    z = await sha(`${sigma}|${nonce}|`, t, hA, hB);
    bits = lzBits(z);
    if (bits >= d) break;
    nonce++;
    if ((nonce & 127) === 0) {
      if (hooks.cancelled?.()) throw new MineCancelled();
      hooks.onAttempts?.(nonce, performance.now() - g0);
      await yieldUI();
    }
  }
  const msGrind = performance.now() - g0;
  hooks.onAttempts?.(nonce + 1, msGrind);
  return { t, hA, hB, sigma, nonce, z, bits, attempts: nonce + 1, msBlocks, msGrind };
}

/** Independent recomputation of z from the certificate. */
export async function verifyCertificate(cert: Certificate): Promise<boolean> {
  const z2 = await sha(`${cert.sigma}|${cert.nonce}|`, cert.t, cert.hA, cert.hB);
  return hex(z2) === hex(cert.z);
}

// ── σ: latest Base Sepolia block hash, honest fallback ─────────────────────

export type Block = { hash: string; number: number };

export async function fetchLatestBlock(timeoutMs = 4500): Promise<Block | null> {
  try {
    const res = await fetch(BASE_SEPOLIA_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: ["latest", false] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const j = await res.json();
    const b = j?.result;
    return b?.hash ? { hash: b.hash as string, number: parseInt(b.number, 16) } : null;
  } catch {
    return null;
  }
}

export type Sigma = { sigma: string; src: string; block: number | null };
let sigmaCache: Sigma | null = null;
let sigmaAt = 0;
/** σ is valid for ~5 min — refresh, never mine on a stale seed. */
const SIGMA_TTL = 5 * 60 * 1000;

export async function getSigma(): Promise<Sigma> {
  if (sigmaCache && Date.now() - sigmaAt < SIGMA_TTL) return sigmaCache;
  sigmaAt = Date.now();
  const b = await fetchLatestBlock();
  if (b) {
    sigmaCache = { sigma: b.hash, src: `base sepolia block #${b.number.toLocaleString("en-US")}`, block: b.number };
    return sigmaCache;
  }
  const rb = new Uint8Array(32);
  crypto.getRandomValues(rb);
  sigmaCache = { sigma: `0x${hex(rb)}`, src: "local entropy (rpc unreachable)", block: null };
  return sigmaCache;
}
