// The WebGL half of the globe: sphere body + rim, graticule, glitch-sketch coastlines (same look as
// components/cld/globe/scene.ts), glowing roads per region (fat lines, two passes) and dashed cable arcs.
// Everything is built once; the engine only touches uniforms, opacities and the group's quaternion per frame.

import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { graticuleSegments, landSegments } from "@/components/cld/globe/geo";

export const GLOBE_COLOR = {
  bg: "#07090D",
  body: "#0C1017",
  coast: "#5B8DEF",
  faint: "#94A3B8",
  rim: "#3FD6C2",
  work: "#F2A93B",
  ok: "#3FD6C2",
} as const;

const FACING = /* glsl */ `
  varying float vFacing;
  float facing(vec4 wp) { return dot(normalize(wp.xyz), normalize(cameraPosition - wp.xyz)); }
`;
// Coastlines: slice jitter + colour split while uGlitch > 0; the opaque body hides the far side.
const landVert = /* glsl */ `
  uniform float uTime; uniform float uGlitch;
  varying float vBand; ${FACING}
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vFacing = facing(wp);
    vec4 vp = viewMatrix * wp;
    float band = floor((vp.y + 1.3) * 9.0 + floor(uTime * 9.0));
    float h = hash(band);
    vBand = h;
    float on = step(0.7, h) * uGlitch;
    vp.x += (h - 0.5) * 0.22 * on;
    gl_Position = projectionMatrix * vp;
  }`;
const landFrag = /* glsl */ `
  uniform vec3 uColor; uniform vec3 uWork; uniform vec3 uOk; uniform float uGlitch;
  varying float vBand; varying float vFacing;
  void main() {
    float front = smoothstep(-0.05, 0.35, vFacing);
    float alpha = mix(0.08, 0.8, front);
    float on = step(0.7, vBand) * uGlitch;
    vec3 c = mix(uColor, vBand > 0.86 ? uOk : uWork, on);
    gl_FragColor = vec4(c, alpha);
  }`;
const rimVert = /* glsl */ `
  varying vec3 vN; varying vec3 vV;
  void main() {
    vec4 vp = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal); vV = normalize(-vp.xyz);
    gl_Position = projectionMatrix * vp;
  }`;
const rimFrag = /* glsl */ `
  uniform vec3 uColor; varying vec3 vN; varying vec3 vV;
  void main() {
    float rim = pow(1.0 - max(dot(vN, vV), 0.0), 5.0);
    gl_FragColor = vec4(uColor, rim * 0.3);
  }`;

export interface RoadLayer {
  core: LineMaterial;
  glow: LineMaterial;
}

export interface GlobeScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  globe: THREE.Group;
  uTime: { value: number };
  uGlitch: { value: number };
  /** One per region, in the order the buffers were given. */
  roads: RoadLayer[];
  /** One per cable, in the order given; the engine sets opacity (far-side fade). */
  cables: LineMaterial[];
  /** Fat-line materials need the viewport size in px. */
  setResolution(w: number, h: number): void;
  dispose(): void;
}

export interface RoadInput {
  color: string;
  /** Segment pairs (xyz, xyz, …) already lifted off the surface. */
  segments: Float32Array;
}

/** Peak cable opacity (when the arc faces the camera). */
export const CABLE_OPACITY = 0.3;

export function buildGlobeScene(roads: RoadInput[], cables: Float32Array[]): GlobeScene {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 20);
  camera.position.set(0, 0, 4);
  camera.lookAt(0, 0, 0);
  const globe = new THREE.Group();
  scene.add(globe);

  const uTime = { value: 0 };
  const uGlitch = { value: 0 };
  const lineMats: LineMaterial[] = [];
  const add = <T extends THREE.Object3D>(o: T) => (globe.add(o), o);
  const lineGeo = (pos: Float32Array) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  };
  const fat = (pos: Float32Array, mat: LineMaterial, dashed = false) => {
    const g = new LineSegmentsGeometry();
    g.setPositions(pos);
    const line = new LineSegments2(g, mat);
    if (dashed) line.computeLineDistances();
    lineMats.push(mat);
    return add(line);
  };

  // Body: opaque, slightly inside the surface so lines on the far side are depth-occluded.
  add(new THREE.Mesh(new THREE.SphereGeometry(0.995, 64, 48), new THREE.MeshBasicMaterial({ color: GLOBE_COLOR.body })));
  add(
    new THREE.Mesh(
      new THREE.SphereGeometry(0.998, 48, 48),
      new THREE.ShaderMaterial({
        vertexShader: rimVert,
        fragmentShader: rimFrag,
        uniforms: { uColor: { value: new THREE.Color(GLOBE_COLOR.rim) } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    ),
  );
  add(
    new THREE.LineSegments(
      lineGeo(graticuleSegments()),
      new THREE.LineBasicMaterial({ color: GLOBE_COLOR.faint, transparent: true, opacity: 0.07, depthWrite: false }),
    ),
  );
  add(
    new THREE.LineSegments(
      lineGeo(landSegments()),
      new THREE.ShaderMaterial({
        vertexShader: landVert,
        fragmentShader: landFrag,
        uniforms: {
          uTime,
          uGlitch,
          uColor: { value: new THREE.Color(GLOBE_COLOR.coast) },
          uWork: { value: new THREE.Color(GLOBE_COLOR.work) },
          uOk: { value: new THREE.Color(GLOBE_COLOR.ok) },
        },
        transparent: true,
        depthWrite: false,
      }),
    ),
  );

  // Roads: a wide soft glow pass under a thin core; opacity is driven by the engine (focus). Normal blending on
  // purpose: routes share motorways, and additive stacking of 4–6 overlapping routes would wash out to white.
  const layers: RoadLayer[] = roads.map((r) => {
    const color = new THREE.Color(r.color);
    const glow = new LineMaterial({ color: color.getHex(), linewidth: 3.5, transparent: true, opacity: 0.06, depthWrite: false });
    const core = new LineMaterial({ color: color.getHex(), linewidth: 1, transparent: true, opacity: 0.45, depthWrite: false });
    fat(r.segments, glow);
    fat(r.segments, core);
    return { core, glow };
  });

  // Cables: thin dashed arcs lifted off the surface; one material each so the engine can fade far-side ones.
  const cableColor = new THREE.Color(GLOBE_COLOR.faint).getHex();
  const cableMats = cables.map((segments) => {
    const mat = new LineMaterial({
      color: cableColor,
      linewidth: 1,
      transparent: true,
      opacity: CABLE_OPACITY,
      depthWrite: false,
      dashed: true,
      dashSize: 0.012,
      gapSize: 0.02,
    });
    fat(segments, mat, true);
    return mat;
  });

  return {
    scene,
    camera,
    globe,
    uTime,
    uGlitch,
    roads: layers,
    cables: cableMats,
    setResolution(w, h) {
      for (const m of lineMats) m.resolution.set(w, h);
    },
    dispose() {
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
    },
  };
}
