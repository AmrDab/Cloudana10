// The globe engine: implements UniverseEngine (../types) on a three.js sphere + a 2D overlay for markers and
// labels. Camera sits on +z; the globe group rotates (yaw about Y, pitch about X, clamped). Levels come from
// the camera distance. Pointer/keyboard handling is shared with the 2D engine (../engine/input).
// Throws when WebGL is unavailable so the shell can fall back (see index.ts webglAvailable()).

import * as THREE from "three";
import type { Camera, EngineOptions, FlyOptions, LiveValue, NodeId, Tone, UNode, UniverseEngine, ZoomLevel } from "../types";
import { attachInput, hitTest } from "../engine/input";
import { CABLES, PLACES, ROADS, type Place } from "../world";
import {
  D_MAX,
  D_MIN,
  DEFAULT_TILT,
  DEG,
  FIT_FRACTION,
  FOV,
  PLANET_ARC,
  SYSTEM_ARC,
  cableMidpoint,
  cableSegments,
  clampPitch,
  distanceForArc,
  easeInOutCubic,
  facingRotation,
  galaxyDistance,
  isFrontFacing,
  latLonToVec3,
  levelForDistance,
  levelThresholds,
  limbFade,
  projectToScreen,
  radiansPerPixel,
  roadSegments,
  rotationQuat,
  shortestDelta,
  smoothstep,
  sphereScreenRadius,
  tiltForArc,
  unprojectToSphere,
} from "./geo3";
import { CABLE_OPACITY, GLOBE_COLOR, buildGlobeScene } from "./scene";
import { Overlay, TONE_COLOR, type Marker, type MarkerSet, type OverlayFrame } from "./overlay";

export const FLY_MS = 900;
const AUTO_ROTATE = 4 * DEG; // rad/s
const IDLE_FIRST_MS = 1500;
const IDLE_MS = 20000;
const KEY_SPIN = 6 * DEG;
const KEY_ZOOM = 1.25;
const INERTIA_DECAY = 5; // 1/s
const INERTIA_STOP = 0.003; // rad/s
/** A region counts as "current" when within this angle of the view centre. */
const REGION_FOCUS_COS = Math.cos(35 * DEG);
/** Landing view: the Atlantic, with four regions in sight. */
const HOME_LAT = 20;
const HOME_LON = -25;
const VIEW_MARGIN = 60;

