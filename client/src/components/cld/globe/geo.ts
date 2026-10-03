// Geometry for the homepage globe: coastline sketch, datacenter hubs, home nodes sampled on land,
// and great-circle arcs between them. Pure math, no Three.js — testable and tree-shakeable.
import land from "./land.json";

export type Vec3 = [number, number, number];

/** lon/lat (degrees) → unit-sphere xyz, Three.js convention (+y up). */
export function toVec(lon: number, lat: number, r = 1): Vec3 {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lon + 180) * Math.PI) / 180;
  return [-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta)];
}

/** Coastlines as line-segment pairs (xyz, xyz, …) on the unit sphere. */
export function landSegments(): Float32Array {
  const strips = land as number[][];
  let count = 0;
  for (const s of strips) count += s.length / 2 - 1;
  const out = new Float32Array(count * 6);
  let o = 0;
  for (const s of strips) {
    let prev = toVec(s[0] / 10, s[1] / 10);
    for (let i = 2; i < s.length; i += 2) {
      const cur = toVec(s[i] / 10, s[i + 1] / 10);
      out.set(prev, o);
      out.set(cur, o + 3);
      o += 6;
      prev = cur;
    }
  }
  return out;
}

/** Lat/long graticule every `step` degrees. */
export function graticuleSegments(step = 15, res = 4): Float32Array {
  const pts: number[] = [];
  for (let lat = -75; lat <= 75; lat += step) {
    for (let lon = -180; lon < 180; lon += res) pts.push(...toVec(lon, lat), ...toVec(lon + res, lat));
  }
  for (let lon = -180; lon < 180; lon += step) {
    for (let lat = -90; lat < 90; lat += res) pts.push(...toVec(lon, lat), ...toVec(lon, lat + res));
  }
  return new Float32Array(pts);
}

export type Hub = { name: string; lon: number; lat: number };
/** Illustrative datacenter regions — TODO(owner): replace with reported node regions when they exist. */
export const HUBS: Hub[] = [
  { name: "Ashburn", lon: -77.5, lat: 39.0 },
  { name: "Toronto", lon: -79.4, lat: 43.7 },
  { name: "Los Angeles", lon: -118.2, lat: 34.1 },
  { name: "São Paulo", lon: -46.6, lat: -23.6 },
  { name: "London", lon: -0.1, lat: 51.5 },
  { name: "Frankfurt", lon: 8.7, lat: 50.1 },
  { name: "Stockholm", lon: 18.1, lat: 59.3 },
  { name: "Johannesburg", lon: 28.0, lat: -26.2 },
  { name: "Dubai", lon: 55.3, lat: 25.3 },
  { name: "Mumbai", lon: 72.9, lat: 19.1 },
  { name: "Singapore", lon: 103.8, lat: 1.3 },
  { name: "Tokyo", lon: 139.7, lat: 35.7 },
  { name: "Seoul", lon: 127.0, lat: 37.6 },
  { name: "Sydney", lon: 151.2, lat: -33.9 },
];

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Home nodes: coastline vertices picked deterministically, so they always sit on land. */
export function homeNodes(count = 110, seed = 7): Array<{ lon: number; lat: number }> {
  const strips = land as number[][];
  const rnd = mulberry32(seed);
  const out: Array<{ lon: number; lat: number }> = [];
  const seen = new Set<string>();
  let guard = 0;
  while (out.length < count && guard++ < count * 40) {
    const s = strips[Math.floor(rnd() * strips.length)];
    const i = Math.floor(rnd() * (s.length / 2)) * 2;
    const lon = s[i] / 10, lat = s[i + 1] / 10;
    if (lat < -55 || lat > 72) continue; // no Antarctica / high Arctic
    const key = `${Math.round(lon)},${Math.round(lat)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ lon, lat });
  }
  return out;
}

const angle = (a: Vec3, b: Vec3) => Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));

function slerp(a: Vec3, b: Vec3, t: number, w: number): Vec3 {
  const s = Math.sin(w);
  if (s < 1e-6) return a;
  const ka = Math.sin((1 - t) * w) / s, kb = Math.sin(t * w) / s;
  return [ka * a[0] + kb * b[0], ka * a[1] + kb * b[1], ka * a[2] + kb * b[2]];
}

export type Arc = { from: Vec3; to: Vec3; kind: 0 | 1; dir: 1 | -1; weight: number };

/** Hub↔hub trunks plus each home node to its nearest hub. kind 0 = work out (amber), 1 = proof back (teal). */
export function buildArcs(homes: Array<{ lon: number; lat: number }>, seed = 11): Arc[] {
  const rnd = mulberry32(seed);
  const hubs = HUBS.map((h) => toVec(h.lon, h.lat));
  const arcs: Arc[] = [];
  const trunk = new Set<string>();
  hubs.forEach((h, i) => {
    const near = hubs.map((o, j) => ({ j, d: angle(h, o) })).filter((x) => x.j !== i).sort((a, b) => a.d - b.d).slice(0, 2);
    for (const { j } of near) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (trunk.has(key)) continue;
      trunk.add(key);
      arcs.push({ from: hubs[i], to: hubs[j], kind: rnd() < 0.5 ? 0 : 1, dir: rnd() < 0.5 ? 1 : -1, weight: 1 });
    }
  });
  for (const home of homes) {
    const p = toVec(home.lon, home.lat);
    let best = 0, bd = Infinity;
    hubs.forEach((h, j) => {
      const d = angle(p, h);
      if (d < bd) (bd = d), (best = j);
    });
    const kind = rnd() < 0.6 ? 0 : 1;
    // Work flows hub → home (amber); proofs flow home → hub (teal).
    arcs.push({ from: hubs[best], to: p, kind, dir: kind === 0 ? 1 : -1, weight: 0.55 });
  }
  return arcs;
}

/** Arcs → line-segment buffers with per-vertex attributes for the pulse shader. */
export function arcBuffers(arcs: Arc[], steps = 48) {
  const segs = arcs.length * (steps - 1);
  const pos = new Float32Array(segs * 6);
  const aT = new Float32Array(segs * 2);
  const aPhase = new Float32Array(segs * 2);
  const aKind = new Float32Array(segs * 2);
  const aDir = new Float32Array(segs * 2);
  const aWeight = new Float32Array(segs * 2);
  const rnd = mulberry32(3);
  let v = 0;
  for (const arc of arcs) {
    const w = angle(arc.from, arc.to);
    const lift = 0.04 + 0.32 * (w / Math.PI);
    const phase = rnd();
    let prev: Vec3 | null = null;
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      const p = slerp(arc.from, arc.to, t, w);
      const r = 1 + lift * Math.sin(Math.PI * t);
      const cur: Vec3 = [p[0] * r, p[1] * r, p[2] * r];
      if (prev) {
        pos.set(prev, v * 3);
        pos.set(cur, v * 3 + 3);
        const tPrev = (i - 1) / (steps - 1);
        aT[v] = tPrev; aT[v + 1] = t;
        for (const k of [v, v + 1]) {
          aPhase[k] = phase; aKind[k] = arc.kind; aDir[k] = arc.dir; aWeight[k] = arc.weight;
        }
        v += 2;
      }
      prev = cur;
    }
  }
  return { pos, aT, aPhase, aKind, aDir, aWeight };
}
