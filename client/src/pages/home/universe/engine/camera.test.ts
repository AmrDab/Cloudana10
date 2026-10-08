import { describe, expect, it } from "vitest";
import { CameraController, PLANET_ZOOM, SYSTEM_ZOOM, ZOOM_MAX, ZOOM_MIN, levelFor, naturalZoomFor } from "./camera";

function cam(): CameraController {
  const c = new CameraController();
  c.setViewport(1200, 800);
  c.set(100, -50, 2);
  return c;
}

describe("camera transforms", () => {
  it("round-trips world → screen → world", () => {
    const c = cam();
    const s = { x: 0, y: 0 };
    const w = { x: 0, y: 0 };
    c.worldToScreen(123.4, -567.8, s);
    c.screenToWorld(s.x, s.y, w);
    expect(w.x).toBeCloseTo(123.4, 9);
    expect(w.y).toBeCloseTo(-567.8, 9);
    // Camera centre is the viewport centre.
    c.worldToScreen(100, -50, s);
    expect(s).toEqual({ x: 600, y: 400 });
  });

  it("zooms about the cursor: the world point under the cursor stays put", () => {
    const c = cam();
    const before = { x: 0, y: 0 };
    const after = { x: 0, y: 0 };
    c.screenToWorld(900, 150, before);
    c.zoomAt(900, 150, 1.7);
    c.screenToWorld(900, 150, after);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    expect(c.zoom).toBeCloseTo(3.4, 9);
  });

  it("clamps zoom to [0.5, 8]", () => {
    const c = cam();
    c.zoomAt(600, 400, 1000);
    expect(c.zoom).toBe(ZOOM_MAX);
    c.zoomAt(600, 400, 1e-6);
    expect(c.zoom).toBe(ZOOM_MIN);
    c.flyTo(0, 0, 99, 0);
    expect(c.zoom).toBe(ZOOM_MAX);
  });

  it("pans by screen pixels scaled by zoom", () => {
    const c = cam();
    c.panBy(20, -40);
    expect(c.x).toBeCloseTo(90);
    expect(c.y).toBeCloseTo(-30);
  });
});

describe("fly-to", () => {
  it("ends exactly at the target after durationMs, easing in and out", () => {
    const c = cam();
    c.flyTo(-300, 200, 5, 900);
    expect(c.isAnimating()).toBe(true);
    let elapsed = 0;
    const mid: number[] = [];
    while (c.isAnimating()) {
      c.update(1 / 60);
      elapsed += 1 / 60;
      if (Math.abs(elapsed - 0.45) < 0.01) mid.push(c.x);
      expect(elapsed).toBeLessThan(1.2);
    }
    expect(c.x).toBe(-300);
    expect(c.y).toBe(200);
    expect(c.zoom).toBe(5);
    expect(elapsed).toBeGreaterThanOrEqual(0.9 - 1e-9);
    expect(mid[0]).toBeCloseTo(-100, 0); // halfway in x at t = 0.5
  });

  it("is instant with duration 0", () => {
    const c = cam();
    c.flyTo(10, 20, 3, 0);
    expect(c.get()).toEqual({ x: 10, y: 20, zoom: 3 });
    expect(c.isAnimating()).toBe(false);
  });

  it("inertia decays to a stop", () => {
    const c = cam();
    c.fling(600, 0);
    const x0 = c.x;
    let steps = 0;
    while (c.isAnimating() && steps < 600) {
      c.update(1 / 60);
      steps++;
    }
    expect(c.isAnimating()).toBe(false);
    expect(c.x).toBeLessThan(x0);
    expect(steps).toBeLessThan(200);
  });
});

describe("levels", () => {
  it("maps zoom to galaxy / system / planet at the spec thresholds", () => {
    expect(levelFor(0.5)).toBe("galaxy");
    expect(levelFor(SYSTEM_ZOOM - 1e-9)).toBe("galaxy");
    expect(levelFor(SYSTEM_ZOOM)).toBe("system");
    expect(levelFor(PLANET_ZOOM - 1e-9)).toBe("system");
    expect(levelFor(PLANET_ZOOM)).toBe("planet");
    expect(levelFor(8)).toBe("planet");
  });
  it("natural zooms land on the level that shows a node's children", () => {
    expect(levelFor(naturalZoomFor("core"))).toBe("galaxy");
    expect(levelFor(naturalZoomFor("region"))).toBe("system");
    expect(levelFor(naturalZoomFor("topic"))).toBe("planet");
    expect(levelFor(naturalZoomFor("leaf"))).toBe("planet");
  });
});
