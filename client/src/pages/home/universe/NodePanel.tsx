// The planet-level panel for the selected node. Positioned by the engine's projection on every camera tick
// (DOM transform, no React re-render per frame); docks to the bottom as a sheet under 640 px.
import { lazy, Suspense, useEffect, useRef } from "react";
import { ArrowUpRight, X } from "lucide-react";
import { btn } from "@/components/cld/cta";
import { StatusChip } from "@/components/cld/status-chip";
import { openWaitlist } from "@/components/waitlist";
import type { ServiceId } from "@/lib/services";
import { panelPosition } from "./shell-utils";
import type { LiveValue, UNode, UniverseEngine } from "./types";

const NetworkGlobe = lazy(() => import("@/components/cld/globe/NetworkGlobe").then((m) => ({ default: m.NetworkGlobe })));

const DOCK_QUERY = "(max-width: 639px)";

export function NodePanel({
  node,
  live,
  engine,
  subscribeCamera,
  onClose,
}: {
  node: UNode;
  live?: LiveValue;
  engine: UniverseEngine | null;
  /** Called with a listener that runs on every engine onCamera tick; returns the unsubscribe. */
  subscribeCamera: (fn: () => void) => () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      if (window.matchMedia(DOCK_QUERY).matches) {
        el.style.transform = "";
        el.style.visibility = "";
        return;
      }
      const a = engine?.project(node.id);
      if (!a) {
        el.style.visibility = "hidden";
        return;
      }
      const p = panelPosition(a, { w: el.offsetWidth, h: el.offsetHeight }, { w: window.innerWidth, h: window.innerHeight });
      el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
      el.style.visibility = "";
    };
    place();
    const unsub = subscribeCamera(place);
    window.addEventListener("resize", place);
    return () => {
      unsub();
      window.removeEventListener("resize", place);
    };
  }, [engine, node.id, subscribeCamera]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ext = !!node.href && /^https?:\/\//.test(node.href);
  const waitlist = node.status === "early" || node.status === "planned";

  return (
    <div
      ref={ref}
      role="dialog"
      aria-labelledby="unode-h"
      className="absolute z-20 max-sm:inset-x-0 max-sm:bottom-0 max-sm:max-h-[70dvh] max-sm:overflow-y-auto max-sm:rounded-t-xl max-sm:border-b-0 sm:left-0 sm:top-0 sm:w-[360px] sm:rounded-xl border border-line-2 bg-[rgba(12,16,23,.9)] p-5 text-text shadow-[0_18px_48px_rgba(0,0,0,.45)] backdrop-blur-[14px]"
    >
      <button type="button" onClick={onClose} aria-label="Close" className="absolute right-3 top-3 grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-white/[.06] hover:text-text">
        <X className="size-4" aria-hidden />
      </button>
      <div className="flex flex-wrap items-center gap-2 pr-8">
        <h2 id="unode-h" className="font-head text-lg font-medium leading-tight tracking-[-.02em]">{node.label}</h2>
        {node.status && <StatusChip status={node.status} />}
      </div>
      {node.summary && <p className="mt-2 text-sm leading-[1.5] text-muted-foreground">{node.summary}</p>}
      {node.body && node.body.length > 0 && (
        <ul className="mt-3 grid gap-1.5 text-sm leading-[1.5] text-text/90">
          {node.body.map((line) => (
            <li key={line} className="flex gap-2">
              <span aria-hidden className="mt-[9px] size-1 shrink-0 rounded-full bg-faint" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      )}
      {live && (
        <p className="mt-3 font-mono text-xs uppercase tracking-[.08em] text-faint">
          Now <span className="ml-1 normal-case tracking-normal text-text tabular-nums">{live.text}</span>
        </p>
      )}
      {node.id === "network" && (
        <div className="mx-auto mt-4 w-full max-w-[260px]">
          <Suspense fallback={<div className="aspect-square" />}>
            <NetworkGlobe />
          </Suspense>
        </div>
      )}
      {(node.href || waitlist) && (
        <div className="mt-5 flex flex-wrap gap-2">
          {node.href && (
            <a href={node.href} className={btn.ghost("sm")} {...(ext ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
              {node.hrefLabel ?? "Open"} {ext ? <ArrowUpRight className="size-4" aria-hidden /> : <span aria-hidden>→</span>}
            </a>
          )}
          {waitlist && (
            <button
              type="button"
              className={btn.primary("sm")}
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
