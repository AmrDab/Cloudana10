import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TILT,
  DEG,
  FOV,
  GALAXY_FRACTION,
  angleBetween,
  cableLift,
  cableSegments,
  distanceForArc,
  facingRotation,
  galaxyDistance,
  greatCircle,
  isFrontFacing,
  latLonToVec3,
  levelForDistance,
  levelThresholds,
  limbFade,
  projectToScreen,
  roadSegments,
  rotationQuat,
  shortHalfTan,
  shortestDelta,
  sphereScreenRadius,
  unprojectToSphere,
  type Vec3,
} from "./geo3";

const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
const PLACES: [number, number][] = [
  [40.713, -74.006], // New York
  [51.507, -0.128], // London
  [-1.292, 36.822], // Nairobi
  [1.352, 103.82], // Singapore
  [35.69, 139.69], // Tokyo
  [-23.55, -46.63], // São Paulo
];

describe("lat/lon → vec3", () => {
  it("puts the poles on ±y and (0°, 0°) on +x, unit length everywhere", () => {
    expect(latLonToVec3(90, 0).map((x) => +x.toFixed(9))).toEqual([0, 1, 0]);
    expect(latLonToVec3(-90, 0).map((x) => +x.toFixed(9))).toEqual([0, -1, 0]);
    expect(latLonToVec3(0, 0).map((x) => +x.toFixed(9))).toEqual([1, 0, 0]);
    for (const [lat, lon] of PLACES) expect(len(latLonToVec3(lat, lon))).toBeCloseTo(1, 9);
    expect(len(latLonToVec3(10, 20, 1.002))).toBeCloseTo(1.002, 9);
  });
});

describe("great circles", () => {
  it("interpolates on the sphere: endpoints exact, midpoint equidistant", () => {
    const a = latLonToVec3(...PLACES[0]);
    const b = latLonToVec3(...PLACES[3]);
    const w = angleBetween(a, b);
    expect(w).toBeGreaterThan(2); // NY–Singapore is nearly antipodal (~150°)
    expect(greatCircle(a, b, 0)).toEqual(a);
    expect(greatCircle(a, b, 1).map((x) => +x.toFixed(9))).toEqual(b.map((x) => +x.toFixed(9)));
    const mid = greatCircle(a, b, 0.5);
    expect(len(mid)).toBeCloseTo(1, 9);
    expect(angleBetween(a, mid)).toBeCloseTo(w / 2, 9);
    expect(angleBetween(mid, b)).toBeCloseTo(w / 2, 9);
  });

  it("lifts cable arcs by length and keeps the ends on the surface", () => {
    const a = latLonToVec3(...PLACES[1]);
    const b = latLonToVec3(...PLACES[2]);
    const seg = cableSegments(a, b, 16);
    expect(seg.length).toBe(15 * 6);
    expect(Math.hypot(seg[0], seg[1], seg[2])).toBeCloseTo(1, 6);
    expect(Math.hypot(seg[seg.length - 3], seg[seg.length - 2], seg[seg.length - 1])).toBeCloseTo(1, 6);
    let peak = 0;
    for (let i = 0; i < seg.length; i += 3) peak = Math.max(peak, Math.hypot(seg[i], seg[i + 1], seg[i + 2]));
    expect(peak).toBeCloseTo(1 + cableLift(angleBetween(a, b)), 3);
    expect(cableLift(0)).toBeCloseTo(0.03);
    expect(cableLift(Math.PI)).toBeCloseTo(0.15);
    expect(cableLift(0.3)).toBeLessThan(cableLift(2));
  });

  it("turns a road polyline into lifted segment pairs", () => {
    const seg = roadSegments([[-74, 40.7], [-73.9, 40.8], [-73.8, 40.9]]);
    expect(seg.length).toBe(12);
    // Consecutive segments share the middle point.
    expect(seg[3]).toBe(seg[6]);
    expect(Math.hypot(seg[0], seg[1], seg[2])).toBeCloseTo(1.002, 5);
    expect(roadSegments([[0, 0]]).length).toBe(0);
  });
});

describe("facing rotation", () => {
  const forwardOf = (lat: number, lon: number, tilt: number) => {
    const { yaw, pitch } = facingRotation(lat, lon, tilt);
    const q = rotationQuat(yaw, pitch, new Quaternion());
    const p = latLonToVec3(lat, lon);
    return new Vector3(p[0], p[1], p[2]).applyQuaternion(q);
  };

  it("brings every region to the front: forward ≈ (0, −sin tilt, cos tilt)", () => {
    for (const [lat, lon] of PLACES) {
      const f = forwardOf(lat, lon, DEFAULT_TILT);
      expect(f.x).toBeCloseTo(0, 9);
      expect(f.y).toBeCloseTo(-Math.sin(DEFAULT_TILT), 9);
      expect(f.z).toBeCloseTo(Math.cos(DEFAULT_TILT), 9);
    }
  });

  it("with no tilt the place is dead centre, and north stays up", () => {
    const f = forwardOf(51.507, -0.128, 0);
    expect(f.x).toBeCloseTo(0, 9);
    expect(f.y).toBeCloseTo(0, 9);
    expect(f.z).toBeCloseTo(1, 9);
    const { yaw, pitch } = facingRotation(51.507, -0.128, 0);
    const pole = new Vector3(0, 1, 0).applyQuaternion(rotationQuat(yaw, pitch, new Quaternion()));
    expect(pole.y).toBeGreaterThan(0);
    expect(pole.x).toBeCloseTo(0, 9);
  });

  it("clamps pitch at ±70° and takes the short way round in yaw", () => {
    expect(facingRotation(85, 0, 0).pitch).toBeCloseTo(70 * DEG, 9);
    expect(facingRotation(-85, 0, 0).pitch).toBeCloseTo(-70 * DEG, 9);
    expect(shortestDelta(170 * DEG, -170 * DEG)).toBeCloseTo(20 * DEG, 9);
    expect(shortestDelta(-170 * DEG, 170 * DEG)).toBeCloseTo(-20 * DEG, 9);
    expect(shortestDelta(0, Math.PI)).toBeCloseTo(Math.PI, 9);
    expect(shortestDelta(1, 1 + 4 * Math.PI)).toBeCloseTo(0, 9);
  });
});

