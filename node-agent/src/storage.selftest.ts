/**
 * Storage role selftest (docs/V4_STORAGE_PHASE1_CONTRACT.md): fetch → root check → keep → held; proofs from the local
 * server verify against the root; a wrong root, a refused download and a full quota fail; deletes; unsent reports retry.
 */
import os from "node:os";
import path from "node:path";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { StorageRole, storageQuotaGb, type CopyState, type StorageOp } from "./storage.ts";
import { LEAF_BYTES, merkleRoot, verifyLeaf } from "../../shared/storage-proof.ts";

// Throw (not exit) so the proof server is always closed in `finally`.
function check(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function bytes(n: number, seed: number): Uint8Array {
  const out = new Uint8Array(n);
  let x = seed * 2654435761;
  for (let i = 0; i < n; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
}

async function main() {
  const t0 = Date.now();
  const dir = mkdtempSync(path.join(os.tmpdir(), "cld-storage-"));
  const api = new Map<string, Uint8Array>();
  const reports: { id: string; state: CopyState }[][] = [];
  let apiUp = true;
  const role = new StorageRole({
    dir,
    quotaGb: 0.001, // ~1 MB
    download: async (copy) => (apiUp ? api.get(copy) ?? new Uint8Array() : null),
    report: async (copies) => {
      if (!apiUp) return false;
      reports.push(copies);
      return true;
    },
    log: () => undefined,
  });
  await role.start();
  try {
    const a = bytes(3 * LEAF_BYTES + 100, 1); // 4 leaves
    api.set(id(1), a);
    const rootA = await merkleRoot(a);
    const fetchA: StorageOp = { op: "fetch", copy: id(1), size: a.byteLength, leaves: 4, root: rootA };

    // Fetch, check the root, keep; reported held.
    await role.handle([fetchA]);
    check(existsSync(path.join(dir, `${id(1)}.bin`)), "copy not kept");
    check(JSON.stringify(reports.pop()) === JSON.stringify([{ id: id(1), state: "held" }]), "held not reported");

    // Proofs from the local server verify against the root, exactly the leaves asked for.
    const t = role.target();
    check(t && t.port > 0, "no proof server");
    const res = await fetch(`http://127.0.0.1:${t!.port}/proof?copy=${id(1)}&i=0,3`);
    check(res.status === 200, `proof status ${res.status}`);
    const { proofs } = (await res.json()) as { proofs: { i: number; leaf: string; path: string[] }[] };
    check(proofs.map((p) => p.i).join() === "0,3", "wrong leaves");
    for (const p of proofs) check(await verifyLeaf(new Uint8Array(Buffer.from(p.leaf, "base64")), p.i, 4, p.path, rootA), `leaf ${p.i} does not verify`);
    check((await fetch(`http://127.0.0.1:${t!.port}/proof?copy=${id(9)}&i=0`)).status === 404, "unknown copy served");
    check((await fetch(`http://127.0.0.1:${t!.port}/proof?copy=${id(1)}&i=4`)).status === 400, "out-of-range leaf served");
    check((await fetch(`http://127.0.0.1:${t!.port}/proof?copy=../x&i=0`)).status === 404, "bad copy id accepted");

    // A copy that doesn't match its root, a refused download, or one past the quota: failed, nothing kept.
    const b = bytes(1000, 2);
    api.set(id(2), b);
    await role.handle([{ op: "fetch", copy: id(2), size: b.byteLength, leaves: 1, root: "00".repeat(32) }]);
    await role.handle([{ op: "fetch", copy: id(3), size: 500, leaves: 1, root: "11".repeat(32) }]); // API refuses: empty body
    const big = bytes(900_000, 3); // + the ~197 KB held > ~1.07 MB
    api.set(id(4), big);
    await role.handle([{ op: "fetch", copy: id(4), size: big.byteLength, leaves: 13, root: await merkleRoot(big) }]);
    check(JSON.stringify(reports.splice(0)) === JSON.stringify([[{ id: id(2), state: "failed" }], [{ id: id(3), state: "failed" }], [{ id: id(4), state: "failed" }]]), "failures not reported");
    for (const n of [2, 3, 4]) check(!existsSync(path.join(dir, `${id(n)}.bin`)), `copy ${n} kept`);

    // API down: nothing lost — the outcome goes out with the next batch. Deletes remove the file.
    apiUp = false;
    await role.handle([{ op: "delete", copy: id(1) }]);
    check(!existsSync(path.join(dir, `${id(1)}.bin`)), "delete did not remove the copy");
    apiUp = true;
    await role.handle([]);
    check(JSON.stringify(reports.pop()) === JSON.stringify([{ id: id(1), state: "deleted" }]), "unsent report not retried");

    check(storageQuotaGb({ CLOUDANA_STORAGE_GB: "25" }) === 25 && storageQuotaGb({}) === 0 && storageQuotaGb({ CLOUDANA_STORAGE_GB: "-1" }) === 0, "quota parsing");
    console.log(`✓ storage selftest passed (${Date.now() - t0} ms)`);
  } finally {
    role.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`✗ storage selftest failed: ${(err as Error).message}`);
  process.exitCode = 1;
});
