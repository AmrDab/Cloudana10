/**
 * Testnet-in-a-box (docs/POUW_SIMULATION_PLAN.md §3): shared constants and helpers. Everything targets 127.0.0.1 —
 * the local hardhat chain, the API on its Node runtime (client/api/src/index.ts) and real node agents. The keys
 * below are derived from public seed strings or are hardhat's published test accounts: they only ever hold local
 * test CLD and are never used anywhere else.
 */
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256, toHex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
/** Logs, pids, the API's SQLite file and per-job records. Git-ignored. */
export const RUN = path.join(ROOT, ".dev-run-sim");
mkdirSync(RUN, { recursive: true });

export const API_PORT = 8791;
export const API = `http://127.0.0.1:${API_PORT}`;
export const RPC = "http://127.0.0.1:8545";
export const CHAIN_ID = 1337;
export const EPOCH_SECONDS = 120;

export const keyOf = (seed: string): `0x${string}` => keccak256(toHex(`cloudana-sim-local-${seed}`));
export const wallet = (seed: string): PrivateKeyAccount => privateKeyToAccount(keyOf(seed));
/** The local API's instruction signer (CLOUDANA_INSTRUCTION_SIGNER = its address). */
export const INSTRUCTION_KEY = keyOf("instruction-signer");
/** Hardhat account #9 (published test key): POSTER_ROLE on the local settlement. */
export const POSTER_KEY = "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6" as const;
/** Hardhat account #1 (published test key): the local treasury, holds the genesis supply. */
export const TREASURY_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
export const INTERNAL_KEY = "sim-internal-key-0000000000000000";
export const JWT_SECRET = "sim-jwt-secret-" + "0".repeat(48);

export const PROVIDERS = ["a", "b", "c"] as const;

/** The v2 section written by contract/scripts/v2/deploy.ts --network localhost. */
export function addresses(): { CLDTokenV2: `0x${string}`; CloudanaSettlementV2: `0x${string}`; epochSeconds: number; genesisEpoch: number } {
  return JSON.parse(readFileSync(path.join(ROOT, "shared/addresses.localhost.json"), "utf8")).v2;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function until<T>(fn: () => Promise<T> | T, what: string, ms = 60_000, every = 500): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve(fn()).catch(() => undefined as T);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out after ${ms} ms waiting for ${what}`);
    await sleep(every);
  }
}

export async function api<T = any>(p: string, init: RequestInit & { token?: string; json?: unknown } = {}): Promise<{ status: number; body: T }> {
  const { token, json, ...rest } = init;
  const res = await fetch(`${API}${p}`, {
    ...rest,
    method: rest.method ?? (json !== undefined ? "POST" : "GET"),
    headers: {
      ...(rest.headers as Record<string, string>),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(json !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

/** The user sign-in the console does: nonce → personal_sign → JWT. */
export async function signIn(acct: PrivateKeyAccount): Promise<string> {
  const nonce = await api<{ message: string }>(`/v1/auth/nonce?address=${acct.address}`);
  if (nonce.status !== 200) throw new Error(`nonce ${nonce.status}: ${JSON.stringify(nonce.body)}`);
  const signature = await acct.signMessage({ message: nonce.body.message });
  const login = await api<{ token: string }>("/v1/auth/login", { json: { address: acct.address, message: nonce.body.message, signature } });
  if (login.status !== 200) throw new Error(`login ${login.status}: ${JSON.stringify(login.body)}`);
  return login.body.token;
}

export const nowIso = () => new Date().toISOString();
export const log = (tag: string, msg: string) => console.log(`${nowIso()} [${tag}] ${msg}`);
