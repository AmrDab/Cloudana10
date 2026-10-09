// Run (vitest lives in client/api): cd client/api && npx vitest run --root ../ --config ../vitest.config.ts
import { describe, expect, it } from "vitest";
import type { NetworkStats } from "@/hooks/useNetwork";
import type { UNode } from "./types";
import { GRAPH, NODE_INDEX } from "./graph";
import { PLACES, placeOf } from "./world";
import { arrivedHome, flyTarget, formatLive, liveValues, nodeLabel, parseHash, REGION_RING, ringStep, searchNodes } from "./shell-utils";

const STATS: NetworkStats = {
  nodesOnline: 3, nodesBound: 10, jobsQueued: 0, jobsDone: 497602, certificates: 12, mintedUcld: 2_500_000,
  burnedUcld: 0, verifiersToday: 1, epoch: 42, priceNcldPerTmac: 7, priceExpiresAt: 0, baseFeeUcld: 33, lastSettledEpochAt: null,
};

const NODES: UNode[] = [
  { id: "proof", label: "Proof", kind: "core" },
  { id: "network", label: "Network", kind: "region", parent: "proof" },
  { id: "net-online", label: "Nodes online", kind: "leaf", parent: "network", live: { stat: "nodesOnline", format: "int", full: 10 } },
  { id: "net-jobs", label: "Jobs done", kind: "leaf", parent: "network", live: { stat: "jobsDone", format: "int", full: 1000 } },
  { id: "net-epoch", label: "Epoch", kind: "leaf", parent: "network", live: { stat: "epoch", format: "epoch", full: 1 } },
  { id: "net-minted", label: "CLD minted", kind: "leaf", parent: "network", live: { stat: "mintedUcld", format: "cld", full: 5_000_000 } },
  { id: "net-price", label: "Price", kind: "leaf", parent: "network", live: { stat: "priceNcldPerTmac", format: "price", full: 0 } },
  { id: "net-deploy", label: "Deployments", kind: "leaf", parent: "network", live: { stat: "deploymentsRunning", format: "int", full: 10 } },
  { id: "run", label: "Run", kind: "region", parent: "proof" },
  { id: "run-secret", label: "Coming up", kind: "topic", parent: "run", hidden: true },
];
const [, region] = NODES;
const hidden = NODES[NODES.length - 1];

describe("formatLive", () => {
  it("follows the binding format", () => {
    expect(formatLive("int", 497602)).toBe("497,602");
    expect(formatLive("epoch", 42)).toBe("#42");
    expect(formatLive("cld", 2_500_000)).toBe("2.50 CLD");
    expect(formatLive("price", 7)).toBe("7 nCLD/TMAC");
  });
});

describe("liveValues", () => {
  it("maps only bound nodes and clamps intensity to 0..1", () => {
    const v = liveValues(NODES, STATS, false);
    expect(Object.keys(v).sort()).toEqual(["net-deploy", "net-epoch", "net-jobs", "net-minted", "net-online", "net-price"]);
    expect(v["net-online"]).toEqual({ text: "3", intensity: 0.3 });
    expect(v["net-jobs"]).toEqual({ text: "497,602", intensity: 1 });
    expect(v["net-epoch"]).toEqual({ text: "#42", intensity: 1 });
    expect(v["net-minted"]).toEqual({ text: "2.50 CLD", intensity: 0.5 });
    // full: 0 never divides by zero; it just stays dim.
    expect(v["net-price"]).toEqual({ text: "7 nCLD/TMAC", intensity: 0 });
    // Stats the API does not report yet read as 0.
    expect(v["net-deploy"]).toEqual({ text: "0", intensity: 0 });
  });
  it("zero stays dim (honest by design), offline reads 'offline', no stats yet gives nothing", () => {
    expect(liveValues(NODES, { ...STATS, nodesOnline: 0 }, false)["net-online"]).toEqual({ text: "0", intensity: 0 });
    const off = liveValues(NODES, STATS, true);
    expect(off["net-online"]).toEqual({ text: "offline", intensity: 0 });
    expect(Object.keys(off)).toHaveLength(6);
    expect(liveValues(NODES, null, false)).toEqual({});
  });
});

