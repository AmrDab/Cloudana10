// Deterministic radial layout for the universe graph. Pure: no DOM, no randomness.
// World units; core at (0,0); y grows downward (canvas convention); angles are degrees
// clockwise from 12 o'clock, matching UNode.angle.

import type { NodeId, NodeKind, UGraph, UNode } from "../types";

export interface LayoutNode {
  x: number;
  y: number;
  /** Node radius in world units (kind × size). */
  r: number;
}

export const REGION_RING = 420;
export const TOPIC_RING = 150;
export const LEAF_RING = 60;

/** Base radius per kind, world units (size 1). */
export const KIND_RADIUS: Record<NodeKind, number> = { core: 40, region: 20, topic: 10, leaf: 5.5 };

/** Default region angles when graph.ts gives no hint. Generic rule for everything else: spread evenly. */
const DEFAULT_REGION_ANGLE: Record<string, number> = {
  verify: 0,
  run: 90,
  network: 135,
  settle: 180,
  security: 225,
  provide: 270,
};

/** Zoom at which each kind's label is meant to be read; used to size label footprints for overlap avoidance. */
const NATURAL_ZOOM: Record<NodeKind, number> = { core: 1, region: 1, topic: 2.4, leaf: 4.4 };
/** Label font size in screen px per kind (keep in sync with render.ts). */
const LABEL_PX: Record<NodeKind, number> = { core: 14, region: 14, topic: 12, leaf: 11 };

const DEG = Math.PI / 180;

export function nodeRadius(node: UNode): number {
  const size = node.size ?? 1;
  return KIND_RADIUS[node.kind] * Math.min(1.4, Math.max(0.4, size));
}

/** Rough label width in world units at the kind's natural zoom (avoids measureText; deterministic). */
export function labelFootprint(node: UNode): number {
  const text = node.hidden ? "?????" : node.label;
  const px = text.length * LABEL_PX[node.kind] * 0.58 + 12;
  return px / NATURAL_ZOOM[node.kind];
}

/** Position a point at polar (angleDeg clockwise from 12 o'clock, radius) around a centre. */
function polar(cx: number, cy: number, angleDeg: number, radius: number): { x: number; y: number } {
  const a = (angleDeg - 90) * DEG;
  return { x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius };
}

/**
 * Angles for a set of siblings. Hinted ones keep their hint; the rest fill the largest gaps,
 * which degrades to even spacing when nothing is hinted.
 */
export function distributeAngles(hints: (number | undefined)[]): number[] {
  const out: number[] = new Array(hints.length);
  const taken: number[] = [];
  hints.forEach((h, i) => {
    if (h !== undefined) {
      out[i] = ((h % 360) + 360) % 360;
      taken.push(out[i]);
    }
  });
  const free = hints.map((h, i) => (h === undefined ? i : -1)).filter((i) => i >= 0);
  if (free.length === 0) return out;
  if (taken.length === 0) {
    free.forEach((idx, k) => (out[idx] = (360 * k) / free.length));
    return out;
  }
  for (const idx of free) {
    taken.sort((a, b) => a - b);
    // Find the largest gap and split it; ties go to the earliest gap, the wrap-around gap last.
    let bestStart = taken[0];
    let bestGap = -1;
    for (let i = 1; i <= taken.length; i++) {
      const start = taken[i - 1];
      const gap = (i < taken.length ? taken[i] : taken[0] + 360) - start;
      if (gap > bestGap) {
        bestGap = gap;
        bestStart = start;
      }
    }
    const a = (bestStart + bestGap / 2) % 360;
    out[idx] = a;
    taken.push(a);
  }
  return out;
}

/**
 * Arc placement of children around a parent on the side facing away from `awayAngle`.
 * Widens the arc (and, if still cramped, the ring) so sibling labels don't overlap at natural zoom.
 */
