/**
 * Waitlist sign-ups (routes/v1/waitlist.ts).
 *
 * Position in line:
 *   rank     = 1 + number of sign-ups before this one (created_at, then insertion order)
 *   position = max(1, rank − 5 × referrals)
 * where referrals = number of rows whose referred_by is this row's ref_code.
 */
import { getD1 } from "../lib/storage.js";

export const WAITLIST_ROLES = ["use", "provide", "verify", "datacenter", "partner"] as const;
export type WaitlistRole = (typeof WAITLIST_ROLES)[number];

export const REFERRAL_BOOST = 5;

/** No 0/O or 1/I: codes get typed from screenshots. 32 symbols → byte % 32 is unbiased. */
const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const REF_CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;

export function newRefCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => REF_ALPHABET[b % REF_ALPHABET.length]).join("");
}

export interface WaitlistInput {
  email: string;
  role: WaitlistRole;
  name?: string;
  company?: string;
  country?: string;
  interests?: string[];
  details?: Record<string, string | number | boolean>;
  newsletter?: boolean;
  ref?: string;
  source?: string;
}

export interface WaitlistStanding {
  position: number;
  refCode: string;
  referrals: number;
}

const STANDING_SQL = `SELECT w.ref_code AS refCode,
  (SELECT COUNT(*) FROM waitlist o
     WHERE o.created_at < w.created_at OR (o.created_at = w.created_at AND o.rowid <= w.rowid)) AS seq,
  (SELECT COUNT(*) FROM waitlist r WHERE r.referred_by = w.ref_code) AS referrals
FROM waitlist w`;

async function standing(where: "email" | "ref_code", value: string): Promise<WaitlistStanding | null> {
  const row = await getD1()
    .prepare(`${STANDING_SQL} WHERE w.${where} = ?`)
    .bind(value)
    .first<{ refCode: string; seq: number; referrals: number }>();
  if (!row) return null;
  return {
    refCode: row.refCode,
    referrals: row.referrals,
    position: Math.max(1, row.seq - REFERRAL_BOOST * row.referrals),
  };
}

export const standingByRefCode = (refCode: string) => standing("ref_code", refCode);

/**
 * Insert a sign-up, or — if the email is already on the list — return the
 * existing standing without touching or revealing any stored field.
 */
export async function joinWaitlist(input: WaitlistInput): Promise<{ created: boolean; standing: WaitlistStanding }> {
  const db = getD1();
  const existing = await standing("email", input.email);
  if (existing) return { created: false, standing: existing };

  // A referral code only counts if it belongs to someone on the list.
  let referredBy: string | null = null;
  if (input.ref && REF_CODE_RE.test(input.ref)) {
    const hit = await db.prepare("SELECT 1 AS x FROM waitlist WHERE ref_code = ?").bind(input.ref).first();
    if (hit) referredBy = input.ref;
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const refCode = newRefCode();
    const r = await db
      .prepare(
        "INSERT INTO waitlist (id, email, role, name, company, country, interests, details, newsletter, ref_code, referred_by, source, created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING",
      )
      .bind(
        crypto.randomUUID(),
        input.email,
        input.role,
        input.name ?? null,
        input.company ?? null,
        input.country ?? null,
        input.interests ? JSON.stringify(input.interests) : null,
        input.details ? JSON.stringify(input.details) : null,
        input.newsletter ? 1 : 0,
        refCode,
        referredBy,
        input.source ?? null,
        Date.now(),
      )
      .run()
      .catch((err: unknown) => {
        // ref_code collision (1 in 32^8 per pair) → try another code.
        if (/UNIQUE constraint failed: waitlist\.ref_code/i.test(String(err instanceof Error ? err.message : err))) return null;
        throw err;
      });
    if (r === null) continue;
    const s = await standing("email", input.email);
    // changes = 0 → a concurrent request inserted the same email first.
    return { created: r.meta.changes > 0, standing: s! };
  }
  throw new Error("could not allocate a unique ref code");
}

/** A believable response for honeypot hits: nothing is stored. */
export async function fakeStanding(): Promise<WaitlistStanding> {
  const row = await getD1().prepare("SELECT COUNT(*) AS n FROM waitlist").first<{ n: number }>();
  return { position: (row?.n ?? 0) + 1, refCode: newRefCode(), referrals: 0 };
}

export async function waitlistStats(): Promise<{ total: number; byRole: Record<WaitlistRole, number> }> {
  const { results } = await getD1()
    .prepare("SELECT role, COUNT(*) AS n FROM waitlist GROUP BY role")
    .all<{ role: WaitlistRole; n: number }>();
  const byRole = Object.fromEntries(WAITLIST_ROLES.map((r) => [r, 0])) as Record<WaitlistRole, number>;
  let total = 0;
  for (const { role, n } of results) {
    if (role in byRole) byRole[role] = n;
    total += n;
  }
  return { total, byRole };
}

export interface WaitlistRow {
  id: string;
  email: string;
  role: string;
  name: string | null;
  company: string | null;
  country: string | null;
  interests: string | null;
  details: string | null;
  newsletter: number;
  ref_code: string;
  referred_by: string | null;
  source: string | null;
  created_at: number;
  referrals: number;
}

export async function listWaitlist(): Promise<WaitlistRow[]> {
  const { results } = await getD1()
    .prepare(
      "SELECT w.*, (SELECT COUNT(*) FROM waitlist r WHERE r.referred_by = w.ref_code) AS referrals " +
        "FROM waitlist w ORDER BY w.created_at, w.rowid",
    )
    .all<WaitlistRow>();
  return results;
}

/**
 * One CSV cell: formula-injection guard (a leading = + - @, tab or CR gets a
 * leading apostrophe so spreadsheets treat it as text), then RFC 4180 quoting.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CSV_COLUMNS = [
  "id", "email", "role", "name", "company", "country", "interests", "details",
  "newsletter", "ref_code", "referred_by", "referrals", "source", "created_at",
] as const;

export function waitlistCsv(rows: WaitlistRow[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(
      CSV_COLUMNS.map((k) => csvCell(k === "created_at" ? new Date(row.created_at).toISOString() : row[k])).join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}
