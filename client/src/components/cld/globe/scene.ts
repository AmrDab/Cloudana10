// The homepage globe: a glitchy line-sketch Earth with data strings between datacenters and home nodes.
// Three.js, unlit shaders only, one draw call per layer. Loaded lazily; the React wrapper drives frame().
import * as THREE from "three";
import { HUBS, arcBuffers, buildArcs, graticuleSegments, homeNodes, landSegments, toVec } from "./geo";

const C = {
  bg: new THREE.Color("#07090D"),
  line: new THREE.Color("#BCCBDD"),
  faint: new THREE.Color("#94A3B8"),
  work: new THREE.Color("#F2A93B"),
  ok: new THREE.Color("#3FD6C2"),
  chain: new THREE.Color("#5B8DEF"),
};

const FACING = /* glsl */ `
  varying float vFacing;
  float facing(vec4 wp) { return dot(normalize(wp.xyz), normalize(cameraPosition - wp.xyz)); }
`;

// Coastlines: slice jitter + colour split while uGlitch > 0, faint on the far side.
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
    float front = smoothstep(-0.12, 0.3, vFacing);
    float alpha = mix(0.06, 0.95, front);
    float on = step(0.7, vBand) * uGlitch;
    vec3 c = mix(uColor, vBand > 0.86 ? uOk : uWork, on);
    gl_FragColor = vec4(c, alpha);
  }`;

// Data strings: a dotted stream with a bright pulse travelling along each arc.
const arcVert = /* glsl */ `
  attribute float aT; attribute float aPhase; attribute float aKind; attribute float aDir; attribute float aWeight;
  varying float vT; varying float vPhase; varying float vKind; varying float vDir; varying float vWeight; ${FACING}
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vFacing = facing(wp);
    vT = aT; vPhase = aPhase; vKind = aKind; vDir = aDir; vWeight = aWeight;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const arcFrag = /* glsl */ `
  uniform float uTime; uniform vec3 uWork; uniform vec3 uOk; uniform float uGlitch;
  varying float vT; varying float vPhase; varying float vKind; varying float vDir; varying float vWeight; varying float vFacing;
  void main() {
    float front = smoothstep(-0.05, 0.35, vFacing);
    float speed = 0.22 + 0.1 * vPhase;
    float p = fract(vT * vDir - uTime * speed + vPhase);
    float head = smoothstep(0.0, 0.015, p) * (1.0 - smoothstep(0.015, 0.16, p));
    float dots = 0.55 + 0.45 * sin(vT * 180.0 + vPhase * 6.283);
    vec3 c = vKind > 0.5 ? uOk : uWork;
    float a = (0.16 * dots * vWeight + head * (0.9 + 0.3 * vWeight)) * front;
    a *= 1.0 - 0.5 * uGlitch;
    gl_FragColor = vec4(c, a);
  }`;

// Nodes: soft disc + expanding ring (hubs) or twinkling dot (homes).
const pointVert = /* glsl */ `
  attribute float aPhase; uniform float uSize; uniform float uDpr;
  varying float vPhase; ${FACING}
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vFacing = facing(wp);
    vPhase = aPhase;
    vec4 vp = viewMatrix * wp;
    gl_PointSize = uSize * uDpr * (3.4 / -vp.z);
    gl_Position = projectionMatrix * vp;
  }`;
const hubFrag = /* glsl */ `
  uniform float uTime; uniform vec3 uColor;
  varying float vPhase; varying float vFacing;
  void main() {
    float front = smoothstep(0.0, 0.3, vFacing);
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float d = length(uv);
    float core = 1.0 - smoothstep(0.0, 0.28, d);
    float rp = fract(uTime * 0.45 + vPhase);
    float ring = (1.0 - smoothstep(0.0, 0.05, abs(d - (0.3 + 0.65 * rp)))) * (1.0 - rp);
    float a = (core + ring * 0.7) * front;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
  }`;
const homeFrag = /* glsl */ `
  uniform float uTime; uniform vec3 uColor;
  varying float vPhase; varying float vFacing;
  void main() {
    float front = smoothstep(0.0, 0.3, vFacing);
    float d = length(gl_PointCoord * 2.0 - 1.0);
    float core = 1.0 - smoothstep(0.0, 0.6, d);
    float tw = 0.45 + 0.4 * sin(uTime * 1.6 + vPhase * 6.283);
    float a = core * tw * front;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
  }`;

