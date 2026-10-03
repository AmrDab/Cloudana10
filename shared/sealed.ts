/**
 * Sealed secrets (V3 contract §6): ECIES over secp256k1, shared by the browser and the node agent.
 *
 *   ephemeral key e  →  shared = x-coordinate of ECDH(e, nodePub)            (32 bytes)
 *   key   = HKDF-SHA256(ikm = shared, salt = ephemeralPub(65), info = "cloudana-sealed-env-v1", 32)
 *   nonce = 24 random bytes
 *   ct    = XChaCha20-Poly1305(key, nonce).encrypt(utf8(plaintext))          (ciphertext ‖ 16-byte tag)
 *   sealed = base64(ephemeralPub(65, uncompressed) ‖ nonce(24) ‖ ct)
 *
 * Pure: no Node-only APIs, so Vite and Node both run it unchanged.
 */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";

const INFO = new TextEncoder().encode("cloudana-sealed-env-v1");
const PUB_LEN = 65;
const NONCE_LEN = 24;

function hex(h: string): Uint8Array {
  return hexToBytes(h.startsWith("0x") ? h.slice(2) : h);
}

function deriveKey(shared: Uint8Array, ephemeralPub: Uint8Array): Uint8Array {
  return hkdf(sha256, shared.slice(1), ephemeralPub, INFO, 32); // drop the 0x02/0x03 prefix → x-coordinate
}

/** Uncompressed (65-byte, 0x04-prefixed) public key hex for a private key hex (0x optional). */
export function publicKeyOf(privateKeyHex: string): string {
  return bytesToHex(secp256k1.getPublicKey(hex(privateKeyHex), false));
}

/** Encrypt UTF-8 plaintext to a node's public key (hex, compressed or uncompressed, 0x optional). */
export function seal(nodePubkeyHex: string, plaintextUtf8: string): string {
  const eph = secp256k1.utils.randomPrivateKey();
  const ephPub = secp256k1.getPublicKey(eph, false);
  const key = deriveKey(secp256k1.getSharedSecret(eph, hex(nodePubkeyHex), true), ephPub);
  const nonce = randomBytes(NONCE_LEN);
  const ct = xchacha20poly1305(key, nonce).encrypt(new TextEncoder().encode(plaintextUtf8));
  const out = new Uint8Array(PUB_LEN + NONCE_LEN + ct.length);
  out.set(ephPub, 0);
  out.set(nonce, PUB_LEN);
  out.set(ct, PUB_LEN + NONCE_LEN);
  return toBase64(out);
}

/** Decrypt a sealed payload with the node's private key. Throws on a wrong key or any tampering. */
export function open(privateKeyHex: string, sealedBase64: string): string {
  const buf = fromBase64(sealedBase64);
  if (buf.length < PUB_LEN + NONCE_LEN + 16) throw new Error("sealed payload too short");
  const ephPub = buf.subarray(0, PUB_LEN);
  const nonce = buf.subarray(PUB_LEN, PUB_LEN + NONCE_LEN);
  const ct = buf.subarray(PUB_LEN + NONCE_LEN);
  const key = deriveKey(secp256k1.getSharedSecret(hex(privateKeyHex), ephPub, true), ephPub);
  return new TextDecoder("utf-8", { fatal: true }).decode(xchacha20poly1305(key, nonce).decrypt(ct));
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
