// The focused region's panel: city, title, summary, then a disclosure tree of topics → leaves
// (docs/UNIVERSE_SPEC.md v2 "Smart navigation"). Fixed to the right on desktop; a bottom sheet under 640 px.
// Expansion follows the selection: the selected topic is open, the selected leaf shows its facts.
import { useEffect, useRef } from "react";
import { ArrowUpRight, ChevronDown, X } from "lucide-react";
import { btn } from "@/components/cld/cta";
import { StatusChip } from "@/components/cld/status-chip";
import { openWaitlist } from "@/components/waitlist";
import type { ServiceId } from "@/lib/services";
import { cn } from "@/lib/utils";
import { childrenOf, NODE_INDEX, pathTo } from "./graph";
import { TONE_DOT, TONE_TEXT } from "./ListView";
import { cityOf } from "./places";
import { modalOpen } from "./RegionDock";
import type { LiveValue, NodeId, UNode } from "./types";

type Live = Partial<Record<NodeId, LiveValue>>;

function LiveText({ value }: { value?: LiveValue }) {
  if (!value) return null;
  return <span className={cn("font-mono text-xs tabular-nums", value.intensity > 0 ? "text-ok" : "text-faint")}>{value.text}</span>;
}

function OpenLink({ node }: { node: UNode }) {
  if (!node.href) return null;
  const ext = /^https?:\/\//.test(node.href);
  return (
    <a href={node.href} className={btn.ghost("sm", "h-8 px-2.5 text-xs")} {...(ext ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      {node.hrefLabel ?? "Open"} {ext ? <ArrowUpRight className="size-3.5" aria-hidden /> : <span aria-hidden>→</span>}
    </a>
  );
}

/** Status, summary, body lines, live value and actions of an expanded topic or leaf. */
function Facts({ node, live }: { node: UNode; live?: LiveValue }) {
  const waitlist = node.status === "early" || node.status === "planned";
  return (
    <div className="grid gap-2 pb-3 pl-[26px] pr-2 text-sm leading-[1.5]">
      {node.status && <div><StatusChip status={node.status} /></div>}
      {node.summary && <p className="text-muted-foreground">{node.summary}</p>}
      {node.body && node.body.length > 0 && (
        <ul className="grid gap-1 text-[13px] text-text/85">
          {node.body.map((line) => (
            <li key={line} className="flex gap-2">
              <span aria-hidden className="mt-[8px] size-1 shrink-0 rounded-full bg-faint" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      )}
      {live && (
        <p className="font-mono text-[11px] uppercase tracking-[.08em] text-faint">
          Now <span className="ml-1 normal-case tracking-normal text-text tabular-nums">{live.text}</span>
        </p>
      )}
      {(node.href || waitlist) && (
        <div className="flex flex-wrap gap-2 pt-1">
          <OpenLink node={node} />
          {waitlist && (
            <button
              type="button"
              className={btn.primary("sm", "h-8 px-2.5 text-xs")}
              onClick={() => openWaitlist(node.interest ? { interests: [node.interest as ServiceId] } : {})}
            >
              Join the waitlist
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function RegionPanel({
  regionId,
  selectedId,
  revealed,
  live,
  onSelect,
  onReveal,
  onClose,
}: {
  regionId: NodeId;
  /** The selected node (region, topic or leaf); drives which topic/leaf is expanded. */
  selectedId: NodeId | null;
  revealed: ReadonlySet<NodeId>;
  live: Live;
  /** Select a node; `fly` moves the globe too (topics), leaves only expand in place. */
  onSelect: (id: NodeId, fly: boolean) => void;
  onReveal: (id: NodeId) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const region = NODE_INDEX[regionId];
  const path = selectedId ? pathTo(selectedId) : [];
  const inRegion = path[1]?.id === regionId;
  const openTopic = inRegion ? path[2]?.id : undefined;
  const openLeaf = inRegion && path[3]?.kind === "leaf" ? path[3].id : undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && !modalOpen()) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Bring the selected row into view (search results and deep links land deep in the tree).
  useEffect(() => {
    ref.current?.querySelector("[data-current]")?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  if (!region) return null;
  const tone = region.tone ?? "neutral";

  const clickTopic = (t: UNode) => {
    if (t.hidden && !revealed.has(t.id)) {
      onReveal(t.id);
      onSelect(t.id, true);
    } else if (openTopic === t.id) onSelect(regionId, false);
    else onSelect(t.id, true);
  };

  return (
    <aside
      ref={ref}
      aria-labelledby="region-h"
      className={cn(
        "absolute z-20 flex flex-col overflow-y-auto overscroll-contain border border-line-2 bg-[rgba(12,16,23,.9)] text-text shadow-[0_18px_48px_rgba(0,0,0,.45)] backdrop-blur-[14px]",
        "max-sm:inset-x-0 max-sm:bottom-0 max-sm:max-h-[46dvh] max-sm:rounded-t-xl max-sm:border-b-0",
        "sm:right-4 sm:top-20 sm:max-h-[calc(100dvh-80px-140px)] sm:w-[min(372px,calc(50vw-48px))] sm:rounded-xl md:right-6",
      )}
    >
      <div className="sticky top-0 z-10 bg-[rgba(12,16,23,.96)] px-5 pb-3 pt-4">
        <button type="button" onClick={onClose} aria-label="Close panel" className="absolute right-3 top-3 grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-white/[.06] hover:text-text">
          <X className="size-4" aria-hidden />
        </button>
        <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[.12em] text-faint">
          <i aria-hidden className={cn("size-1.5 rounded-full", TONE_DOT[tone])} />
          {cityOf(regionId)}
        </p>
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1 pr-8">
          <h2 id="region-h" className={cn("font-head text-2xl font-bold leading-tight tracking-[-.02em]", TONE_TEXT[tone])}>{region.label}</h2>
          <LiveText value={live[regionId]} />
        </div>
        {region.summary && <p className="mt-2 text-sm leading-[1.5] text-muted-foreground">{region.summary}</p>}
        {region.href && <div className="mt-3"><OpenLink node={region} /></div>}
      </div>

      <ul className="border-t border-line px-2 py-2">
        {childrenOf(regionId).map((t) => {
          const concealed = !!t.hidden && !revealed.has(t.id);
          const open = !concealed && openTopic === t.id;
          const leaves = childrenOf(t.id);
          return (
            <li key={t.id} className={cn("rounded-lg", open && "bg-white/[.03]")}>
              <button
                type="button"
                onClick={() => clickTopic(t)}
                aria-expanded={concealed ? undefined : open}
                aria-controls={open ? `rp-${t.id}` : undefined}
                aria-label={concealed ? "Hidden topic: reveal it" : undefined}
                {...(open && !openLeaf ? { "data-current": "" } : {})}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2.5 text-left hover:bg-white/[.04]"
              >
                <i aria-hidden className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[t.tone ?? "neutral"])} />
                <span className={cn("min-w-0 flex-1 truncate font-head text-[15px] font-medium", concealed ? "tracking-[.2em] text-faint" : "text-text")}>
                  {concealed ? "?????" : t.label}
                </span>
                <LiveText value={concealed || open ? undefined : live[t.id]} />
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-[.08em] text-faint">{cityOf(t.id)}</span>
                {!concealed && <ChevronDown aria-hidden className={cn("size-4 shrink-0 text-faint transition-transform duration-150", open && "rotate-180")} />}
              </button>
              {open && (
                <div id={`rp-${t.id}`}>
                  <Facts node={t} live={live[t.id]} />
                  {leaves.length > 0 && (
                    <ul className="pb-2 pl-4">
                      {leaves.map((l) => {
                        const lopen = openLeaf === l.id;
                        return (
                          <li key={l.id} className="border-l border-line">
                            <button
                              type="button"
                              onClick={() => onSelect(lopen ? t.id : l.id, false)}
                              aria-expanded={lopen}
                              aria-controls={lopen ? `rp-${l.id}` : undefined}
                              {...(lopen ? { "data-current": "" } : {})}
                              className="flex w-full items-center gap-2 rounded-r-md py-2 pl-3 pr-2 text-left hover:bg-white/[.04]"
                            >
                              <i aria-hidden className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[l.tone ?? "neutral"])} />
                              <span className={cn("min-w-0 flex-1 truncate text-sm", lopen ? "text-text" : "text-text/85")}>{l.label}</span>
                              {l.status && !lopen && <StatusChip status={l.status} className="text-[10px] leading-4" />}
                              <LiveText value={lopen ? undefined : live[l.id]} />
                            </button>
                            {lopen && (
                              <div id={`rp-${l.id}`} className="pl-1">
                                <Facts node={l} live={live[l.id]} />
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