describe("parseHash", () => {
  const has = (id: string) => NODES.some((n) => n.id === id) || id === "settle";
  it("resolves node ids and legacy anchors", () => {
    expect(parseHash("#run", has)).toBe("run");
    expect(parseHash("run", has)).toBe("run");
    expect(parseHash("#services", has)).toBe("run"); // LEGACY_ANCHORS.services
    expect(parseHash("#pays", has)).toBe("settle");
    expect(parseHash("#provide", (id) => id === "provide")).toBe("provide");
    expect(parseHash("#status", has)).toBe("network");
    expect(parseHash("#waitlist", has)).toBe("proof");
    expect(parseHash("#net%2Donline", has)).toBe("net-online");
  });
  it("rejects unknown, empty and prototype keys", () => {
    expect(parseHash("#nope", has)).toBeNull();
    expect(parseHash("#", has)).toBeNull();
    expect(parseHash("", has)).toBeNull();
    expect(parseHash("#__proto__", has)).toBeNull();
    expect(parseHash("#%E0%A4%A", has)).toBeNull(); // malformed escape
    // A legacy anchor whose target is missing from the graph is unknown too.
    expect(parseHash("#pays", (id) => id === "run")).toBeNull();
  });
});

describe("nodeLabel", () => {
  it("hides unrevealed hidden nodes", () => {
    expect(nodeLabel(hidden, new Set())).toBe("?????");
    expect(nodeLabel(hidden, new Set(["run-secret"]))).toBe("Coming up");
    expect(nodeLabel(region, new Set())).toBe("Network");
  });
});

describe("arrivedHome", () => {
  it("clears only on the transition back into the galaxy with no region in view", () => {
    expect(arrivedHome("galaxy", "system", null)).toBe(true);
    expect(arrivedHome("galaxy", "planet", null)).toBe(true);
    expect(arrivedHome("galaxy", "galaxy", null)).toBe(false); // a fly-to that starts at home
    expect(arrivedHome("galaxy", "system", "run")).toBe(false); // zoomed out but still over a region
    expect(arrivedHome("system", "galaxy", null)).toBe(false);
  });
});

describe("ringStep / REGION_RING", () => {
  it("is the six regions of the graph in the spec's ring order", () => {
    expect(REGION_RING).toEqual(["run", "settle", "provide", "verify", "security", "network"]);
    for (const id of REGION_RING) expect(NODE_INDEX[id]?.kind).toBe("region");
    expect(GRAPH.nodes.filter((n) => n.kind === "region")).toHaveLength(REGION_RING.length);
  });
  it("steps and wraps both ways", () => {
    expect(ringStep("run", 1)).toBe("settle");
    expect(ringStep("settle", -1)).toBe("run");
    expect(ringStep("network", 1)).toBe("run");
    expect(ringStep("run", -1)).toBe("network");
  });
  it("starts at the ends from nowhere (or an unknown id)", () => {
    expect(ringStep(null, 1)).toBe("run");
    expect(ringStep(null, -1)).toBe("network");
    expect(ringStep("nope", 1)).toBe("run");
  });
});

describe("flyTarget", () => {
  it("sends leaves to their topic, everything else to itself", () => {
    expect(flyTarget(NODES[2])).toBe("network");
    expect(flyTarget(region)).toBe("network");
    expect(flyTarget(hidden)).toBe("run-secret");
  });
});

