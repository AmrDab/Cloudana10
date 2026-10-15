/**
 * Storage role (docs/V4_STORAGE_PHASE1_CONTRACT.md §B, agent 1.4.0): holds encrypted copies the API tells it to fetch
 * (signed heartbeat `storage` ops), deletes the ones it drops, and answers checks — the relay delivers them as
 * requests for dep "storage", which the relay client forwards to the local proof server here.
 *
 * The node never sees plaintext: a copy is ciphertext checked against its Merkle root before it is kept.
 */
import http from "node:http";
import path from "node:path";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { leafRange, merkleLevels, merklePath, merkleRoot, type LeafProof } from "../../shared/storage-proof.ts";

export const STORAGE_CAPABILITY = "storage";

export type StorageOp = { op: "fetch"; copy: string; size: number; leaves: number; root: string } | { op: "delete"; copy: string };
export type CopyState = "held" | "deleted" | "failed";

export interface StorageOptions {
  dir: string;
  quotaGb: number;
  /** Signed GET of the copy's ciphertext from the API (null: unreachable or refused). */
  download: (copy: string) => Promise<Uint8Array | null>;
  /** Signed POST of the outcome (true: delivered). */
  report: (copies: { id: string; state: CopyState }[]) => Promise<boolean>;
  log: (msg: string) => void;
}

const COPY_ID = /^[0-9a-f-]{36}$/;
const MAX_LEAVES_PER_PROOF = 16;

export class StorageRole {
  private server: http.Server | null = null;
  private port = 0;
  private busy = false;
  /** Outcomes not yet delivered (the API was unreachable): sent with the next batch. */
  private unsent: { id: string; state: CopyState }[] = [];

  constructor(private o: StorageOptions) {
    if (!existsSync(o.dir)) mkdirSync(o.dir, { recursive: true });
  }

  /** The local proof server the relay client forwards dep "storage" to (loopback only). */
  async start(): Promise<void> {
    this.server = http.createServer((req, res) => void this.serve(req, res));
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    this.port = (this.server.address() as { port: number }).port;
  }

  stop(): void {
    this.server?.close();
  }

  target(): { port: number; kind: "static" } | null {
    return this.port ? { port: this.port, kind: "static" } : null;
  }

  private file(copy: string): string {
    return path.join(this.o.dir, `${copy}.bin`);
  }

  /** Bytes held on disk (copies only; temp files are cleaned on start). */
  used(): number {
    let total = 0;
    for (const f of readdirSync(this.o.dir)) {
      if (f.endsWith(".tmp")) rmSync(path.join(this.o.dir, f), { force: true });
      else if (f.endsWith(".bin")) total += statSync(path.join(this.o.dir, f)).size;
    }
    return total;
  }

  /** Deletes first, then fetches one at a time; outcomes go back in one report. Overlapping calls are skipped. */
  async handle(ops: StorageOp[]): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const out = this.unsent.splice(0);
      for (const op of ops) {
        if (op.op !== "delete" || !COPY_ID.test(op.copy)) continue;
        rmSync(this.file(op.copy), { force: true });
        out.push({ id: op.copy, state: "deleted" });
      }
      let used = this.used();
      for (const op of ops) {
        if (op.op !== "fetch" || !COPY_ID.test(op.copy)) continue;
        if (existsSync(this.file(op.copy))) {
          out.push({ id: op.copy, state: "held" });
          continue;
        }
        if (used + op.size > this.o.quotaGb * 1024 ** 3) {
          this.o.log(`storage: copy ${op.copy} would pass the ${this.o.quotaGb} GB quota — refused`);
          out.push({ id: op.copy, state: "failed" });
          continue;
        }
        const state = await this.fetchCopy(op);
        if (state === "held") used += op.size;
        if (state) out.push({ id: op.copy, state });
      }
      if (out.length && !(await this.o.report(out))) this.unsent = out;
    } finally {
      this.busy = false;
    }
  }

  /** Download, check size and root, then keep (temp file renamed). null: the API was unreachable, try next time. */
  private async fetchCopy(op: Extract<StorageOp, { op: "fetch" }>): Promise<CopyState | null> {
    const ct = await this.o.download(op.copy);
    if (!ct) return null;
    if (ct.byteLength !== op.size || (await merkleRoot(ct)) !== op.root) {
      this.o.log(`storage: copy ${op.copy} did not match its root — refused`);
      return "failed";
    }
    const tmp = `${this.file(op.copy)}.tmp`;
    writeFileSync(tmp, ct);
    renameSync(tmp, this.file(op.copy));
    return "held";
  }

  /** GET /proof?copy=<id>&i=<a>,<b>,… → { proofs: [{ i, leaf (base64), path (hex[]) }] }. */
  private async serve(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    try {
      const u = new URL(req.url ?? "/", "http://storage");
      const copy = u.searchParams.get("copy") ?? "";
      const idx = (u.searchParams.get("i") ?? "").split(",").map(Number);
      if (req.method !== "GET" || u.pathname !== "/proof" || !COPY_ID.test(copy)) return send(404, { error: "not found" });
      if (idx.length === 0 || idx.length > MAX_LEAVES_PER_PROOF || !idx.every((i) => Number.isInteger(i) && i >= 0)) return send(400, { error: "bad leaves" });
      const f = this.file(copy);
      if (!existsSync(f)) return send(404, { error: "not held" });
      const ct = new Uint8Array(readFileSync(f));
      const levels = await merkleLevels(ct);
      if (idx.some((i) => i >= levels[0].length)) return send(400, { error: "bad leaves" });
      const proofs: LeafProof[] = idx.map((i) => ({
        i,
        leaf: Buffer.from(ct.subarray(...leafRange(i, ct.byteLength))).toString("base64"),
        path: merklePath(levels, i),
      }));
      send(200, { proofs });
    } catch (err) {
      send(500, { error: (err as Error).message });
    }
  }
}

/** CLOUDANA_STORAGE_GB > 0 turns the role on (a number of GB); anything else leaves it off. */
export function storageQuotaGb(env = process.env): number {
  const n = Number(env.CLOUDANA_STORAGE_GB ?? "");
  return Number.isFinite(n) && n > 0 ? n : 0;
}
