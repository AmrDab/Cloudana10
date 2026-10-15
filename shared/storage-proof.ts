/**
 * Storage proofs (docs/V4_STORAGE_PHASE1_CONTRACT.md §B), shared by the API and the agent.
 *
 * A copy is ciphertext split into leaves of LEAF_BYTES (64 KiB of plaintext + the 16-byte GCM tag; the last leaf is
 * shorter). The Merkle root over the leaves is recorded when the copy is placed; a check asks the node for a few
 * leaves with their paths. Leaf hash = SHA-256(0x00 ‖ leaf), inner = SHA-256(0x01 ‖ left ‖ right); an odd node is
 * carried up unchanged. The root does not bind the leaf count, so verifiers take `leaves` from their own records and
 * derive the path's shape from (index, leaves) — never from the node.
 *
 * WebCrypto only (Workers and Node ≥ 20).
 */
export const LEAF_PLAIN_BYTES = 64 * 1024;
export const GCM_TAG_BYTES = 16;
export const LEAF_BYTES = LEAF_PLAIN_BYTES + GCM_TAG_BYTES;

/** Leaves of a plaintext of `plainSize` bytes (at least one: an empty object is one tag-only leaf). */
export const leafCount = (plainSize: number): number => Math.max(1, Math.ceil(plainSize / LEAF_PLAIN_BYTES));

/** Ciphertext size of a plaintext of `plainSize` bytes: every leaf carries a tag. */
export const cipherSize = (plainSize: number): number => plainSize + leafCount(plainSize) * GCM_TAG_BYTES;

/** Byte range [start, end) of ciphertext leaf `i` in a copy of `size` ciphertext bytes. */
export function leafRange(i: number, size: number): [number, number] {
  const start = i * LEAF_BYTES;
  return [start, Math.min(size, start + LEAF_BYTES)];
}

async function sha256(...parts: Uint8Array[]): Promise<Uint8Array> {
  const total = parts.reduce((s, p) => s + p.byteLength, 0);
  const buf = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    buf.set(p, at);
    at += p.byteLength;
  }
  return new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
}

const LEAF_TAG = new Uint8Array([0]);
const NODE_TAG = new Uint8Array([1]);

export const leafHash = (leaf: Uint8Array): Promise<Uint8Array> => sha256(LEAF_TAG, leaf);
const nodeHash = (left: Uint8Array, right: Uint8Array): Promise<Uint8Array> => sha256(NODE_TAG, left, right);

/** Every level of the tree over a whole copy, leaves first, root last. */
export async function merkleLevels(copy: Uint8Array): Promise<Uint8Array[][]> {
  const n = Math.max(1, Math.ceil(copy.byteLength / LEAF_BYTES));
  const level: Uint8Array[] = [];
  for (let i = 0; i < n; i++) {
    const [a, b] = leafRange(i, copy.byteLength);
    level.push(await leafHash(copy.subarray(a, b)));
  }
  const levels = [level];
  while (levels[levels.length - 1].length > 1) {
    const prev = levels[levels.length - 1];
    const next: Uint8Array[] = [];
    for (let i = 0; i < prev.length; i += 2) next.push(i + 1 < prev.length ? await nodeHash(prev[i], prev[i + 1]) : prev[i]);
    levels.push(next);
  }
  return levels;
}

export async function merkleRoot(copy: Uint8Array): Promise<string> {
  const levels = await merkleLevels(copy);
  return toHex(levels[levels.length - 1][0]);
}

/** Siblings of leaf `i`, bottom up; a level where the node is carried up (odd and last) contributes none. */
export function merklePath(levels: Uint8Array[][], i: number): string[] {
  const path: string[] = [];
  let idx = i;
  for (let l = 0; l < levels.length - 1; l++) {
    const width = levels[l].length;
    const carried = idx === width - 1 && width % 2 === 1;
    if (!carried) path.push(toHex(levels[l][idx ^ 1]));
    idx >>= 1;
  }
  return path;
}

/**
 * Whether `leaf` is leaf `i` of a copy with `leaves` leaves and root `root`: the path must have exactly the siblings
 * the shape (i, leaves) needs — one missing or one extra fails.
 */
export async function verifyLeaf(leaf: Uint8Array, i: number, leaves: number, path: string[], root: string): Promise<boolean> {
  if (!Number.isInteger(i) || i < 0 || i >= leaves) return false;
  let h = await leafHash(leaf);
  let idx = i;
  let width = leaves;
  let used = 0;
  while (width > 1) {
    const carried = idx === width - 1 && width % 2 === 1;
    if (!carried) {
      const hex = path[used++];
      if (typeof hex !== "string" || !/^[0-9a-f]{64}$/.test(hex)) return false;
      const sib = fromHex(hex);
      h = idx % 2 === 0 ? await nodeHash(h, sib) : await nodeHash(sib, h);
    }
    idx >>= 1;
    width = Math.ceil(width / 2);
  }
  return used === path.length && toHex(h) === root;
}

export function toHex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

export function fromHex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** The proof a node returns for `GET /proof?copy=…&i=…` (dep "storage"). */
export interface LeafProof {
  i: number;
  /** base64 */
  leaf: string;
  /** hex siblings, bottom up */
  path: string[];
}
