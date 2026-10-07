/**
 * Signed instructions from the API (docs/IMPL_SPEC_2026-10.md "Node instruction signing").
 *
 * The API signs every heartbeat body that carries work with INSTRUCTION_SIGNING_KEY:
 *   digest = keccak256(canonicalJSON({ nodeAddress, ts, nonce, body }))   body = { assignment, deployments }
 *   sig    = personal_sign(digest bytes)
 * The agent accepts an instruction only when the recovered signer is the pinned address, |ts − now| ≤ 60 s and
 * the nonce was not seen before (LRU). Anything else — including an unsigned response — is ignored, so a
 * compromised or spoofed API cannot hand this machine containers to run.
 *
 * The signer that signs instructions (client/api/src/services/instruction-signing.service.ts) must produce the
 * same canonical JSON: object keys sorted recursively, undefined values dropped, arrays in order.
 */
import { keccak256, stringToBytes, verifyMessage } from "viem";

/**
 * Address of the API's instruction key, pinned at build time. null until the owner generates
 * INSTRUCTION_SIGNING_KEY and bakes its address in here (GET /v1/nodes/instruction-key shows it);
 * until then CLOUDANA_INSTRUCTION_SIGNER must be set or the agent refuses to start.
 */
export const DEFAULT_INSTRUCTION_SIGNER: string | null = null;

export const INSTRUCTION_WINDOW_MS = 60_000;

export interface SignedEnvelope {
  ts?: unknown;
  nonce?: unknown;
  sig?: unknown;
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

/** Remembers the last `max` nonces (insertion order; oldest evicted first). */
export class NonceLru {
  private seen = new Set<string>();
  constructor(private max = 4096) {}
  /** true when the nonce is new (and now recorded); false when it was seen before. */
  add(nonce: string): boolean {
    if (this.seen.has(nonce)) return false;
    this.seen.add(nonce);
    if (this.seen.size > this.max) this.seen.delete(this.seen.values().next().value as string);
    return true;
  }
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

/**
 * Verify an instruction envelope for this node. `body` is exactly what was signed ({ assignment, deployments }).
 * On success the nonce is recorded, so a verbatim replay fails afterwards.
 */
export async function verifyInstruction(
  env: SignedEnvelope,
  nodeAddress: string,
  body: unknown,
  signer: string,
  seen: NonceLru,
  now = Date.now(),
): Promise<VerifyResult> {
  const { ts, nonce, sig } = env;
  if (typeof sig !== "string" || typeof nonce !== "string" || typeof ts !== "number") return { ok: false, reason: "unsigned" };
  if (!/^0x[0-9a-fA-F]{130}$/.test(sig)) return { ok: false, reason: "malformed signature" };
  if (!/^[0-9a-f]{16,64}$/i.test(nonce)) return { ok: false, reason: "malformed nonce" };
  if (!Number.isFinite(ts) || Math.abs(now - ts) > INSTRUCTION_WINDOW_MS) return { ok: false, reason: "stale timestamp" };
  let valid = false;
  try {
    valid = await verifyMessage({
      address: signer as `0x${string}`,
      message: { raw: instructionDigest(nodeAddress, ts, nonce, body) },
      signature: sig as `0x${string}`,
    });
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: "wrong signer" };
  if (!seen.add(nonce.toLowerCase())) return { ok: false, reason: "replayed nonce" };
  return { ok: true };
}
