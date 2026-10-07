import { describe, expect, it } from "vitest";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { getAddress, keccak256, toHex, type Hex } from "viem";
import { buildTree, leafOf, processProof, sumLanes, toWei, UCLD_TO_WEI } from "../src/tree";
import vector from "./fixtures/tree-vector.json";

const addr = (tag: string) => getAddress("0x" + keccak256(toHex(tag)).slice(26));

describe("tree: vector produced by contract/test/v2/gas-and-vector.test.ts (Solidity leafOf)", () => {
  const epoch = BigInt(vector.epoch);
  const t = buildTree(epoch, vector.leaves);

  it("leaf hashes equal CloudanaSettlementV2.leafOf", () => {
    expect(t.leafHashes).toEqual(vector.leafHashes);
    vector.leaves.forEach((l, i) => {
      expect(leafOf(epoch, getAddress(l.account), toWei(l.laneAUcld), toWei(l.laneBUcld))).toBe(vector.leafHashes[i]);
    });
  });

  it("root and proofs equal the OZ StandardMerkleTree used on-chain", () => {
    expect(t.root).toBe(vector.root);
    expect(t.proofs).toEqual(vector.proofs);
    t.proofs.forEach((p, i) => expect(processProof(t.leafHashes[i], p)).toBe(vector.root));
  });

  it("totals convert µCLD -> wei exactly", () => {
    const s = sumLanes(t.leaves);
    expect(s.laneA).toBe(BigInt(vector.totalLaneAUcld) * UCLD_TO_WEI);
    expect(s.laneB).toBe(BigInt(vector.totalLaneBUcld) * UCLD_TO_WEI);
  });
});

describe("tree: matches @openzeppelin/merkle-tree for arbitrary leaf sets", () => {
  const cases = [1, 2, 3, 7, 8, 33, 250];
  for (const n of cases) {
    it(`${n} leaves`, () => {
      const epoch = 12345n + BigInt(n);
      const leaves = Array.from({ length: n }, (_, i) => ({
        account: addr(`acct-${n}-${i}`),
        laneAUcld: String((i * 7919 + 13) % 1_000_003),
        laneBUcld: i % 4 === 0 ? 0 : String((i * 104729) % 50_021),
      }));
      const ours = buildTree(epoch, leaves);
      const oz = StandardMerkleTree.of(
        leaves.map((l) => [epoch, l.account, BigInt(l.laneAUcld) * UCLD_TO_WEI, BigInt(l.laneBUcld) * UCLD_TO_WEI]),
        ["uint256", "address", "uint256", "uint256"],
      );
      expect(ours.root).toBe(oz.root);
      for (const [i, v] of oz.entries()) {
        expect(ours.leafHashes[i]).toBe(oz.leafHash(v));
        expect(ours.proofs[i]).toEqual(oz.getProof(i));
        expect(processProof(ours.leafHashes[i], ours.proofs[i])).toBe(oz.root);
      }
    });
  }

  it("is order-independent in root (sorted leaves) and rejects empty / negative input", () => {
    const a = { account: addr("x"), laneAUcld: "5", laneBUcld: "1" };
    const b = { account: addr("y"), laneAUcld: "6", laneBUcld: "0" };
    expect(buildTree(1n, [a, b]).root).toBe(buildTree(1n, [b, a]).root);
    expect(() => buildTree(1n, [])).toThrow(/empty/);
    expect(() => toWei("-1")).toThrow(/negative/);
  });

  it("different epoch or lane split gives a different leaf", () => {
    const acc = addr("z");
    const l = leafOf(1n, acc, 10n, 5n);
    expect(leafOf(2n, acc, 10n, 5n)).not.toBe(l);
    expect(leafOf(1n, acc, 5n, 10n)).not.toBe(l);
    expect(leafOf(1n, acc, 15n, 0n)).not.toBe(l);
  });

  it("checksums lowercase addresses", () => {
    const lower = addr("w").toLowerCase();
    const t = buildTree(1n, [{ account: lower, laneAUcld: 1, laneBUcld: 0 }]);
    expect(t.leaves[0].account).toBe(getAddress(lower));
    expect(t.proofs[0]).toEqual([] as Hex[]);
    expect(t.root).toBe(t.leafHashes[0]);
  });
});