// Rim light so the sphere reads as a volume against the page background.
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
    gl_FragColor = vec4(uColor, rim * 0.38);
  }`;

export type Globe = { frame: (dt: number) => void; dispose: () => void };

export function createGlobe(host: HTMLElement, { reduce = false } = {}): Globe {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  camera.position.set(0, 0.15, 4.1);
  camera.lookAt(0, 0, 0);

  const globe = new THREE.Group();
  globe.rotation.x = 0.28;
  globe.rotation.y = -1.05; // start on the Atlantic: Americas left, Europe and Africa right
  scene.add(globe);

  const uTime = { value: 0 }, uGlitch = { value: 0 };
  const add = <T extends THREE.Object3D>(o: T) => (globe.add(o), o);
  const lineGeo = (pos: Float32Array) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  };

  // Rim
  add(new THREE.Mesh(new THREE.SphereGeometry(0.995, 48, 48), new THREE.ShaderMaterial({
    vertexShader: rimVert, fragmentShader: rimFrag, uniforms: { uColor: { value: C.ok } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  })));

  // Graticule
  add(new THREE.LineSegments(lineGeo(graticuleSegments()), new THREE.LineBasicMaterial({
    color: C.faint, transparent: true, opacity: 0.06, depthWrite: false,
  })));

  // Coastline sketch
  const landMat = new THREE.ShaderMaterial({
    vertexShader: landVert, fragmentShader: landFrag,
    uniforms: { uTime, uGlitch, uColor: { value: C.line }, uWork: { value: C.work }, uOk: { value: C.ok } },
    transparent: true, depthWrite: false,
  });
  add(new THREE.LineSegments(lineGeo(landSegments()), landMat));

  // Data strings
  const homes = homeNodes();
  const ab = arcBuffers(buildArcs(homes));
  const arcGeo = lineGeo(ab.pos);
  for (const [k, v] of Object.entries({ aT: ab.aT, aPhase: ab.aPhase, aKind: ab.aKind, aDir: ab.aDir, aWeight: ab.aWeight })) {
    arcGeo.setAttribute(k, new THREE.BufferAttribute(v, 1));
  }
  add(new THREE.LineSegments(arcGeo, new THREE.ShaderMaterial({
    vertexShader: arcVert, fragmentShader: arcFrag,
    uniforms: { uTime, uGlitch, uWork: { value: C.work }, uOk: { value: C.ok } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  })));

  // Nodes
  const points = (lonlat: Array<{ lon: number; lat: number }>, size: number, frag: string, color: THREE.Color) => {
    const pos = new Float32Array(lonlat.length * 3), phase = new Float32Array(lonlat.length);
    lonlat.forEach((p, i) => {
      pos.set(toVec(p.lon, p.lat, 1.004), i * 3);
      phase[i] = ((i * 2654435761) % 1000) / 1000;
    });
    const g = lineGeo(pos);
    g.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    return add(new THREE.Points(g, new THREE.ShaderMaterial({
      vertexShader: pointVert, fragmentShader: frag,
      uniforms: { uTime, uSize: { value: size }, uDpr: { value: dpr }, uColor: { value: color } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })));
  };
  points(homes, 9, homeFrag, C.faint);
  points(HUBS, 30, hubFrag, C.ok);

  // Size to host
  const resize = () => {
    const w = host.clientWidth || 1, h = host.clientHeight || w;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(host);

  // Pointer parallax (no drag — the page must keep scrolling).
  let px = 0, py = 0, tx = 0, ty = 0;
  const onMove = (e: PointerEvent) => {
    const r = host.getBoundingClientRect();
    tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
    ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
  };
  const onLeave = () => (tx = ty = 0);
  if (!reduce) {
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerleave", onLeave);
  }

  // Glitch bursts: short, irregular, never constant.
  let nextBurst = 2.5, burstEnd = 0, t = 0;

  const frame = (dt: number) => {
    if (!reduce) {
      t += dt;
      uTime.value = t;
      globe.rotation.y += dt * 0.05;
      px += (tx - px) * 0.04;
      py += (ty - py) * 0.04;
      globe.rotation.x = 0.28 + py * 0.12;
      globe.rotation.z = -px * 0.05;
      if (t >= nextBurst) {
        burstEnd = t + 0.12 + Math.random() * 0.25;
        nextBurst = burstEnd + 3 + Math.random() * 6;
      }
      uGlitch.value = t < burstEnd ? 0.5 + 0.5 * Math.random() : 0;
    }
    renderer.render(scene, camera);
  };

  const dispose = () => {
    ro.disconnect();
    host.removeEventListener("pointermove", onMove);
    host.removeEventListener("pointerleave", onLeave);
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    renderer.dispose();
    renderer.domElement.remove();
  };

  return { frame, dispose };
}
