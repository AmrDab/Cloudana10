process.env.JWT_SECRET = "x".repeat(40);

import { describe, it, expect } from "vitest";
import { clusterTest, eligibleHash, sha256, weightedDraw, type Candidate } from "../src/services/jobs.service.js";

const nodes: Candidate[] = [
  { address: "0x00000000000000000000000000000000000000bb", payout: "0xw1", weight: 3 },
  { address: "0x00000000000000000000000000000000000000aa", payout: "0xw2", weight: 1 },
  { address: "0x00000000000000000000000000000000000000cc", payout: "0xw3", weight: 0 },
];

describe("assignment draw", () => {
  it("is deterministic for a seed and independent of input order", () => {
    const seed = sha256("0xblockhash" + "job-1");
    const a = weightedDraw(seed, nodes);
    expect(weightedDraw(seed, [...nodes].reverse())).toBe(a);
    expect(weightedDraw(seed, nodes)).toBe(a);
  });

  it("maps the seed onto cumulative weights sorted by address", () => {
    // sorted: aa [0,1), bb [1,4), cc (weight 0); u = first 52 bits / 2^52, target = 4u
    expect(weightedDraw("0".repeat(64), nodes)).toBe(nodes[1].address); // u=0 → aa
    expect(weightedDraw("4" + "0".repeat(63), nodes)).toBe(nodes[0].address); // u=0.25 → target 1 → bb
    expect(weightedDraw("f".repeat(64), nodes)).toBe(nodes[0].address); // u≈1 → bb (cc has no weight)
  });

  it("follows the weights over many seeds", () => {
    let bb = 0;
    for (let i = 0; i < 4000; i++) if (weightedDraw(sha256(`s${i}`), nodes) === nodes[0].address) bb++;
    expect(bb / 4000).toBeGreaterThan(0.7);
    expect(bb / 4000).toBeLessThan(0.8);
  });

  it("eligible hash ignores order and changes with weights", () => {
    expect(eligibleHash(nodes)).toBe(eligibleHash([...nodes].reverse()));
    expect(eligibleHash(nodes)).not.toBe(eligibleHash([{ ...nodes[0], weight: 4 }, nodes[1], nodes[2]]));
  });
});

describe("cluster test", () => {
  const c = (payout: string, weight: number, i: number): Candidate => ({ address: `0x${i}`, payout, weight });

  it("passes a single wallet when N_MIN = 1 (share check skipped)", () => {
    expect(clusterTest([c("w1", 5, 1), c("w1", 5, 2)], 1, 0.5)).toBe(true);
  });

  it("fails with fewer wallets than N_MIN", () => {
    expect(clusterTest([c("w1", 1, 1), c("w2", 1, 2)], 3, 0.5)).toBe(false);
  });

  it("fails when the largest wallet holds more than S_CAP of throughput", () => {
    expect(clusterTest([c("w1", 6, 1), c("w2", 2, 2), c("w3", 2, 3)], 3, 0.5)).toBe(false);
    expect(clusterTest([c("w1", 5, 1), c("w2", 3, 2), c("w3", 2, 3)], 3, 0.5)).toBe(true);
  });

  it("groups nodes by payout wallet (splitting identities gains nothing)", () => {
    expect(clusterTest([c("w1", 2, 1), c("w1", 2, 2), c("w1", 2, 3), c("w2", 2, 4)], 1, 0.5)).toBe(false);
  });
});
