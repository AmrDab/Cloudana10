/**
 * Storage phase 1 (docs/V4_STORAGE_PHASE1_CONTRACT.md §B): providers hold encrypted copies of Cloudana's job
 * artifacts while R2 stays the durable copy. Placement, heartbeat instructions, downloads, reports, checks, audits and
 * expiry live here; the cron runs runStorageCron(), the heartbeat asks storageInstructions().
 */
import { getD1 } from "../lib/storage.js";
import { getEnv, resetEnv } from "../config/env.js";
import { getRelay } from "../lib/relay.js";
import { getArtifactStore } from "../lib/artifacts.js";
import { readCapped } from "../lib/read-capped.js";
import { agentVersionAllowed, compareVersions, instructionSignerAddress } from "./instruction-signing.service.js";
import {
  GCM_TAG_BYTES, LEAF_BYTES, LEAF_PLAIN_BYTES, cipherSize, fromHex, leafCount, leafRange, merkleRoot, toHex, verifyLeaf, type LeafProof,
} from "../../../../shared/storage-proof.js";

export const STORAGE_CAPABILITY = "storage";
/** The first agent that holds copies and answers proofs. */
export const STORAGE_MIN_AGENT = "1.4.0";
/** Larger artifacts are not placed on providers (R2 only). */
export const MAX_OBJECT_BYTES = 4 * 1024 * 1024;

const MB = 1024 * 1024;
const GB = 1024 * MB;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const MAX_PENDING_PER_NODE = 8;
const FETCHES_PER_COPY = 3;
const FETCH_OPS_PER_BEAT = 4;
const DELETE_OPS_PER_BEAT = 50;
const PENDING_TTL_MS = HOUR_MS;
const BACKOFF_MS = HOUR_MS;
const OFFLINE_MS = 48 * HOUR_MS;
/** Dropped copies of a node gone this long are forgotten (it will never ask to delete them). */
const FORGET_MS = 30 * DAY_MS;
const NO_NODE_RETRY_MS = 10 * 60_000;
const CHECK_INTERVAL_MS = 72 * 60_000;
const CHECK_TIMEOUT_MS = 15_000;
const INCONCLUSIVE_RETRY_MS = 60_000;
const PROOF_MAX_BYTES = 512 * 1024;
const COOLDOWNS_MS = [24 * HOUR_MS, 72 * HOUR_MS, 7 * DAY_MS];
const INCONCLUSIVE_MAX = 3;
const AUDIT_AGAIN_MS = 10 * 60_000;
const PLACE_SUCCESSES = 20;
const PLACE_ATTEMPTS = 50;
const CHECKS_PER_RUN = 20;
const AUDITS_PER_RUN = 20;
/** Concentration caps apply once this many nodes hold copies (below it a cap would block every placement). */
const CAP_FROM_HOLDERS = 4;
const DEV_KEK_SEED = "cloudana-dev-storage-kek-not-secret";

const utf8 = (s: string) => new TextEncoder().encode(s);

// ── Keys ─────────────────────────────────────────────────────────────────────
/** The key-encryption key: STORAGE_KEK (base64, 32 bytes), or a fixed development key in DEV_MODE; else null. */
async function masterKey(): Promise<Uint8Array | null> {
  const env = getEnv();
  const raw = env.STORAGE_KEK?.trim();
  if (raw) {
    try {
      const b = Uint8Array.from(atob(raw), (ch) => ch.charCodeAt(0));
      return b.length === 32 ? b : null;
    } catch {
      return null;
    }
  }
  return env.DEV_MODE ? new Uint8Array(await crypto.subtle.digest("SHA-256", utf8(DEV_KEK_SEED))) : null;
}

/** Copies are placed only when they can be encrypted and the node can verify its instructions. */
export async function storageEnabled(): Promise<boolean> {
  return !!instructionSignerAddress() && !!(await masterKey());
}

async function hkdf(ikm: Uint8Array, info: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: utf8(info) }, key, 256));
}

export interface CopyKeyRef {
  id: string;
  object_id: string;
  copy_idx: number;
  /** 8 bytes, hex */
  nonce: string;
}

async function copyKey(master: Uint8Array, c: CopyKeyRef, usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  const objectKey = await hkdf(master, `cloudana/object/${c.object_id}`);
  return crypto.subtle.importKey("raw", await hkdf(objectKey, `cloudana/copy/${c.copy_idx}`), "AES-GCM", false, [usage]);
}

function leafParams(c: CopyKeyRef, i: number, last: boolean): { name: "AES-GCM"; iv: Uint8Array; additionalData: Uint8Array } {
  const iv = new Uint8Array(12);
  iv.set(fromHex(c.nonce), 0);
  new DataView(iv.buffer).setUint32(8, i);
  const id = utf8(c.id);
  const aad = new Uint8Array(id.length + 1);
  aad.set(id);
  aad[id.length] = last ? 1 : 0;
  return { name: "AES-GCM", iv, additionalData: aad };
}

