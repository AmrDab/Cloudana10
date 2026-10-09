// 2D canvas over the WebGL globe: region/topic markers (ring + glow + live pulse) and crisp labels.
// The engine projects places into `MarkerSet` each frame; this file only draws. Nothing allocates per frame.

import type { LiveValue, Tone, UNode } from "../types";
import type { Place } from "../world";

export const COLOR = {
  bg2: "#0C1017",
  text: "#E6EAF0",
  faint: "#7A8699",
  ok: "#3FD6C2",
  work: "#F2A93B",
  chain: "#5B8DEF",
  burn: "#E5484D",
} as const;

export const TONE_COLOR: Record<Tone, string> = {
  ok: COLOR.ok,
  work: COLOR.work,
  chain: COLOR.chain,
  burn: COLOR.burn,
  neutral: COLOR.faint,
};

const FONT_HEAD = '"Bricolage Grotesque", system-ui, sans-serif';
const FONT_MONO = '"IBM Plex Mono", ui-monospace, monospace';
const HIDDEN_LABEL = "?????";
const DASH_DOT: number[] = [1.5, 3.5];
const DASH_NONE: number[] = [];
const TAU = Math.PI * 2;

export interface Marker {
  node: UNode;
  place: Place;
  /** 1 = region, 2 = topic. */
  kind: 1 | 2;
  /** Marker index of the parent region (−1 for regions). */
  parent: number;
  color: string;
}

export interface MarkerSet {
  markers: Marker[];
  /** Unit-sphere position, 3 per marker. */
  pos: Float32Array;
  /** Per-frame screen state. */
  sx: Float32Array;
  sy: Float32Array;
  /** Limb fade 0..1 (0 = far side). */
  fade: Float32Array;
  /** LOD visibility 0..1 before the limb fade. */
  lod: Float32Array;
  /** Ring radius in CSS px. */
  r: Float32Array;
  /** 1 when inside the viewport and facing the camera. */
  vis: Uint8Array;
  hitActive: Uint8Array;
  revealed: Uint8Array;
  live: (LiveValue | undefined)[];
}

export interface OverlayFrame {
  t: number;
  hover: number;
  selected: number;
  focusedRegion: number;
  focusedTopic: number;
  /** 0 at galaxy → 1 at planet: the focused topic's summary and bigger ring. */
  planet: number;
  reducedMotion: boolean;
}

