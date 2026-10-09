// Pure maths for the globe engine: lat/lon ↔ unit sphere, great circles, the yaw/pitch rotation that brings a
// place to the front, camera distances ↔ zoom levels, projection and occlusion. No DOM, no WebGL — unit-tested.
// Conventions: three.js axes (+y north pole), camera on +z looking at the origin, globe radius 1.

import { Quaternion, Vector3 } from "three";

export const DEG = Math.PI / 180;
export type Vec3 = [number, number, number];

const X_AXIS = new Vector3(1, 0, 0);
const Y_AXIS = new Vector3(0, 1, 0);
const qx = new Quaternion();
const qy = new Quaternion();

/** lon/lat (degrees) → xyz on a sphere of radius r. Same convention as components/cld/globe/geo.ts toVec. */
export function latLonToVec3(lat: number, lon: number, r = 1): Vec3 {
  const phi = (90 - lat) * DEG;
  const theta = (lon + 180) * DEG;
  return [-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta)];
}

export function angleBetween(a: Vec3, b: Vec3): number {
  return Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
}

/** Point at fraction t along the great circle from a to b (unit vectors); w = angleBetween(a, b). */
export function greatCircle(a: Vec3, b: Vec3, t: number, w = angleBetween(a, b)): Vec3 {
  const s = Math.sin(w);
  if (s < 1e-6) return [a[0], a[1], a[2]];
  const ka = Math.sin((1 - t) * w) / s;
  const kb = Math.sin(t * w) / s;
  return [ka * a[0] + kb * b[0], ka * a[1] + kb * b[1], ka * a[2] + kb * b[2]];
}

/** Road polyline ([lon, lat] points) → line-segment pairs (xyz, xyz, …) lifted slightly off the surface. */
export function roadSegments(coords: [number, number][], lift = 1.002): Float32Array {
  const n = Math.max(0, coords.length - 1);
  const out = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    const a = latLonToVec3(coords[i][1], coords[i][0], lift);
    const b = latLonToVec3(coords[i + 1][1], coords[i + 1][0], lift);
    out.set(a, i * 6);
    out.set(b, i * 6 + 3);
  }
  return out;
}

/** Peak lift of a cable arc: short hops hug the surface (~1.03 R), the longest rise to ~1.15 R so 15 arcs stay apart. */
export function cableLift(angle: number): number {
  return 0.03 + 0.12 * Math.min(1, angle / Math.PI);
}

/** Midpoint of the arc (unit vector): where a cable is "mostly" — used to fade far-side cables. */
export function cableMidpoint(a: Vec3, b: Vec3): Vec3 {
  return greatCircle(a, b, 0.5);
}

/** Great-circle arc between two unit vectors as line-segment pairs, lifted by cableLift · sin(πt). */
export function cableSegments(a: Vec3, b: Vec3, steps = 32): Float32Array {
  const w = angleBetween(a, b);
  const lift = cableLift(w);
  const out = new Float32Array((steps - 1) * 6);
  let prev = a;
  for (let i = 1; i < steps; i++) {
    const t = i / (steps - 1);
    const p = greatCircle(a, b, t, w);
    const r = 1 + lift * Math.sin(Math.PI * t);
    const cur: Vec3 = [p[0] * r, p[1] * r, p[2] * r];
    out.set(prev, (i - 1) * 6);
    out.set(cur, (i - 1) * 6 + 3);
    prev = cur;
  }
  return out;
}

// ---- rotation -------------------------------------------------------------------------------------------
// The globe's orientation is yaw (about world Y) then pitch (about world X): q = Rx(pitch) · Ry(yaw).
// Yaw is free; pitch is clamped so the poles never swing past the camera.

/** Looking slightly from the north: the focused place sits a touch below centre and the pole leans in. */
export const DEFAULT_TILT = 12 * DEG;
export const PITCH_MAX = 70 * DEG;

/** Yaw/pitch that put (lat, lon) in front of the camera, tilted by `tilt` toward the north. */
export function facingRotation(lat: number, lon: number, tilt = DEFAULT_TILT): { yaw: number; pitch: number } {
  const p = latLonToVec3(lat, lon);
  return { yaw: -Math.atan2(p[0], p[2]), pitch: clampPitch(lat * DEG + tilt) };
}

/** Tilt scaled to what the view shows: a fraction of the cap's angular radius, never more than the default. */
export function tiltForArc(arcDeg: number): number {
  return Math.min(DEFAULT_TILT, 0.3 * arcDeg * DEG);
}

export function clampPitch(pitch: number): number {
  return pitch < -PITCH_MAX ? -PITCH_MAX : pitch > PITCH_MAX ? PITCH_MAX : pitch;
}