/** The copy's ciphertext: AES-256-GCM per 64 KiB leaf under the copy's own key (each leaf = ciphertext ‖ tag). */
export async function encryptCopy(plain: Uint8Array, c: CopyKeyRef, master: Uint8Array): Promise<Uint8Array> {
  const key = await copyKey(master, c, "encrypt");
  const n = leafCount(plain.byteLength);
  const out = new Uint8Array(cipherSize(plain.byteLength));
  for (let i = 0; i < n; i++) {
    const pt = plain.subarray(i * LEAF_PLAIN_BYTES, Math.min(plain.byteLength, (i + 1) * LEAF_PLAIN_BYTES));
    out.set(new Uint8Array(await crypto.subtle.encrypt(leafParams(c, i, i === n - 1), key, pt)), i * LEAF_BYTES);
  }
  return out;
}

/** The inverse of encryptCopy (phase 2 reads copies back; tests prove the round trip). */
export async function decryptCopy(ct: Uint8Array, c: CopyKeyRef, master: Uint8Array): Promise<Uint8Array> {
  const key = await copyKey(master, c, "decrypt");
  const n = Math.max(1, Math.ceil(ct.byteLength / LEAF_BYTES));
  const out = new Uint8Array(ct.byteLength - n * GCM_TAG_BYTES);
  for (let i = 0; i < n; i++) {
    const [a, b] = leafRange(i, ct.byteLength);
    out.set(new Uint8Array(await crypto.subtle.decrypt(leafParams(c, i, i === n - 1), key, ct.subarray(a, b))), i * LEAF_PLAIN_BYTES);
  }
  return out;
}

// ── Node identity ────────────────────────────────────────────────────────────
/** /24 of an IPv4 address or /48 of an IPv6 one; null when it isn't an IP. */
export function netPrefix(ip: string): string | null {
  const v4 = ip.replace(/^::ffff:/i, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v4)) return `${v4.split(".").slice(0, 3).join(".")}.0/24`;
  if (!ip.includes(":")) return null;
  const halves = ip.toLowerCase().split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const parts = [...head, ...Array<string>(fill).fill("0"), ...tail];
  if (parts.length !== 8 || !parts.every((p) => /^[0-9a-f]{1,4}$/.test(p))) return null;
  return `${parts.slice(0, 3).map((p) => parseInt(p, 16).toString(16)).join(":")}::/48`;
}

/** Records the node's network (/24 or /48) and ASN when known and changed (announce and heartbeat). */
export async function recordNodeNetwork(node: string, ip: string, asn: number | undefined, current?: { net_prefix?: string | null; asn?: number | null }): Promise<void> {
  const prefix = netPrefix(ip);
  const a = typeof asn === "number" && Number.isInteger(asn) ? asn : null;
  if (prefix === null && a === null) return;
  if (current && (prefix ?? current.net_prefix ?? null) === (current.net_prefix ?? null) && (a ?? current.asn ?? null) === (current.asn ?? null)) return;
  await getD1()
    .prepare("UPDATE nodes SET net_prefix = COALESCE(?, net_prefix), asn = COALESCE(?, asn) WHERE address = ?")
    .bind(prefix, a, node)
    .run();
}

/** Whether a node may hold copies: agent ≥ STORAGE_MIN_AGENT, a quota, and the relay (checks go through it). */
export function storageCapable(agentVersion: string | null | undefined, storageGb: number | undefined, relay: boolean): boolean {
  return relay && !!storageGb && storageGb > 0 && !!agentVersion && compareVersions(agentVersion, STORAGE_MIN_AGENT) >= 0;
}

