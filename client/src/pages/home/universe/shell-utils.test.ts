// Run (vitest lives in client/api): cd client/api && npx vitest run --root ../ --config ../vitest.config.ts
import { describe, expect, it } from "vitest";
import type { NetworkStats } from "@/hooks/useNetwork";
import type { UNode } from "./types";
import { formatLive, liveValues, nodeLabel, panelPosition, panelVisible, parseHash } from "./shell-utils";
import { arrivedHome } from "./shell-utils";

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
const [core, region, leaf] = NODES;
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

describe("panelVisible", () => {
  it("shows regions from system level, deeper nodes at planet level, never the core", () => {
    expect(panelVisible(null, "planet")).toBe(false);
    expect(panelVisible(core, "planet")).toBe(false);
    expect(panelVisible(region, "galaxy")).toBe(false);
    expect(panelVisible(region, "system")).toBe(true);
    expect(panelVisible(region, "planet")).toBe(true);
    expect(panelVisible(leaf, "system")).toBe(false);
    expect(panelVisible(leaf, "planet")).toBe(true);
  });
});

describe("panelPosition", () => {
  const vp = { w: 1280, h: 800 }, panel = { w: 360, h: 240 };
  it("sits right of the node, vertically centred", () => {
    expect(panelPosition({ x: 640, y: 400, r: 20 }, panel, vp)).toEqual({ x: 674, y: 280 });
  });
  it("flips to the left near the right edge", () => {
    expect(panelPosition({ x: 1200, y: 400, r: 20 }, panel, vp)).toEqual({ x: 806, y: 280 });
  });
  it("clamps inside a 16 px margin", () => {
    expect(panelPosition({ x: 5, y: 5, r: 10 }, panel, vp)).toEqual({ x: 29, y: 16 });
    expect(panelPosition({ x: 640, y: 790, r: 10 }, panel, vp)).toEqual({ x: 664, y: 544 });
    // A panel larger than the viewport never goes negative.
    expect(panelPosition({ x: 100, y: 100, r: 10 }, { w: 500, h: 500 }, { w: 400, h: 300 })).toEqual({ x: 16, y: 16 });
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
