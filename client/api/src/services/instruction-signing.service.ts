/**
 * Signed node instructions (docs/IMPL_SPEC_2026-10.md "Node instruction signing").
 *
 * Every API response that carries work or deployment instructions for a node is signed with the
 * INSTRUCTION_SIGNING_KEY Worker secret (a secp256k1 key that is NOT a chain key and never holds funds):
 *
 *   digest = keccak256(canonicalJSON({ nodeAddress, ts, nonce, body }))
 *   sig    = personal_sign(digest bytes)            (viem signMessage({ message: { raw } }))
 *
 * canonicalJSON sorts object keys recursively; arrays keep their order. The agent pins the signer
 * address (CLOUDANA_INSTRUCTION_SIGNER, default baked in) and verifies sig, |ts − now| ≤ 60 s and an
 * unseen nonce. The verifier lives in node-agent/src/instructions.ts — keep both in step.
 *
 * Env is read lazily (never at import time — the Worker copies bindings per request):
 *   INSTRUCTION_SIGNING_KEY  32-byte hex private key (unset → responses go out unsigned and the
 *                            agent ignores them; /v1/nodes/instruction-key answers 503)
 *   MIN_AGENT_VERSION        semver; nodes below it get no work (default: CURRENT_AGENT_VERSION)
 */
import { keccak256, stringToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/** The agent version this API was built against (node-agent/package.json). MIN_AGENT_VERSION defaults to it. */
export const CURRENT_AGENT_VERSION = "1.1.0";

export interface InstructionEnvelope {
  ts: number;
  nonce: string;
  sig: `0x${string}`;
}

export function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJSON(obj[k])}`).join(",")}}`;
}

export function instructionDigest(nodeAddress: string, ts: number, nonce: string, body: unknown): `0x${string}` {
  return keccak256(stringToBytes(canonicalJSON({ nodeAddress: nodeAddress.toLowerCase(), ts, nonce, body })));
}

function signingKey(): `0x${string}` | null {
  const raw = process.env.INSTRUCTION_SIGNING_KEY?.trim();
  if (!raw) return null;
  const hex = raw.startsWith("0x") ? raw : `0x${raw}`;
  return /^0x[0-9a-fA-F]{64}$/.test(hex) ? (hex as `0x${string}`) : null;
}

/** Address nodes must pin, or null when the key is not configured. */
export function instructionSignerAddress(): string | null {
  const key = signingKey();
  return key ? privateKeyToAccount(key).address : null;
}

function randomNonce(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Sign `body` for `nodeAddress`. Returns null when INSTRUCTION_SIGNING_KEY is not configured. */
export async function signInstruction(nodeAddress: string, body: unknown, now = Date.now()): Promise<InstructionEnvelope | null> {
  const key = signingKey();
  if (!key) return null;
  const nonce = randomNonce();
  const sig = await privateKeyToAccount(key).signMessage({ message: { raw: instructionDigest(nodeAddress, now, nonce, body) } });
  return { ts: now, nonce, sig };
}

/** Compare two "x.y.z" versions: negative when a < b. Non-numeric parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map((p) => parseInt(p, 10) || 0);
  const pb = b.replace(/^v/, "").split(".").map((p) => parseInt(p, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function minAgentVersion(): string {
  const v = process.env.MIN_AGENT_VERSION?.trim();
  return v && /^v?\d+(\.\d+){0,2}$/.test(v) ? v.replace(/^v/, "") : CURRENT_AGENT_VERSION;
}

/** Whether a node that reported `agentVersion` (null = never reported) may receive work. */
export function agentVersionAllowed(agentVersion: string | null | undefined): boolean {
  return !!agentVersion && compareVersions(agentVersion, minAgentVersion()) >= 0;
}
