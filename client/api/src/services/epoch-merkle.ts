/**
 * Settlement v2 Merkle tree, byte-compatible with OpenZeppelin's StandardMerkleTree
 * (what contract/ MerkleProof verifies): leaf = keccak256(bytes.concat(keccak256(abi.encode(
 * epoch, account, laneA, laneB)))), leaves sorted ascending by hash, pairs hashed in sorted order.
 * Amounts are CLD wei (µCLD × 1e12).
 */
import { concat, encodeAbiParameters, keccak256, type Hex } from "viem";

export const UCLD_TO_WEI = 10n ** 12n;
export const ZERO_ROOT: Hex = `0x${"0".repeat(64)}`;

export function leafHash(epoch: number, account: string, laneAWei: bigint, laneBWei: bigint): Hex {
  const inner = keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }],
      [BigInt(epoch), account as Hex, laneAWei, laneBWei],
    ),
  );
  return keccak256(concat([inner]));
}

function compareHex(a: Hex, b: Hex): number {
  return a < b ? -1 : a > b ? 1 : 0; // same-length lowercase hex compares like bytes
}

function hashPair(a: Hex, b: Hex): Hex {
  return keccak256(concat(compareHex(a, b) <= 0 ? [a, b] : [b, a]));
}

/** OZ `makeMerkleTree` over sorted leaves; ZERO_ROOT for no leaves. */
export function merkleRoot(leaves: Hex[]): Hex {
  if (leaves.length === 0) return ZERO_ROOT;
  const sorted = [...leaves].map((l) => l.toLowerCase() as Hex).sort(compareHex);
  const tree: Hex[] = new Array(2 * sorted.length - 1);
  sorted.forEach((leaf, i) => (tree[tree.length - 1 - i] = leaf));
  for (let i = tree.length - 1 - sorted.length; i >= 0; i--) tree[i] = hashPair(tree[2 * i + 1], tree[2 * i + 2]);
  return tree[0];
}

export function epochRoot(epoch: number, leaves: { account: string; laneAUcld: number; laneBUcld: number }[]): Hex {
  return merkleRoot(leaves.map((l) => leafHash(epoch, l.account, BigInt(l.laneAUcld) * UCLD_TO_WEI, BigInt(l.laneBUcld) * UCLD_TO_WEI)));
}
