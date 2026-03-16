/**
 * Quick smoke test for the cuPOW implementation.
 * Run with: tsx src/test.ts
 */
import { solve, verify, chooseBlockSize, meetsDifficulty } from "./cupow.js";

const n = 64;
const difficulty = 8; // 8 leading zero bits ≈ 1/256 chance per attempt (fast for testing)
const chainSeed = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
const providerAddress = "0x1234567890abcdef1234567890abcdef12345678";
const deviceId = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

console.log(`cuPOW smoke test`);
console.log(`  n=${n}, r=${chooseBlockSize(n)}, difficulty=${difficulty} bits`);
console.log(`  Expected attempts per certificate: ~${Math.pow(2, difficulty)}`);
console.log();

const start = Date.now();
let attempts = 0;
let cert = null;

while (!cert) {
  const seed = chainSeed.slice(0, 62) + attempts.toString().padStart(2, "0");
  cert = solve(seed, n, difficulty, providerAddress, deviceId, 1);
  attempts++;
  if (attempts % 100 === 0) process.stdout.write(`  ${attempts} outer attempts...\r`);
}

const elapsed = (Date.now() - start) / 1000;
console.log(`\n✅ Certificate found after ${attempts} outer attempts in ${elapsed.toFixed(2)}s`);
console.log(`  sigma:          ${cert.certificate.sigma.slice(0, 20)}...`);
console.log(`  transcriptHash: ${cert.certificate.transcriptHash.slice(0, 20)}...`);
console.log(`  z:              ${cert.certificate.z}`);
console.log(`  z meets diff:   ${meetsDifficulty(cert.certificate.z, difficulty)}`);
console.log();

console.log("Verifying certificate...");
const valid = verify(cert.certificate);
console.log(`  Result: ${valid ? "✅ VALID" : "❌ INVALID"}`);

if (!valid) process.exit(1);

// Test tampered certificate is rejected
const tampered = { ...cert.certificate, transcriptHash: "00".repeat(32) };
const tamperedValid = verify(tampered);
console.log(`  Tampered cert: ${tamperedValid ? "❌ Should have been rejected!" : "✅ Correctly rejected"}`);
if (tamperedValid) process.exit(1);

console.log("\n✅ All tests passed");
