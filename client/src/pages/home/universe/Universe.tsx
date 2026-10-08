// The homepage: a full-viewport canvas universe (engine/) with a minimal React HUD, the node panel, deep links
// and live network data. docs/UNIVERSE_SPEC.md "Shell (React)". Falls back to <ListView/> when the user prefers
// reduced motion or the canvas is unavailable; always renders the list sr-only for screen readers and crawlers.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Logo } from "@/components/cld/logo";
import { btn } from "@/components/cld/cta";
import { openWaitlist } from "@/components/waitlist";
import { useNetwork } from "@/hooks/useNetwork";
import { cn } from "@/lib/utils";
import { GRAPH, NODE_INDEX, pathTo } from "./graph";
import { ListView } from "./ListView";
import { createEngine } from "./engine/engine";
import { NodePanel } from "./NodePanel";
import { arrivedHome, liveValues, nodeLabel, panelVisible, parseHash } from "./shell-utils";
import type { EngineCallbacks, NodeId, UNode, UniverseEngine, ZoomLevel } from "./types";

const TITLE = "Cloudana — The proof is the work";

const hasNode = (id: NodeId) => Object.prototype.hasOwnProperty.call(NODE_INDEX, id);
const getNode = (id: NodeId): UNode | undefined => (NODE_INDEX as Record<NodeId, UNode | undefined>)[id];

