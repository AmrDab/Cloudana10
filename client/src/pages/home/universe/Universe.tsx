// The homepage: a full-viewport universe on a globe (globe/, the 2D engine/ as fallback) with a minimal React HUD,
// the region dock, search, the region panel, deep links and live network data. docs/UNIVERSE_SPEC.md "Shell (React)"
// and v2 "Smart navigation". Falls back to <ListView/> when the user prefers reduced motion or no canvas works;
// always renders the list sr-only for screen readers and crawlers.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Logo } from "@/components/cld/logo";
import { btn } from "@/components/cld/cta";
import { openWaitlist } from "@/components/waitlist";
import { useNetwork } from "@/hooks/useNetwork";
import { cn } from "@/lib/utils";
import { GRAPH, NODE_INDEX, pathTo } from "./graph";
import { ListView } from "./ListView";
import { createEngine } from "./engine/engine";
import { createGlobeEngine, webglAvailable } from "./globe";
import { cityOf, regionOf } from "./places";
import { ignoreShortcut, RegionDock } from "./RegionDock";
import { RegionPanel } from "./RegionPanel";
import { SearchPalette } from "./SearchPalette";
import { arrivedHome, flyTarget, liveValues, nodeLabel, parseHash } from "./shell-utils";
import type { EngineCallbacks, EngineOptions, NodeId, UNode, UniverseEngine, ZoomLevel } from "./types";

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

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

/**
 * The one place the engine is chosen: the globe when WebGL works, else the 2D map. Throws only when neither can
 * use this canvas (a failed globe may already hold a WebGL context); the shell then retries on a fresh canvas.
 */
