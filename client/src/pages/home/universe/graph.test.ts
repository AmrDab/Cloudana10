import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CATALOG } from "@/lib/services";
import { childrenOf, GRAPH, NODE_INDEX, pathTo } from "./graph";
import { LEGACY_ANCHORS } from "./types";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const read = (p: string) => readFileSync(here(p), "utf8");

const { nodes, edges } = GRAPH;
const ids = new Set(nodes.map((n) => n.id));
const regions = nodes.filter((n) => n.kind === "region");
const primary = edges.filter((e) => e.kind !== "cross");

/** Internal paths the router serves (ConsoleApp under /control, App for / and /lab) plus static files in public/. */
function allowlist(): Set<string> {
  const ok = new Set<string>(["/", "/lab", "/control"]);
  const console = read("../../../ConsoleApp.tsx");
  for (const m of console.matchAll(/<Route path="(\/[a-z-]*)"/g)) ok.add(`/control${m[1] === "/" ? "" : m[1]}`);
  for (const f of ["litepaper.html", "terms.html", "privacy.html"]) {
    read(`../../../../public/${f}`); // throws when missing
    ok.add(`/${f}`);
  }
  return ok;
}

const BANNED = ["marketplace", "bidding", "97.5", "mainnet is live", "guaranteed", "demand floor"];

describe("universe graph: structure", () => {
  it("has unique ids and the core as root", () => {
    expect(ids.size).toBe(nodes.length);
    expect(NODE_INDEX[GRAPH.root]?.kind).toBe("core");
    expect(nodes.filter((n) => n.kind === "core")).toHaveLength(1);
  });

  it("every edge references existing nodes", () => {
    for (const e of edges) {
      expect(ids.has(e.from), `edge from ${e.from}`).toBe(true);
      expect(ids.has(e.to), `edge to ${e.to}`).toBe(true);
    }
  });

  it("every non-core node has an existing parent of the right kind, and one primary edge from it", () => {
    const up: Record<string, string> = { region: "core", topic: "region", leaf: "topic" };
    for (const n of nodes) {
      if (n.kind === "core") { expect(n.parent).toBeUndefined(); continue; }
      expect(n.parent, `${n.id} has a parent`).toBeDefined();
      const p = NODE_INDEX[n.parent!];
      expect(p, `${n.id} parent exists`).toBeDefined();
      expect(p.kind, `${n.id} parent kind`).toBe(up[n.kind]);
      expect(primary.filter((e) => e.from === n.parent && e.to === n.id)).toHaveLength(1);
    }
  });

  it("primary edges form a tree (no cycles, everything reachable from the root)", () => {
    const seen = new Set<string>();
    const walk = (id: string, trail: string[]) => {
      expect(trail.includes(id), `cycle at ${[...trail, id].join(" > ")}`).toBe(false);
      seen.add(id);
      for (const c of childrenOf(id)) walk(c.id, [...trail, id]);
    };
    walk(GRAPH.root, []);
    expect(seen.size).toBe(nodes.length);
  });

  it("has the six regions the legacy anchors and the spec expect", () => {
    expect(regions.map((r) => r.id).sort()).toEqual(["network", "provide", "run", "security", "settle", "verify"]);
    for (const id of Object.values(LEGACY_ANCHORS)) expect(ids.has(id), id).toBe(true);
  });

  it("keeps the spec's fan-out: 3–7 topics per region, 0–6 leaves per topic", () => {
    for (const r of regions) {
      const topics = childrenOf(r.id);
      expect(topics.length, r.id).toBeGreaterThanOrEqual(3);
      expect(topics.length, r.id).toBeLessThanOrEqual(7);
      for (const t of topics) expect(childrenOf(t.id).length, t.id).toBeLessThanOrEqual(6);
    }
  });

  it("has at most one hidden node per region", () => {
    for (const r of regions) {
      const hidden = nodes.filter((n) => n.hidden && pathTo(n.id)[1]?.id === r.id);
      expect(hidden.length, r.id).toBeLessThanOrEqual(1);
      for (const h of hidden) expect(h.label).not.toBe("?????");
    }
  });

  it("pathTo walks core → region → topic → leaf", () => {
    expect(pathTo("svc-compute").map((n) => n.id)).toEqual(["proof", "run", "run-compute", "svc-compute"]);
    expect(pathTo("nope")).toEqual([]);
  });
});

describe("universe graph: content", () => {
  it("has one leaf per catalog service with its status and interest", () => {
    for (const s of CATALOG) {
      const n = NODE_INDEX[`svc-${s.id}`];
      expect(n, s.id).toBeDefined();
      expect(n.status).toBe(s.status);
      expect(n.interest).toBe(s.id);
      expect(n.summary).toBe(s.line);
      expect(n.parent).toBe(`run-${s.group}`);
    }
  });

  it("every interest is a valid service id", () => {
    const valid = new Set(CATALOG.map((s) => s.id as string));
    for (const n of nodes) if (n.interest) expect(valid.has(n.interest), `${n.id}: ${n.interest}`).toBe(true);
  });

  it("every href resolves: router allowlist, public file, or https URL under the repo / API", () => {
    const ok = allowlist();
    for (const n of nodes) {
      if (!n.href) continue;
      if (/^https:\/\//.test(n.href)) {
        expect(n.href.startsWith("https://github.com/AmrDab/Cloudana10") || n.href.startsWith("https://api.cloudana.io/"), `${n.id}: ${n.href}`).toBe(true);
        continue;
      }
      const path = n.href.split("#")[0];
      expect(ok.has(path), `${n.id}: ${n.href}`).toBe(true);
    }
  });

  it("every node has a label; live bindings have a positive full", () => {
    for (const n of nodes) {
      expect(n.label.trim().length, n.id).toBeGreaterThan(0);
      if (n.live) expect(n.live.full, n.id).toBeGreaterThan(0);
      if (n.size !== undefined) { expect(n.size).toBeGreaterThanOrEqual(0.4); expect(n.size).toBeLessThanOrEqual(1.4); }
    }
  });

  it("keeps copy short: summary ≤ 90, body lines ≤ 120, 1–4 body lines", () => {
    for (const n of nodes) {
      if (n.summary) expect(n.summary.length, `${n.id} summary: ${n.summary}`).toBeLessThanOrEqual(90);
      if (n.body) {
        expect(n.body.length, `${n.id} body lines`).toBeGreaterThanOrEqual(1);
        expect(n.body.length, `${n.id} body lines`).toBeLessThanOrEqual(4);
        for (const l of n.body) expect(l.length, `${n.id} body: ${l}`).toBeLessThanOrEqual(120);
      }
    }
  });

  it("uses no banned words", () => {
    for (const n of nodes) {
      const text = [n.label, n.summary ?? "", n.hrefLabel ?? "", ...(n.body ?? [])].join("\n").toLowerCase();
      for (const w of BANNED) expect(text.includes(w), `${n.id} contains "${w}"`).toBe(false);
    }
  });
});
