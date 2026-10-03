import { generatePrivateKey } from "viem/accounts";
import { open, publicKeyOf, seal } from "../../shared/sealed.ts";

function fail(msg: string): never {
  console.error(`✗ sealed selftest failed: ${msg}`);
  process.exit(1);
}

function throws(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

const key = generatePrivateKey();
const pub = publicKeyOf(key);
if (pub.length !== 130 || !pub.startsWith("04")) fail(`publicKeyOf not uncompressed 65-byte hex: ${pub}`);

const secret = JSON.stringify({ DATABASE_URL: "postgres://u:p@h/db", TOKEN: "s3cr3t ✓ ünïcode" });
const sealed = seal(pub, secret);
if (open(key, sealed) !== secret) fail("round trip mismatch");
if (open(key, seal("0x" + pub, "")) !== "") fail("empty round trip mismatch");

// Flip one byte in each region: ephemeral pubkey, nonce, ciphertext, tag.
const raw = Buffer.from(sealed, "base64");
if (raw.length !== 65 + 24 + Buffer.byteLength(secret) + 16) fail(`unexpected payload length ${raw.length}`);
for (const i of [10, 70, 100, raw.length - 1]) {
  const t = Buffer.from(raw);
  t[i] ^= 0x01;
  if (!throws(() => open(key, t.toString("base64")))) fail(`tampered byte ${i} did not throw`);
}
if (!throws(() => open(generatePrivateKey(), sealed))) fail("wrong key did not throw");

console.log(`✓ sealed selftest passed — round trip, 4 tampered bytes rejected, wrong key rejected`);