function makeEngine(opts: EngineOptions, allowGlobe: boolean): UniverseEngine {
  if (allowGlobe && webglAvailable()) {
    try {
      return createGlobeEngine(opts);
    } catch (err) {
      if (import.meta.env.DEV) console.warn("[universe] globe failed, falling back to 2D", err);
    }
  }
  if (!opts.canvas.getContext("2d")) throw new Error("no 2D context on this canvas");
  return createEngine(opts);
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function Universe() {
  const reduced = useMemo(prefersReducedMotion, []);
  const [canvasOk, setCanvasOk] = useState(true);
  const [globeOff, setGlobeOff] = useState(false);
  const [view, setView] = useState<"map" | "list">(reduced ? "list" : "map");
  const [selected, setSelected] = useState<UNode | null>(null);
  const [level, setLevel] = useState<ZoomLevel>("galaxy");
  const lastLevel = useRef<ZoomLevel>("galaxy");
  const [region, setRegion] = useState<NodeId | null>(null);
  const [revealed, setRevealed] = useState<ReadonlySet<NodeId>>(() => new Set());
  const [hint, setHint] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  /** The region whose panel the user closed; it stays closed until something is selected again. */
  const [closedRegion, setClosedRegion] = useState<NodeId | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<UniverseEngine | null>(null);
  const [engine, setEngine] = useState<UniverseEngine | null>(null);
  const hashDone = useRef(false);
  const pendingFly = useRef<NodeId | null>(null);

  const { data, offline } = useNetwork();
  const live = useMemo(() => liveValues(GRAPH.nodes, data, offline), [data, offline]);

  const showMap = view === "map" && canvasOk;

  const setHash = (id: NodeId | null) => {
    const { pathname, search } = window.location;
    history.replaceState(null, "", id ? `${pathname}${search}#${id}` : pathname + search);
  };

  const zoomOut = useCallback(() => {
    setSelected(null);
    setHash(null);
    engineRef.current?.zoomOut();
  }, []);

  /**
   * Select a node (breadcrumb, dock, search, panel, list view, deep link) and reflect it in state + hash; `fly` also
   * moves the globe (a leaf goes to its topic's city). The core means "zoom out".
   */
  const select = useCallback(
    (id: NodeId, fly = true) => {
      const node = getNode(id);
      if (!node) return;
      if (node.kind === "core") return zoomOut();
      setClosedRegion(null);
      setSelected(node);
      setHash(id);
      if (!fly) return;
      const target = flyTarget(node);
      const e = engineRef.current;
      if (e) e.flyTo(target);
      else pendingFly.current = target;
    },
    [zoomOut],
  );

  const reveal = useCallback((id: NodeId) => {
    engineRef.current?.reveal(id);
    setRevealed((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

  const applyHash = useCallback(() => {
    const id = parseHash(window.location.hash, hasNode);
    if (id) select(id);
    else if (engineRef.current) zoomOut();
  }, [select, zoomOut]);

  // Document title + referral capture (kept from the old homepage).
  useEffect(() => {
    document.title = TITLE;
  }, []);

  // Engine lifecycle: created while the canvas is mounted, destroyed when the list view takes over or on unmount.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!showMap || !canvas) return;
    let e: UniverseEngine | undefined;
    const callbacks: EngineCallbacks = {
      onSelect: (node) => {
        if (node) setClosedRegion(null);
        setSelected(node);
        setHash(node ? node.id : null);
      },
      onHover: () => {}, // the engine sets the canvas cursor itself; nothing in the HUD depends on hover
      onCamera: (_camera, lvl) => {
        setLevel(lvl);
        const region = e ? e.currentRegion() : null;
        setRegion(region);
        if (arrivedHome(lvl, lastLevel.current, region)) {
          setSelected(null);
          if (window.location.hash) setHash(null);
        }
        lastLevel.current = lvl;
      },
      onReveal: (node) => setRevealed((prev) => new Set(prev).add(node.id)),
    };
    try {
      e = makeEngine({ canvas, graph: GRAPH, reducedMotion: reduced, callbacks }, !globeOff);
    } catch {
      // A failed globe can leave a WebGL context on this canvas: remount a fresh one for the 2D map, else the list.
      if (!globeOff) setGlobeOff(true);
      else setCanvasOk(false);
      return;
    }
    const eng = e;
    engineRef.current = eng;
    setEngine(eng);
    if (import.meta.env.DEV) (window as unknown as { __universe?: UniverseEngine }).__universe = eng; // dev-only debug handle
    eng.start();
    eng.setLive(live);
    const raf = requestAnimationFrame(() => {
      if (pendingFly.current) {
        eng.flyTo(pendingFly.current);
        pendingFly.current = null;
      } else if (!hashDone.current) {
        applyHash();
      }
      hashDone.current = true;
    });
    return () => {
      cancelAnimationFrame(raf);
      eng.destroy();
      engineRef.current = null;
      setEngine(null);
    };
    // `live` is pushed by its own effect below; `applyHash` only changes with select/zoomOut, which are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMap, reduced, globeOff]);

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

  // ⌘K / Ctrl+K toggles search anywhere; "/" opens it when not typing; Esc flies back to the whole globe.
  useEffect(() => {
    if (!showMap) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      } else if (e.key === "/" && !ignoreShortcut(e)) {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === "Escape" && !ignoreShortcut(e)) {
        zoomOut();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showMap, zoomOut]);

  const onPick = useCallback(
    (id: NodeId) => {
      setSearchOpen(false);
      if (getNode(id)?.hidden) reveal(id);
      select(id);
    },
    [reveal, select],
  );

  const selectedRegion = selected ? regionOf(selected.id)?.id : undefined;

  const closePanel = useCallback(() => {
    setClosedRegion(selectedRegion ?? region);
    setSelected(null);
  }, [selectedRegion, region]);

  const onListFly = useCallback(
    (id: NodeId) => {
      setView("map");
      select(id);
    },
    [select],
  );

  const crumbId = selected?.id ?? region;
  const crumbs: UNode[] = crumbId ? pathTo(crumbId) : [];
  // The panel follows the selection's region, else the region in view once zoomed in, unless the user closed it.
  const focusRegion = selectedRegion ?? (level !== "galaxy" ? region : null);
  const panelOpen = showMap && !!focusRegion && focusRegion !== closedRegion;
  const landing = showMap && level === "galaxy" && !selected;
  const hudLink = "text-[11px] text-faint transition-colors duration-150 hover:text-text";

  return (
    <div className="fixed inset-0 overflow-hidden bg-bg text-text">
      {showMap && (
        // On phones the panel is a bottom sheet (46dvh): lift the map so the focused place stays visible above it.
        <div
          className={cn(
            "absolute inset-0 transition-transform duration-500",
            panelOpen && "max-sm:-translate-y-[23dvh]",
          )}
        >
          <canvas
            // A failed globe may keep a WebGL context on its canvas: the 2D fallback gets a fresh element.
            key={globeOff ? "2d" : "globe"}
            ref={canvasRef}
            aria-hidden
            className="absolute inset-0 block h-full w-full cursor-grab touch-none select-none"
          />
        </div>
      )}

      {/* The same graph as a semantic list: the fallback view, and always present (sr-only) for screen readers. */}
      <div className={showMap ? "sr-only" : "absolute inset-0 overflow-y-auto px-6 pb-20 pt-24 max-[480px]:px-4"}>
        <ListView live={live} onFly={canvasOk ? onListFly : undefined} />
      </div>

      {/* Landing copy: galaxy level only; fades out as soon as the globe zooms in. */}
      {showMap && (
        <div
          aria-hidden={!landing}
          className={cn(
            "pointer-events-none absolute left-4 top-20 z-10 max-w-[22rem] transition-opacity duration-700 md:left-6 md:top-24",
            landing ? "opacity-100" : "opacity-0",
          )}
        >
          <p className="font-head text-[clamp(40px,5.5vw,76px)] font-bold leading-[.95] tracking-[-.03em] text-text">CLOUDANA</p>
          <p className="mt-3 text-base leading-[1.5] text-muted-foreground">
            The proof is the work. A decentralized datacenter, on every continent.
          </p>
        </div>
      )}

      {panelOpen && focusRegion && (
        <RegionPanel
          key={focusRegion}
          regionId={focusRegion}
          selectedId={selected?.id ?? null}
          revealed={revealed}
          live={live}
          onSelect={select}
          onReveal={reveal}
          onClose={closePanel}
        />
      )}

      {showMap && <SearchPalette open={searchOpen} onOpenChange={setSearchOpen} revealed={revealed} onPick={onPick} />}

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
                    const city = n.kind === "region" ? cityOf(n.id) : undefined;
                    return (
                      <li key={n.id} className="flex min-w-0 items-center gap-1">
                        {i > 0 && <span aria-hidden>›</span>}
                        {last ? (
                          <span aria-current="page" className="truncate text-text">{nodeLabel(n, revealed)}</span>
                        ) : (
                          <button type="button" onClick={() => (n.kind === "core" ? zoomOut() : select(n.id))} className="truncate rounded-sm hover:text-text">
                            {nodeLabel(n, revealed)}
                          </button>
                        )}
                        {city && <span className="shrink-0 whitespace-nowrap">· {city}</span>}
                      </li>
                    );
                  })}
                </ol>
              </nav>
            )}
          </div>
          <div className="pointer-events-auto flex shrink-0 items-center gap-2">
            {showMap && (
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                aria-keyshortcuts={IS_MAC ? "Meta+K /" : "Control+K /"}
                aria-label="Search the map"
                className={btn.ghost("sm", "text-muted-foreground max-sm:w-9 max-sm:px-0 sm:w-[200px] sm:justify-start")}
              >
                <Search className="size-4" aria-hidden />
                <span className="font-sans font-normal max-sm:hidden">Search</span>
                <kbd className="ml-auto rounded border border-line-2 px-1.5 font-mono text-[10px] leading-4 text-faint max-sm:hidden">{IS_MAC ? "⌘K" : "Ctrl K"}</kbd>
              </button>
            )}
            <a href="/control" className={btn.ghost("sm", "max-sm:hidden")}>Open console</a>
            <button type="button" onClick={() => openWaitlist()} className={btn.primary("sm")}>Join the waitlist</button>
          </div>
        </div>

        {/* On phones the panel docks to the bottom, so the dock and the bottom row step aside while it is open. */}
        <div className={cn("flex flex-col gap-3", panelOpen && "max-sm:hidden")}>
          {showMap && <RegionDock active={selectedRegion ?? region} onTravel={select} />}
          <div className="flex items-end justify-between gap-3">
            <p
              aria-hidden
              className={cn(
                "font-mono text-[11px] uppercase tracking-[.08em] text-faint transition-opacity duration-700 max-sm:hidden",
                hint && showMap ? "opacity-100" : "opacity-0",
              )}
            >
              Drag to spin · Scroll to zoom · 1–6 to travel · ⌘K to search
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
              <span className="flex flex-wrap items-center gap-1.5">
                {TINY.map((l, i) => (
                  <span key={l.href} className="flex items-center gap-1.5">
                    {i > 0 && <span aria-hidden className="text-faint/60">·</span>}
                    <a href={l.href} className={hudLink}>{l.label}</a>
                  </span>
                ))}
                <span aria-hidden className="text-faint/60">·</span>
                <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className={hudLink}>
                  Roads © OpenStreetMap
                </a>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Universe;
