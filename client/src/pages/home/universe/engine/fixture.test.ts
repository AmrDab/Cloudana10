// Throwaway graph for engine tests (graph.ts belongs to another workstream).
import type { UGraph, UNode } from "../types";

export function testGraph(): UGraph {
  const nodes: UNode[] = [{ id: "proof", label: "Proof", kind: "core" }];
  const regions = ["verify", "run", "settle", "provide", "security", "network"] as const;
  for (const r of regions) {
    nodes.push({ id: r, label: r[0].toUpperCase() + r.slice(1), kind: "region", parent: "proof", tone: "ok" });
    const topics = r === "run" ? 7 : r === "verify" ? 3 : 4;
    for (let t = 0; t < topics; t++) {
      const tid = `${r}-t${t}`;
      nodes.push({ id: tid, label: `Some longer topic ${t}`, kind: "topic", parent: r });
      const leaves = t === 0 ? 6 : 2;
      for (let l = 0; l < leaves; l++) {
        nodes.push({ id: `${tid}-l${l}`, label: `Leaf label ${l}`, kind: "leaf", parent: tid });
      }
    }
    nodes.push({ id: `${r}-hidden`, label: "Secret", kind: "topic", parent: r, hidden: true });
  }
  const edges = nodes.filter((n) => n.parent).map((n) => ({ from: n.parent!, to: n.id, kind: "primary" as const }));
  edges.push({ from: "run", to: "settle", kind: "cross" as never });
  return { root: "proof", nodes, edges };
}

// vitest treats this file as a suite; keep one trivial assertion so it isn't reported as empty.
import { it, expect } from "vitest";
it("builds a fixture graph", () => {
  expect(testGraph().nodes.length).toBeGreaterThan(100);
});
