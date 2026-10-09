// Pure helpers for the React shell (Universe.tsx, RegionDock, SearchPalette, RegionPanel). No DOM, no engine: unit-tested in shell-utils.test.ts.
import type { NetworkStats } from "@/hooks/useNetwork";
import { cld, int } from "@/lib/cld";
import { LEGACY_ANCHORS, type LiveBinding, type LiveStat, type LiveValue, type NodeId, type UNode, type ZoomLevel } from "./types";

export function formatLive(format: LiveBinding["format"], v: number): string {
  switch (format) {
    case "cld":
      return cld(v);
    case "epoch":
      return `#${int(v)}`;
    case "price":
      return `${v} nCLD/TMAC`;
    default:
      return int(v);
  }
}

export function liveValue(binding: LiveBinding, stats: NetworkStats): LiveValue {
  // LiveStat has a few keys the API does not report yet (deploymentsRunning, …): those read as 0.
  const v = Number((stats as Partial<Record<LiveStat, number>>)[binding.stat] ?? 0);
  const intensity = binding.full > 0 && Number.isFinite(v) ? Math.min(1, Math.max(0, v / binding.full)) : 0;
  return { text: formatLive(binding.format, Number.isFinite(v) ? v : 0), intensity };
}

/**
 * Live value per bound node. Offline → every bound node is dim and reads "offline"; no stats yet (first poll
 * still in flight) → nothing, so the engine keeps its initial dim state.
 */
export function liveValues(
  nodes: UNode[],
  stats: NetworkStats | null,
  offline: boolean,
): Partial<Record<NodeId, LiveValue>> {
  const out: Partial<Record<NodeId, LiveValue>> = {};
  for (const n of nodes) {
    if (!n.live) continue;
    if (offline) out[n.id] = { text: "offline", intensity: 0 };
    else if (stats) out[n.id] = liveValue(n.live, stats);
  }
  return out;
}

/** `#run`, `#services` (legacy anchor) or `#` + a node id → the node to fly to; null when unknown/empty. */
export function parseHash(hash: string, has: (id: NodeId) => boolean): NodeId | null {
  let raw = hash.startsWith("#") ? hash.slice(1) : hash;
  try {
    raw = decodeURIComponent(raw);
  } catch {
    /* keep raw */
  }
  if (!raw) return null;
  const legacy = Object.prototype.hasOwnProperty.call(LEGACY_ANCHORS, raw) ? LEGACY_ANCHORS[raw] : null;
  if (legacy && has(legacy)) return legacy;
  return has(raw) ? raw : null;
}

/** Breadcrumb text: hidden nodes read "?????" until revealed. */
export const nodeLabel = (n: UNode, revealed: ReadonlySet<NodeId>) => (n.hidden && !revealed.has(n.id) ? "?????" : n.label);

/**
 * Back at the galaxy by any route (Esc, Home, wheel, drag): the selection and hash should clear. True only on the
 * transition into galaxy level with no region in view, so a fly-to that starts at home keeps its target hash.
 */
export function arrivedHome(level: ZoomLevel, lastLevel: ZoomLevel, region: NodeId | null): boolean {
  return level === "galaxy" && lastLevel !== "galaxy" && region === null;
}

/** The dock's ring order (docs/UNIVERSE_SPEC.md v2 "Smart navigation"). Keys 1–6 follow it. */
export const REGION_RING: readonly NodeId[] = ["run", "settle", "provide", "verify", "security", "network"];

/** The region before/after `current` in ring order, wrapping; from nowhere, next is the first and prev the last. */
export function ringStep(current: NodeId | null, dir: 1 | -1): NodeId {
  const n = REGION_RING.length;
  const i = current ? REGION_RING.indexOf(current) : -1;
  if (i < 0) return dir > 0 ? REGION_RING[0] : REGION_RING[n - 1];
  return REGION_RING[(i + dir + n) % n];
}

/** Where the globe flies for a node: leaves are not drawn, so they go to their topic's city. */
export const flyTarget = (n: UNode): NodeId => (n.kind === "leaf" && n.parent ? n.parent : n.id);

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const words = (s: string) => s.split(/[^a-z0-9]+/).filter(Boolean);

function isSubsequence(needle: string, hay: string): boolean {
  let j = 0;
  for (let i = 0; i < hay.length && j < needle.length; i++) if (hay[i] === needle[j]) j++;
  return j === needle.length;
}

type Field = { text: string; words: string[]; weight: number; fuzzy: boolean };

/** 4 whole word · 3 word prefix · 2 substring · 1 subsequence (label/city only, ≥ 2 chars) · 0 no match. */
function tokenScore(token: string, f: Field): number {
  if (f.words.includes(token)) return 4;
  if (f.words.some((w) => w.startsWith(token))) return 3;
  if (f.text.includes(token)) return 2;
  if (f.fuzzy && token.length >= 2 && isSubsequence(token, f.text)) return 1;
  return 0;
}

const KIND_BONUS: Record<UNode["kind"], number> = { core: 0, region: 0.3, topic: 0.2, leaf: 0.1 };

/**
 * Search palette ranking over every node incl. leaves: label (×3), city (×2), summary (×1), body (×0.5).
 * Every query token must match some field. Hidden nodes, and anything under one, stay out until revealed.
 */
export function searchNodes(
  query: string,
  nodes: readonly UNode[],
  opts: { revealed: ReadonlySet<NodeId>; cityOf?: (id: NodeId) => string | undefined; limit?: number },
): UNode[] {
  const q = fold(query.trim());
  const tokens = words(q);
  if (tokens.length === 0) return [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const concealed = (n: UNode): boolean => {
    for (let cur: UNode | undefined = n; cur; cur = cur.parent ? byId.get(cur.parent) : undefined) {
      if (cur.hidden && !opts.revealed.has(cur.id)) return true;
    }
    return false;
  };
  const field = (s: string | undefined, weight: number, fuzzy: boolean): Field => {
    const text = fold(s ?? "");
    return { text, words: words(text), weight, fuzzy };
  };
  const scored: { n: UNode; score: number; i: number }[] = [];
  nodes.forEach((n, i) => {
    if (concealed(n)) return;
    const label = field(n.label, 3, true);
    const fields = [label, field(opts.cityOf?.(n.id), 2, true), field(n.summary, 1, false), field(n.body?.join(" "), 0.5, false)];
    let score = 0;
    for (const t of tokens) {
      const best = Math.max(...fields.map((f) => tokenScore(t, f) * f.weight));
      if (best === 0) return;
      score += best;
    }
    if (label.text.startsWith(q)) score += 4; // "epoch" → "Epochs" before "Current epoch"
    scored.push({ n, score: score + KIND_BONUS[n.kind], i });
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, opts.limit ?? 30).map((s) => s.n);
}
