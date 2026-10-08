// 2D canvas renderer. Why 2D, not three.js: the map is ~120 circles, ~130 lines and text. Canvas 2D gives
// crisp text at DPR 2 for free (WebGL text means SDF atlases or DOM overlays), 1 px hairlines without AA tricks,
// and no shader/geometry upkeep; at this element count it comfortably holds 60 fps. Nothing allocates per frame.

import type { LiveValue, NodeId, Tone, UGraph, UNode } from "../types";
import type { CameraController } from "./camera";
import type { LayoutNode } from "./layout";
import { drawStars, type StarLayer } from "./stars";

export const COLOR = {
  bg: "#07090D",
  bg2: "#0C1017",
  text: "#E6EAF0",
  faint: "#7A8699",
  line: "#94A3B8",
  ok: "#3FD6C2",
  work: "#F2A93B",
  chain: "#5B8DEF",
  burn: "#E5484D",
} as const;

const TONE_COLOR: Record<Tone, string> = {
  ok: COLOR.ok,
  work: COLOR.work,
  chain: COLOR.chain,
  burn: COLOR.burn,
  neutral: COLOR.faint,
};

const FONT_HEAD = '"Bricolage Grotesque", system-ui, sans-serif';
const FONT_MONO = '"IBM Plex Mono", ui-monospace, monospace';
const WORDMARK = "CLOUDANA";
const TAGLINE = "The proof is the work";
const HIDDEN_LABEL = "?????";

/** Label font size (screen px) per kind. Mirrors layout.ts LABEL_PX. */
const LABEL_PX = { core: 14, region: 14, topic: 12, leaf: 11 } as const;
const DASH_DOT: number[] = [1.5, 3.5];
const DASH_CROSS: number[] = [3, 7];
const DASH_NONE: number[] = [];
const CULL_MARGIN = 140;

export interface SceneNode {
  node: UNode;
  x: number;
  y: number;
  r: number;
  tone: Tone;
  color: string;
  /** Index into scene.nodes, -1 for the core. */
  parent: number;
}

export interface Scene {
  nodes: SceneNode[];
  index: Map<NodeId, number>;
  /** [from, to, kindOfTo] triples: kindOfTo 1 = region, 2 = topic, 3 = leaf. */
  primary: Int32Array;
  /** [from, to] pairs. */
  cross: Int32Array;
  /** Screen-space scratch, refreshed each frame. */
  sx: Float32Array;
  sy: Float32Array;
  visible: Uint8Array;
  /** Hidden nodes that have been revealed (1) — indexed like nodes. */
  revealed: Uint8Array;
  live: (LiveValue | undefined)[];
}

const KIND_ORDER = { core: 0, region: 1, topic: 2, leaf: 3 } as const;

