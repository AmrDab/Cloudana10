// Pointer (mouse, touch, pen), wheel and keyboard input → camera intents. No knowledge of the graph.

export interface InputHandlers {
  /** Drag / inertia pan in screen px. */
  panBy(dx: number, dy: number): void;
  panEnd(vx: number, vy: number): void;
  /** Multiply zoom by factor about the screen point. */
  zoomAt(sx: number, sy: number, factor: number): void;
  click(sx: number, sy: number): void;
  doubleClick(sx: number, sy: number): void;
  move(sx: number, sy: number): void;
  leave(): void;
  key(action: "up" | "down" | "left" | "right" | "in" | "out" | "escape" | "home"): void;
  /** Any input: used to wake the frame loop. */
  wake(): void;
}

export const DRAG_THRESHOLD_PX = 4;
export const MIN_TAP_RADIUS_PX = 14;
const DOUBLE_MS = 320;
const DOUBLE_DIST = 12;
const VELOCITY_WINDOW_MS = 90;

/**
 * Nearest node under (sx, sy). Each candidate's hit radius is max(radius + pad, MIN_TAP_RADIUS_PX).
 * Smaller nodes win ties so a leaf on top of its topic is still clickable. Returns the index or -1.
 */
export function hitTest(
  sx: number,
  sy: number,
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  radii: ArrayLike<number>,
  active: ArrayLike<number>,
): number {
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < xs.length; i++) {
    if (!active[i]) continue;
    const hr = Math.max(MIN_TAP_RADIUS_PX, radii[i] + 4);
    const dx = xs[i] - sx;
    const dy = ys[i] - sy;
    const d2 = dx * dx + dy * dy;
    if (d2 > hr * hr) continue;
    // Prefer small targets, then the closest.
    const score = radii[i] * 1000 + Math.sqrt(d2);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

interface PointerState {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
}

export function attachInput(canvas: HTMLCanvasElement, h: InputHandlers): () => void {
  const pointers: PointerState[] = [];
  let dragging = false;
  let spaceHeld = false;
  let lastTapT = 0;
  let lastTapX = 0;
  let lastTapY = 0;
  let pinchDist = 0;
  // Velocity ring buffer (time, x, y) — fixed size, no allocation while dragging.
  const N = 8;
  const vt = new Float64Array(N);
  const vx = new Float64Array(N);
  const vy = new Float64Array(N);
  let vHead = 0;
  let vCount = 0;

  const pos = (e: PointerEvent | MouseEvent | WheelEvent, out: { x: number; y: number }) => {
    const r = canvas.getBoundingClientRect();
    out.x = e.clientX - r.left;
    out.y = e.clientY - r.top;
  };
  const p = { x: 0, y: 0 };

  const sample = (t: number, x: number, y: number) => {
    vt[vHead] = t;
    vx[vHead] = x;
    vy[vHead] = y;
    vHead = (vHead + 1) % N;
    if (vCount < N) vCount++;
  };
  const velocity = (now: number, out: { x: number; y: number }) => {
    out.x = out.y = 0;
    if (vCount < 2) return;
    const newest = (vHead - 1 + N) % N;
    let oldest = newest;
    for (let k = 1; k < vCount; k++) {
      const idx = (vHead - 1 - k + N) % N;
      if (now - vt[idx] > VELOCITY_WINDOW_MS) break;
      oldest = idx;
    }
    const dt = (vt[newest] - vt[oldest]) / 1000;
    if (dt <= 0.004) return;
    out.x = (vx[newest] - vx[oldest]) / dt;
    out.y = (vy[newest] - vy[oldest]) / dt;
  };
  const v = { x: 0, y: 0 };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(e.pointerId);
    pos(e, p);
    pointers.push({ id: e.pointerId, x: p.x, y: p.y, startX: p.x, startY: p.y });
    if (pointers.length === 2) {
      pinchDist = Math.hypot(pointers[0].x - pointers[1].x, pointers[0].y - pointers[1].y);
      dragging = true;
    }
    vCount = 0;
    sample(e.timeStamp, p.x, p.y);
    h.wake();
  };

  const onPointerMove = (e: PointerEvent) => {
    pos(e, p);
    const ps = pointers.find((q) => q.id === e.pointerId);
    if (!ps) {
      if (spaceHeld) {
        h.panBy(e.movementX, e.movementY);
      } else {
        h.move(p.x, p.y);
      }
      return;
    }
    if (pointers.length === 2) {
      const other = pointers[0] === ps ? pointers[1] : pointers[0];
      const mx0 = (ps.x + other.x) / 2;
      const my0 = (ps.y + other.y) / 2;
      ps.x = p.x;
      ps.y = p.y;
      const mx1 = (ps.x + other.x) / 2;
      const my1 = (ps.y + other.y) / 2;
      const d = Math.hypot(ps.x - other.x, ps.y - other.y);
      if (pinchDist > 0 && d > 0) h.zoomAt(mx1, my1, d / pinchDist);
      pinchDist = d;
      h.panBy(mx1 - mx0, my1 - my0);
      return;
    }
    const dx = p.x - ps.x;
    const dy = p.y - ps.y;
    if (!dragging && Math.hypot(p.x - ps.startX, p.y - ps.startY) >= DRAG_THRESHOLD_PX) dragging = true;
    ps.x = p.x;
    ps.y = p.y;
    sample(e.timeStamp, p.x, p.y);
    if (dragging) h.panBy(dx, dy);
  };

  const onPointerUp = (e: PointerEvent) => {
    const idx = pointers.findIndex((q) => q.id === e.pointerId);
    if (idx < 0) return;
    pos(e, p);
    const wasPinch = pointers.length === 2;
    pointers.splice(idx, 1);
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (pointers.length > 0) {
      pinchDist = 0;
      return;
    }
    if (dragging) {
      dragging = false;
      if (!wasPinch) {
        velocity(e.timeStamp, v);
        h.panEnd(v.x, v.y);
      }
      return;
    }
    // Tap / click.
    const now = e.timeStamp;
    if (now - lastTapT < DOUBLE_MS && Math.hypot(p.x - lastTapX, p.y - lastTapY) < DOUBLE_DIST) {
      lastTapT = 0;
      h.doubleClick(p.x, p.y);
    } else {
      lastTapT = now;
      lastTapX = p.x;
      lastTapY = p.y;
      h.click(p.x, p.y);
    }
  };

  const onPointerCancel = (e: PointerEvent) => {
    const idx = pointers.findIndex((q) => q.id === e.pointerId);
    if (idx >= 0) pointers.splice(idx, 1);
    if (pointers.length === 0) dragging = false;
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    pos(e, p);
    // Lines/pages → px; trackpads send small px deltas, mice ~100 px notches.
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const dy = Math.max(-240, Math.min(240, e.deltaY * unit));
    h.zoomAt(p.x, p.y, Math.exp(-dy * 0.0025));
  };

  const onLeave = () => h.leave();

  const onKeyDown = (e: KeyboardEvent) => {
    switch (e.key) {
      case "ArrowUp": h.key("up"); break;
      case "ArrowDown": h.key("down"); break;
      case "ArrowLeft": h.key("left"); break;
      case "ArrowRight": h.key("right"); break;
      case "+": case "=": h.key("in"); break;
      case "-": case "_": h.key("out"); break;
      case "Escape": h.key("escape"); break;
      case "Home": h.key("home"); break;
      case " ": spaceHeld = true; break;
      default: return;
    }
    e.preventDefault();
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === " ") spaceHeld = false;
  };
  const onContextMenu = (e: Event) => e.preventDefault();

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("keydown", onKeyDown);
  canvas.addEventListener("keyup", onKeyUp);
  canvas.addEventListener("contextmenu", onContextMenu);

  return () => {
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerCancel);
    canvas.removeEventListener("pointerleave", onLeave);
    canvas.removeEventListener("wheel", onWheel);
    canvas.removeEventListener("keydown", onKeyDown);
    canvas.removeEventListener("keyup", onKeyUp);
    canvas.removeEventListener("contextmenu", onContextMenu);
  };
}
