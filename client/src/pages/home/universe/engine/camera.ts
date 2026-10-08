// Camera state + maths. Pure (no DOM); the engine drives it from input and the frame loop.

import type { Camera, NodeKind, ZoomLevel } from "../types";

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 8;
/** Level thresholds from docs/UNIVERSE_SPEC.md. */
export const SYSTEM_ZOOM = 1.6;
export const PLANET_ZOOM = 3.6;
export const FLY_MS = 900;

/** Zoom that makes a node's children legible. */
const NATURAL: Record<NodeKind, number> = { core: 1, region: 2.4, topic: 4.4, leaf: 5 };

export function naturalZoomFor(kind: NodeKind): number {
  return NATURAL[kind];
}

export function levelFor(zoom: number): ZoomLevel {
  return zoom < SYSTEM_ZOOM ? "galaxy" : zoom < PLANET_ZOOM ? "system" : "planet";
}

export function clampZoom(z: number): number {
  return z < ZOOM_MIN ? ZOOM_MIN : z > ZOOM_MAX ? ZOOM_MAX : z;
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

const INERTIA_DECAY = 5; // 1/s; velocity halves every ~140 ms
const INERTIA_STOP = 6; // px/s

export class CameraController {
  x = 0;
  y = 0;
  zoom = 1;
  /** Viewport size in CSS px. */
  width = 1;
  height = 1;

  /** Pan velocity in screen px/s (inertia). */
  private vx = 0;
  private vy = 0;

  private flyT = -1; // -1 = idle, else elapsed ms
  private flyMs = FLY_MS;
  private from: Camera = { x: 0, y: 0, zoom: 1 };
  private to: Camera = { x: 0, y: 0, zoom: 1 };

  get(): Camera {
    return { x: this.x, y: this.y, zoom: this.zoom };
  }

  set(x: number, y: number, zoom: number): void {
    this.x = x;
    this.y = y;
    this.zoom = clampZoom(zoom);
    this.flyT = -1;
    this.vx = this.vy = 0;
  }

  setViewport(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
  }

  level(): ZoomLevel {
    return levelFor(this.zoom);
  }

  /** world → screen (CSS px), written into `out` to avoid allocation. */
  worldToScreen(wx: number, wy: number, out: { x: number; y: number }): void {
    out.x = (wx - this.x) * this.zoom + this.width / 2;
    out.y = (wy - this.y) * this.zoom + this.height / 2;
  }

  screenToWorld(sx: number, sy: number, out: { x: number; y: number }): void {
    out.x = (sx - this.width / 2) / this.zoom + this.x;
    out.y = (sy - this.height / 2) / this.zoom + this.y;
  }

  /** Multiply zoom by `factor`, keeping the world point under (sx, sy) fixed on screen. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const next = clampZoom(this.zoom * factor);
    if (next === this.zoom) return;
    const dx = sx - this.width / 2;
    const dy = sy - this.height / 2;
    // world point under cursor: w = cam + d/zoom. Keep it: cam' = w - d/zoom'.
    this.x = this.x + dx / this.zoom - dx / next;
    this.y = this.y + dy / this.zoom - dy / next;
    this.zoom = next;
    this.flyT = -1;
  }

  /** Pan by a screen-space delta (drag). */
  panBy(dxPx: number, dyPx: number): void {
    this.x -= dxPx / this.zoom;
    this.y -= dyPx / this.zoom;
    this.flyT = -1;
  }

  /** Start inertia with a screen-space velocity (px/s). */
  fling(vxPx: number, vyPx: number): void {
    this.vx = vxPx;
    this.vy = vyPx;
  }

  stop(): void {
    this.vx = this.vy = 0;
    this.flyT = -1;
  }

  flyTo(x: number, y: number, zoom: number, durationMs: number): void {
    const z = clampZoom(zoom);
    this.vx = this.vy = 0;
    if (durationMs <= 0) {
      this.x = x;
      this.y = y;
      this.zoom = z;
      this.flyT = -1;
      return;
    }
    this.from.x = this.x;
    this.from.y = this.y;
    this.from.zoom = this.zoom;
    this.to.x = x;
    this.to.y = y;
    this.to.zoom = z;
    this.flyMs = durationMs;
    this.flyT = 0;
  }

  isAnimating(): boolean {
    return this.flyT >= 0 || this.vx !== 0 || this.vy !== 0;
  }

  /** Advance animations by dt seconds. Returns true when the camera moved. */
  update(dt: number): boolean {
    let moved = false;
    if (this.flyT >= 0) {
      this.flyT += dt * 1000;
      const t = Math.min(1, this.flyT / this.flyMs);
      const e = easeInOutCubic(t);
      this.x = this.from.x + (this.to.x - this.from.x) * e;
      this.y = this.from.y + (this.to.y - this.from.y) * e;
      // Zoom interpolates in log space so the fly feels uniform.
      this.zoom = Math.exp(Math.log(this.from.zoom) + (Math.log(this.to.zoom) - Math.log(this.from.zoom)) * e);
      if (t >= 1) {
        this.x = this.to.x;
        this.y = this.to.y;
        this.zoom = this.to.zoom;
        this.flyT = -1;
      }
      moved = true;
    } else if (this.vx !== 0 || this.vy !== 0) {
      this.x -= (this.vx * dt) / this.zoom;
      this.y -= (this.vy * dt) / this.zoom;
      const k = Math.exp(-INERTIA_DECAY * dt);
      this.vx *= k;
      this.vy *= k;
      if (Math.hypot(this.vx, this.vy) < INERTIA_STOP) this.vx = this.vy = 0;
      moved = true;
    }
    return moved;
  }
}
