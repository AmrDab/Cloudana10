// Three parallax star layers. Seeded, allocation-free per frame.

export interface StarLayer {
  /** Normalised positions in [0,1) of the layer's own wrap tile. */
  x: Float32Array;
  y: Float32Array;
  size: Float32Array;
  phase: Float32Array;
  /** Parallax: screen px per world unit of camera travel (at zoom 1). */
  parallax: number;
  /** Drift in px/s along +x. */
  drift: number;
  alpha: number;
}

/** mulberry32: tiny seeded PRNG. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;

const LAYERS = [
  { count: 320, parallax: 0.03, drift: 1.2, alpha: 0.35, sizeMin: 0.6, sizeMax: 1.1 },
  { count: 200, parallax: 0.07, drift: 2.0, alpha: 0.55, sizeMin: 0.9, sizeMax: 1.6 },
  { count: 80, parallax: 0.14, drift: 2.8, alpha: 0.8, sizeMin: 1.3, sizeMax: 2.2 },
];

export function createStars(seed = 7): StarLayer[] {
  const rand = prng(seed);
  return LAYERS.map((l) => {
    const x = new Float32Array(l.count);
    const y = new Float32Array(l.count);
    const size = new Float32Array(l.count);
    const phase = new Float32Array(l.count);
    for (let i = 0; i < l.count; i++) {
      x[i] = rand();
      y[i] = rand();
      size[i] = l.sizeMin + rand() * (l.sizeMax - l.sizeMin);
      phase[i] = rand() * Math.PI * 2;
    }
    return { x, y, size, phase, parallax: l.parallax, drift: l.drift, alpha: l.alpha };
  });
}

/**
 * Draw all layers. `t` in seconds (drift + twinkle); pass a constant when reducedMotion.
 * Stars wrap over a tile slightly larger than the viewport so parallax never shows an edge.
 */
export function drawStars(
  ctx: CanvasRenderingContext2D,
  layers: StarLayer[],
  width: number,
  height: number,
  camX: number,
  camY: number,
  zoom: number,
  t: number,
  twinkle: boolean,
): void {
  const tileW = width + 64;
  const tileH = height + 64;
  // Zoom adds a touch of depth without making stars fly off at zoom 8.
  const zp = 0.6 + 0.4 * Math.log2(zoom + 1);
  ctx.fillStyle = "#E6EAF0";
  for (let l = 0; l < layers.length; l++) {
    const L = layers[l];
    const ox = -camX * L.parallax * zp + L.drift * t;
    const oy = -camY * L.parallax * zp;
    for (let i = 0; i < L.x.length; i++) {
      let sx = (L.x[i] * tileW + ox) % tileW;
      let sy = (L.y[i] * tileH + oy) % tileH;
      if (sx < 0) sx += tileW;
      if (sy < 0) sy += tileH;
      sx -= 32;
      sy -= 32;
      if (sx < -2 || sy < -2 || sx > width + 2 || sy > height + 2) continue;
      const a = twinkle ? L.alpha * (0.75 + 0.25 * Math.sin(t * 0.9 + L.phase[i])) : L.alpha;
      ctx.globalAlpha = a;
      const s = L.size[i];
      if (s < 1.3) ctx.fillRect(sx - s / 2, sy - s / 2, s, s);
      else {
        ctx.beginPath();
        ctx.arc(sx, sy, s / 2, 0, TAU);
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;
}
