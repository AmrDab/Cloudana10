import { generatePrivateKey } from "viem/accounts";
import { open, publicKeyOf, seal, sealedEnvAad, sealedVersion, SEALED_V2_TAG } from "../../shared/sealed.ts";

function fail(msg: string): never {
  console.error(`✗ sealed selftest failed: ${msg}`);
  process.exit(1);
}

function throws(fn: () => unknown, want?: RegExp): boolean {
  try {
    fn();
    return false;
  } catch (err) {
    return want ? want.test((err as Error).message) : true;
  }
}

let checks = 0;
const check = (cond: unknown, msg: string) => {
  checks++;
  if (!cond) fail(msg);
};

const key = generatePrivateKey();
const pub = publicKeyOf(key);
check(pub.length === 130 && pub.startsWith("04"), `publicKeyOf not uncompressed 65-byte hex: ${pub}`);

const secret = JSON.stringify({ DATABASE_URL: "postgres://u:p@h/db", TOKEN: "s3cr3t ✓ ünïcode" });
const depA = "0b4f1e2c-6d3a-4a8b-9c1d-2e3f4a5b6c7d";
const depB = "1c5a2f3d-7e4b-4b9c-8d2e-3f4a5b6c7d8e";
const aadA = sealedEnvAad(depA);
const aadB = sealedEnvAad(depB);

// v2: bound round trip
const sealedA = seal(pub, secret, aadA);
check(sealedVersion(sealedA) === 2, "v2 payload not recognised as version 2");
check(Buffer.from(sealedA, "base64")[0] === SEALED_V2_TAG, "v2 payload does not start with the v2 tag");
check(open(key, sealedA, aadA) === secret, "v2 round trip mismatch");
check(open(key, seal("0x" + pub, "", aadA), aadA) === "", "v2 empty round trip mismatch");

// The binding: deployment A's payload never opens as deployment B, nor unbound, nor with a mangled aad.
check(throws(() => open(key, sealedA, aadB)), "payload sealed for deployment A opened under deployment B");
check(throws(() => open(key, sealedA), /bound to a deployment/), "v2 payload opened without an aad");
check(throws(() => open(key, sealedA, aadA + "x")), "v2 payload opened under a mangled aad");
check(throws(() => sealedEnvAad("../etc"), /invalid deployment id/), "sealedEnvAad accepted a bad id");

// Flip one byte in each region of the v2 payload: tag, ephemeral pubkey, nonce, ciphertext, auth tag.
const raw = Buffer.from(sealedA, "base64");
check(raw.length === 1 + 65 + 24 + Buffer.byteLength(secret) + 16, `unexpected v2 payload length ${raw.length}`);
for (const i of [0, 10, 70, 100, raw.length - 1]) {
  const t = Buffer.from(raw);
  t[i] ^= 0x01;
  check(throws(() => open(key, t.toString("base64"), aadA)), `tampered v2 byte ${i} did not throw`);
}
check(throws(() => open(generatePrivateKey(), sealedA, aadA)), "wrong key opened a v2 payload");

// v1 (legacy): still recognised and opens unbound, but an agent opening for a deployment refuses it.
const sealedV1 = seal(pub, secret);
check(sealedVersion(sealedV1) === 1, "v1 payload not recognised as version 1");
check(open(key, sealedV1) === secret, "v1 round trip mismatch");
check(throws(() => open(key, sealedV1, aadA), /unbound \(v1\)/), "v1 payload opened for a deployment");
const rawV1 = Buffer.from(sealedV1, "base64");
for (const i of [10, 70, 100, rawV1.length - 1]) {
  const t = Buffer.from(rawV1);
  t[i] ^= 0x01;
  check(throws(() => open(key, t.toString("base64"))), `tampered v1 byte ${i} did not throw`);
}
check(throws(() => open(generatePrivateKey(), sealedV1)), "wrong key opened a v1 payload");

// Garbage is neither.
check(sealedVersion("") === null && sealedVersion("!!") === null && sealedVersion(Buffer.alloc(200, 7).toString("base64")) === null, "garbage recognised as a sealed payload");
check(throws(() => open(key, Buffer.alloc(200, 7).toString("base64"), aadA), /not a sealed payload/), "garbage opened");

console.log(`✓ sealed selftest passed — ${checks} checks: v2 bound round trip, cross-deployment/unbound/tampered/wrong-key refused, v1 recognised and refused for deployments`);
