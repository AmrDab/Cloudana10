// Cloudana v1 API client shared by the homepage and the console.
// Envelope: { status: "success", ...data } | { status: "error", error: { code, message } }.
// Sign-in: GET /auth/nonce → wallet signs → POST /auth/login → JWT (sessionStorage, per tab).
// Signer: the connected wagmi wallet if any; otherwise, only when VITE_DEV_BURNER=true (local
// testnet), a burner key kept in localStorage so the whole flow works without a wallet extension.

export const API_ROOT = (import.meta.env.VITE_API_URL || "http://127.0.0.1:8790").replace(/\/$/, "");
const API = `${API_ROOT}/v1`;
export const DEV_BURNER = import.meta.env.VITE_DEV_BURNER === "true";

export class ApiError extends Error {
  constructor(public code: string, message: string, public status = 0) {
    super(message);
  }
}

/** True when the API is unreachable (not when it answered with an error). */
export const isOffline = (e: unknown) => e instanceof ApiError && e.code === "offline";

type ApiOptions = { method?: string; body?: unknown; auth?: boolean; signal?: AbortSignal };

export async function api<T = Record<string, unknown>>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { method = "GET", body, auth = false } = opts;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const s = getSession();
    if (!s) throw new ApiError("unauthorized", "Sign in first.");
    headers.Authorization = `Bearer ${s.token}`;
  }
  let res: Response;
  try {
    res = await fetch(API + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: opts.signal ?? AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ApiError("offline", "The network API is offline.");
  }
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok || !json || json.status === "error") {
    if (res.status === 401 && auth) signOut();
    const err = json?.error ?? {};
    throw new ApiError(err.code ?? (res.status === 429 ? "rate_limited" : "error"), err.message ?? `HTTP ${res.status}`, res.status);
  }
  return json as T;
}

// ── Session ────────────────────────────────────────────────────────────────

export type Session = { token: string; address: string; burner: boolean };
const SESSION_KEY = "cld.session";
const BURNER_KEY = "cld.burner";
const listeners = new Set<() => void>();

export function getSession(): Session | null {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null");
    return s?.token ? s : null;
  } catch {
    return null;
  }
}

function setSession(s: Session | null) {
  if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
  else sessionStorage.removeItem(SESSION_KEY);
  listeners.forEach((l) => l());
}

export const signOut = () => setSession(null);
export function subscribeSession(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

type Signer = { address: string; burner: boolean; sign: (message: string) => Promise<string> };

async function getSigner(): Promise<Signer> {
  // Connected wallet first (loaded lazily so the homepage doesn't pull the wallet stack).
  const [{ getAccount, signMessage }, { wagmiConfig }] = await Promise.all([
    import("@wagmi/core"),
    import("@/lib/wagmi-config"),
  ]);
  const acct = getAccount(wagmiConfig);
  if (acct.address) {
    const address = acct.address;
    return { address: address.toLowerCase(), burner: false, sign: (message) => signMessage(wagmiConfig, { account: address, message }) };
  }
  if (!DEV_BURNER) throw new ApiError("no_wallet", "Connect a wallet to sign in.");
  const { generatePrivateKey, privateKeyToAccount } = await import("viem/accounts");
  let pk = localStorage.getItem(BURNER_KEY) as `0x${string}` | null;
  if (!pk) {
    pk = generatePrivateKey();
    localStorage.setItem(BURNER_KEY, pk);
  }
  const burner = privateKeyToAccount(pk);
  return { address: burner.address.toLowerCase(), burner: true, sign: (message) => burner.signMessage({ message }) };
}

export async function signIn(): Promise<Session> {
  const w = await getSigner();
  const { message } = await api<{ message: string }>(`/auth/nonce?address=${w.address}`);
  const signature = await w.sign(message);
  const { token } = await api<{ token: string }>("/auth/login", { method: "POST", body: { address: w.address, message, signature } });
  const s = { token, address: w.address, burner: w.burner };
  setSession(s);
  return s;
}

/** Sign an arbitrary message with the same signer used for sign-in (e.g. node binding). */
export async function signWithSessionWallet(message: string): Promise<string> {
  const w = await getSigner();
  const s = getSession();
  if (s && s.address !== w.address) throw new ApiError("wallet_changed", "Wallet changed — sign in again.");
  return w.sign(message);
}

// ── Formatting ─────────────────────────────────────────────────────────────

/** µCLD (integer) → "1,204.36 CLD". */
export function cld(ucld: number | null | undefined, digits = 2): string {
  if (ucld == null || !Number.isFinite(ucld)) return "—";
  const v = ucld / 1e6;
  // Small job fees are real amounts: 33 µCLD is "0.000033 CLD", never "0.0000 CLD".
  const a = Math.abs(v);
  const d = v === 0 ? digits : a < 0.001 ? 6 : a < 0.01 ? 4 : digits;
  return `${v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })} CLD`;
}

/** "0x3fa2…9c1e" */
export const short = (h?: string | null, head = 6, tail = 4) =>
  !h ? "—" : h.length <= head + tail + 1 ? h : `${h.slice(0, head)}…${h.slice(-tail)}`;

export const int = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US"));

/** "14 s ago" */
export function ago(ms: number | null | undefined, now = Date.now()): string {
  if (!ms) return "—";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** Price of an n×n matmul in µCLD at `pricePerMmac` µCLD per million multiply-adds (min 1). */
export const jobPriceUcld = (n: number, pricePerMmac: number) => Math.max(1, Math.ceil((n ** 3 * pricePerMmac) / 1e6));
