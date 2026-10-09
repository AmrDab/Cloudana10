// ⌘K / Ctrl+K / "/" search over every node incl. leaves (docs/UNIVERSE_SPEC.md v2 "Smart navigation").
// Ranking is searchNodes() in shell-utils.ts; cmdk only provides the keyboard-driven listbox (filtering off).
import { useMemo, useState } from "react";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { GRAPH, NODE_INDEX } from "./graph";
import { TONE_DOT } from "./ListView";
import { cityOf, regionOf } from "./places";
import { nodeLabel, REGION_RING, searchNodes } from "./shell-utils";
import type { NodeId, UNode } from "./types";

const KIND: Record<UNode["kind"], string> = { core: "Core", region: "Region", topic: "Topic", leaf: "Leaf" };

export function SearchPalette({
  open,
  onOpenChange,
  revealed,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  revealed: ReadonlySet<NodeId>;
  onPick: (id: NodeId) => void;
}) {
  const [query, setQuery] = useState("");
  const results = useMemo(
    () => (query.trim() ? searchNodes(query, GRAPH.nodes, { revealed, cityOf }) : REGION_RING.map((id) => NODE_INDEX[id]).filter(Boolean)),
    [query, revealed],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setQuery("");
        onOpenChange(o);
      }}
    >
      <DialogContent className="gap-0 overflow-hidden border-line-2 bg-panel p-0 text-text sm:max-w-[600px] sm:rounded-xl">
        <DialogTitle className="sr-only">Search the map</DialogTitle>
        <DialogDescription className="sr-only">Type to search regions, topics and details. Enter flies there.</DialogDescription>
        <Command shouldFilter={false} loop className="bg-transparent text-text">
          <CommandInput value={query} onValueChange={setQuery} placeholder="Search regions, topics, cities…" className="h-12 pr-8 text-base sm:text-sm" />
          <CommandList className="h-[min(56dvh,420px)] max-h-none p-1.5">
            <CommandEmpty className="py-10 text-center text-sm text-muted-foreground">Nothing matches “{query.trim()}”.</CommandEmpty>
            {results.map((n) => {
              const region = n.kind === "region" ? undefined : regionOf(n.id);
              const city = cityOf(n.id);
              return (
                <CommandItem
                  key={n.id}
                  value={n.id}
                  onSelect={() => {
                    setQuery("");
                    onPick(n.id);
                  }}
                  className="gap-3 rounded-lg px-3 py-2.5 data-[selected=true]:bg-white/[.06] data-[selected=true]:text-text"
                >
                  <i aria-hidden className={cn("size-2 shrink-0 rounded-full", TONE_DOT[n.tone ?? "neutral"])} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-head text-sm font-medium">{nodeLabel(n, revealed)}</span>
                    {n.summary && <span className="block truncate text-xs text-muted-foreground">{n.summary}</span>}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-[.08em] text-faint max-sm:hidden">{KIND[n.kind]}</span>
                  {region && (
                    <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-line-2 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                      <i aria-hidden className={cn("size-1.5 rounded-full", TONE_DOT[region.tone ?? "neutral"])} />
                      {region.label}
                    </span>
                  )}
                  {city && <span className="w-[88px] shrink-0 truncate text-right font-mono text-[11px] text-faint max-sm:hidden">{city}</span>}
                </CommandItem>
              );
            })}
          </CommandList>
          <p aria-hidden className="border-t border-line px-4 py-2 font-mono text-[10px] uppercase tracking-[.08em] text-faint">
            ↑↓ to move · Enter to fly · Esc to close
          </p>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