/** Small HUD links: Litepaper · Lab · Terms · Privacy. */
const TINY = [
  { label: "Litepaper", href: "/litepaper.html" },
  { label: "Lab", href: "/lab" },
  { label: "Terms", href: "/terms.html" },
  { label: "Privacy", href: "/privacy.html" },
];

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function Universe() {
  const reduced = useMemo(prefersReducedMotion, []);
  const [canvasOk, setCanvasOk] = useState(true);
  const [view, setView] = useState<"map" | "list">(reduced ? "list" : "map");
  const [selected, setSelected] = useState<UNode | null>(null);
  const [level, setLevel] = useState<ZoomLevel>("galaxy");
  const lastLevel = useRef<ZoomLevel>("galaxy");
  const [region, setRegion] = useState<NodeId | null>(null);
  const [revealed, setRevealed] = useState<ReadonlySet<NodeId>>(() => new Set());
  const [hint, setHint] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<UniverseEngine | null>(null);
  const [engine, setEngine] = useState<UniverseEngine | null>(null);
  const cameraSubs = useRef(new Set<() => void>());
  const hashDone = useRef(false);
  const pendingFly = useRef<NodeId | null>(null);

  const { data, offline } = useNetwork();
  const live = useMemo(() => liveValues(GRAPH.nodes, data, offline), [data, offline]);

  const showMap = view === "map" && canvasOk;

  const subscribeCamera = useCallback((fn: () => void) => {
    cameraSubs.current.add(fn);
    return () => {
      cameraSubs.current.delete(fn);
    };
  }, []);

  const setHash = (id: NodeId | null) => {
    const { pathname, search } = window.location;
    history.replaceState(null, "", id ? `${pathname}${search}#${id}` : pathname + search);
  };

  /** Fly to a node (from the breadcrumb, list view or a deep link) and reflect it in state + hash. */
  const flyTo = useCallback((id: NodeId) => {
    const node = getNode(id);
    if (!node) return;
    setSelected(node.kind === "core" ? null : node);
    setHash(node.kind === "core" ? null : id);
    const e = engineRef.current;
    if (e) e.flyTo(id);
    else pendingFly.current = id;
  }, []);

  const zoomOut = useCallback(() => {
    setSelected(null);
    setHash(null);
    engineRef.current?.zoomOut();
  }, []);

  const close = useCallback(() => setSelected(null), []);

  const applyHash = useCallback(() => {
    const id = parseHash(window.location.hash, hasNode);
    if (id) flyTo(id);
    else if (engineRef.current) zoomOut();
  }, [flyTo, zoomOut]);

  // Document title + referral capture (kept from the old homepage).
  useEffect(() => {
    document.title = TITLE;
  }, []);

  // Engine lifecycle: created while the canvas is mounted, destroyed when the list view takes over or on unmount.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!showMap || !canvas) return;
    if (!canvas.getContext("2d")) {
      setCanvasOk(false);
      return;
    }
    const callbacks: EngineCallbacks = {
      onSelect: (node) => {
        setSelected(node);
        setHash(node ? node.id : null);
      },
      onHover: () => {}, // the engine sets the canvas cursor itself; nothing in the HUD depends on hover
      onCamera: (_camera, lvl) => {
        setLevel(lvl);
        const region = e.currentRegion();
        setRegion(region);
        if (arrivedHome(lvl, lastLevel.current, region)) {
          setSelected(null);
          if (window.location.hash) setHash(null);
        }
        lastLevel.current = lvl;
        cameraSubs.current.forEach((fn) => fn());
      },
      onReveal: (node) => setRevealed((prev) => new Set(prev).add(node.id)),
    };
    const e = createEngine({ canvas, graph: GRAPH, reducedMotion: reduced, callbacks });
    engineRef.current = e;
    setEngine(e);
    if (import.meta.env.DEV) (window as unknown as { __universe?: UniverseEngine }).__universe = e; // dev-only debug handle
    e.start();
    e.setLive(live);
    const raf = requestAnimationFrame(() => {
      if (pendingFly.current) {
        e.flyTo(pendingFly.current);
        pendingFly.current = null;
      } else if (!hashDone.current) {
        applyHash();
      }
      hashDone.current = true;
    });
    return () => {
      cancelAnimationFrame(raf);
      e.destroy();
      engineRef.current = null;
      setEngine(null);
    };
    // `live` is pushed by its own effect below; `applyHash` only changes with flyTo/zoomOut, which are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMap, reduced]);

  useEffect(() => {
    engineRef.current?.setLive(live);
  }, [live, engine]);

  // Deep links: back/forward (and manual hash edits) fly too.
  useEffect(() => {
    window.addEventListener("popstate", applyHash);
    window.addEventListener("hashchange", applyHash);
    return () => {
      window.removeEventListener("popstate", applyHash);
      window.removeEventListener("hashchange", applyHash);
    };
  }, [applyHash]);

  // The hint fades after the first pointer / wheel / keyboard interaction.
  useEffect(() => {
    if (!hint) return;
    const done = () => setHint(false);
    const opts = { once: true, passive: true } as const;
    window.addEventListener("pointerdown", done, opts);
    window.addEventListener("wheel", done, opts);
    window.addEventListener("keydown", done, opts);
    return () => {
      window.removeEventListener("pointerdown", done);
      window.removeEventListener("wheel", done);
      window.removeEventListener("keydown", done);
    };
  }, [hint]);

  const onListFly = useCallback(
    (id: NodeId) => {
      setView("map");
      flyTo(id);
    },
    [flyTo],
  );

  const crumbId = selected?.id ?? region;
  const crumbs: UNode[] = crumbId ? pathTo(crumbId) : [];
  const panelOpen = showMap && panelVisible(selected, level);
  const hudLink = "text-[11px] text-faint transition-colors duration-150 hover:text-text";

  return (
    <div className="fixed inset-0 overflow-hidden bg-bg text-text">
      {showMap && (
        <canvas
          ref={canvasRef}
          aria-hidden
          className="absolute inset-0 block h-full w-full cursor-grab touch-none select-none"
        />
      )}

      {/* The same graph as a semantic list: the fallback view, and always present (sr-only) for screen readers. */}
      <div className={showMap ? "sr-only" : "absolute inset-0 overflow-y-auto px-6 pb-20 pt-24 max-[480px]:px-4"}>
        <ListView live={live} onFly={canvasOk ? onListFly : undefined} />
      </div>

      {panelOpen && selected && engine && (
        <NodePanel key={selected.id} node={selected} live={live[selected.id]} engine={engine} subscribeCamera={subscribeCamera} onClose={close} />
      )}

      {/* HUD */}
      <div className="pointer-events-none absolute inset-0 z-30 flex flex-col justify-between p-4 md:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="pointer-events-auto flex min-w-0 items-center gap-3">
            <span
              onClickCapture={(e) => {
                e.preventDefault();
                zoomOut();
              }}
              title="Zoom out"
            >
              <Logo />
            </span>
            {crumbs.length > 0 && (
              <nav aria-label="Breadcrumb" className="min-w-0 max-sm:hidden">
                <ol className="flex min-w-0 items-center gap-1 font-mono text-[11px] uppercase tracking-[.08em] text-faint">
                  {crumbs.map((n, i) => {
                    const last = i === crumbs.length - 1;
                    return (
                      <li key={n.id} className="flex min-w-0 items-center gap-1">
                        {i > 0 && <span aria-hidden>›</span>}
                        {last ? (
                          <span aria-current="page" className="truncate text-text">{nodeLabel(n, revealed)}</span>
                        ) : (
                          <button type="button" onClick={() => (n.kind === "core" ? zoomOut() : flyTo(n.id))} className="truncate rounded-sm hover:text-text">
                            {nodeLabel(n, revealed)}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </nav>
            )}
          </div>
          <div className="pointer-events-auto flex shrink-0 items-center gap-2">
            <a href="/control" className={btn.ghost("sm", "max-sm:hidden")}>Open console</a>
            <button type="button" onClick={() => openWaitlist()} className={btn.primary("sm")}>Join the waitlist</button>
          </div>
        </div>

        {/* On phones the panel docks to the bottom, so the bottom row steps aside while it is open. */}
        <div className={cn("flex items-end justify-between gap-3", panelOpen && selected && "max-sm:hidden")}>
          <p
            aria-hidden
            className={cn(
              "font-mono text-[11px] uppercase tracking-[.08em] text-faint transition-opacity duration-700 max-sm:hidden",
              hint && showMap ? "opacity-100" : "opacity-0",
            )}
          >
            Drag to move · Scroll to zoom · Double-click to fly
          </p>
          <div className="pointer-events-auto ml-auto flex items-center gap-3 font-mono">
            {canvasOk && (
              <button
                type="button"
                onClick={() => setView(view === "map" ? "list" : "map")}
                aria-pressed={view === "list"}
                className="rounded-md border border-line-2 bg-white/[.02] px-2 py-1 text-[11px] uppercase tracking-[.08em] text-muted-foreground hover:border-faint hover:text-text"
              >
                {view === "map" ? "List" : "Map"}
              </button>
            )}
            <span className="flex items-center gap-1.5">
              {TINY.map((l, i) => (
                <span key={l.href} className="flex items-center gap-1.5">
                  {i > 0 && <span aria-hidden className="text-faint/60">·</span>}
                  <a href={l.href} className={hudLink}>{l.label}</a>
                </span>
              ))}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Universe;
