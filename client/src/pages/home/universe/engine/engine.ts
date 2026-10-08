// Wires layout + camera + renderer + input into the UniverseEngine contract from ../types.

import type { Camera, EngineOptions, FlyOptions, LiveValue, NodeId, UniverseEngine, ZoomLevel } from "../types";
import { CameraController, FLY_MS, ZOOM_MAX, ZOOM_MIN, naturalZoomFor } from "./camera";
import { attachInput, hitTest } from "./input";
import { REGION_RING, layoutGraph } from "./layout";
import { Renderer, buildScene, screenRadius, type FrameState } from "./render";
import { createStars } from "./stars";

const KEY_PAN_PX = 80;
const KEY_ZOOM = 1.25;
/** Camera is "inside" a region when its centre is within this many world units of the region's centre. */
const REGION_RADIUS = REGION_RING * 0.62;

/** Galaxy zoom that fits the region ring in the viewport (1 on desktop, smaller on phones). */
function homeZoomFor(width: number, height: number): number {
  return Math.min(1, Math.max(ZOOM_MIN, Math.min(width, height) / (2 * (REGION_RING + 160))));
}

export function createEngine(opts: EngineOptions): UniverseEngine {
  const { canvas, graph, reducedMotion, callbacks } = opts;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("universe: 2D canvas unsupported");

  const layout = layoutGraph(graph);
  const scene = buildScene(graph, layout);
  const renderer = new Renderer(ctx, scene, createStars());
  const cam = new CameraController();
  const n = scene.nodes.length;
  const hitR = new Float32Array(n);
  const hitActive = new Uint8Array(n);
  const pt = { x: 0, y: 0 };

  const state: FrameState = { cam, t: 0, hover: -1, selected: -1, reducedMotion };
  let running = false;
  let started = false;
  let destroyed = false;
  let raf = 0;
  let lastFrame = 0;
  let clock = 0;
  const lastCam: Camera = { x: NaN, y: NaN, zoom: NaN };
  let lastLevel: ZoomLevel | null = null;

  // ---- sizing -------------------------------------------------------------------------------------------
  function resize(): void {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    const dpr = Math.min(2, typeof devicePixelRatio === "number" ? devicePixelRatio : 1);
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    cam.setViewport(w, h);
    wake();
  }

  // ---- frame loop ---------------------------------------------------------------------------------------
  function anyPulse(): boolean {
    if (reducedMotion) return false;
    for (let i = 0; i < n; i++) {
      const lv = scene.live[i];
      if (lv && lv.intensity > 0) return true;
    }
    return false;
  }

  function frame(now: number): void {
    raf = 0;
    if (destroyed) return;
    const dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    if (!reducedMotion) clock += dt;
    state.t = clock;

    const moved = cam.update(dt);
    renderer.draw(state);

    if (moved || cam.x !== lastCam.x || cam.y !== lastCam.y || cam.zoom !== lastCam.zoom) {
      lastCam.x = cam.x;
      lastCam.y = cam.y;
      lastCam.zoom = cam.zoom;
      lastLevel = cam.level();
      callbacks.onCamera(cam.get(), lastLevel);
    }

    // Keep going while something animates (stars drift unless reducedMotion); otherwise idle until woken.
    const animating = cam.isAnimating() || !reducedMotion || anyPulse();
    if (animating) raf = requestAnimationFrame(frame);
    else {
      running = false;
      lastFrame = 0;
    }
  }

  function wake(): void {
    if (!started || destroyed || running) return;
    running = true;
    raf = requestAnimationFrame(frame);
  }

  // ---- hit testing ---------------------------------------------------------------------------------------
  function refreshHit(): void {
    renderer.projectAll(cam);
    const z = cam.zoom;
    for (let i = 0; i < n; i++) {
      const sn = scene.nodes[i];
      hitR[i] = screenRadius(sn.node.kind, sn.r, z);
      const k = sn.node.kind;
      hitActive[i] =
        scene.visible[i] && (k === "core" || k === "region" || (k === "topic" ? z >= 1.2 : z >= 1.7)) ? 1 : 0;
    }
  }
  function hit(sx: number, sy: number): number {
    refreshHit();
    return hitTest(sx, sy, scene.sx, scene.sy, hitR, hitActive);
  }

  function setHover(i: number): void {
    if (i === state.hover) return;
    state.hover = i;
    canvas.style.cursor = i >= 0 ? "pointer" : "";
    callbacks.onHover(i >= 0 ? scene.nodes[i].node : null);
    wake();
  }

  function revealIndex(i: number): void {
    const sn = scene.nodes[i];
    if (!sn.node.hidden || scene.revealed[i]) return;
    scene.revealed[i] = 1;
    callbacks.onReveal(sn.node);
    wake();
  }

  function flyToIndex(i: number, o?: FlyOptions): void {
    const sn = scene.nodes[i];
    const zoom = o?.zoom ?? naturalZoomFor(sn.node.kind);
    cam.flyTo(sn.x, sn.y, zoom, reducedMotion ? 0 : (o?.durationMs ?? FLY_MS));
    state.selected = i;
    wake();
  }

  function zoomOut(): void {
    cam.flyTo(0, 0, homeZoomFor(cam.width, cam.height), reducedMotion ? 0 : FLY_MS);
    state.selected = -1;
    wake();
  }

  // ---- input ---------------------------------------------------------------------------------------------
  const detachInput = attachInput(canvas, {
    panBy(dx, dy) {
      cam.stop();
      cam.panBy(dx, dy);
      wake();
    },
    panEnd(vx, vy) {
      cam.fling(vx, vy);
      wake();
    },
    zoomAt(sx, sy, factor) {
      cam.zoomAt(sx, sy, factor);
      wake();
    },
    click(sx, sy) {
      const i = hit(sx, sy);
      if (i >= 0) {
        revealIndex(i);
        flyToIndex(i);
        callbacks.onSelect(scene.nodes[i].node);
      } else if (cam.level() === "planet" && state.selected >= 0) {
        state.selected = -1;
        callbacks.onSelect(null);
        wake();
      }
    },
    doubleClick(sx, sy) {
      const i = hit(sx, sy);
      if (i >= 0) {
        revealIndex(i);
        flyToIndex(i, { zoom: Math.min(ZOOM_MAX, naturalZoomFor(scene.nodes[i].node.kind) * 1.5) });
        callbacks.onSelect(scene.nodes[i].node);
      } else {
        cam.screenToWorld(sx, sy, pt);
        cam.flyTo(pt.x, pt.y, Math.min(ZOOM_MAX, cam.zoom * 2), reducedMotion ? 0 : FLY_MS * 0.7);
        wake();
      }
    },
    move(sx, sy) {
      setHover(hit(sx, sy));
    },
    leave() {
      setHover(-1);
    },
    key(action) {
      const cx = cam.width / 2;
      const cy = cam.height / 2;
      switch (action) {
        case "up": cam.panBy(0, KEY_PAN_PX); break;
        case "down": cam.panBy(0, -KEY_PAN_PX); break;
        case "left": cam.panBy(KEY_PAN_PX, 0); break;
        case "right": cam.panBy(-KEY_PAN_PX, 0); break;
        case "in": cam.zoomAt(cx, cy, KEY_ZOOM); break;
        case "out": cam.zoomAt(cx, cy, 1 / KEY_ZOOM); break;
        case "escape":
        case "home": zoomOut(); break;
      }
      wake();
    },
    wake,
  });

  canvas.style.touchAction = "none";
  canvas.style.outline = "none";
  if (!canvas.hasAttribute("tabindex")) canvas.tabIndex = 0;

  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => resize()) : null;
  ro?.observe(canvas);

  // Redraw once web fonts arrive so labels don't stay in the fallback face.
  const fonts = typeof document !== "undefined" ? document.fonts : undefined;
  fonts?.ready.then(() => wake()).catch(() => {});

  // ---- public API ----------------------------------------------------------------------------------------
  const engine: UniverseEngine = {
    start() {
      if (started || destroyed) return;
      started = true;
      resize();
      cam.set(0, 0, homeZoomFor(cam.width, cam.height));
      wake();
    },
    destroy() {
      destroyed = true;
      running = false;
      if (raf) cancelAnimationFrame(raf);
      detachInput();
      ro?.disconnect();
      canvas.style.cursor = "";
    },
    resize,
    flyTo(id, o) {
      const i = scene.index.get(id);
      if (i === undefined) return;
      revealIndex(i);
      flyToIndex(i, o);
    },
    zoomOut,
    project(id) {
      const i = scene.index.get(id);
      if (i === undefined) return null;
      const sn = scene.nodes[i];
      cam.worldToScreen(sn.x, sn.y, pt);
      const r = screenRadius(sn.node.kind, sn.r, cam.zoom);
      if (pt.x + r < 0 || pt.y + r < 0 || pt.x - r > cam.width || pt.y - r > cam.height) return null;
      return { x: pt.x, y: pt.y, r };
    },
    setLive(values: Partial<Record<NodeId, LiveValue>>) {
      for (const id in values) {
        const i = scene.index.get(id);
        if (i !== undefined) scene.live[i] = values[id];
      }
      wake();
    },
    reveal(id) {
      const i = scene.index.get(id);
      if (i !== undefined) revealIndex(i);
    },
    getCamera: () => cam.get(),
    getLevel: () => cam.level(),
    currentRegion() {
      let best: NodeId | null = null;
      let bestD = REGION_RADIUS;
      for (let i = 0; i < n; i++) {
        const sn = scene.nodes[i];
        if (sn.node.kind !== "region") continue;
        const d = Math.hypot(sn.x - cam.x, sn.y - cam.y);
        if (d < bestD) {
          bestD = d;
          best = sn.node.id;
        }
      }
      return best;
    },
  };
  return engine;
}
