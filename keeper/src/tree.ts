/**
 * Lane-aware Merkle tree, bit-compatible with OpenZeppelin's StandardMerkleTree and CloudanaSettlementV2.leafOf:
 *   leaf  = keccak256(bytes.concat(keccak256(abi.encode(epoch, account, laneAWei, laneBWei))))
 *   node  = keccak256(sorted(left, right))
 *   leaves sorted ascending by hash; tree laid out as OZ does (leaves at the end, reversed).
 * Amounts arrive in µCLD from the API and are converted here (×1e12).
 */
import { encodeAbiParameters, getAddress, keccak256, concatHex, type Address, type Hex } from "viem";

export const UCLD_TO_WEI = 10n ** 12n;

export type ApiLeaf = { account: string; laneAUcld: string | number; laneBUcld: string | number };
export type WeiLeaf = { account: Address; laneA: bigint; laneB: bigint };

export type Tree = {
  root: Hex;
  /** Leaves in API order, with wei amounts. */
  leaves: WeiLeaf[];
  /** Leaf hashes in API order. */
  leafHashes: Hex[];
  /** Proof per leaf, API order. */
  proofs: Hex[][];
};

export function toWei(ucld: string | number | bigint): bigint {
  const v = BigInt(ucld);
  if (v < 0n) throw new Error(`negative amount ${ucld}`);
  return v * UCLD_TO_WEI;
}

export function leafOf(epoch: bigint, account: Address, laneA: bigint, laneB: bigint): Hex {
  const inner = keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }],
      [epoch, account, laneA, laneB],
    ),
  );
  return keccak256(inner);
}

function hashPair(a: Hex, b: Hex): Hex {
  return BigInt(a) < BigInt(b) ? keccak256(concatHex([a, b])) : keccak256(concatHex([b, a]));
}

export function buildTree(epoch: bigint, apiLeaves: ApiLeaf[]): Tree {
  if (apiLeaves.length === 0) throw new Error("empty tree");
  const leaves: WeiLeaf[] = apiLeaves.map((l) => ({
    account: getAddress(l.account),
    laneA: toWei(l.laneAUcld),
    laneB: toWei(l.laneBUcld),
  }));
  const leafHashes = leaves.map((l) => leafOf(epoch, l.account, l.laneA, l.laneB));

  // OZ: sort hashed leaves ascending, then place at tree[n-1-i] for i in sorted order.
  const order = leafHashes.map((h, i) => i).sort((i, j) => (BigInt(leafHashes[i]) < BigInt(leafHashes[j]) ? -1 : 1));
  const n = leaves.length;
  const tree: Hex[] = new Array(2 * n - 1);
  const treeIndexOf: number[] = new Array(n);
  order.forEach((leafIdx, sortedPos) => {
    const ti = tree.length - 1 - sortedPos;
    tree[ti] = leafHashes[leafIdx];
    treeIndexOf[leafIdx] = ti;
  });
  for (let i = tree.length - 1 - n; i >= 0; i--) tree[i] = hashPair(tree[2 * i + 1], tree[2 * i + 2]);

  const proofs = leaves.map((_, leafIdx) => {
    const proof: Hex[] = [];
    let i = treeIndexOf[leafIdx];
    while (i > 0) {
      proof.push(tree[i % 2 === 1 ? i + 1 : i - 1]);
      i = Math.floor((i - 1) / 2);
    }
    return proof;
  });
  return { root: tree[0], leaves, leafHashes, proofs };
}

/** Recompute a root from a leaf and proof (same as OZ MerkleProof.processProof). */
export function processProof(leaf: Hex, proof: Hex[]): Hex {
  return proof.reduce<Hex>((acc, p) => hashPair(acc, p), leaf);
}

export function sumLanes(leaves: WeiLeaf[]): { laneA: bigint; laneB: bigint } {
  return leaves.reduce((s, l) => ({ laneA: s.laneA + l.laneA, laneB: s.laneB + l.laneB }), { laneA: 0n, laneB: 0n });
}