describe("distance ↔ level", () => {
  it("maps distances to levels at the viewport's thresholds", () => {
    const t = levelThresholds(FOV, 1);
    expect(t.planet).toBeLessThan(t.system);
    expect(levelForDistance(t.planet - 0.01, t)).toBe("planet");
    expect(levelForDistance(t.planet, t)).toBe("system");
    expect(levelForDistance(t.system - 0.01, t)).toBe("system");
    expect(levelForDistance(t.system, t)).toBe("galaxy");
    expect(levelForDistance(100, t)).toBe("galaxy");
  });

  it("galaxy distance makes the sphere's diameter 55% of the short side", () => {
    for (const aspect of [0.5, 1, 1.78]) {
      const d = galaxyDistance(FOV, aspect);
      const h = shortHalfTan(FOV, aspect);
      expect(Math.tan(Math.asin(1 / d)) / h).toBeCloseTo(GALAXY_FRACTION, 9);
      expect(levelForDistance(d, levelThresholds(FOV, aspect))).toBe("galaxy");
    }
    // Portrait phones need a farther camera than landscape.
    expect(galaxyDistance(FOV, 0.5)).toBeGreaterThan(galaxyDistance(FOV, 1.78));
  });

  it("system and planet distances land inside their levels and nest", () => {
    for (const aspect of [0.4, 0.5, 1, 1.78]) {
      const t = levelThresholds(FOV, aspect);
      const sys = distanceForArc(8, 0.7, FOV, aspect);
      const planet = distanceForArc(2.5, 0.7, FOV, aspect);
      expect(levelForDistance(sys, t)).toBe("system");
      expect(levelForDistance(planet, t)).toBe("planet");
      expect(planet).toBeLessThan(sys);
      expect(sys).toBeLessThan(galaxyDistance(FOV, aspect));
    }
    // A cap of angular radius a seen from d spans fraction f of the short side (inverse check).
    const d = distanceForArc(8, 0.7, FOV, 1);
    const a = 8 * DEG;
    expect(Math.sin(a) / (d - Math.cos(a)) / shortHalfTan(FOV, 1)).toBeCloseTo(0.7, 9);
  });
});

describe("occlusion", () => {
  it("a surface point faces the camera iff z > 1/d (the tangent cone)", () => {
    expect(isFrontFacing(1, 3)).toBe(true);
    expect(isFrontFacing(0.2, 3)).toBe(false);
    expect(isFrontFacing(1 / 3 + 1e-6, 3)).toBe(true);
    expect(isFrontFacing(1 / 3 - 1e-6, 3)).toBe(false);
    // Closer camera → more of the sphere hidden.
    expect(isFrontFacing(0.5, 1.5)).toBe(false);
    expect(isFrontFacing(0.5, 4)).toBe(true);
  });

  it("limb fade is 0 behind the horizon, 1 well inside, monotonic between", () => {
    expect(limbFade(0, 3)).toBe(0);
    expect(limbFade(1 / 3, 3)).toBe(0);
    expect(limbFade(1, 3)).toBe(1);
    const a = limbFade(1 / 3 + 0.03, 3);
    const b = limbFade(1 / 3 + 0.07, 3);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(b).toBeLessThan(1);
  });
});

describe("projection", () => {
  const W = 1200;
  const H = 800;
  const D = 4;

  it("the front point lands at the viewport centre; +x goes right, +y goes up", () => {
    const out = { x: 0, y: 0 };
    projectToScreen(0, 0, 1, D, FOV, W, H, out);
    expect(out.x).toBeCloseTo(W / 2, 9);
    expect(out.y).toBeCloseTo(H / 2, 9);
    projectToScreen(0.3, 0.3, 0.9, D, FOV, W, H, out);
    expect(out.x).toBeGreaterThan(W / 2);
    expect(out.y).toBeLessThan(H / 2);
  });

  it("unproject inverts project for points on the visible cap, and misses off the disc", () => {
    const out = { x: 0, y: 0 };
    const back = { x: 0, y: 0, z: 0 };
    for (const [lat, lon] of [[10, -80], [-30, -120], [45, -60]] as [number, number][]) {
      const p = latLonToVec3(lat, lon); // these face +z (lon −90 is the front meridian)
      expect(isFrontFacing(p[2], D)).toBe(true);
      projectToScreen(p[0], p[1], p[2], D, FOV, W, H, out);
      expect(unprojectToSphere(out.x, out.y, W, H, FOV, D, back)).toBe(true);
      expect(back.x).toBeCloseTo(p[0], 6);
      expect(back.y).toBeCloseTo(p[1], 6);
      expect(back.z).toBeCloseTo(p[2], 6);
    }
    expect(unprojectToSphere(0, 0, W, H, FOV, D, back)).toBe(false);
  });

  it("the sphere's apparent radius matches the projected limb", () => {
    const r = sphereScreenRadius(D, FOV, W, H);
    // A point on the horizon circle (z = 1/d) projects r px from the centre.
    const z = 1 / D;
    const y = Math.sqrt(1 - z * z);
    const out = { x: 0, y: 0 };
    projectToScreen(0, y, z, D, FOV, W, H, out);
    expect(H / 2 - out.y).toBeCloseTo(r, 6);
  });
});