export function createGlobeEngine(opts: EngineOptions): UniverseEngine {
  const { canvas, graph, reducedMotion, callbacks } = opts;

  // ---- graph → markers ----------------------------------------------------------------------------------
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const parentOf = (id: NodeId) => byId.get(id)?.parent;
  const toneOf = (n: UNode): Tone => {
    let cur: UNode | undefined = n;
    while (cur) {
      if (cur.tone) return cur.tone;
      cur = cur.parent ? byId.get(cur.parent) : undefined;
    }
    return "neutral";
  };
  const markers: Marker[] = [];
  const index = new Map<NodeId, number>();
  for (const node of graph.nodes) {
    const place: Place | undefined = PLACES[node.id];
    if (!place || (node.kind !== "region" && node.kind !== "topic")) continue;
    index.set(node.id, markers.length);
    markers.push({ node, place, kind: node.kind === "region" ? 1 : 2, parent: -1, color: TONE_COLOR[toneOf(node)] });
  }
  for (const m of markers) m.parent = m.node.parent !== undefined ? (index.get(m.node.parent) ?? -1) : -1;
  const n = markers.length;
  const ms: MarkerSet = {
    markers,
    pos: new Float32Array(n * 3),
    sx: new Float32Array(n),
    sy: new Float32Array(n),
    fade: new Float32Array(n),
    lod: new Float32Array(n),
    r: new Float32Array(n),
    vis: new Uint8Array(n),
    hitActive: new Uint8Array(n),
    revealed: new Uint8Array(n),
    live: new Array<LiveValue | undefined>(n).fill(undefined),
  };
  for (let i = 0; i < n; i++) ms.pos.set(latLonToVec3(markers[i].place.lat, markers[i].place.lon), i * 3);
  /** Rotated z per marker (view space): how much it faces the camera. */
  const vz = new Float32Array(n);
  const regionIdx: number[] = [];
  for (let i = 0; i < n; i++) if (markers[i].kind === 1) regionIdx.push(i);

  /** Marker drawn for a node: itself, or (for leaves) the nearest ancestor with a place. */
  const markerFor = (id: NodeId): number => {
    let cur: NodeId | undefined = id;
    while (cur !== undefined) {
      const i = index.get(cur);
      if (i !== undefined) return i;
      cur = parentOf(cur);
    }
    return -1;
  };

  // ---- geometry (built once) ----------------------------------------------------------------------------
  const concat = (parts: Float32Array[]) => {
    let len = 0;
    for (const p of parts) len += p.length;
    const out = new Float32Array(len);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  };
  /** Region marker a road belongs to: the region itself or the parent of either endpoint. */
  const regionOfRoad = (from: NodeId, to: NodeId): number => {
    for (const id of [from, to]) {
      const i = markerFor(id);
      if (i < 0) continue;
      return markers[i].kind === 1 ? i : markers[i].parent;
    }
    return -1;
  };
  const roadInputs = regionIdx.map((ri) => ({
    color: markers[ri].color,
    segments: concat(ROADS.filter((r) => regionOfRoad(r.from, r.to) === ri).map((r) => roadSegments(r.coords))),
  }));
  const cablePairs = CABLES.filter((c) => PLACES[c.from] && PLACES[c.to]).map((c) => [
    latLonToVec3(PLACES[c.from].lat, PLACES[c.from].lon),
    latLonToVec3(PLACES[c.to].lat, PLACES[c.to].lon),
  ]);
  const cables = cablePairs.map(([a, b]) => cableSegments(a, b));
  /** Cable midpoints (unit vectors), 3 per cable: rotated each frame to fade arcs on the far side. */
  const cableMid = new Float32Array(cablePairs.length * 3);
  cablePairs.forEach(([a, b], i) => cableMid.set(cableMidpoint(a, b), i * 3));

  // ---- WebGL + overlay -----------------------------------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setClearColor(GLOBE_COLOR.bg, 1);
  const gs = buildGlobeScene(roadInputs, cables);
  const overlay = new Overlay();
  canvas.parentNode?.insertBefore(overlay.canvas, canvas.nextSibling);

  // ---- camera state --------------------------------------------------------------------------------------
  let width = 1;
  let height = 1;
  let galaxyD = 4;
  let systemD = 1.8;
  let planetD = 1.25;
  let thresholds = levelThresholds(FOV, 1);
  let yaw = 0;
  let pitch = 0;
  let dist = 4;
  let vyaw = 0;
  let vpitch = 0;
  /** True while the distance is "whole sphere": resize keeps it fitted. */
  let atHome = true;
  const fly = { t: -1, ms: FLY_MS, y0: 0, p0: 0, d0: 1, y1: 0, p1: 0, d1: 1 };
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const pt = { x: 0, y: 0 };
  const sp = { x: 0, y: 0, z: 0 };

  const frame: OverlayFrame = { t: 0, hover: -1, selected: -1, focusedRegion: -1, focusedTopic: -1, planet: 0, reducedMotion };
  let running = false;
  let started = false;
  let destroyed = false;
  let lost = false;
  let raf = 0;
  let idleTimer = 0;
  let idleAt = Infinity;
  let lastFrame = 0;
  let clock = 0;
  let emphasisSettled = false;
  let lastYaw = NaN;
  let lastPitch = NaN;
  let lastDist = NaN;

  const dMax = () => Math.max(D_MAX, galaxyD);
  const clampD = (d: number) => (d < D_MIN ? D_MIN : d > dMax() ? dMax() : d);
  const level = (): ZoomLevel => levelForDistance(dist, thresholds);
  const now = () => performance.now();

  function interact(): void {
    idleAt = now() + IDLE_MS;
  }

  function startFly(toYaw: number, toPitch: number, toD: number, ms: number): void {
    vyaw = vpitch = 0;
    toPitch = clampPitch(toPitch);
    toD = clampD(toD);
    if (ms <= 0) {
      yaw = toYaw;
      pitch = toPitch;
      dist = toD;
      fly.t = -1;
      return;
    }
    fly.y0 = yaw;
    fly.p0 = pitch;
    fly.d0 = dist;
    fly.y1 = yaw + shortestDelta(yaw, toYaw);
    fly.p1 = toPitch;
    fly.d1 = toD;
    fly.ms = ms;
    fly.t = 0;
  }

  function autoRotating(t: number): boolean {
    return !reducedMotion && fly.t < 0 && level() === "galaxy" && t >= idleAt;
  }

  /** Advance fly / inertia / auto-rotation. Returns true when the camera moved. */
  function updateCamera(dt: number, t: number): boolean {
    if (fly.t >= 0) {
      fly.t += dt * 1000;
      const k = Math.min(1, fly.t / fly.ms);
      const e = easeInOutCubic(k);
      yaw = fly.y0 + (fly.y1 - fly.y0) * e;
      pitch = fly.p0 + (fly.p1 - fly.p0) * e;
      dist = Math.exp(Math.log(fly.d0) + (Math.log(fly.d1) - Math.log(fly.d0)) * e);
      if (k >= 1) {
        yaw = fly.y1;
        pitch = fly.p1;
        dist = fly.d1;
        fly.t = -1;
      }
      return true;
    }
    if (vyaw !== 0 || vpitch !== 0) {
      yaw += vyaw * dt;
      pitch = clampPitch(pitch + vpitch * dt);
      const k = Math.exp(-INERTIA_DECAY * dt);
      vyaw *= k;
      vpitch *= k;
      if (Math.hypot(vyaw, vpitch) < INERTIA_STOP) vyaw = vpitch = 0;
      return true;
    }
    if (autoRotating(t)) {
      yaw += AUTO_ROTATE * dt;
      return true;
    }
    return false;
  }

  // ---- projection + LOD ----------------------------------------------------------------------------------
  function projectMarkers(): void {
    rotationQuat(yaw, pitch, q);
    const { pos, sx, sy, fade, vis } = ms;
    for (let i = 0; i < n; i++) {
      v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyQuaternion(q);
      vz[i] = v.z;
      fade[i] = limbFade(v.z, dist);
      projectToScreen(v.x, v.y, v.z, dist, FOV, width, height, pt);
      sx[i] = pt.x;
      sy[i] = pt.y;
      vis[i] =
        fade[i] > 0.001 && pt.x > -VIEW_MARGIN && pt.x < width + VIEW_MARGIN && pt.y > -VIEW_MARGIN && pt.y < height + VIEW_MARGIN
          ? 1
          : 0;
    }
  }

  function nearestToCentre(kind: 1 | 2, parent: number): number {
    let best = -1;
    let bestZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const m = markers[i];
      if (m.kind !== kind || (kind === 2 && m.parent !== parent)) continue;
      if (vz[i] > bestZ) {
        bestZ = vz[i];
        best = i;
      }
    }
    return best;
  }

  /** Per-marker visibility + radius from the camera distance; also the road emphasis targets. */
  function updateLod(dt: number): void {
    const topicRamp = 1 - smoothstep(thresholds.system * 0.85, thresholds.system * 1.15, dist);
    const planetRamp = 1 - smoothstep(thresholds.planet * 0.9, thresholds.planet * 1.1, dist);
    const fr = nearestToCentre(1, -1);
    const sel = frame.selected;
    const ft = sel >= 0 && markers[sel].kind === 2 ? sel : planetRamp > 0 ? nearestToCentre(2, fr) : -1;
    frame.focusedRegion = fr;
    frame.focusedTopic = ft;
    frame.planet = planetRamp;
    const { lod, r, fade, hitActive } = ms;
    for (let i = 0; i < n; i++) {
      const m = markers[i];
      if (m.kind === 1) {
        lod[i] = i === fr ? 1 : 1 - 0.6 * topicRamp;
        r[i] = 8 + (i === fr ? 3 * topicRamp : 0);
      } else {
        lod[i] = m.parent === fr ? topicRamp : 0;
        r[i] = 5 + (i === ft ? 3 * planetRamp : 0);
      }
      hitActive[i] = lod[i] * fade[i] > 0.3 ? 1 : 0;
    }

    // Roads: the focused region brightens, the others recede as the camera closes in.
    emphasisSettled = true;
    const k = reducedMotion ? 1 : Math.min(1, dt * 8);
    for (let j = 0; j < regionIdx.length; j++) {
      const focused = regionIdx[j] === fr;
      const core = focused ? 0.45 + 0.3 * topicRamp : 0.45 - 0.3 * topicRamp;
      const glow = focused ? 0.06 + 0.05 * topicRamp : 0.06 - 0.045 * topicRamp;
      const layer = gs.roads[j];
      layer.core.opacity += (core - layer.core.opacity) * k;
      layer.glow.opacity += (glow - layer.glow.opacity) * k;
      if (Math.abs(core - layer.core.opacity) > 0.005) emphasisSettled = false;
    }
    // Cables fade out as their midpoint turns away from the camera.
    for (let j = 0; j < gs.cables.length; j++) {
      v.set(cableMid[j * 3], cableMid[j * 3 + 1], cableMid[j * 3 + 2]).applyQuaternion(q);
      gs.cables[j].opacity = CABLE_OPACITY * smoothstep(-0.35, 0.35, v.z);
    }
  }

  function anyPulse(): boolean {
    if (reducedMotion) return false;
    for (let i = 0; i < n; i++) {
      const lv = ms.live[i];
      if (lv && lv.intensity > 0) return true;
    }
    return false;
  }

  // ---- frame loop ----------------------------------------------------------------------------------------
  let burstEnd = 0;
  let nextBurst = 2.5;

  function tick(t: number): void {
    raf = 0;
    if (destroyed) return;
    const dt = lastFrame ? Math.min(0.05, (t - lastFrame) / 1000) : 0;
    lastFrame = t;
    if (!reducedMotion) clock += dt;
    frame.t = clock;

    const moved = updateCamera(dt, t);
    projectMarkers();
    updateLod(dt);

    if (!lost) {
      gs.globe.quaternion.copy(q);
      gs.camera.position.z = dist;
      gs.uTime.value = clock;
      // Glitch bursts ride on the auto-rotation (the only time the loop runs continuously at rest).
      if (autoRotating(t)) {
        if (clock >= nextBurst) {
          burstEnd = clock + 0.12 + Math.random() * 0.25;
          nextBurst = burstEnd + 3 + Math.random() * 6;
        }
        gs.uGlitch.value = clock < burstEnd ? 0.5 + 0.5 * Math.random() : 0;
      } else gs.uGlitch.value = 0;
      renderer.render(gs.scene, gs.camera);
    }
    overlay.draw(ms, frame);

    if (moved || yaw !== lastYaw || pitch !== lastPitch || dist !== lastDist) {
      lastYaw = yaw;
      lastPitch = pitch;
      lastDist = dist;
      callbacks.onCamera(getCamera(), level());
    }

    const animating = fly.t >= 0 || vyaw !== 0 || vpitch !== 0 || autoRotating(t) || anyPulse() || !emphasisSettled;
    if (animating) raf = requestAnimationFrame(tick);
    else {
      running = false;
      lastFrame = 0;
      // Wake again when the idle auto-rotation is due.
      if (!reducedMotion && level() === "galaxy" && idleAt < Infinity) {
        clearTimeout(idleTimer);
        idleTimer = window.setTimeout(wake, Math.max(0, idleAt - t) + 16);
      }
    }
  }

  function wake(): void {
    if (!started || destroyed || running) return;
    running = true;
    raf = requestAnimationFrame(tick);
  }

  // ---- sizing --------------------------------------------------------------------------------------------
  function resize(): void {
    width = canvas.clientWidth || 1;
    height = canvas.clientHeight || 1;
    const dpr = Math.min(2, typeof devicePixelRatio === "number" ? devicePixelRatio : 1);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    gs.camera.aspect = width / height;
    gs.camera.updateProjectionMatrix();
    gs.setResolution(width, height);
    overlay.resize(canvas.offsetLeft, canvas.offsetTop, width, height, dpr);
    const aspect = width / height;
    galaxyD = galaxyDistance(FOV, aspect);
    systemD = distanceForArc(SYSTEM_ARC, FIT_FRACTION, FOV, aspect);
    planetD = distanceForArc(PLANET_ARC, FIT_FRACTION, FOV, aspect);
    thresholds = levelThresholds(FOV, aspect);
    if (atHome && fly.t < 0) dist = galaxyD;
    wake();
  }

  // ---- camera queries ------------------------------------------------------------------------------------
  /** Lat/lon under the view centre (the globe-frame direction that currently faces the camera). */
  function getCamera(): Camera {
    rotationQuat(yaw, pitch, q);
    v.set(0, 0, 1).applyQuaternion(q.invert());
    q.invert();
    const lat = 90 - Math.acos(Math.max(-1, Math.min(1, v.y))) / DEG;
    const lon = Math.atan2(v.z, -v.x) / DEG - 180;
    return { x: lon, y: lat, zoom: galaxyD / dist };
  }

  // ---- hit testing / selection ---------------------------------------------------------------------------
  function hit(sx: number, sy: number): number {
    projectMarkers();
    return hitTest(sx, sy, ms.sx, ms.sy, ms.r, ms.hitActive);
  }

  function setHover(i: number): void {
    if (i === frame.hover) return;
    frame.hover = i;
    canvas.style.cursor = i >= 0 ? "pointer" : "";
    callbacks.onHover(i >= 0 ? markers[i].node : null);
    wake();
  }

  function revealIndex(i: number): void {
    const m = markers[i];
    if (!m.node.hidden || ms.revealed[i]) return;
    ms.revealed[i] = 1;
    callbacks.onReveal(m.node);
    wake();
  }

  function distanceFor(kind: UNode["kind"]): number {
    return kind === "region" ? systemD : kind === "core" ? galaxyD : planetD;
  }

  /** Northward tilt for a target distance: a fraction of the cap the view will show. */
  function tiltFor(d: number): number {
    return tiltForArc(d >= thresholds.system ? 90 : d >= thresholds.planet ? SYSTEM_ARC : PLANET_ARC);
  }

  function flyToIndex(i: number, d: number, o?: FlyOptions): void {
    const m = markers[i];
    const rot = facingRotation(m.place.lat, m.place.lon, tiltFor(d));
    startFly(rot.yaw, rot.pitch, d, reducedMotion ? 0 : (o?.durationMs ?? FLY_MS));
    frame.selected = i;
    atHome = false;
    interact();
    wake();
  }

  function zoomOut(): void {
    startFly(yaw, DEFAULT_TILT + 8 * DEG, galaxyD, reducedMotion ? 0 : FLY_MS);
    frame.selected = -1;
    atHome = true;
    interact();
    wake();
  }

  // ---- input ---------------------------------------------------------------------------------------------
  const detachInput = attachInput(canvas, {
    panBy(dx, dy) {
      fly.t = -1;
      vyaw = vpitch = 0;
      const k = radiansPerPixel(dist, FOV, width, height);
      yaw += dx * k;
      pitch = clampPitch(pitch + dy * k);
      interact();
      wake();
    },
    panEnd(vx, vy) {
      const k = radiansPerPixel(dist, FOV, width, height);
      vyaw = vx * k;
      vpitch = vy * k;
      wake();
    },
    zoomAt(_sx, _sy, factor) {
      fly.t = -1;
      dist = clampD(dist / factor);
      atHome = false;
      interact();
      wake();
    },
    click(sx, sy) {
      interact();
      const i = hit(sx, sy);
      if (i >= 0) {
        revealIndex(i);
        flyToIndex(i, distanceFor(markers[i].node.kind));
        callbacks.onSelect(markers[i].node);
      } else if (level() === "planet" && frame.selected >= 0) {
        frame.selected = -1;
        callbacks.onSelect(null);
        wake();
      }
    },
    doubleClick(sx, sy) {
      interact();
      const i = hit(sx, sy);
      if (i >= 0) {
        revealIndex(i);
        flyToIndex(i, distanceFor(markers[i].node.kind) * 0.8);
        callbacks.onSelect(markers[i].node);
        return;
      }
      // Empty space: bring the point under the pointer to the centre and close in.
      const d = clampD(dist * 0.6);
      if (unprojectToSphere(sx, sy, width, height, FOV, dist, sp)) {
        rotationQuat(yaw, pitch, q);
        v.set(sp.x, sp.y, sp.z).applyQuaternion(q.invert());
        const lat = 90 - Math.acos(Math.max(-1, Math.min(1, v.y))) / DEG;
        const lon = Math.atan2(v.z, -v.x) / DEG - 180;
        const rot = facingRotation(lat, lon, tiltFor(d));
        startFly(rot.yaw, rot.pitch, d, reducedMotion ? 0 : FLY_MS * 0.7);
      } else startFly(yaw, pitch, d, reducedMotion ? 0 : FLY_MS * 0.7);
      atHome = false;
      wake();
    },
    move(sx, sy) {
      setHover(hit(sx, sy));
    },
    leave() {
      setHover(-1);
    },
    key(action) {
      interact();
      switch (action) {
        case "left": fly.t = -1; yaw -= KEY_SPIN; break;
        case "right": fly.t = -1; yaw += KEY_SPIN; break;
        case "up": fly.t = -1; pitch = clampPitch(pitch - KEY_SPIN); break;
        case "down": fly.t = -1; pitch = clampPitch(pitch + KEY_SPIN); break;
        case "in": fly.t = -1; dist = clampD(dist / KEY_ZOOM); atHome = false; break;
        case "out": fly.t = -1; dist = clampD(dist * KEY_ZOOM); atHome = false; break;
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

  const onContextLost = (e: Event) => {
    e.preventDefault();
    lost = true;
  };
  const onContextRestored = () => {
    lost = false;
    wake();
  };
  canvas.addEventListener("webglcontextlost", onContextLost);
  canvas.addEventListener("webglcontextrestored", onContextRestored);

  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => resize()) : null;
  ro?.observe(canvas);
  document.fonts?.ready.then(() => wake()).catch(() => {});

  // ---- public API ----------------------------------------------------------------------------------------
  return {
    start() {
      if (started || destroyed) return;
      started = true;
      resize();
      const home = facingRotation(HOME_LAT, HOME_LON);
      yaw = home.yaw;
      pitch = home.pitch;
      dist = galaxyD;
      atHome = true;
      idleAt = now() + IDLE_FIRST_MS;
      wake();
    },
    destroy() {
      destroyed = true;
      running = false;
      if (raf) cancelAnimationFrame(raf);
      clearTimeout(idleTimer);
      detachInput();
      ro?.disconnect();
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      gs.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      overlay.canvas.remove();
      canvas.style.cursor = "";
    },
    resize,
    flyTo(id, o) {
      if (id === graph.root) {
        zoomOut();
        return;
      }
      const i = markerFor(id);
      if (i < 0) return;
      revealIndex(i);
      const kind = byId.get(id)?.kind ?? "topic";
      flyToIndex(i, o?.zoom ? galaxyD / o.zoom : distanceFor(kind), o);
    },
    zoomOut,
    project(id) {
      if (id === graph.root) return { x: width / 2, y: height / 2, r: sphereScreenRadius(dist, FOV, width, height) };
      const i = markerFor(id);
      if (i < 0) return null;
      rotationQuat(yaw, pitch, q);
      v.set(ms.pos[i * 3], ms.pos[i * 3 + 1], ms.pos[i * 3 + 2]).applyQuaternion(q);
      if (!isFrontFacing(v.z, dist)) return null;
      projectToScreen(v.x, v.y, v.z, dist, FOV, width, height, pt);
      const r = ms.r[i] || 8;
      if (pt.x + r < 0 || pt.y + r < 0 || pt.x - r > width || pt.y - r > height) return null;
      return { x: pt.x, y: pt.y, r };
    },
    setLive(values: Partial<Record<NodeId, LiveValue>>) {
      for (const id in values) {
        const i = index.get(id);
        if (i !== undefined) ms.live[i] = values[id];
      }
      wake();
    },
    reveal(id) {
      const i = index.get(id);
      if (i !== undefined) revealIndex(i);
    },
    getCamera,
    getLevel: level,
    currentRegion() {
      if (level() === "galaxy") return null;
      projectMarkers();
      const i = nearestToCentre(1, -1);
      return i >= 0 && vz[i] > REGION_FOCUS_COS ? markers[i].node.id : null;
    },
  };
}