describe("searchNodes", () => {
  const S: UNode[] = [
    { id: "proof", label: "Proof", kind: "core" },
    { id: "settle", label: "Settle (CLD)", kind: "region", parent: "proof", summary: "The fee is burned; CLD is minted." },
    { id: "settle-epochs", label: "Epochs", kind: "topic", parent: "settle", summary: "Hourly batches settle on Base." },
    { id: "settle-epoch-now", label: "Current epoch", kind: "leaf", parent: "settle-epochs", body: ["Posted by the keeper every hour."] },
    { id: "run", label: "Run", kind: "region", parent: "proof", summary: "Submit work." },
    { id: "run-roadmap", label: "Roadmap", kind: "topic", parent: "run", hidden: true, summary: "Coming up." },
    { id: "run-roadmap-gpu", label: "GPU clusters", kind: "leaf", parent: "run-roadmap" },
    { id: "network", label: "Network", kind: "region", parent: "proof", summary: "Live numbers." },
  ];
  const CITY: Record<string, string> = { settle: "London", "settle-epochs": "Amsterdam", run: "New York", "run-roadmap": "Albany", network: "São Paulo" };
  const cityOf = (id: string) => {
    for (let cur: UNode | undefined = S.find((n) => n.id === id); cur; cur = S.find((n) => n.id === cur!.parent)) {
      if (CITY[cur.id]) return CITY[cur.id];
    }
    return undefined;
  };
  const ids = (q: string, revealed: ReadonlySet<string> = new Set()) => searchNodes(q, S, { revealed, cityOf }).map((n) => n.id);

  it("empty or blank query finds nothing", () => {
    expect(ids("")).toEqual([]);
    expect(ids("   ")).toEqual([]);
  });
  it("ranks a label match above a summary match", () => {
    const r = ids("epoch");
    expect(r[0]).toBe("settle-epochs"); // "Epochs": label prefix, starts the label
    expect(r[1]).toBe("settle-epoch-now"); // a leaf: "Current epoch" is a whole word in the label
    expect(r).toHaveLength(2);
    // "settle" is in Settle's label and only in the Epochs topic's summary.
    expect(ids("settle")).toEqual(["settle", "settle-epochs"]);
  });
  it("finds leaves by body text", () => {
    expect(ids("keeper")).toEqual(["settle-epoch-now"]);
  });
  it("matches cities (accent-insensitive), and leaves inherit their topic's city", () => {
    expect(ids("london")).toEqual(["settle", "settle-epochs", "settle-epoch-now"].filter((id) => cityOf(id) === "London"));
    expect(ids("sao paulo")).toEqual(["network"]);
    expect(ids("amsterdam")).toEqual(["settle-epochs", "settle-epoch-now"]);
  });
  it("requires every token to match", () => {
    expect(ids("epoch london")).toEqual([]);
    expect(ids("epoch amsterdam").sort()).toEqual(["settle-epoch-now", "settle-epochs"]);
  });
  it("falls back to a subsequence on labels", () => {
    expect(ids("sttl")).toEqual(["settle"]);
    expect(ids("zzz")).toEqual([]);
  });
  it("keeps hidden nodes (and their subtree) out until revealed", () => {
    expect(ids("roadmap")).toEqual([]);
    expect(ids("gpu")).toEqual([]);
    expect(ids("albany")).toEqual([]);
    const open = new Set(["run-roadmap"]);
    expect(ids("roadmap", open)).toEqual(["run-roadmap"]);
    expect(ids("gpu", open)).toEqual(["run-roadmap-gpu"]);
  });
  it("respects the limit", () => {
    expect(searchNodes("e", S, { revealed: new Set(), cityOf, limit: 2 })).toHaveLength(2);
  });
  it("covers the real graph: every leaf is findable by its label once revealed", () => {
    const all = new Set(GRAPH.nodes.map((n) => n.id));
    const parentOf = (id: string) => NODE_INDEX[id]?.parent;
    const realCity = (id: string) => placeOf(id, parentOf)?.city;
    for (const n of GRAPH.nodes.filter((x) => x.kind === "leaf")) {
      const r = searchNodes(n.label, GRAPH.nodes, { revealed: all, cityOf: realCity, limit: 100 });
      expect(r.map((x) => x.id)).toContain(n.id);
    }
    expect(searchNodes("london", GRAPH.nodes, { revealed: all, cityOf: realCity })[0]?.id).toBe("settle");
    expect(Object.keys(PLACES)).toContain("settle");
  });
});