// ── Objects ──────────────────────────────────────────────────────────────────
/** Registers an artifact for provider copies (idempotent); objects over MAX_OBJECT_BYTES stay R2-only. */
export async function registerObject(id: string, size: number, now = Date.now()): Promise<void> {
  if (size > MAX_OBJECT_BYTES) return;
  await getD1()
    .prepare("INSERT OR IGNORE INTO storage_objects (id, size, leaves, created_at, next_attempt_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, size, leafCount(size), now, now)
    .run();
}

// ── Placement ────────────────────────────────────────────────────────────────
interface StorageNode {
  address: string;
  work_types: string | null;
  agent_version: string | null;
  storage_quota_mb: number;
  net_prefix: string | null;
  asn: number | null;
  storage_passed_days: number;
  used: number;
  pending: number;
}

interface LiveCopy {
  copy_idx: number;
  node: string;
  net_prefix: string | null;
  asn: number | null;
}

/** Bytes a node may hold: its declared quota, grown into one GB per day of passed checks. */
const effectiveQuota = (n: StorageNode) => Math.min(n.storage_quota_mb * MB, GB * (1 + n.storage_passed_days));
const sameNetwork = (a: { net_prefix: string | null; asn: number | null }, b: { net_prefix: string | null; asn: number | null }) =>
  (a.net_prefix !== null && a.net_prefix === b.net_prefix) || (a.asn !== null && a.asn === b.asn);

async function storageNodes(now: number): Promise<StorageNode[]> {
  const env = getEnv();
  const rows =
    (
      await getD1()
        .prepare(
          "SELECT n.address, n.work_types, n.agent_version, n.storage_quota_mb, n.net_prefix, n.asn, n.storage_passed_days, " +
            "COALESCE((SELECT SUM(o.size + o.leaves * ?) FROM storage_copies c JOIN storage_objects o ON o.id = c.object_id " +
            "WHERE c.node = n.address AND c.state <> 'dropping'), 0) AS used, " +
            "(SELECT COUNT(*) FROM storage_copies c WHERE c.node = n.address AND c.state = 'pending') AS pending " +
            "FROM nodes n WHERE n.storage_quota_mb > 0 AND n.payout IS NOT NULL AND n.state = 'active' AND n.relay_at >= ? AND n.last_seen >= ? " +
            "AND COALESCE(n.storage_cooldown_until, 0) <= ? AND COALESCE(n.storage_backoff_until, 0) <= ?",
        )
        .bind(GCM_TAG_BYTES, now - env.RELAY_FRESH_SECONDS * 1000, now - env.NODE_ACTIVE_SECONDS * 1000, now, now)
        .all<StorageNode>()
    ).results ?? [];
  return rows.filter(
    (n) =>
      (JSON.parse(n.work_types ?? "[]") as string[]).includes(STORAGE_CAPABILITY) &&
      !!n.agent_version &&
      compareVersions(n.agent_version, STORAGE_MIN_AGENT) >= 0 &&
      agentVersionAllowed(n.agent_version) &&
      (env.DEV_MODE || (n.net_prefix !== null && n.asn !== null)),
  );
}

/** Live copies per ASN and per /24-/48 across the network, for the 50 % caps. */
async function concentration(): Promise<{ total: number; holders: number; asn: Map<number, number>; prefix: Map<string, number> }> {
  const rows =
    (
      await getD1()
        .prepare(
          "SELECT n.asn, n.net_prefix, COUNT(*) AS c, COUNT(DISTINCT c.node) AS h FROM storage_copies c JOIN nodes n ON n.address = c.node " +
            "WHERE c.state <> 'dropping' GROUP BY n.asn, n.net_prefix",
        )
        .all<{ asn: number | null; net_prefix: string | null; c: number; h: number }>()
    ).results ?? [];
  const out = { total: 0, holders: 0, asn: new Map<number, number>(), prefix: new Map<string, number>() };
  for (const r of rows) {
    out.total += r.c;
    out.holders += r.h;
    if (r.asn !== null) out.asn.set(r.asn, (out.asn.get(r.asn) ?? 0) + r.c);
    if (r.net_prefix !== null) out.prefix.set(r.net_prefix, (out.prefix.get(r.net_prefix) ?? 0) + r.c);
  }
  return out;
}

/** Places missing copies (≤ PLACE_SUCCESSES successes and PLACE_ATTEMPTS tries a run), one object at a time. */
export async function placeCopies(now: number, master: Uint8Array): Promise<number> {
  const env = getEnv();
  const store = getArtifactStore();
  if (!store) return 0;
  const db = getD1();
  const nodes = await storageNodes(now);
  if (nodes.length === 0) return 0; // nobody can take a copy: leave the queue as it is
  const objects =
    (
      await db
        .prepare(
          "SELECT id, size, leaves FROM storage_objects WHERE next_attempt_at IS NOT NULL AND next_attempt_at <= ? AND created_at >= ? " +
            "ORDER BY next_attempt_at LIMIT ?",
        )
        .bind(now, now - env.STORAGE_RETENTION_DAYS * DAY_MS, PLACE_ATTEMPTS)
        .all<{ id: string; size: number; leaves: number }>()
    ).results ?? [];
  if (objects.length === 0) return 0;
  const share = await concentration();
  let placed = 0;
  let attempts = 0;
  for (const obj of objects) {
    if (placed >= PLACE_SUCCESSES || attempts >= PLACE_ATTEMPTS) break;
    const live =
      (
        await db
          .prepare(
            "SELECT c.copy_idx, c.node, n.net_prefix, n.asn FROM storage_copies c LEFT JOIN nodes n ON n.address = c.node " +
              "WHERE c.object_id = ? AND c.state <> 'dropping'",
          )
          .bind(obj.id)
          .all<LiveCopy>()
      ).results ?? [];
    const held = new Set(
      ((await db.prepare("SELECT node FROM storage_copies WHERE object_id = ?").bind(obj.id).all<{ node: string }>()).results ?? []).map((r) => r.node),
    );
    const bytes = cipherSize(obj.size);
    let plain: Uint8Array | null = null;
    let gone = false;
    while (live.length < env.STORAGE_COPIES && attempts < PLACE_ATTEMPTS) {
      attempts++;
      const capped = share.holders >= CAP_FROM_HOLDERS;
      const pick = nodes
        .filter(
          (n) =>
            !held.has(n.address) &&
            n.pending < MAX_PENDING_PER_NODE &&
            n.used + bytes <= effectiveQuota(n) &&
            !live.some((l) => sameNetwork(l, n)) &&
            (!capped ||
              ((n.asn === null || (share.asn.get(n.asn) ?? 0) + 1 <= (share.total + 1) / 2) &&
                (n.net_prefix === null || (share.prefix.get(n.net_prefix) ?? 0) + 1 <= (share.total + 1) / 2))),
        )
        .sort((a, b) => a.used / effectiveQuota(a) - b.used / effectiveQuota(b))[0];
      if (!pick) break;
      try {
        plain ??= await store.get(obj.id);
      } catch (err) {
        console.error(`[storage] reading ${obj.id} failed:`, err);
        break; // R2 hiccup: this object goes to the back of the queue, the rest of the run continues
      }
      if (!plain) {
        gone = true;
        break;
      }
      const used = new Set(live.map((l) => l.copy_idx));
      let idx = 0;
      while (used.has(idx)) idx++;
      const copy: CopyKeyRef = { id: crypto.randomUUID(), object_id: obj.id, copy_idx: idx, nonce: toHex(crypto.getRandomValues(new Uint8Array(8))) };
      const root = await merkleRoot(await encryptCopy(plain, copy, master));
      try {
        await db
          .prepare(
            "INSERT INTO storage_copies (id, object_id, copy_idx, node, nonce, root, state, fetches, assigned_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?)",
          )
          .bind(copy.id, obj.id, idx, pick.address, copy.nonce, root, now)
          .run();
      } catch {
        break; // another run placed this index first
      }
      live.push({ copy_idx: idx, node: pick.address, net_prefix: pick.net_prefix, asn: pick.asn });
      held.add(pick.address);
      pick.used += bytes;
      pick.pending++;
      share.total++;
      if (pick.asn !== null) share.asn.set(pick.asn, (share.asn.get(pick.asn) ?? 0) + 1);
      if (pick.net_prefix !== null) share.prefix.set(pick.net_prefix, (share.prefix.get(pick.net_prefix) ?? 0) + 1);
      placed++;
    }
    // Fully placed, or the artifact is gone (nothing to place): done. Otherwise try again later.
    const next = live.length >= env.STORAGE_COPIES || gone ? null : now + NO_NODE_RETRY_MS;
    await db.prepare("UPDATE storage_objects SET next_attempt_at = ? WHERE id = ?").bind(next, obj.id).run();
  }
  return placed;
}

// ── Instructions, downloads, reports ─────────────────────────────────────────
export type StorageOp = { op: "fetch"; copy: string; size: number; leaves: number; root: string } | { op: "delete"; copy: string };

/** The `storage` key of a node's signed heartbeat body, or null for a node without the storage capability. */
export async function storageInstructions(node: string, workTypes: string | null, allowFetch: boolean): Promise<StorageOp[] | null> {
  if (!(JSON.parse(workTypes ?? "[]") as string[]).includes(STORAGE_CAPABILITY)) return null;
  const db = getD1();
  const ops: StorageOp[] = [];
  if (allowFetch) {
    const pending =
      (
        await db
          .prepare(
            "SELECT c.id, c.root, o.size, o.leaves FROM storage_copies c JOIN storage_objects o ON o.id = c.object_id " +
              "WHERE c.node = ? AND c.state = 'pending' AND c.fetches < ? ORDER BY c.assigned_at LIMIT ?",
          )
          .bind(node, FETCHES_PER_COPY, FETCH_OPS_PER_BEAT)
          .all<{ id: string; root: string; size: number; leaves: number }>()
      ).results ?? [];
    for (const p of pending) ops.push({ op: "fetch", copy: p.id, size: cipherSize(p.size), leaves: p.leaves, root: p.root });
  }
  const drops =
    (await db.prepare("SELECT id FROM storage_copies WHERE node = ? AND state = 'dropping' LIMIT ?").bind(node, DELETE_OPS_PER_BEAT).all<{ id: string }>())
      .results ?? [];
  for (const d of drops) ops.push({ op: "delete", copy: d.id });
  return ops;
}

export type DownloadResult = { ok: true; body: Uint8Array; root: string } | { ok: false; code: "not_found" | "conflict" | "not_configured"; message: string };

/**
 * The assigned node downloads its copy, only while it is pending and at most FETCHES_PER_COPY times: a held copy can
 * never be fetched again, so a node can't fetch on demand to answer a check.
 */
export async function downloadCopy(node: string, id: string): Promise<DownloadResult> {
  const master = await masterKey();
  const store = getArtifactStore();
  if (!master || !store) return { ok: false, code: "not_configured", message: "storage is not configured" };
  const db = getD1();
  const claimed = await db
    .prepare("UPDATE storage_copies SET fetches = fetches + 1 WHERE id = ? AND node = ? AND state = 'pending' AND fetches < ?")
    .bind(id, node, FETCHES_PER_COPY)
    .run();
  if ((claimed.meta?.changes ?? 0) === 0) {
    const row = await db.prepare("SELECT 1 FROM storage_copies WHERE id = ? AND node = ?").bind(id, node).first();
    return row
      ? { ok: false, code: "conflict", message: "only a pending copy can be downloaded, at most 3 times" }
      : { ok: false, code: "not_found", message: "copy not found" };
  }
  const c = await db.prepare("SELECT id, object_id, copy_idx, nonce, root FROM storage_copies WHERE id = ?").bind(id).first<CopyKeyRef & { root: string }>();
  const plain = c ? await store.get(c.object_id) : null;
  if (!c || !plain) {
    await db.prepare("UPDATE storage_copies SET state = 'dropping' WHERE id = ?").bind(id).run();
    return { ok: false, code: "conflict", message: "the object is gone" };
  }
  return { ok: true, body: await encryptCopy(plain, c, master), root: c.root };
}

export interface CopyReport {
  id: string;
  state: "held" | "deleted" | "failed";
}

/** The node's reports: held (after a download; checked first), deleted (a dropping copy), failed (a pending one). */
export async function applyReports(node: string, reports: CopyReport[], now = Date.now()): Promise<number> {
  const db = getD1();
  let applied = 0;
  for (const r of reports) {
    if (r.state === "held") {
      const res = await db
        .prepare("UPDATE storage_copies SET state = 'held', held_at = ? WHERE id = ? AND node = ? AND state = 'pending' AND fetches >= 1")
        .bind(now, r.id, node)
        .run();
      if ((res.meta?.changes ?? 0) > 0) {
        applied++;
        await db.prepare("UPDATE nodes SET storage_next_check_at = ? WHERE address = ?").bind(now, node).run();
      }
    } else if (r.state === "deleted") {
      const res = await db.prepare("DELETE FROM storage_copies WHERE id = ? AND node = ? AND state = 'dropping'").bind(r.id, node).run();
      applied += res.meta?.changes ?? 0;
    } else {
      const row = await db.prepare("SELECT object_id FROM storage_copies WHERE id = ? AND node = ? AND state = 'pending'").bind(r.id, node).first<{ object_id: string }>();
      if (!row) continue;
      await db.batch([
        db.prepare("UPDATE storage_copies SET state = 'dropping' WHERE id = ? AND state = 'pending'").bind(r.id),
        db.prepare("UPDATE nodes SET storage_backoff_until = ? WHERE address = ?").bind(now + BACKOFF_MS, node),
        db.prepare("UPDATE storage_objects SET next_attempt_at = ? WHERE id = ?").bind(now, row.object_id),
      ]);
      applied++;
    }
  }
  return applied;
}

// ── Checks ───────────────────────────────────────────────────────────────────
interface CheckedCopy {
  id: string;
  object_id: string;
  root: string;
  size: number;
  leaves: number;
}

type SampleResult = "pass" | "fail" | "inconclusive";

function pickLeaves(leaves: number, count: number): number[] {
  const all = Array.from({ length: leaves }, (_, i) => i);
  for (let i = all.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, Math.min(count, leaves)).sort((a, b) => a - b);
}

/** Exactly the requested leaves, each the expected length, each path the shape (i, leaves) needs, to the root. */
async function proofsValid(proofs: unknown, idx: number[], c: CheckedCopy): Promise<boolean> {
  if (!Array.isArray(proofs) || proofs.length !== idx.length) return false;
  const size = cipherSize(c.size);
  for (let k = 0; k < idx.length; k++) {
    const p = proofs[k] as Partial<LeafProof>;
    if (!p || p.i !== idx[k] || typeof p.leaf !== "string" || !Array.isArray(p.path)) return false;
    let leaf: Uint8Array;
    try {
      leaf = Uint8Array.from(atob(p.leaf), (ch) => ch.charCodeAt(0));
    } catch {
      return false;
    }
    const [a, b] = leafRange(idx[k], size);
    if (leaf.byteLength !== b - a) return false;
    if (!(await verifyLeaf(leaf, idx[k], c.leaves, p.path as string[], c.root))) return false;
  }
  return true;
}

/**
 * One sample through the relay (class storage, a probe: reserved slots). Only the relay call itself throwing is
 * inconclusive; once the node has answered, anything but valid proofs fails (as with hosting probes).
 */
async function sample(node: string, c: CheckedCopy, count: number): Promise<SampleResult> {
  const relay = getRelay();
  if (!relay) return "inconclusive";
  const idx = pickLeaves(c.leaves, count);
  let res: Response;
  try {
    res = await relay(node, "/proxy", {
      method: "GET",
      headers: {
        "x-relay-dep": "storage",
        "x-relay-class": "storage",
        "x-relay-path": `/proof?copy=${c.id}&i=${idx.join(",")}`,
        "x-relay-probe": "1",
      },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
  } catch (err) {
    return (err as Error)?.name === "TimeoutError" ? "fail" : "inconclusive";
  }
  try {
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => undefined);
      return "fail";
    }
    const body = await readCapped(res, PROOF_MAX_BYTES);
    if (!body) return "fail";
    const parsed = JSON.parse(new TextDecoder().decode(body)) as { proofs?: unknown };
    return (await proofsValid(parsed.proofs, idx, c)) ? "pass" : "fail";
  } catch {
    return "fail";
  }
}

interface DueNode {
  address: string;
  storage_inconclusive: number;
  storage_strikes: number;
  storage_open_day: number | null;
}

/** One sample on the node-day; a node-day with samples and no confirmed failure counts as passed when the next opens. */
async function recordSample(n: DueNode, now: number, miss: boolean, failure: boolean): Promise<void> {
  const db = getD1();
  const day = Math.floor(now / DAY_MS);
  if (n.storage_open_day !== day) {
    const prev = n.storage_open_day === null
      ? null
      : await db
          .prepare("SELECT samples, misses, failures FROM storage_checks WHERE node = ? AND day = ?")
          .bind(n.address, n.storage_open_day)
          .first<{ samples: number; misses: number; failures: number }>();
    // A passed day: no confirmed failure, at least one conclusive pass, and misses (flakes, unanswered re-challenges)
    // on at most half the samples — a node can't earn quota on answers it never gave.
    const passed = prev && prev.failures === 0 && prev.samples - prev.misses >= 1 && prev.misses * 2 <= prev.samples ? 1 : 0;
    await db
      .prepare("UPDATE nodes SET storage_open_day = ?, storage_passed_days = storage_passed_days + ? WHERE address = ?")
      .bind(day, passed, n.address)
      .run();
    n.storage_open_day = day;
  }
  await db
    .prepare(
      "INSERT INTO storage_checks (node, day, samples, misses, failures) VALUES (?, ?, 1, ?, ?) " +
        "ON CONFLICT(node, day) DO UPDATE SET samples = samples + 1, misses = misses + excluded.misses, failures = failures + excluded.failures",
    )
    .bind(n.address, day, miss ? 1 : 0, failure ? 1 : 0)
    .run();
}

async function confirmFailure(n: DueNode, c: CheckedCopy, now: number): Promise<void> {
  const db = getD1();
  const cooldown = COOLDOWNS_MS[Math.min(n.storage_strikes, COOLDOWNS_MS.length - 1)];
  await db.batch([
    db.prepare("UPDATE storage_copies SET state = 'dropping' WHERE id = ? AND state IN ('held','suspect')").bind(c.id),
    db.prepare("UPDATE storage_copies SET state = 'suspect', checked_at = NULL WHERE node = ? AND state = 'held'").bind(n.address),
    db.prepare("UPDATE nodes SET storage_strikes = storage_strikes + 1, storage_cooldown_until = ? WHERE address = ?").bind(now + cooldown, n.address),
    db.prepare("UPDATE storage_objects SET next_attempt_at = ? WHERE id = ?").bind(now, c.object_id),
  ]);
  await recordSample(n, now, true, true);
}

/** Checks one claimed node: a held copy (unchecked ones first), re-challenged once before a failure counts. */
async function checkNode(n: DueNode, now: number): Promise<void> {
  const db = getD1();
  const c = await db
    .prepare(
      "SELECT c.id, c.object_id, c.root, o.size, o.leaves FROM storage_copies c JOIN storage_objects o ON o.id = c.object_id " +
        "WHERE c.node = ? AND c.state = 'held' ORDER BY (c.checked_at IS NULL) DESC, RANDOM() LIMIT 1",
    )
    .bind(n.address)
    .first<CheckedCopy>();
  if (!c) {
    await db
      .prepare(
        "UPDATE nodes SET storage_next_check_at = NULL WHERE address = ? " +
          "AND NOT EXISTS (SELECT 1 FROM storage_copies WHERE node = ? AND state IN ('pending','held','suspect'))",
      )
      .bind(n.address, n.address)
      .run();
    return;
  }
  let r = await sample(n.address, c, 3);
  if (r === "inconclusive") {
    if (n.storage_inconclusive + 1 < INCONCLUSIVE_MAX) {
      await db
        .prepare("UPDATE nodes SET storage_inconclusive = storage_inconclusive + 1, storage_next_check_at = ? WHERE address = ?")
        .bind(now + INCONCLUSIVE_RETRY_MS, n.address)
        .run();
      return;
    }
    r = "fail";
  }
  if (n.storage_inconclusive > 0) await db.prepare("UPDATE nodes SET storage_inconclusive = 0 WHERE address = ?").bind(n.address).run();
  await db.prepare("UPDATE storage_copies SET checked_at = ? WHERE id = ?").bind(now, c.id).run();
  if (r === "pass") return recordSample(n, now, false, false);
  // A miss: challenge again with fresh leaves before acting, so one flake never drops data or cools a node down.
  const again = await sample(n.address, c, 3);
  if (again === "pass") return recordSample(n, now, true, false);
  if (again === "inconclusive") {
    await recordSample(n, now, true, false);
    await db.prepare("UPDATE nodes SET storage_next_check_at = ? WHERE address = ?").bind(now + INCONCLUSIVE_RETRY_MS, n.address).run();
    return;
  }
  await confirmFailure(n, c, now);
}

/** Claims and checks due nodes (one sample each, in parallel); returns the addresses checked. */
export async function runChecks(now: number): Promise<Set<string>> {
  const db = getD1();
  const fresh = now - getEnv().RELAY_FRESH_SECONDS * 1000;
  const due =
    (
      await db
        .prepare(
          "SELECT address, storage_inconclusive, storage_strikes, storage_open_day FROM nodes " +
            "WHERE storage_next_check_at IS NOT NULL AND storage_next_check_at <= ? AND relay_at >= ? ORDER BY storage_next_check_at LIMIT ?",
        )
        .bind(now, fresh, CHECKS_PER_RUN)
        .all<DueNode>()
    ).results ?? [];
  const claimed: DueNode[] = [];
  for (const n of due) {
    const next = now + Math.floor((0.5 + Math.random()) * CHECK_INTERVAL_MS);
    const r = await db
      .prepare("UPDATE nodes SET storage_next_check_at = ? WHERE address = ? AND storage_next_check_at <= ?")
      .bind(next, n.address, now)
      .run();
    if ((r.meta?.changes ?? 0) > 0) claimed.push(n);
  }
  await Promise.all(claimed.map((n) => checkNode(n, now).catch((err) => console.error(`[storage] check ${n.address} failed:`, err))));
  return new Set(claimed.map((n) => n.address));
}

/** Audits suspect copies (one leaf each, one per node, skipping nodes just checked): pass → held, fail → dropping. */
export async function auditSuspects(now: number, skip: Set<string>): Promise<void> {
  const db = getD1();
  const fresh = now - getEnv().RELAY_FRESH_SECONDS * 1000;
  // One candidate per node (oldest audit first), so a node with a large backlog can't crowd out the others.
  const rows =
    (
      await db
        .prepare(
          "SELECT id, node, object_id, root, size, leaves FROM (SELECT c.id, c.node, c.object_id, c.root, o.size, o.leaves, " +
            "ROW_NUMBER() OVER (PARTITION BY c.node ORDER BY c.checked_at) AS rn FROM storage_copies c " +
            "JOIN storage_objects o ON o.id = c.object_id JOIN nodes n ON n.address = c.node " +
            "WHERE c.state = 'suspect' AND (c.checked_at IS NULL OR c.checked_at < ?) AND n.relay_at >= ?) WHERE rn = 1 LIMIT ?",
        )
        .bind(now - AUDIT_AGAIN_MS, fresh, AUDITS_PER_RUN + skip.size)
        .all<CheckedCopy & { node: string }>()
    ).results ?? [];
  const picked: (CheckedCopy & { node: string })[] = [];
  const nodes = new Set(skip);
  for (const r of rows) {
    if (picked.length >= AUDITS_PER_RUN || nodes.has(r.node)) continue;
    const claim = await db
      .prepare("UPDATE storage_copies SET checked_at = ? WHERE id = ? AND state = 'suspect' AND (checked_at IS NULL OR checked_at < ?)")
      .bind(now, r.id, now - AUDIT_AGAIN_MS)
      .run();
    if ((claim.meta?.changes ?? 0) === 0) continue;
    nodes.add(r.node);
    picked.push(r);
  }
  await Promise.all(
    picked.map(async (c) => {
      const r = await sample(c.node, c, 1);
      if (r === "pass") {
        await db.batch([
          db.prepare("UPDATE storage_copies SET state = 'held' WHERE id = ? AND state = 'suspect'").bind(c.id),
          db.prepare("UPDATE nodes SET storage_next_check_at = COALESCE(storage_next_check_at, ?) WHERE address = ?").bind(now, c.node),
        ]);
      }
      else if (r === "fail") {
        await db.batch([
          db.prepare("UPDATE storage_copies SET state = 'dropping' WHERE id = ? AND state = 'suspect'").bind(c.id),
          db.prepare("UPDATE storage_objects SET next_attempt_at = ? WHERE id = ?").bind(now, c.object_id),
        ]);
      }
    }),
  );
}

// ── Expiry ───────────────────────────────────────────────────────────────────
/** Stale pendings (node backs off), nodes offline OFFLINE_MS, retention, and forgetting long-gone nodes' drops. */
export async function expireCopies(now: number): Promise<void> {
  const db = getD1();
  const stale =
    (
      await db
        .prepare("SELECT id, node, object_id FROM storage_copies WHERE state = 'pending' AND assigned_at < ? LIMIT 100")
        .bind(now - PENDING_TTL_MS)
        .all<{ id: string; node: string; object_id: string }>()
    ).results ?? [];
  for (const s of stale) {
    await db.batch([
      db.prepare("UPDATE storage_copies SET state = 'dropping' WHERE id = ? AND state = 'pending'").bind(s.id),
      db.prepare("UPDATE nodes SET storage_backoff_until = ? WHERE address = ?").bind(now + BACKOFF_MS, s.node),
      db.prepare("UPDATE storage_objects SET next_attempt_at = ? WHERE id = ?").bind(now, s.object_id),
    ]);
  }
  // Offline: no heartbeat, or no relay socket (copies are only checked through it), for OFFLINE_MS.
  const offline = "SELECT address FROM nodes WHERE COALESCE(MIN(last_seen, relay_at), 0) < ?";
  const retained = now - getEnv().STORAGE_RETENTION_DAYS * DAY_MS;
  await db.batch([
    db
      .prepare(
        `UPDATE storage_objects SET next_attempt_at = ? WHERE created_at >= ? AND id IN (SELECT object_id FROM storage_copies ` +
          `WHERE state <> 'dropping' AND node IN (${offline}))`,
      )
      .bind(now, retained, now - OFFLINE_MS),
    db.prepare(`UPDATE storage_copies SET state = 'dropping' WHERE state <> 'dropping' AND node IN (${offline})`).bind(now - OFFLINE_MS),
    db
      .prepare("UPDATE storage_copies SET state = 'dropping' WHERE state <> 'dropping' AND object_id IN (SELECT id FROM storage_objects WHERE created_at < ?)")
      .bind(retained),
    db.prepare("UPDATE storage_objects SET next_attempt_at = NULL WHERE created_at < ? AND next_attempt_at IS NOT NULL").bind(retained),
    db.prepare(`DELETE FROM storage_copies WHERE state = 'dropping' AND node IN (${offline})`).bind(now - FORGET_MS),
    db
      .prepare("DELETE FROM storage_objects WHERE created_at < ? AND NOT EXISTS (SELECT 1 FROM storage_copies c WHERE c.object_id = storage_objects.id)")
      .bind(retained),
  ]);
}

/**
 * Cron: expiry, placement, checks, audits — only when copies can be encrypted and instructions signed. Each phase
 * runs on its own: one failing never blocks the others. `env` bridges the Worker's string bindings (secrets) on a
 * cold isolate, like the other cron jobs.
 */
export async function runStorageCron(env?: Record<string, unknown>, now = Date.now()): Promise<void> {
  if (env) {
    let changed = false;
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === "string" && process.env[key] !== value) {
        process.env[key] = value;
        changed = true;
      }
    }
    if (changed) resetEnv();
  }
  const master = await masterKey();
  if (!master || !instructionSignerAddress()) return;
  const phase = async <T>(name: string, run: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await run();
    } catch (err) {
      console.error(`[storage] ${name} failed:`, err);
      return fallback;
    }
  };
  await phase("expire", () => expireCopies(now), undefined);
  await phase("place", () => placeCopies(now, master), 0);
  const checked = await phase("checks", () => runChecks(now), new Set<string>());
  await phase("audits", () => auditSuspects(now, checked), undefined);
}
