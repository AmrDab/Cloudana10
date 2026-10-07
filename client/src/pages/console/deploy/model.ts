// Deploy tab — pure helpers shared by the browser, the detail sheet, the form and the deployments table.
import { useSyncExternalStore } from "react";
import {
  Activity, Blocks, Box, Brain, Code2, Database, FileCode2, Gamepad2, Globe, HardDrive, MessageSquare, Server, Wrench,
  type LucideIcon,
} from "lucide-react";
import type { Deployment, Template } from "@/components/console/data";

export type Kind = "static" | "container";

/** Public gateway address (https://{id}.sites.cloudana.io) from the API's `url`; `endpoint` stays the node origin. */
export const publicUrl = (d: Deployment): string | null => (d as Deployment & { url?: string | null }).url ?? null;
export const hostOf = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");

/** The API marks curated starters with `kind`; for imported (awesome-akash) entries, an SDL with an image is a container. */
export function kindOf(t: Template): Kind {
  if (t.kind) return t.kind;
  return /^\s*image:\s*\S+/m.test(t.deploy ?? "") ? "container" : "static";
}

export const isCurated = (t: Template, category?: string) =>
  t.curated === true || /cloudana|starter/i.test(category ?? "") || t.id.startsWith("cloudana-");

export function categoryIcon(title: string): LucideIcon {
  const t = title.toLowerCase();
  if (/static|site|html/.test(t)) return FileCode2;
  if (/web|cms|blog|host/.test(t)) return Globe;
  if (/data|sql|cache|db/.test(t)) return Database;
  if (/\bai\b|ml|llm|machine|model|inference|gpu/.test(t)) return Brain;
  if (/stor|file|backup/.test(t)) return HardDrive;
  if (/monitor|observ|metric|log/.test(t)) return Activity;
  if (/chat|social|commun|messag/.test(t)) return MessageSquare;
  if (/game/.test(t)) return Gamepad2;
  if (/chain|crypto|node|web3/.test(t)) return Blocks;
  if (/dev|ci|git|code|tool/.test(t)) return Code2;
  if (/infra|network|proxy|server/.test(t)) return Server;
  if (/util|misc/.test(t)) return Wrench;
  return Box;
}

// ── Sizes & price (§3, contract defaults — the live values are protocol-set, so the UI says "estimate") ─────────
export const SIZES = {
  S: { cpu: 500, memMb: 512, storageMb: 1024 },
  M: { cpu: 1000, memMb: 1024, storageMb: 5 * 1024 },
  L: { cpu: 2000, memMb: 2048, storageMb: 10 * 1024 },
} as const;
export type Size = keyof typeof SIZES;

const PRICE_HOSTING = 50, PRICE_CPU = 200, PRICE_MEM_GB = 100, PRICE_STORAGE_GB = 20;
export function priceEstimate(kind: Kind, r?: { cpu: number; memMb: number; storageMb: number }) {
  if (kind === "static" || !r) return PRICE_HOSTING;
  const p = (r.cpu / 1000) * PRICE_CPU + (r.memMb / 1024) * PRICE_MEM_GB + (r.storageMb / 1024) * PRICE_STORAGE_GB;
  return Math.max(PRICE_HOSTING, Math.round(p));
}

// ── Container defaults from the template's SDL ──────────────────────────────────────────────────────────────
const UNIT: Record<string, number> = { "": 1 / 1024 / 1024, k: 1 / 1024, ki: 1 / 1024, m: 1, mi: 1, g: 1024, gi: 1024, t: 1024 ** 2, ti: 1024 ** 2 };
const toMb = (v?: string) => {
  const m = v?.trim().match(/^([\d.]+)\s*([kmgt]i?)?b?$/i);
  return m ? Number(m[1]) * (UNIT[(m[2] ?? "").toLowerCase()] ?? 1) : null;
};

