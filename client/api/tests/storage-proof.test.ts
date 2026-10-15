/** shared/storage-proof.ts: Merkle roots, paths and verification over ciphertext leaves (docs/V4_STORAGE_PHASE1_CONTRACT.md §B). */
import { describe, it, expect } from "vitest";
import {
  LEAF_BYTES, LEAF_PLAIN_BYTES, cipherSize, fromHex, leafCount, leafRange, merkleLevels, merklePath, merkleRoot, toHex, verifyLeaf,
} from "../../../shared/storage-proof.js";

/** A pseudo-random copy of `n` full leaves plus `tail` bytes. */
function copyOf(n: number, tail = 0): Uint8Array {
  const out = new Uint8Array(n * LEAF_BYTES + tail);
  let x = 2463534242 ^ (n * 7919 + tail);
  for (let i = 0; i < out.length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
}
const leafOf = (copy: Uint8Array, i: number) => copy.subarray(...leafRange(i, copy.byteLength));

describe("sizes", () => {
  it("counts leaves and tags", () => {
    expect(leafCount(0)).toBe(1);
    expect(leafCount(1)).toBe(1);
    expect(leafCount(LEAF_PLAIN_BYTES)).toBe(1);
    expect(leafCount(LEAF_PLAIN_BYTES + 1)).toBe(2);
    expect(cipherSize(LEAF_PLAIN_BYTES + 1)).toBe(LEAF_PLAIN_BYTES + 1 + 32);
    expect(leafRange(1, LEAF_BYTES + 10)).toEqual([LEAF_BYTES, LEAF_BYTES + 10]);
  });
});

describe("paths", () => {
  for (const [n, tail] of [[1, 0], [0, 300], [2, 0], [2, 5], [3, 0], [5, 77], [7, 0], [64, 1]] as const) {
    const leaves = n + (tail > 0 ? 1 : 0);
    it(`${leaves} leaves: every leaf verifies; a changed leaf or index does not`, async () => {
      const copy = copyOf(n, tail);
      const levels = await merkleLevels(copy);
      const root = await merkleRoot(copy);
      expect(levels[0]).toHaveLength(leaves);
      for (let i = 0; i < leaves; i++) {
        const path = merklePath(levels, i);
        const leaf = leafOf(copy, i);
        expect(await verifyLeaf(leaf, i, leaves, path, root), `leaf ${i}`).toBe(true);
        const bad = leaf.slice();
        bad[0] ^= 1;
        expect(await verifyLeaf(bad, i, leaves, path, root)).toBe(false);
        if (leaves > 1) expect(await verifyLeaf(leaf, (i + 1) % leaves, leaves, path, root)).toBe(false);
        expect(await verifyLeaf(leaf, leaves, leaves, path, root)).toBe(false); // out of range (the count is ours, not the node's)
      }
    }, 30_000);
  }

  it("carries an odd last node up without a sibling, and refuses a path with one too many or too few", async () => {
    const copy = copyOf(3);
    const levels = await merkleLevels(copy);
    const root = await merkleRoot(copy);
    expect(merklePath(levels, 2)).toHaveLength(1); // carried at level 0, paired at level 1
    expect(merklePath(levels, 0)).toHaveLength(2);
    const path = merklePath(levels, 0);
    expect(await verifyLeaf(leafOf(copy, 0), 0, 3, [...path, path[0]], root)).toBe(false);
    expect(await verifyLeaf(leafOf(copy, 0), 0, 3, path.slice(0, 1), root)).toBe(false);
    expect(await verifyLeaf(leafOf(copy, 0), 0, 3, ["zz".repeat(32), path[1]], root)).toBe(false);
    expect(await verifyLeaf(leafOf(copy, 0), -1, 3, path, root)).toBe(false);
  });

  it("an inner node is not a leaf: domain separation", async () => {
    const copy = copyOf(2);
    const levels = await merkleLevels(copy);
    const root = await merkleRoot(copy);
    // Presenting the two leaf hashes concatenated as a one-leaf "copy" must not reproduce the root.
    const forged = new Uint8Array([...levels[0][0], ...levels[0][1]]);
    expect(await verifyLeaf(forged, 0, 1, [], root)).toBe(false);
    expect(toHex(fromHex(root))).toBe(root);
  });
});
