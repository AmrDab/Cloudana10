/**
 * Signed public data (DECENTRALIZATION_ROADMAP.md phase 1 "signed network data").
 *
 * The orchestrator signs what it publishes — network stats, epoch payloads — so mirrors, dashboards and auditors can
 * prove later what it claimed, with the same funds-less INSTRUCTION_SIGNING_KEY nodes already pin:
 *
 *   digest = keccak256(canonicalJSON({ domain: "cloudana-public-v1", signedAt, body }))
 *   sig    = personal_sign(digest bytes)
 *
 * The `domain` field keeps these signatures apart from node instructions, which sign { nodeAddress, ts, nonce, body }
 * and are verified only against that shape. Verification: viem `verifyMessage({ address: signer, message: { raw:
 * publicDigest(body, signedAt) }, signature })` — see client/api/scripts/verify/replay.ts.
 */
import { keccak256, stringToBytes, verifyMessage } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalJSON, instructionSignerAddress } from "./instruction-signing.service.js";

export const PUBLIC_SIGNING_DOMAIN = "cloudana-public-v1";

export interface PublicSignature {
  /** Address of the signing key; the same one GET /v1/nodes/instruction-key publishes. */
  signer: string;
  /** Unix ms the body was signed. */
  signedAt: number;
  sig: `0x${string}`;
}

export function publicDigest(body: unknown, signedAt: number): `0x${string}` {
  return keccak256(stringToBytes(canonicalJSON({ domain: PUBLIC_SIGNING_DOMAIN, signedAt, body })));
}

function signingKey(): `0x${string}` | null {
  const raw = process.env.INSTRUCTION_SIGNING_KEY?.trim();
  if (!raw) return null;
  const hex = raw.startsWith("0x") ? raw : `0x${raw}`;
  return /^0x[0-9a-fA-F]{64}$/.test(hex) ? (hex as `0x${string}`) : null;
}

/** Sign `body`; null when the API has no signing key (the data is still served, just unsigned — and says so). */
export async function signPublic(body: unknown, now = Date.now()): Promise<PublicSignature | null> {
  const key = signingKey();
  if (!key) return null;
  const account = privateKeyToAccount(key);
  const sig = await account.signMessage({ message: { raw: publicDigest(body, now) } });
  return { signer: account.address, signedAt: now, sig };
}

/** True when `signature` is this signer's signature over `body` at `signedAt`. */
export async function verifyPublic(body: unknown, signature: PublicSignature): Promise<boolean> {
  try {
    return await verifyMessage({
      address: signature.signer as `0x${string}`,
      message: { raw: publicDigest(body, signature.signedAt) },
      signature: signature.sig,
    });
  } catch {
    return false;
  }
}

/** The address public data is signed with, or null. */
export const publicSignerAddress = instructionSignerAddress;
