/**
 * Vectors computed independently with @openzeppelin/merkle-tree (StandardMerkleTree.of(values,
 * ["uint256","address","uint256","uint256"])) — the library contract/'s MerkleProof verifies against.
 */
import { describe, it, expect } from "vitest";
import { encodeAbiParameters, keccak256 } from "viem";
import { epochRoot, leafHash, merkleRoot, UCLD_TO_WEI, ZERO_ROOT } from "../src/services/epoch-merkle.js";

const EPOCH = 498_000;
const leaves = [
  { account: "0x00000000000000000000000000000000000000a1", laneAUcld: 950, laneBUcld: 250 },
  { account: "0x00000000000000000000000000000000000000a2", laneAUcld: 1900, laneBUcld: 0 },
  { account: "0x00000000000000000000000000000000000000a3", laneAUcld: 4, laneBUcld: 1 },
];
const OZ = {
  leaf: {
    a1: "0xe4553510a401e36e970c802b80d2c11671ea88168389cce21863605c447101c7",
    a2: "0xf713fafe9d1bc392f17f756952738b0639310cb8838a417ecff3634b45875b2f",
    a3: "0x1a866034f4526fa49f0c86acc7101fddf8c9eb21d9d134a8690df5212a642746",
  },
  root1: "0xe4553510a401e36e970c802b80d2c11671ea88168389cce21863605c447101c7",
  root2: "0x0d0a6a55fd678763e64e959ae0042dfb4760ead9316df03052dc29fcb9d5ecce",
  root3: "0x4159fbe3035723ca04e918a17b3750bf266bc20322938467b6d84d4369073146",
};

describe("settlement v2 leaves", () => {
  it("double-hashes abi.encode(epoch, account, laneAWei, laneBWei)", () => {
    const [l1, l2, l3] = leaves.map((l) => leafHash(EPOCH, l.account, BigInt(l.laneAUcld) * UCLD_TO_WEI, BigInt(l.laneBUcld) * UCLD_TO_WEI));
    expect([l1, l2, l3]).toEqual([OZ.leaf.a1, OZ.leaf.a2, OZ.leaf.a3]);
    // Re-implementation in the test: keccak256 of the 32-byte inner hash.
    const inner = keccak256(
      encodeAbiParameters(
        [{ type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }],
        [BigInt(EPOCH), leaves[0].account as `0x${string}`, 950n * UCLD_TO_WEI, 250n * UCLD_TO_WEI],
      ),
    );
    expect(keccak256(inner)).toBe(OZ.leaf.a1);
    expect(UCLD_TO_WEI).toBe(10n ** 12n);
  });

  it("builds the same root as OZ StandardMerkleTree for 1, 2 and 3 leaves, in any input order", () => {
    expect(epochRoot(EPOCH, leaves.slice(0, 1))).toBe(OZ.root1);
    expect(epochRoot(EPOCH, leaves.slice(0, 2))).toBe(OZ.root2);
    expect(epochRoot(EPOCH, leaves)).toBe(OZ.root3);
    expect(epochRoot(EPOCH, [...leaves].reverse())).toBe(OZ.root3);
    expect(epochRoot(EPOCH + 1, leaves)).not.toBe(OZ.root3);
  });

  it("has a zero root for no leaves", () => {
    expect(merkleRoot([])).toBe(ZERO_ROOT);
  });
});