export type SdlDefaults = { image: string; ports: number[]; cpu: number | null; memMb: number | null; storageMb: number | null };
export function sdlDefaults(sdl: string): SdlDefaults {
  const image = sdl.match(/^\s*image:\s*["']?([^\s"']+)/m)?.[1] ?? "";
  const ports = [...sdl.matchAll(/^\s*-\s*port:\s*(\d+)/gm)].map((m) => Number(m[1]));
  const units = sdl.match(/cpu:\s*\n\s*units:\s*["']?([\d.]+)(m?)/);
  const cpu = units ? (units[2] ? Number(units[1]) : Number(units[1]) * 1000) : null;
  const mem = sdl.match(/memory:\s*\n\s*size:\s*["']?([\w.]+)/)?.[1];
  const sto = sdl.match(/storage:\s*\n\s*(?:-\s*)?size:\s*["']?([\w.]+)/)?.[1];
  return { image, ports: [...new Set(ports)], cpu, memMb: toMb(mem), storageMb: toMb(sto) };
}

/** Container defaults: the template's structured fields when present, else what its SDL says. */
export function containerDefaults(t: Template | null): SdlDefaults & { command: string[] } {
  const d = sdlDefaults(t?.deploy ?? "");
  return {
    image: t?.image || d.image,
    ports: t?.ports?.length ? t.ports : d.ports,
    cpu: t?.cpu || d.cpu,
    memMb: t?.memMb || d.memMb,
    storageMb: t?.storageMb || d.storageMb,
    command: t?.command ?? [],
  };
}

/** Smallest preset that covers the template's own resources (L if it asks for more). */
export function sizeFor(d: Pick<SdlDefaults, "cpu" | "memMb" | "storageMb">): Size {
  for (const s of ["S", "M", "L"] as const) {
    const r = SIZES[s];
    if ((d.cpu ?? 0) <= r.cpu && (d.memMb ?? 0) <= r.memMb && (d.storageMb ?? 0) <= r.storageMb) return s;
  }
  return "L";
}

export const mb = (n: number) => (n >= 1024 ? `${+(n / 1024).toFixed(1)} GB` : `${Math.round(n)} MB`);
export const bytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`);

// ── Pending secrets (sessionStorage only — never localStorage) + sealing state ─────────────────────────────
const SECRET_KEY = (id: string) => `cld.secrets.${id}`;
export function savePendingSecrets(id: string, secrets: Record<string, string>) {
  sessionStorage.setItem(SECRET_KEY(id), JSON.stringify(secrets));
  autoSeal.add(id);
  emit();
}
export function pendingSecrets(id: string): Record<string, string> | null {
  try {
    return JSON.parse(sessionStorage.getItem(SECRET_KEY(id)) ?? "null");
  } catch {
    return null;
  }
}
export function clearPendingSecrets(id: string) {
  sessionStorage.removeItem(SECRET_KEY(id));
  autoSeal.delete(id);
  emit();
}

/** Deployments created while this app was loaded seal themselves; the rest wait for "Seal secrets now". */
export const autoSeal = new Set<string>();

export type SealState = { phase: "waiting" | "sealing" | "sealed" | "error"; node?: string; message?: string };
const sealStates = new Map<string, SealState>();
const listeners = new Set<() => void>();
let version = 0;
function emit() {
  version++;
  listeners.forEach((l) => l());
}
export function setSealState(id: string, s: SealState) {
  sealStates.set(id, s);
  emit();
}
export const getSealState = (id: string) => sealStates.get(id);
/** Re-renders when any seal state or pending-secret set changes. */
export function useSealVersion() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => version,
  );
}

// ── Static files ────────────────────────────────────────────────────────────────────────────────────────────
export type StaticFile = { path: string; contentBase64: string; size: number };
export const MAX_STATIC = 2 * 1024 * 1024;

export function textToBase64(text: string) {
  const b = new TextEncoder().encode(text);
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function readFolder(list: FileList): Promise<StaticFile[]> {
  const files = [...list];
  // webkitdirectory paths start with the chosen folder's name — the site root is inside it.
  const rel = (f: File) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
  const roots = new Set(files.map((f) => rel(f).split("/")[0]));
  const strip = roots.size === 1 && files.every((f) => rel(f).includes("/"));
  return Promise.all(
    files.map(
      (f) =>
        new Promise<StaticFile>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve({ path: strip ? rel(f).split("/").slice(1).join("/") : rel(f), contentBase64: String(r.result).split(",")[1] ?? "", size: f.size });
          r.onerror = () => reject(r.error);
          r.readAsDataURL(f);
        }),
    ),
  );
}
