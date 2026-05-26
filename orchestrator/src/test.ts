/**
 * End-to-end test: solve a POUW certificate → submit to orchestrator → verify acceptance.
 *
 * Run: npx tsx src/test.ts
 * Requires: orchestrator running on localhost:7002 (or set ORCHESTRATOR_URL)
 */

import { solve, verify } from "../../pouw/src/cupow.js";
import { createHash } from "node:crypto";

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL ?? "http://localhost:7002";

async function main() {
  console.log("=== POUW Orchestrator E2E Test ===\n");

  // 1. Fetch seed from orchestrator
  console.log("1. Fetching seed...");
  let seed: string;
  let difficulty: number;
  let matrixSize: number;
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/v1/pouw/seed`);
    const data = await res.json() as any;
    seed = data.seed;
    difficulty = data.difficulty;
    matrixSize = data.matrixSize;
    console.log(`   Seed: ${seed.slice(0, 16)}...`);
    console.log(`   Difficulty: ${difficulty} bits`);
    console.log(`   Matrix: ${matrixSize}x${matrixSize}`);
  } catch (err) {
    console.error("   FAIL: Cannot reach orchestrator at", ORCHESTRATOR_URL);
    console.error("   Start it with: cd orchestrator && npm run dev");
    process.exit(1);
  }

  // 2. Mine a certificate
  console.log("\n2. Mining certificate (this may take a moment)...");
  const providerAddress = "0x" + "a".repeat(40); // test address
  const deviceId = "0x" + createHash("sha256").update("test-device").digest("hex");
  const startTime = Date.now();

  // Use the same difficulty the orchestrator requires
  const result = solve(seed, matrixSize, difficulty, providerAddress, deviceId, 10000);

  const elapsed = Date.now() - startTime;
  if (!result) {
    console.error(`   FAIL: No certificate found in 10000 attempts (${elapsed}ms)`);
    console.error("   Try lowering POUW_DIFFICULTY");
    process.exit(1);
  }

  const cert = result.certificate;
  console.log(`   Found! z: ${cert.z.slice(0, 16)}... (${elapsed}ms)`);

  // 3. Verify locally first
  console.log("\n3. Local verification...");
  const localValid = verify(cert);
  console.log(`   Local verify: ${localValid ? "PASS" : "FAIL"}`);
  if (!localValid) {
    console.error("   Certificate failed local verification — bug in solve/verify");
    process.exit(1);
  }

  // 4. Submit to orchestrator
  console.log("\n4. Submitting to orchestrator...");
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/v1/pouw/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cert),
    });
    const data = await res.json() as any;
    console.log(`   Status: ${data.status}`);
    if (data.status === "accepted") {
      console.log(`   Reward: ${data.reward} CLD`);
      console.log(`   TX: ${data.txHash}`);
    } else {
      console.log(`   Reason: ${data.reason}`);
      // Unexpected rejection
      if (data.reason) {
        console.error("   FAIL: Unexpected rejection");
      }
    }
  } catch (err) {
    console.error("   FAIL: Submission error:", err);
    process.exit(1);
  }

  // 5. Check stats
  console.log("\n5. Checking stats...");
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/v1/pouw/stats`);
    const stats = await res.json() as any;
    console.log(`   Total certificates: ${stats.totalCertificates}`);
    console.log(`   Total rewards minted: ${stats.totalRewardsMinted} CLD`);
    console.log(`   On-chain certs: ${stats.onChainCertificates}`);
    console.log(`   On-chain miners: ${stats.onChainMiners}`);
  } catch {
    console.log("   Could not fetch stats");
  }

  // 6. Test replay protection
  console.log("\n6. Testing replay protection...");
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/v1/pouw/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cert),
    });
    const data = await res.json() as any;
    if (data.status === "rejected" && data.reason?.includes("Duplicate")) {
      console.log("   PASS: Replay correctly rejected");
    } else {
      console.log(`   WARN: Expected rejection, got: ${data.status} — ${data.reason}`);
    }
  } catch {
    console.log("   Could not test replay");
  }

  console.log("\n=== Test Complete ===");
}

main().catch(console.error);
