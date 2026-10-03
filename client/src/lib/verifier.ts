// Browser verifier: Freivalds' check of C = A·B over the prime field p = 1e9+7 (BigInt),
// on flat row-major matrices from GET /v1/verify/task. Ported from client/public/app/app.js.
import { api } from "@/lib/cld";

export const P = 1_000_000_007n;

const modp = (x: number | bigint) => {
  const b = BigInt(x) % P;
  return b < 0n ? b + P : b;
};

function randVec(n: number): bigint[] {
  const u = new Uint32Array(n);
  crypto.getRandomValues(u);
  return Array.from(u, (x) => BigInt(x) % P);
}

/**
 * Freivalds: pick random r, accept iff A(Br) = Cr (mod p). A wrong C survives one round with
 * probability ≤ 1/p; `rounds` independent vectors make that negligible. O(n²) per round.
 */
export function freivalds(A: ArrayLike<number>, B: ArrayLike<number>, C: ArrayLike<number>, n: number, rounds = 2): boolean {
  const a = Array.from(A, modp);
  const b = Array.from(B, modp);
  const c = Array.from(C, modp);
  if (a.length !== n * n || b.length !== n * n || c.length !== n * n) return false;
  for (let round = 0; round < rounds; round++) {
    const r = randVec(n);
    const br = new Array<bigint>(n);
    for (let i = 0; i < n; i++) {
      let s = 0n;
      for (let k = 0; k < n; k++) s += b[i * n + k] * r[k];
      br[i] = s % P;
    }
    for (let i = 0; i < n; i++) {
      let s = 0n;
      let t = 0n;
      for (let k = 0; k < n; k++) {
        s += a[i * n + k] * br[k];
        t += c[i * n + k] * r[k];
      }
      if (s % P !== t % P) return false;
    }
  }
  return true;
}

export type Intensity = "low" | "med" | "high";
/** Pause between checks. Each check is two requests (task + verdict); the API allows 240/min per IP. */
export const GAP: Record<Intensity, number> = { low: 3000, med: 1000, high: 400 };
/** On rate_limited: back off this long before the next check. */
export const RATE_LIMIT_BACKOFF = 15_000;

/** Same key as /app/verify.html so credits carry over between the two. */
const SESSION_KEY = "cld_verify_session";
export function verifySession(): string {
  let id: string | null = null;
  try {
    id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(SESSION_KEY, id);
    }
  } catch {
    id ??= crypto.randomUUID();
  }
  return id;
}

export type VerifyTask = { taskId: string; n: number; matrixA: number[]; matrixB: number[]; matrixC: number[] };

export const fetchTask = (session: string, signal?: AbortSignal) =>
  api<VerifyTask>(`/verify/task?session=${encodeURIComponent(session)}`, { signal });

export const postVerdict = (session: string, taskId: string, verdict: "valid" | "invalid") =>
  api<{ correct: boolean; credits: number }>("/verify/verdict", { method: "POST", body: { taskId, session, verdict } });

/** Time a Freivalds check. */
export function checkTask(t: VerifyTask): { ok: boolean; ms: number } {
  const t0 = performance.now();
  const ok = freivalds(t.matrixA, t.matrixB, t.matrixC, t.n);
  return { ok, ms: performance.now() - t0 };
}
