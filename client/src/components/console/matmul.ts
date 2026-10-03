// Client-side matmul helpers for the Run page: random inputs (the API's shape) and a local Freivalds check.
// Ported from client/public/app/app.js.

const P = 1_000_000_007n;

/** Flat, row-major n×n ints in [-100, 100] — what POST /v1/jobs expects. */
export function randMatrix(n: number): number[] {
  const u = new Int8Array(n * n);
  crypto.getRandomValues(u);
  return Array.from(u, (v) => Math.max(-100, Math.min(100, v)));
}

const modp = (x: number) => {
  const b = BigInt(x) % P;
  return b < 0n ? b + P : b;
};

/** Freivalds: checks A·B = C (mod p) with `rounds` random vectors. False negatives impossible; false positives ≤ 1/p per round. */
export function freivalds(A: number[], B: number[], C: number[], n: number, rounds = 2): boolean {
  if (A.length !== n * n || B.length !== n * n || C.length !== n * n) return false;
  const a = A.map(modp), b = B.map(modp), c = C.map(modp);
  for (let round = 0; round < rounds; round++) {
    const u = new Uint32Array(n);
    crypto.getRandomValues(u);
    const r = Array.from(u, (x) => BigInt(x) % P);
    const br = new Array<bigint>(n);
    for (let i = 0; i < n; i++) {
      let s = 0n;
      for (let k = 0; k < n; k++) s += b[i * n + k] * r[k];
      br[i] = s % P;
    }
    for (let i = 0; i < n; i++) {
      let s = 0n, t = 0n;
      for (let k = 0; k < n; k++) {
        s += a[i * n + k] * br[k];
        t += c[i * n + k] * r[k];
      }
      if (s % P !== t % P) return false;
    }
  }
  return true;
}

// Inputs are generated in this browser and never returned by the API, so keep the last few locally
// to let the owner re-check the answer. Bounded: at most 12 jobs.
const KEY = "cld.jobInputs";
type Stored = Record<string, { n: number; A: number[]; B: number[]; at: number }>;
function read(): Stored {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}
export function saveInputs(jobId: string, n: number, A: number[], B: number[]) {
  const all = read();
  all[jobId] = { n, A, B, at: Date.now() };
  const keep = Object.entries(all).sort((x, y) => y[1].at - x[1].at).slice(0, 12);
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(keep)));
  } catch {
    /* quota — the check just won't be offered */
  }
}
export const loadInputs = (jobId: string) => read()[jobId] ?? null;

export function downloadJson(name: string, obj: unknown) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(obj)], { type: "application/json" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
