// The homepage universe: a zoomable map of what Cloudana is, centred on Proof.
// Shared contract between graph.ts (content), engine/ (canvas + camera) and Universe.tsx (React shell).
// docs/UNIVERSE_SPEC.md explains the behaviour; change this file only together with that doc.

export type NodeId = string;

/** core = the centre (Proof); region = a world around it; topic = a system inside a region; leaf = a planet with a panel. */
export type NodeKind = "core" | "region" | "topic" | "leaf";

/** Design tokens: ok teal (verified), work amber (work), chain blue (on-chain), burn red, neutral text. */
export type Tone = "ok" | "work" | "chain" | "burn" | "neutral";

/** Network stat that drives a node's glow. Keys match useNetwork()'s NetworkStats. */
export type LiveStat =
  | "nodesOnline"
  | "nodesBound"
  | "jobsDone"
  | "jobsQueued"
  | "certificates"
  | "mintedUcld"
  | "burnedUcld"
  | "verifiersToday"
  | "epoch"
  | "priceNcldPerTmac"
  | "deploymentsRunning"
  | "gpusOnline"
  | "workstationsRunning";

export interface LiveBinding {
  stat: LiveStat;
  /** How to print the number next to the label. */
  format: "int" | "cld" | "epoch" | "price";
  /** Value that counts as "fully lit"; brightness = clamp(value / full, 0, 1). Zero stays dim: honest by design. */
  full: number;
}

export interface UNode {
  id: NodeId;
  label: string;
  kind: NodeKind;
  tone?: Tone;
  /** Primary parent: the region/topic this node orbits. Undefined only for the core. */
  parent?: NodeId;
  /** One line under the label (system level and panel). ≤ 90 chars, no marketing claims. */
  summary?: string;
  /** Panel body at planet level: 1–4 short lines, each ≤ 120 chars. Facts only. */
  body?: string[];
  /** Where "Open" goes: internal path (/control/run, /lab#faq, /litepaper.html) or https URL. */
  href?: string;
  hrefLabel?: string;
  /** Service status chip (from lib/services.ts) when the node is a service. */
  status?: "live" | "early" | "planned";
  /** Waitlist interest to prefill when the panel's "Join the waitlist" is pressed. */
  interest?: string;
  /** Real network number that lights this node. */
  live?: LiveBinding;
  /** Shown as "?????" until revealed (click). Exactly one such node is allowed per region. */
  hidden?: boolean;
  /** Relative size 0.4–1.4 (default 1). */
  size?: number;
  /** Optional angle hint in degrees for the radial layout (clockwise from 12 o'clock). */
  angle?: number;
}

export interface UEdge {
  from: NodeId;
  to: NodeId;
  /** primary = parent link (drawn solid); cross = the "everything connected" links (drawn faint, dashed). */
  kind?: "primary" | "cross";
}

export interface UGraph {
  root: NodeId;
  nodes: UNode[];
  edges: UEdge[];
}

/** Camera in world units. zoom 1 = galaxy (core + regions legible), ~2.2 = system, ≥ 4 = planet. */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export type ZoomLevel = "galaxy" | "system" | "planet";

export interface LiveValue {
  /** Printed next to the label, e.g. "0 online", "#497,602". */
  text: string;
  /** 0..1 glow; 0 = dim, no pulse. */
  intensity: number;
}

export interface EngineCallbacks {
  /** Fired on click/tap of a node (after the fly-to starts) and with null when the user clicks empty space at planet level. */
  onSelect(node: UNode | null): void;
  onHover(node: UNode | null): void;
  /** Throttled to animation frames; the React shell uses it to position panels and update the breadcrumb. */
  onCamera(camera: Camera, level: ZoomLevel): void;
  /** A hidden node was revealed. */
  onReveal(node: UNode): void;
}

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  graph: UGraph;
  reducedMotion: boolean;
  callbacks: EngineCallbacks;
}

export interface FlyOptions {
  /** Target zoom; default: the level that makes the node's children legible. */
  zoom?: number;
  /** ms; ignored when reducedMotion (instant). */
  durationMs?: number;
}

/** Implemented by engine/engine.ts. The React shell owns the canvas element and the live data. */
export interface UniverseEngine {
  start(): void;
  destroy(): void;
  resize(): void;
  flyTo(id: NodeId, opts?: FlyOptions): void;
  /** Back to galaxy level, centred on the core. */
  zoomOut(): void;
  /** Screen-space position (CSS px, relative to the canvas) and radius of a node, or null when off-screen. */
  project(id: NodeId): { x: number; y: number; r: number } | null;
  setLive(values: Partial<Record<NodeId, LiveValue>>): void;
  reveal(id: NodeId): void;
  getCamera(): Camera;
  getLevel(): ZoomLevel;
  /** The region (direct child of the core) the camera is currently inside, if any. */
  currentRegion(): NodeId | null;
}

/** Anchors kept from the old homepage and the lab's nav: `/#services` etc. must still land somewhere sensible. */
export const LEGACY_ANCHORS: Record<string, NodeId> = {
  services: "run",
  pays: "settle",
  provide: "provide",
  status: "network",
  waitlist: "proof",
};
