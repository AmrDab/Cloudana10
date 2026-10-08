// Pure helpers for the React shell (Universe.tsx / NodePanel.tsx). No DOM, no engine: unit-tested in shell-utils.test.ts.
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

/** The level at which a node's panel makes sense: regions at system level, everything deeper at planet level. */
export function panelVisible(node: UNode | null, level: ZoomLevel): boolean {
  if (!node || node.kind === "core") return false;
  if (node.kind === "region") return level !== "galaxy";
  return level === "planet";
}

export type Box = { w: number; h: number };
export type Anchor = { x: number; y: number; r: number };

/**
 * Panel top-left in CSS px: to the right of the node, vertically centred on it; flips to the left when it would
 * leave the viewport, then clamps inside `margin`.
 */
export function panelPosition(anchor: Anchor, panel: Box, viewport: Box, margin = 16, gap = 14): { x: number; y: number } {
  const maxX = Math.max(margin, viewport.w - margin - panel.w);
  const maxY = Math.max(margin, viewport.h - margin - panel.h);
  let x = anchor.x + anchor.r + gap;
  if (x > maxX) x = anchor.x - anchor.r - gap - panel.w;
  x = Math.min(maxX, Math.max(margin, x));
  const y = Math.min(maxY, Math.max(margin, anchor.y - panel.h / 2));
  return { x, y };
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
