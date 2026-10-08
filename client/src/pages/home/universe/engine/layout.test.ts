import { describe, expect, it } from "vitest";
import { REGION_RING, angleOf, distributeAngles, labelFootprint, layoutGraph } from "./layout";
import { testGraph } from "./fixture.test";

describe("layoutGraph", () => {
  const graph = testGraph();
  const layout = layoutGraph(graph);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  it("places every node with finite numbers", () => {
    expect(layout.size).toBe(graph.nodes.length);
    for (const [, p] of layout) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
      expect(p.r).toBeGreaterThan(0);
    }
  });

  it("puts the core at the origin and regions on the ring at the expected angles", () => {
    expect(layout.get("proof")).toMatchObject({ x: 0, y: 0 });
    const expected: Record<string, number> = { verify: 0, run: 90, settle: 180, provide: 270, security: 225, network: 135 };
    for (const id in expected) {
      const p = layout.get(id)!;
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(REGION_RING, 6);
      expect(angleOf(0, 0, p.x, p.y)).toBeCloseTo(expected[id], 6);
    }
    expect(layout.get("verify")!.y).toBeLessThan(0); // top
    expect(layout.get("run")!.x).toBeGreaterThan(0); // right
  });

  it("respects an explicit angle hint", () => {
    const g = testGraph();
    g.nodes.find((n) => n.id === "run")!.angle = 45;
    const p = layoutGraph(g).get("run")!;
    expect(angleOf(0, 0, p.x, p.y)).toBeCloseTo(45, 6);
  });

  it("puts topics on the far side of their region and leaves on the far side of their topic", () => {
    for (const n of graph.nodes) {
      if (!n.parent || n.kind === "region") continue;
      const p = layout.get(n.id)!;
      const parent = layout.get(n.parent)!;
      const grand = byId.get(n.parent)!.parent;
      const gp = grand ? layout.get(grand)! : { x: 0, y: 0 };
      // Child lies in the half-plane facing away from the grandparent.
      const dot = (p.x - parent.x) * (parent.x - gp.x) + (p.y - parent.y) * (parent.y - gp.y);
      expect(dot, n.id).toBeGreaterThan(0);
    }
  });

  it("keeps sibling labels from overlapping at their natural zoom", () => {
    const groups = new Map<string, string[]>();
    for (const n of graph.nodes) if (n.parent) groups.set(n.parent, [...(groups.get(n.parent) ?? []), n.id]);
    for (const [, ids] of groups) {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = layout.get(ids[i])!;
          const b = layout.get(ids[j])!;
          const need = (labelFootprint(byId.get(ids[i])!) + labelFootprint(byId.get(ids[j])!)) / 2;
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          expect(d, `${ids[i]} vs ${ids[j]}`).toBeGreaterThanOrEqual(need - 1e-6);
        }
      }
    }
  });

  it("is deterministic", () => {
    const again = layoutGraph(testGraph());
    for (const [id, p] of layout) expect(again.get(id)).toEqual(p);
  });
});

describe("distributeAngles", () => {
  it("spreads evenly with no hints", () => {
    expect(distributeAngles([undefined, undefined, undefined, undefined])).toEqual([0, 90, 180, 270]);
  });
  it("fills the largest gaps around hints", () => {
    expect(distributeAngles([0, 180, undefined])).toEqual([0, 180, 90]);
    const r = distributeAngles([0, 180, undefined, undefined]);
    expect(r.slice(2).sort()).toEqual([270, 90]);
  });
});
