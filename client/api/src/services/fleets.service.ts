/**
 * Datacenter fleets: one token onboards many nodes to an owner's payout wallet.
 *
 * The token ("cft_" + 32 hex) is returned once at creation; only its sha256 is
 * stored. A node announcing with a live token is bound to the fleet owner at
 * once (no bind code). Revoking a fleet stops new announces with its token;
 * nodes already bound stay bound.
 *
 * floor_ucld_per_mmac is stored for the owner only — placement does not read it yet.
 */
import { getD1 } from "../lib/storage.js";
import { normalizeAddress } from "../lib/eth.js";
import { getEnv } from "../config/env.js";
import { sha256 } from "./jobs.service.js";

export const MAX_ACTIVE_FLEETS = 10;

export interface FleetRow {
  id: string;
  owner: string;
  name: string | null;
  token_hash: string;
  floor_ucld_per_mmac: number | null;
  created_at: number;
  revoked_at: number | null;
}

export interface FleetSummary {
  id: string;
  name: string | null;
  floorUcldPerMmac: number | null;
  createdAt: number;
  revokedAt: number | null;
  nodes: number;
  nodesOnline: number;
  jobsDone: number;
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}

export type CreateFleetResult =
  | { ok: true; id: string; token: string }
  | { ok: false; code: "conflict"; message: string };

export async function createFleet(owner: string, name: string | null, floorUcldPerMmac: number | null): Promise<CreateFleetResult> {
  const key = normalizeAddress(owner);
  const db = getD1();
  const active = await db
    .prepare("SELECT COUNT(*) AS n FROM fleets WHERE owner = ? AND revoked_at IS NULL")
    .bind(key)
    .first<{ n: number }>();
  if ((active?.n ?? 0) >= MAX_ACTIVE_FLEETS) {
    return { ok: false, code: "conflict", message: `at most ${MAX_ACTIVE_FLEETS} active fleets — revoke one first` };
  }
  const id = `flt_${randomHex(8)}`;
  const token = `cft_${randomHex(16)}`;
  await db
    .prepare("INSERT INTO fleets (id, owner, name, token_hash, floor_ucld_per_mmac, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, key, name, sha256(token), floorUcldPerMmac, Date.now())
    .run();
  return { ok: true, id, token };
}

export async function listFleets(owner: string): Promise<FleetSummary[]> {
  const rows = await getD1()
    .prepare(
      "SELECT f.id, f.name, f.floor_ucld_per_mmac, f.created_at, f.revoked_at, " +
        "COUNT(n.address) AS nodes, " +
        "COALESCE(SUM(CASE WHEN n.last_seen >= ? THEN 1 ELSE 0 END), 0) AS online, " +
        "COALESCE(SUM(n.jobs_done), 0) AS jobs_done " +
        "FROM fleets f LEFT JOIN nodes n ON n.fleet_id = f.id " +
        "WHERE f.owner = ? GROUP BY f.id ORDER BY f.created_at",
    )
    .bind(Date.now() - getEnv().NODE_ACTIVE_SECONDS * 1000, normalizeAddress(owner))
    .all<FleetRow & { nodes: number; online: number; jobs_done: number }>();
  return (rows.results ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    floorUcldPerMmac: r.floor_ucld_per_mmac,
    createdAt: r.created_at,
    revokedAt: r.revoked_at,
    nodes: r.nodes,
    nodesOnline: r.online,
    jobsDone: r.jobs_done,
  }));
}

async function ownedFleet(owner: string, id: string): Promise<FleetRow | null> {
  return getD1().prepare("SELECT * FROM fleets WHERE id = ? AND owner = ?").bind(id, normalizeAddress(owner)).first<FleetRow>();
}

/** Update name / floor. Another owner's fleet is reported as not found. */
export async function updateFleet(
  owner: string,
  id: string,
  patch: { name?: string | null; floorUcldPerMmac?: number | null },
): Promise<boolean> {
  const row = await ownedFleet(owner, id);
  if (!row) return false;
  const name = patch.name !== undefined ? patch.name : row.name;
  const floor = patch.floorUcldPerMmac !== undefined ? patch.floorUcldPerMmac : row.floor_ucld_per_mmac;
  await getD1().prepare("UPDATE fleets SET name = ?, floor_ucld_per_mmac = ? WHERE id = ?").bind(name, floor, id).run();
  return true;
}

/** Revoke (idempotent). Returns the revocation time, or null if the caller owns no such fleet. */
export async function revokeFleet(owner: string, id: string): Promise<number | null> {
  const row = await ownedFleet(owner, id);
  if (!row) return null;
  if (row.revoked_at) return row.revoked_at;
  const now = Date.now();
  await getD1().prepare("UPDATE fleets SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(now, id).run();
  return now;
}

/** The live fleet a token belongs to, or null (unknown or revoked). */
export async function fleetForToken(token: string): Promise<{ id: string; owner: string } | null> {
  return getD1()
    .prepare("SELECT id, owner FROM fleets WHERE token_hash = ? AND revoked_at IS NULL")
    .bind(sha256(token))
    .first<{ id: string; owner: string }>();
}