function arcPlace(
  children: UNode[],
  parent: LayoutNode,
  awayAngle: number,
  ring: number,
  spacingDeg: number,
  out: Map<NodeId, LayoutNode>,
): void {
  const n = children.length;
  if (n === 0) return;
  // Minimum chord between neighbours: half of each label plus a pad.
  let needChord = 0;
  for (let i = 1; i < n; i++) {
    const c = (labelFootprint(children[i - 1]) + labelFootprint(children[i])) / 2 + 6;
    needChord = Math.max(needChord, c);
  }
  let radius = ring;
  // Base arc stays on the far side (≤ 170°); it widens only when labels need the room.
  let span = Math.min(170, spacingDeg * (n - 1));
  if (n > 1) {
    let sepDeg = 2 * Math.asin(Math.min(1, needChord / (2 * radius))) / DEG;
    span = Math.max(span, sepDeg * (n - 1));
    // Closed ring needs n gaps, not n-1.
    while (sepDeg * n > 360) {
      radius *= 1.25;
      sepDeg = 2 * Math.asin(Math.min(1, needChord / (2 * radius))) / DEG;
    }
    if (sepDeg * (n - 1) >= 360 - sepDeg) span = 360 - 360 / n; // full circle, evenly
  }
  const hints = children.map((c) => c.angle);
  const hinted = hints.some((h) => h !== undefined) ? distributeAngles(hints) : null;
  children.forEach((child, i) => {
    const angle = hinted
      ? hinted[i]
      : n === 1
        ? awayAngle
        : awayAngle - span / 2 + (span * i) / (n - 1);
    const p = polar(parent.x, parent.y, angle, radius);
    out.set(child.id, { x: p.x, y: p.y, r: nodeRadius(child) });
  });
}

export function layoutGraph(graph: UGraph): Map<NodeId, LayoutNode> {
  const out = new Map<NodeId, LayoutNode>();
  const byId = new Map<NodeId, UNode>();
  const children = new Map<NodeId, UNode[]>();
  for (const n of graph.nodes) {
    byId.set(n.id, n);
    if (n.parent !== undefined) {
      const list = children.get(n.parent) ?? [];
      list.push(n);
      children.set(n.parent, list);
    }
  }
  const core = byId.get(graph.root);
  if (!core) return out;
  out.set(core.id, { x: 0, y: 0, r: nodeRadius(core) });

  // Regions: hinted or default-by-id, else even distribution.
  const regions = (children.get(core.id) ?? []).filter((n) => n.kind === "region");
  const regionAngles = distributeAngles(regions.map((r) => r.angle ?? DEFAULT_REGION_ANGLE[r.id]));
  regions.forEach((region, i) => {
    const p = polar(0, 0, regionAngles[i], REGION_RING);
    out.set(region.id, { x: p.x, y: p.y, r: nodeRadius(region) });
  });

  // Topics around each region, facing away from the core; leaves around each topic, facing away from the region.
  for (const region of regions) {
    const rp = out.get(region.id)!;
    const topics = (children.get(region.id) ?? []).filter((n) => n.kind === "topic");
    arcPlace(topics, rp, angleOf(0, 0, rp.x, rp.y), TOPIC_RING, 36, out);
    for (const topic of topics) {
      const tp = out.get(topic.id)!;
      const leaves = (children.get(topic.id) ?? []).filter((n) => n.kind === "leaf");
      arcPlace(leaves, tp, angleOf(rp.x, rp.y, tp.x, tp.y), LEAF_RING, 42, out);
    }
  }

  // Anything orphaned or oddly typed still gets a slot near its parent so nothing is undefined.
  for (const n of graph.nodes) {
    if (out.has(n.id)) continue;
    const pp = (n.parent && out.get(n.parent)) || { x: 0, y: 0, r: 0 };
    const p = polar(pp.x, pp.y, 0, LEAF_RING);
    out.set(n.id, { x: p.x, y: p.y, r: nodeRadius(n) });
  }
  return out;
}

/** Angle (deg, clockwise from 12 o'clock) of (x,y) seen from (cx,cy). */
export function angleOf(cx: number, cy: number, x: number, y: number): number {
  return ((Math.atan2(y - cy, x - cx) / DEG + 90) % 360 + 360) % 360;
}
