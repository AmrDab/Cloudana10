import { describe, expect, it } from "vitest";
import { MIN_TAP_RADIUS_PX, hitTest } from "./input";

describe("hitTest", () => {
  const xs = [100, 300, 300];
  const ys = [100, 100, 100];
  const radii = [20, 30, 5]; // index 2 is a small node sitting on top of index 1
  const active = [1, 1, 1];

  it("returns the node under the point and -1 on empty space", () => {
    expect(hitTest(105, 95, xs, ys, radii, active)).toBe(0);
    expect(hitTest(200, 300, xs, ys, radii, active)).toBe(-1);
  });

  it("uses a minimum 14 px tap target for tiny nodes", () => {
    const tiny = [2];
    expect(hitTest(0 + MIN_TAP_RADIUS_PX - 1, 0, [0], [0], tiny, [1])).toBe(0);
    expect(hitTest(0 + MIN_TAP_RADIUS_PX + 1, 0, [0], [0], tiny, [1])).toBe(-1);
  });

  it("prefers the smaller node when targets overlap", () => {
    expect(hitTest(302, 101, xs, ys, radii, active)).toBe(2);
    expect(hitTest(325, 100, xs, ys, radii, active)).toBe(1);
  });

  it("ignores inactive nodes", () => {
    expect(hitTest(302, 101, xs, ys, radii, [1, 1, 0])).toBe(1);
  });
});