/** Signed shortest turn from angle a to angle b, in (−π, π]. */
export function shortestDelta(a: number, b: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

/** Writes Rx(pitch) · Ry(yaw) into `out` (yaw applied first). */
export function rotationQuat(yaw: number, pitch: number, out: Quaternion): Quaternion {
  qx.setFromAxisAngle(X_AXIS, pitch);
  qy.setFromAxisAngle(Y_AXIS, yaw);
  return out.copy(qx).multiply(qy);
}

// ---- camera distance ↔ level ---------------------------------------------------------------------------

export const FOV = 30; // vertical, degrees
export const D_MIN = 1.15;
export const D_MAX = 7;
/** Angular radius of what should fill the view at each level. */
export const SYSTEM_ARC = 8; // degrees: a region and its topic cities
export const PLANET_ARC = 2.5;
export const FIT_FRACTION = 0.7;

export interface LevelThresholds {
  /** Below this distance the level is planet … */
  planet: number;
  /** … below this it is system, otherwise galaxy. */
  system: number;
}

/** Thresholds halfway (geometrically) between the fitted planet, system and galaxy distances for this viewport. */
export function levelThresholds(fovDeg: number, aspect: number): LevelThresholds {
  const planet = distanceForArc(PLANET_ARC, FIT_FRACTION, fovDeg, aspect);
  const system = distanceForArc(SYSTEM_ARC, FIT_FRACTION, fovDeg, aspect);
  const galaxy = galaxyDistance(fovDeg, aspect);
  return { planet: Math.sqrt(planet * system), system: Math.sqrt(system * galaxy) };
}

export function levelForDistance(d: number, t: LevelThresholds): "galaxy" | "system" | "planet" {
  return d < t.planet ? "planet" : d < t.system ? "system" : "galaxy";
}

export function clampDistance(d: number): number {
  return d < D_MIN ? D_MIN : d > D_MAX ? D_MAX : d;
}

/** tan(half-fov) along the shorter viewport side. */
export function shortHalfTan(fovDeg: number, aspect: number): number {
  return Math.tan((fovDeg / 2) * DEG) * Math.min(1, aspect);
}

/** Sphere diameter as a fraction of the short side at galaxy level (owner: breathing room). */
export const GALAXY_FRACTION = 0.55;

/** Distance at which the sphere's diameter spans `fraction` of the short side. */
export function galaxyDistance(fovDeg: number, aspect: number, fraction = GALAXY_FRACTION): number {
  const r = fraction * shortHalfTan(fovDeg, aspect); // tan of the sphere's angular radius
  return Math.sqrt(1 + r * r) / r;
}

/** Distance at which a surface cap of angular radius `arcDeg` spans `fraction` of the short side. */
export function distanceForArc(arcDeg: number, fraction: number, fovDeg: number, aspect: number): number {
  const a = arcDeg * DEG;
  return Math.cos(a) + Math.sin(a) / (fraction * shortHalfTan(fovDeg, aspect));
}

// ---- projection + occlusion ----------------------------------------------------------------------------

/** A unit-sphere point (already rotated into view space) faces the camera at (0, 0, d) iff z > 1/d. */
export function isFrontFacing(z: number, d: number): boolean {
  return z > 1 / d;
}

/** 0 on the far side, 1 well inside the visible disc, smooth across the limb. */
export function limbFade(z: number, d: number, width = 0.1): number {
  return smoothstep(1 / d, 1 / d + width, z);
}

/** View-space point → CSS px on a w×h viewport for a camera at (0, 0, d) looking at the origin. */
export function projectToScreen(
  x: number,
  y: number,
  z: number,
  d: number,
  fovDeg: number,
  w: number,
  h: number,
  out: { x: number; y: number },
): void {
  const depth = d - z; // distance in front of the camera
  const tv = Math.tan((fovDeg / 2) * DEG);
  const th = tv * (w / h);
  out.x = ((x / depth / th + 1) / 2) * w;
  out.y = ((1 - y / depth / tv) / 2) * h;
}

/** CSS px → the nearest unit-sphere point (view space) under the pointer, or false when the ray misses. */
export function unprojectToSphere(
  sx: number,
  sy: number,
  w: number,
  h: number,
  fovDeg: number,
  d: number,
  out: { x: number; y: number; z: number },
): boolean {
  const tv = Math.tan((fovDeg / 2) * DEG);
  const th = tv * (w / h);
  const dx = ((sx / w) * 2 - 1) * th;
  const dy = (1 - (sy / h) * 2) * tv;
  const dz = -1;
  // |o + t·dir|² = 1 with o = (0, 0, d).
  const a = dx * dx + dy * dy + dz * dz;
  const b = 2 * d * dz;
  const c = d * d - 1;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return false;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  out.x = dx * t;
  out.y = dy * t;
  out.z = d + dz * t;
  return true;
}

/** Apparent radius of the sphere in CSS px. */
export function sphereScreenRadius(d: number, fovDeg: number, w: number, h: number): number {
  return ((h / 2) * Math.tan(Math.asin(Math.min(1, 1 / d)))) / Math.tan((fovDeg / 2) * DEG);
}

/** Radians of spin per pixel of drag so the surface roughly follows the pointer. */
export function radiansPerPixel(d: number, fovDeg: number, w: number, h: number): number {
  return 1 / Math.max(1, sphereScreenRadius(d, fovDeg, w, h));
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
