/**
 * Sealed secrets (V3 contract §6): ECIES over secp256k1, shared by the browser and the node agent.
 *
 * v2 (current) — bound to the deployment it was sealed for:
 *   ephemeral key e  →  shared = x-coordinate of ECDH(e, nodePub)            (32 bytes)
 *   key   = HKDF-SHA256(ikm = shared, salt = ephemeralPub(65), info = "cloudana-sealed-env-v2" ‖ 0x00 ‖ utf8(aad), 32)
 *   nonce = 24 random bytes
 *   ct    = XChaCha20-Poly1305(key, nonce, aad = utf8(aad)).encrypt(utf8(plaintext))   (ciphertext ‖ 16-byte tag)
 *   sealed = base64(0x02 ‖ ephemeralPub(65, uncompressed) ‖ nonce(24) ‖ ct)
 *
 * `aad` is `sealedEnvAad(deploymentId)`. The node opens a payload only with the aad of the deployment it is about to
 * start, so whoever stores and forwards sealed payloads (the API, D1) cannot move the secrets of deployment X into a
 * container of deployment Y on the same node. A wrong deployment, a wrong node key or one flipped byte all fail the
 * Poly1305 tag; nothing is decrypted and nothing is injected.
 *
 * v1 (legacy, no binding) — `0x04`-prefixed (the ephemeral key itself) ‖ nonce ‖ ct, info "cloudana-sealed-env-v1".
 * Agents ≥ 1.5.0 refuse it for deployments; it is kept only so old payloads can be recognised and reported.
 *
 * Pure: no Node-only APIs, so Vite and Node both run it unchanged.
 */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";

const utf8 = (s: string) => new TextEncoder().encode(s);
const INFO_V1 = utf8("cloudana-sealed-env-v1");
const INFO_V2 = utf8("cloudana-sealed-env-v2");
/** First byte of a v2 payload. A v1 payload starts with its uncompressed ephemeral key, 0x04, so the two never collide. */
export const SEALED_V2_TAG = 0x02;
const V1_TAG = 0x04;
const PUB_LEN = 65;
const NONCE_LEN = 24;
const TAG_LEN = 16;

/** The associated data a deployment's secrets are bound to. The browser seals with it; the agent opens with it. */
export function sealedEnvAad(deploymentId: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(deploymentId)) throw new Error("invalid deployment id");
  return `cloudana-deployment:${deploymentId}`;
}

/** 2 for a bound payload, 1 for a legacy one, null for anything that is not a sealed payload at all. */
export function sealedVersion(sealedBase64: string): 1 | 2 | null {
  let buf: Uint8Array;
  try {
    buf = fromBase64(sealedBase64);
  } catch {
    return null;
  }
  if (buf[0] === SEALED_V2_TAG && buf.length >= 1 + PUB_LEN + NONCE_LEN + TAG_LEN && buf[1] === V1_TAG) return 2;
  if (buf[0] === V1_TAG && buf.length >= PUB_LEN + NONCE_LEN + TAG_LEN) return 1;
  return null;
}

function hex(h: string): Uint8Array {
  return hexToBytes(h.startsWith("0x") ? h.slice(2) : h);
}

function deriveKey(shared: Uint8Array, ephemeralPub: Uint8Array, aad?: Uint8Array): Uint8Array {
  const info = aad ? concat(INFO_V2, new Uint8Array([0]), aad) : INFO_V1;
  return hkdf(sha256, shared.slice(1), ephemeralPub, info, 32); // drop the 0x02/0x03 prefix → x-coordinate
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

/** Uncompressed (65-byte, 0x04-prefixed) public key hex for a private key hex (0x optional). */
export function publicKeyOf(privateKeyHex: string): string {
  return bytesToHex(secp256k1.getPublicKey(hex(privateKeyHex), false));
}

/**
 * Encrypt UTF-8 plaintext to a node's public key (hex, compressed or uncompressed, 0x optional), bound to `aad`
 * (`sealedEnvAad(deploymentId)`). Without `aad` a legacy v1 payload is produced — only for tests of the legacy path;
 * nothing that ships should seal unbound.
 */
export function seal(nodePubkeyHex: string, plaintextUtf8: string, aad?: string): string {
  const eph = secp256k1.utils.randomPrivateKey();
  const ephPub = secp256k1.getPublicKey(eph, false);
  const ad = aad === undefined ? undefined : utf8(aad);
  const key = deriveKey(secp256k1.getSharedSecret(eph, hex(nodePubkeyHex), true), ephPub, ad);
  const nonce = randomBytes(NONCE_LEN);
  const ct = xchacha20poly1305(key, nonce, ad).encrypt(utf8(plaintextUtf8));
  return toBase64(ad ? concat(new Uint8Array([SEALED_V2_TAG]), ephPub, nonce, ct) : concat(ephPub, nonce, ct));
}

/**
 * Decrypt a sealed payload with the node's private key. With `aad` (the agent's call) only a v2 payload sealed under
 * exactly that aad opens; a v1 payload is refused as unbound. Without `aad` only a v1 payload opens. Throws on a wrong
 * key, a wrong deployment, a wrong version or any tampering.
 */
export function open(privateKeyHex: string, sealedBase64: string, aad?: string): string {
  const buf = fromBase64(sealedBase64);
  const version = sealedVersion(sealedBase64);
  if (version === null) throw new Error("not a sealed payload");
  if (version === 2 && aad === undefined) throw new Error("sealed payload is bound to a deployment: open it with that deployment's aad");
  if (version === 1 && aad !== undefined) {
    throw new Error("sealed payload is unbound (v1): it was sealed by an old console — seal the secrets again");
  }
  const at = version === 2 ? 1 : 0;
  const ephPub = buf.subarray(at, at + PUB_LEN);
  const nonce = buf.subarray(at + PUB_LEN, at + PUB_LEN + NONCE_LEN);
  const ct = buf.subarray(at + PUB_LEN + NONCE_LEN);
  const ad = aad === undefined ? undefined : utf8(aad);
  const key = deriveKey(secp256k1.getSharedSecret(hex(privateKeyHex), ephPub, true), ephPub, ad);
  return new TextDecoder("utf-8", { fatal: true }).decode(xchacha20poly1305(key, nonce, ad).decrypt(ct));
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    s += i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=";
    s += i + 2 < bytes.length ? B64[n & 63] : "=";
  }
  return s;
}

function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/\s+/g, "").replace(/=+$/, "");
  if (/[^A-Za-z0-9+/]/.test(clean) || clean.length % 4 === 1) throw new Error("invalid base64");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let o = 0;
  for (const ch of clean) {
    acc = (acc << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}