export function buildScene(graph: UGraph, layout: Map<NodeId, LayoutNode>): Scene {
  const index = new Map<NodeId, number>();
  const nodes: SceneNode[] = [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const toneOf = (n: UNode): Tone => {
    let cur: UNode | undefined = n;
    while (cur) {
      if (cur.tone) return cur.tone;
      cur = cur.parent ? byId.get(cur.parent) : undefined;
    }
    return "neutral";
  };
  for (const n of graph.nodes) {
    const l = layout.get(n.id);
    if (!l) continue;
    index.set(n.id, nodes.length);
    const tone = toneOf(n);
    nodes.push({ node: n, x: l.x, y: l.y, r: l.r, tone, color: TONE_COLOR[tone], parent: -1 });
  }
  for (const sn of nodes) sn.parent = sn.node.parent !== undefined ? (index.get(sn.node.parent) ?? -1) : -1;

  const primary: number[] = [];
  const cross: number[] = [];
  for (const e of graph.edges) {
    const a = index.get(e.from);
    const b = index.get(e.to);
    if (a === undefined || b === undefined) continue;
    if (e.kind === "cross") cross.push(a, b);
    else primary.push(a, b, KIND_ORDER[nodes[b].node.kind]);
  }
  // Parent links without an explicit edge are still primary edges.
  for (let i = 0; i < nodes.length; i++) {
    const p = nodes[i].parent;
    if (p < 0) continue;
    let found = false;
    for (let k = 0; k < primary.length; k += 3) {
      if ((primary[k] === p && primary[k + 1] === i) || (primary[k] === i && primary[k + 1] === p)) {
        found = true;
        break;
      }
    }
    if (!found) primary.push(p, i, KIND_ORDER[nodes[i].node.kind]);
  }
  const n = nodes.length;
  return {
    nodes,
    index,
    primary: Int32Array.from(primary),
    cross: Int32Array.from(cross),
    sx: new Float32Array(n),
    sy: new Float32Array(n),
    visible: new Uint8Array(n),
    revealed: new Uint8Array(n),
    live: new Array(n).fill(undefined),
  };
}

export interface FrameState {
  cam: CameraController;
  /** Seconds since start (frozen when reducedMotion). */
  t: number;
  hover: number;
  selected: number;
  reducedMotion: boolean;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Glow sprites per tone, built once; drawn scaled with drawImage. */
type Sprite = HTMLCanvasElement | OffscreenCanvas;
function makeGlow(color: string): Sprite | null {
  const size = 128;
  let c: Sprite;
  if (typeof OffscreenCanvas !== "undefined") c = new OffscreenCanvas(size, size);
  else if (typeof document !== "undefined") {
    const el = document.createElement("canvas");
    el.width = el.height = size;
    c = el;
  } else return null;
  const g = c.getContext("2d") as CanvasRenderingContext2D | null;
  if (!g) return null;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, color + "99");
  grad.addColorStop(0.35, color + "40");
  grad.addColorStop(1, color + "00");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

export class Renderer {
  private glows: Partial<Record<Tone, Sprite | null>> = {};
  private fontCache = new Map<number, string>();
  private readonly pt = { x: 0, y: 0 };

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly scene: Scene,
    private readonly stars: StarLayer[],
  ) {}

  private font(px: number, weight: number, mono: boolean): string {
    const key = (Math.round(px * 2) << 4) | (weight / 100) | (mono ? 8 : 0);
    let f = this.fontCache.get(key);
    if (!f) {
      f = `${weight} ${Math.round(px * 2) / 2}px ${mono ? FONT_MONO : FONT_HEAD}`;
      this.fontCache.set(key, f);
    }
    return f;
  }

  private glow(tone: Tone): Sprite | null {
    if (!(tone in this.glows)) this.glows[tone] = makeGlow(TONE_COLOR[tone]);
    return this.glows[tone] ?? null;
  }

  /** Refresh screen positions + culling. Also used by the engine for hit-testing and project(). */
  projectAll(cam: CameraController): void {
    const { nodes, sx, sy, visible } = this.scene;
    const w = cam.width;
    const h = cam.height;
    for (let i = 0; i < nodes.length; i++) {
      cam.worldToScreen(nodes[i].x, nodes[i].y, this.pt);
      sx[i] = this.pt.x;
      sy[i] = this.pt.y;
      const m = CULL_MARGIN + nodes[i].r * cam.zoom;
      visible[i] = this.pt.x > -m && this.pt.x < w + m && this.pt.y > -m && this.pt.y < h + m ? 1 : 0;
    }
  }

  draw(state: FrameState): void {
    const { ctx, scene } = this;
    const cam = state.cam;
    const w = cam.width;
    const h = cam.height;
    const z = cam.zoom;
    this.projectAll(cam);

    ctx.fillStyle = COLOR.bg;
    ctx.fillRect(0, 0, w, h);
    drawStars(ctx, this.stars, w, h, cam.x, cam.y, z, state.t, !state.reducedMotion);

    // Visibility ramps: labels fade across thresholds instead of popping.
    const topicDot = 0.35 + 0.65 * smoothstep(1.2, 1.8, z);
    const topicLabel = smoothstep(1.35, 1.95, z);
    const leafDot = smoothstep(1.4, 2.1, z);
    const leafLabel = smoothstep(3.1, 3.9, z);
    const wordmark = 1 - smoothstep(1.1, 2.2, z); // 1 = big wordmark, 0 = ordinary node
    const kindAlpha = [1, 1, topicDot, leafDot];
    const labelAlpha = [1, 1, topicLabel, leafLabel];

    this.drawEdges(kindAlpha);
    this.drawNodes(state, kindAlpha, wordmark);
    this.drawLabels(state, labelAlpha, wordmark);
  }

  private drawEdges(kindAlpha: number[]): void {
    const { ctx, scene } = this;
    const { sx, sy, visible, primary, cross } = scene;
    ctx.lineWidth = 1;
    ctx.strokeStyle = COLOR.line;

    if (cross.length) {
      ctx.setLineDash(DASH_CROSS);
      ctx.globalAlpha = 0.09;
      ctx.beginPath();
      for (let k = 0; k < cross.length; k += 2) {
        const a = cross[k];
        const b = cross[k + 1];
        if (!visible[a] && !visible[b]) continue;
        ctx.moveTo(sx[a], sy[a]);
        ctx.lineTo(sx[b], sy[b]);
      }
      ctx.stroke();
      ctx.setLineDash(DASH_NONE);
    }

    // Primary edges, batched by target kind so alpha follows the level ramps.
    for (let kind = 1; kind <= 3; kind++) {
      const alpha = (kind === 1 ? 0.2 : kind === 2 ? 0.16 : 0.14) * kindAlpha[kind];
      if (alpha <= 0.005) continue;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      for (let k = 0; k < primary.length; k += 3) {
        if (primary[k + 2] !== kind) continue;
        const a = primary[k];
        const b = primary[k + 1];
        if (!visible[a] && !visible[b]) continue;
        ctx.moveTo(sx[a], sy[a]);
        ctx.lineTo(sx[b], sy[b]);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private drawNodes(state: FrameState, kindAlpha: number[], wordmark: number): void {
    const { ctx, scene } = this;
    const { nodes, sx, sy, visible, revealed, live } = scene;
    const z = state.cam.zoom;
    const TAU = Math.PI * 2;
    ctx.lineWidth = 1;

    // Pass 1: glows (under everything else so rings stay crisp).
    for (let i = 0; i < nodes.length; i++) {
      if (!visible[i]) continue;
      const sn = nodes[i];
      const kind = KIND_ORDER[sn.node.kind];
      const ka = kindAlpha[kind];
      if (ka <= 0.01) continue;
      const lv = live[i];
      const intensity = lv ? lv.intensity : 0;
      // Regions get a faint ambient glow; live nodes glow with intensity.
      let a = kind === 1 ? 0.22 : kind === 0 ? 0.18 * wordmark : 0;
      if (intensity > 0) a = Math.max(a, 0.25 + 0.75 * intensity);
      if (a <= 0.01) continue;
      const sprite = this.glow(sn.tone);
      if (!sprite) continue;
      const pulse =
        intensity > 0 && !state.reducedMotion ? 1 + 0.08 * intensity * Math.sin(state.t * 1.7 + i * 0.9) : 1;
      let R = sn.r * z * (2.2 + 1.6 * intensity) * pulse;
      if (kind === 0) R = Math.max(R, 150 * wordmark);
      ctx.globalAlpha = a * ka;
      ctx.drawImage(sprite, sx[i] - R, sy[i] - R, R * 2, R * 2);
    }

    // Pass 2: fills + rings.
    for (let i = 0; i < nodes.length; i++) {
      if (!visible[i]) continue;
      const sn = nodes[i];
      const kind = KIND_ORDER[sn.node.kind];
      const ka = kindAlpha[kind];
      if (ka <= 0.01) continue;
      const x = sx[i];
      const y = sy[i];
      const lv = live[i];
      const dim = sn.node.live !== undefined && (!lv || lv.intensity <= 0);
      const hidden = sn.node.hidden === true && revealed[i] === 0;

      if (kind === 0) {
        // Core: no ring while the wordmark is big; the ring grows in as it shrinks.
        if (wordmark >= 0.98) continue;
        const R = sn.r * z;
        ctx.globalAlpha = (1 - wordmark) * 0.9;
        ctx.fillStyle = COLOR.bg2;
        ctx.beginPath();
        ctx.arc(x, y, R, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = COLOR.text;
        ctx.stroke();
        continue;
      }

      const R = screenRadius(sn.node.kind, sn.r, z);

      // Fill: opaque bg so edges stop at the ring, plus a whisper of tone.
      ctx.globalAlpha = ka;
      ctx.fillStyle = COLOR.bg2;
      ctx.beginPath();
      ctx.arc(x, y, R, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = ka * (dim ? 0.05 : 0.1);
      ctx.fillStyle = sn.color;
      ctx.fill();

      // Ring: 1 px, tone colour; dim when the live number is zero; dotted while hidden.
      const ringAlpha = (kind === 1 ? 0.9 : kind === 2 ? 0.75 : 0.65) * (dim ? 0.4 : 1);
      ctx.globalAlpha = ka * ringAlpha;
      ctx.strokeStyle = hidden ? COLOR.faint : sn.color;
      if (hidden) ctx.setLineDash(DASH_DOT);
      ctx.stroke();
      if (hidden) ctx.setLineDash(DASH_NONE);

      if (i === state.hover && i !== state.selected) {
        ctx.globalAlpha = ka * 0.5;
        ctx.strokeStyle = COLOR.text;
        ctx.beginPath();
        ctx.arc(x, y, R + 4, 0, TAU);
        ctx.stroke();
      }
      if (i === state.selected) {
        ctx.globalAlpha = ka * 0.9;
        ctx.strokeStyle = sn.color;
        ctx.beginPath();
        ctx.arc(x, y, R + 6, 0, TAU);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawLabels(state: FrameState, labelAlpha: number[], wordmark: number): void {
    const { ctx, scene } = this;
    const { nodes, sx, sy, visible, revealed, live } = scene;
    const z = state.cam.zoom;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    for (let i = 0; i < nodes.length; i++) {
      if (!visible[i]) continue;
      const sn = nodes[i];
      const kind = KIND_ORDER[sn.node.kind];
      const la = labelAlpha[kind];
      if (la <= 0.01) continue;
      const x = sx[i];
      const y = sy[i];

      if (kind === 0) {
        this.drawCore(x, y, sn.r * z, wordmark);
        continue;
      }

      const hidden = sn.node.hidden === true && revealed[i] === 0;
      const px = LABEL_PX[sn.node.kind];
      let ty = y + screenRadius(sn.node.kind, sn.r, z) + 6;

      ctx.globalAlpha = la * (kind === 1 ? 1 : kind === 2 ? 0.85 : 0.75) * (hidden ? 0.7 : 1);
      ctx.fillStyle = hidden ? COLOR.faint : COLOR.text;
      ctx.font = hidden ? this.font(px, 500, true) : this.font(px, kind === 1 ? 700 : 600, false);
      ctx.fillText(hidden ? HIDDEN_LABEL : sn.node.label, x, ty);
      ty += px + 3;

      const lv = live[i];
      if (lv && !hidden) {
        ctx.globalAlpha = la * (0.45 + 0.55 * lv.intensity);
        ctx.fillStyle = sn.color;
        ctx.font = this.font(Math.max(10, px - 2), 500, true);
        ctx.fillText(lv.text, x, ty);
        ty += px + 1;
      }

      // Summary line at system level (topics) / planet level (leaves), muted.
      if (sn.node.summary && !hidden && kind >= 2) {
        const sa = kind === 2 ? smoothstep(2.6, 3.4, z) : smoothstep(4.2, 5, z);
        if (sa > 0.01) {
          ctx.globalAlpha = la * sa * 0.8;
          ctx.fillStyle = COLOR.faint;
          ctx.font = this.font(10, 500, false);
          ctx.fillText(sn.node.summary, x, ty);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawCore(x: number, y: number, R: number, wordmark: number): void {
    const { ctx } = this;
    ctx.textAlign = "center";
    if (wordmark > 0.01) {
      // Big wordmark, centred on the core; shrinks and fades as the ring takes over.
      const px = 16 + 30 * wordmark;
      ctx.textBaseline = "alphabetic";
      ctx.globalAlpha = wordmark;
      ctx.fillStyle = COLOR.text;
      ctx.font = this.font(px, 800, false);
      ctx.fillText(WORDMARK, x, y + px * 0.1);
      ctx.globalAlpha = wordmark * 0.8;
      ctx.fillStyle = COLOR.faint;
      ctx.font = this.font(11 + 3 * wordmark, 500, false);
      ctx.textBaseline = "top";
      ctx.fillText(TAGLINE, x, y + px * 0.1 + 10);
    }
    if (wordmark < 0.99) {
      // Ordinary node: label under the ring.
      ctx.textBaseline = "top";
      ctx.globalAlpha = 1 - wordmark;
      ctx.fillStyle = COLOR.text;
      ctx.font = this.font(LABEL_PX.core, 800, false);
      ctx.fillText(WORDMARK, x, y + R + 6);
    }
    ctx.globalAlpha = 1;
  }
}

/**
 * On-screen radius of a node: topics and leaves are faint dots at the level above their own and grow
 * continuously into full rings, so nothing pops. Shared with the engine for hit-testing and project().
 */
export function screenRadius(kind: UNode["kind"], r: number, z: number): number {
  const full = r * z;
  if (kind === "topic") return full * (0.25 + 0.75 * smoothstep(1.2, 1.9, z));
  if (kind === "leaf") return full * (0.3 + 0.7 * smoothstep(1.4, 2.2, z));
  return full;
}
