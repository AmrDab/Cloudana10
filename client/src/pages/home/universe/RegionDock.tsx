// Bottom-centre region dock: ‹ six chips in ring order › (docs/UNIVERSE_SPEC.md v2 "Smart navigation").
// Keys: 1–6 jump, [ / ] prev/next anywhere; ← / → while focus is in the dock. Phones: scrolls, names only.
import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { NODE_INDEX } from "./graph";
import { TONE_DOT } from "./ListView";
import { cityOf } from "./places";
import { REGION_RING, ringStep } from "./shell-utils";
import type { NodeId } from "./types";

/** True while a modal (Radix dialog: search, waitlist) is open. */
export const modalOpen = () => !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]');

/** Global shortcuts stay quiet while typing, with modifiers held (browser shortcuts) or under a modal. */
export function ignoreShortcut(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return true;
  const t = e.target as HTMLElement | null;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return true;
  return modalOpen();
}

export function RegionDock({ active, onTravel }: { active: NodeId | null; onTravel: (id: NodeId) => void }) {
  const chips = useRef<Record<NodeId, HTMLButtonElement | null>>({});

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ignoreShortcut(e)) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= REGION_RING.length) onTravel(REGION_RING[n - 1]);
      else if (e.key === "[") onTravel(ringStep(active, -1));
      else if (e.key === "]") onTravel(ringStep(active, 1));
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onTravel]);

  // Keep the active chip visible in the phone's horizontal scroller.
  useEffect(() => {
    if (active) chips.current[active]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  const step = (dir: 1 | -1, focus = false) => {
    const id = ringStep(active, dir);
    onTravel(id);
    if (focus) chips.current[id]?.focus();
  };

  const arrow = "grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-white/[.06] hover:text-text";

  return (
    <nav
      aria-label="Regions"
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        step(e.key === "ArrowLeft" ? -1 : 1, true);
      }}
      className="pointer-events-auto mx-auto flex max-w-full items-center gap-1 rounded-xl border border-line-2 bg-[rgba(12,16,23,.82)] p-1 shadow-[0_12px_32px_rgba(0,0,0,.35)] backdrop-blur-[14px]"
    >
      <button type="button" onClick={() => step(-1)} aria-label="Previous region" aria-keyshortcuts="[" className={arrow}>
        <ChevronLeft className="size-4" aria-hidden />
      </button>
      <ul className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {REGION_RING.map((id, i) => {
          const node = NODE_INDEX[id];
          if (!node) return null;
          const on = id === active;
          return (
            <li key={id} className="shrink-0">
              <button
                ref={(el) => {
                  chips.current[id] = el;
                }}
                type="button"
                onClick={() => onTravel(id)}
                aria-current={on ? "location" : undefined}
                aria-keyshortcuts={String(i + 1)}
                className={cn(
                  "flex h-9 items-center gap-2 rounded-lg border px-2.5 text-left transition-colors duration-150 sm:h-11 sm:pr-3",
                  on ? "border-line-2 bg-white/[.08] text-text" : "border-transparent text-muted-foreground hover:bg-white/[.04] hover:text-text",
                )}
              >
                <i aria-hidden className={cn("size-2 shrink-0 rounded-full", TONE_DOT[node.tone ?? "neutral"])} />
                <span className="flex flex-col gap-1">
                  <span className="whitespace-nowrap font-head text-sm font-medium leading-none">{node.label}</span>
                  <span className="whitespace-nowrap font-mono text-[10px] leading-none tracking-[.04em] text-faint max-sm:hidden">
                    {i + 1} · {cityOf(id)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" onClick={() => step(1)} aria-label="Next region" aria-keyshortcuts="]" className={arrow}>
        <ChevronRight className="size-4" aria-hidden />
      </button>
    </nav>
  );
}
