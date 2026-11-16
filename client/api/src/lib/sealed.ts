/**
 * The API's half of shared/sealed.ts v2 — sealing only. The API seals one thing itself: an encrypted workstation volume's
 * key, to the node that holds the volume (docs/WORKSTATIONS.md §10.3). Everything else sealed is sealed by the browser.
 *
 * shared/sealed.ts is not imported here because its @noble imports resolve from the repo root, which an install of
 * client/api alone does not have. The format is the same byte for byte: tests/machines.test.ts seals a golden payload
 * with fixed randomness, and node-agent/src/volumes.selftest.ts opens that same payload with shared/sealed.ts open().
 */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { hexToBytes, randomBytes } from "@noble/hashes/utils.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";

const utf8 = (s: string) => new TextEncoder().encode(s);
const INFO_V2 = utf8("cloudana-sealed-env-v2");

/** shared/sealed.ts volumeKeyAad: what a deployment's volume key is bound to. */
export function volumeKeyAad(deploymentId: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(deploymentId)) throw new Error("invalid deployment id");
  return `cloudana-volume-key:${deploymentId}`;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * shared/sealed.ts seal(nodePubkey, plaintext, aad): v2 = 0x02 ‖ ephemeralPub(65) ‖ nonce(24) ‖ XChaCha20-Poly1305
 * ciphertext, key = HKDF-SHA256(x(ECDH(e, nodePub)), salt = ephemeralPub, info = "cloudana-sealed-env-v2" ‖ 0 ‖ aad).
 * `ephemeral` and `nonce` are for the golden test only; leave them out.
 */
export function sealV2(nodePubkeyHex: string, plaintextUtf8: string, aad: string, ephemeral?: Uint8Array, nonce?: Uint8Array): string {
  const eph = ephemeral ?? secp256k1.utils.randomPrivateKey();
  const ephPub = secp256k1.getPublicKey(eph, false);
  const ad = utf8(aad);
  const shared = secp256k1.getSharedSecret(eph, hexToBytes(nodePubkeyHex.replace(/^0x/, "")), true);
  const key = hkdf(sha256, shared.slice(1), ephPub, concat(INFO_V2, new Uint8Array([0]), ad), 32);
  const n = nonce ?? randomBytes(24);
  const ct = xchacha20poly1305(key, n, ad).encrypt(utf8(plaintextUtf8));
  return Buffer.from(concat(new Uint8Array([0x02]), ephPub, n, ct)).toString("base64");
}

/** A fresh volume key: 32 random bytes as 64 lowercase hex characters (what node-agent/src/volumes.ts accepts). */
export function newVolumeKey(): string {
  return [...randomBytes(32)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