type Sprite = HTMLCanvasElement | OffscreenCanvas;
function makeGlow(color: string): Sprite | null {
  const size = 128;
  let c: Sprite;
  if (typeof OffscreenCanvas !== "undefined") c = new OffscreenCanvas(size, size);
  else {
    const el = document.createElement("canvas");
    el.width = el.height = size;
    c = el;
  }
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

export class Overlay {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private glows = new Map<string, Sprite | null>();
  private fontCache = new Map<string, string>();
  width = 1;
  height = 1;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.setAttribute("aria-hidden", "true");
    this.canvas.style.cssText = "position:absolute;pointer-events:none;display:block";
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("universe/globe: 2D overlay unsupported");
    this.ctx = ctx;
  }

  /** Match the WebGL canvas's box (CSS px) and DPR. */
  resize(left: number, top: number, w: number, h: number, dpr: number): void {
    this.width = w;
    this.height = h;
    const s = this.canvas.style;
    s.left = `${left}px`;
    s.top = `${top}px`;
    s.width = `${w}px`;
    s.height = `${h}px`;
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private font(px: number, weight: number, mono: boolean): string {
    const key = `${px}|${weight}|${mono ? 1 : 0}`;
    let f = this.fontCache.get(key);
    if (!f) {
      f = `${weight} ${px}px ${mono ? FONT_MONO : FONT_HEAD}`;
      this.fontCache.set(key, f);
    }
    return f;
  }

  private glow(color: string): Sprite | null {
    let g = this.glows.get(color);
    if (g === undefined) {
      g = makeGlow(color);
      this.glows.set(color, g);
    }
    return g;
  }

  draw(ms: MarkerSet, f: OverlayFrame): void {
    const { ctx } = this;
    const { markers, sx, sy, fade, lod, r, vis, revealed, live } = ms;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.lineWidth = 1;

    // Pass 1: glows (regions ambient, live nodes by intensity).
    for (let i = 0; i < markers.length; i++) {
      if (!vis[i]) continue;
      const a = lod[i] * fade[i];
      if (a <= 0.01) continue;
      const m = markers[i];
      const lv = live[i];
      const intensity = lv ? lv.intensity : 0;
      let ga = m.kind === 1 ? 0.22 : 0;
      if (intensity > 0) ga = Math.max(ga, 0.25 + 0.75 * intensity);
      if (ga <= 0.01) continue;
      const sprite = this.glow(m.color);
      if (!sprite) continue;
      const pulse = intensity > 0 && !f.reducedMotion ? 1 + 0.08 * intensity * Math.sin(f.t * 1.7 + i * 0.9) : 1;
      const R = r[i] * (2.4 + 1.6 * intensity) * pulse;
      ctx.globalAlpha = ga * a;
      ctx.drawImage(sprite, sx[i] - R, sy[i] - R, R * 2, R * 2);
    }

    // Pass 2: rings.
    for (let i = 0; i < markers.length; i++) {
      if (!vis[i]) continue;
      const m = markers[i];
      const a = lod[i] * fade[i];
      if (a <= 0.01) continue;
      const x = sx[i];
      const y = sy[i];
      const lv = live[i];
      const dim = m.node.live !== undefined && (!lv || lv.intensity <= 0);
      const hidden = m.node.hidden === true && revealed[i] === 0;
      const R = r[i];

      ctx.globalAlpha = a;
      ctx.fillStyle = COLOR.bg2;
      ctx.beginPath();
      ctx.arc(x, y, R, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = a * (dim ? 0.05 : 0.1);
      ctx.fillStyle = m.color;
      ctx.fill();

      ctx.globalAlpha = a * (m.kind === 1 ? 0.9 : 0.75) * (dim ? 0.4 : 1);
      ctx.strokeStyle = hidden ? COLOR.faint : m.color;
      if (hidden) ctx.setLineDash(DASH_DOT);
      ctx.stroke();
      if (hidden) ctx.setLineDash(DASH_NONE);

      if (i === f.hover && i !== f.selected) {
        ctx.globalAlpha = a * 0.5;
        ctx.strokeStyle = COLOR.text;
        ctx.beginPath();
        ctx.arc(x, y, R + 4, 0, TAU);
        ctx.stroke();
      }
      if (i === f.selected) {
        ctx.globalAlpha = a * 0.9;
        ctx.strokeStyle = m.color;
        ctx.beginPath();
        ctx.arc(x, y, R + 6, 0, TAU);
        ctx.stroke();
      }
    }

    // Pass 3: labels.
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let i = 0; i < markers.length; i++) {
      if (!vis[i]) continue;
      const a = lod[i] * fade[i];
      if (a <= 0.01) continue;
      const m = markers[i];
      const hidden = m.node.hidden === true && revealed[i] === 0;
      const px = m.kind === 1 ? 14 : 12;
      const x = sx[i];
      let ty = sy[i] + r[i] + 6;

      ctx.globalAlpha = a * (m.kind === 1 ? 1 : 0.85) * (hidden ? 0.7 : 1);
      ctx.fillStyle = hidden ? COLOR.faint : COLOR.text;
      ctx.font = hidden ? this.font(px, 500, true) : this.font(px, m.kind === 1 ? 700 : 600, false);
      ctx.fillText(hidden ? HIDDEN_LABEL : m.node.label, x, ty);
      ty += px + 3;

      if (m.kind === 1) {
        ctx.globalAlpha = a * 0.8;
        ctx.fillStyle = COLOR.faint;
        ctx.font = this.font(10, 500, true);
        ctx.fillText(m.place.city.toUpperCase(), x, ty);
        ty += 13;
      }

      const lv = live[i];
      if (lv && !hidden) {
        ctx.globalAlpha = a * (0.45 + 0.55 * lv.intensity);
        ctx.fillStyle = m.color;
        ctx.font = this.font(Math.max(10, px - 2), 500, true);
        ctx.fillText(lv.text, x, ty);
        ty += px + 1;
      }

      if (m.kind === 2 && i === f.focusedTopic && m.node.summary && !hidden && f.planet > 0.01) {
        ctx.globalAlpha = a * f.planet * 0.8;
        ctx.fillStyle = COLOR.faint;
        ctx.font = this.font(10, 500, false);
        ctx.fillText(m.node.summary, x, ty);
      }
    }
    ctx.globalAlpha = 1;
  }
}
