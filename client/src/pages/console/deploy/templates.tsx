// Templates browser — category rail with counts, search, card grid; curated Cloudana starters first.
import { useMemo, useState } from "react";
import { FileCode2, LayoutGrid, PackageOpen, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { errText } from "@/components/console/actions";
import { btn, Bone, CodeBlock, Empty, Panel, PanelHeader, Pill, Unavailable, useDelayed } from "@/components/console/primitives";
import { isUnavailable, useTemplates, type Template } from "@/components/console/data";
import { categoryIcon, isCurated, kindOf } from "./model";

export type ListedTemplate = Template & { category: string; curatedRank: number };

export function useTemplateList() {
  const q = useTemplates();
  const list = useMemo(() => {
    const seen = new Map<string, ListedTemplate & { categories: Set<string> }>();
    for (const c of q.data ?? []) {
      for (const t of c.templates ?? []) {
        if ((t.kind as string | undefined) === "workstation") continue; // own tab
        const hit = seen.get(t.id);
        if (hit) hit.categories.add(c.title);
        else seen.set(t.id, { ...t, category: c.title, curatedRank: isCurated(t, c.title) ? 0 : 1, categories: new Set([c.title]) });
      }
    }
    return [...seen.values()].sort((a, b) => a.curatedRank - b.curatedRank);
  }, [q.data]);
  return { q, list };
}

export function TemplatesBrowser({ onOpen, onBlank }: { onOpen: (t: ListedTemplate) => void; onBlank: () => void }) {
  const { q, list } = useTemplateList();
  const [cat, setCat] = useState<string | null>(null);
  const [term, setTerm] = useState("");
  const bone = useDelayed(q.isLoading);

  const cats = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of list) for (const c of t.categories) m.set(c, (m.get(c) ?? 0) + 1);
    // Rail follows the curated-first order of the list.
    return [...m.entries()];
  }, [list]);

  const shown = useMemo(() => {
    const s = term.trim().toLowerCase();
    return list.filter((t) => (!cat || t.categories.has(cat)) && (!s || t.name.toLowerCase().includes(s) || t.summary?.toLowerCase().includes(s)));
  }, [list, cat, term]);

  return (
    <Panel className="mt-6 overflow-hidden" aria-labelledby="tpl-h">
      <PanelHeader
        title={<span id="tpl-h">Templates</span>}
        kicker="Deploy"
        right={
          <button type="button" className={cn(btn.ghost, btn.sm)} onClick={onBlank}>
            <FileCode2 /> Paste HTML
          </button>
        }
      />
      {q.isError ? (
        isUnavailable(q.error) ? <Unavailable what="Templates" /> : <Empty icon={X} title={errText(q.error)} />
      ) : q.isLoading ? (
        bone ? <BrowserBones /> : <div className="h-[420px]" />
      ) : list.length === 0 ? (
        <Empty
          icon={PackageOpen}
          title="The template catalog is empty. You can still deploy a static site from a single HTML file."
          action={
            <>
              <button type="button" className={btn.primary} onClick={onBlank}>
                <FileCode2 /> Deploy a static site
              </button>
              {import.meta.env.DEV && <CodeBlock className="mt-2 w-full max-w-md text-left" code={"POST /v1/admin/templates/refresh  # X-Internal-Key"} copyText="POST /v1/admin/templates/refresh" />}
            </>
          }
        />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] md:grid-cols-[220px_minmax(0,1fr)]">
          <nav aria-label="Template categories" className="min-w-0 border-b border-line p-3 md:border-r md:border-b-0">
            <ul className="flex gap-1 overflow-x-auto [scrollbar-width:none] md:max-h-[640px] md:flex-col md:overflow-y-auto">
              <RailItem label="All" count={list.length} active={!cat} onClick={() => setCat(null)} icon={LayoutGrid} />
              {cats.map(([c, n]) => (
                <RailItem key={c} label={c} count={n} active={cat === c} onClick={() => setCat(c)} icon={categoryIcon(c)} />
              ))}
            </ul>
          </nav>
          <div className="min-w-0 p-4">
            <div className="relative mb-4">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" aria-hidden />
              <input
                type="search"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="Search templates"
                aria-label="Search templates by name or summary"
                className="h-10 w-full rounded-md border border-line-2 bg-bg-2 pr-3 pl-9 text-sm text-text placeholder:text-faint"
              />
            </div>
            {shown.length === 0 ? (
              <Empty
                icon={Search}
                title={<>No templates match “{term.trim() || cat}”.</>}
                action={
                  <button type="button" className={btn.ghost} onClick={() => (setTerm(""), setCat(null))}>
                    Clear filters
                  </button>
                }
              />
            ) : (
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {shown.map((t) => (
                  <li key={t.id}>
                    <TemplateCard t={t} onOpen={() => onOpen(t)} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}

function RailItem({ label, count, active, onClick, icon: Icon }: { label: string; count: number; active: boolean; onClick: () => void; icon: typeof LayoutGrid }) {
  return (
    <li className="shrink-0">
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={cn(
          "flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-[13px] whitespace-nowrap transition-colors duration-150",
          active ? "bg-panel-2 text-text ring-1 ring-line-2" : "text-muted-foreground hover:bg-panel-2 hover:text-text",
        )}
      >
        <Icon className={cn("size-3.5 shrink-0", active ? "text-ok" : "text-faint")} aria-hidden />
        <span className="flex-1 truncate">{label}</span>
        <span className="font-mono text-[11px] tabular-nums text-faint">{count}</span>
      </button>
    </li>
  );
}

export function TemplateLogo({ t, className }: { t: ListedTemplate; className?: string }) {
  const [broken, setBroken] = useState(false);
  const src = t.logoUrl || t.config?.logoUrl;
  const Icon = kindOf(t) === "static" ? FileCode2 : categoryIcon(t.category);
  return (
    <span className={cn("grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg border border-line-2 bg-bg-2", className)}>
      {src && !broken ? (
        <img src={src} alt="" loading="lazy" className="size-7 object-contain" onError={() => setBroken(true)} />
      ) : (
        <Icon className="size-[18px] text-faint" aria-hidden />
      )}
    </span>
  );
}

export function KindPill({ kind }: { kind: "static" | "container" }) {
  return kind === "static" ? <Pill tone="ok">Static</Pill> : <Pill tone="work">Container · early access</Pill>;
}

function TemplateCard({ t, onOpen }: { t: ListedTemplate; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${t.name} — open details`}
      className="flex h-full w-full flex-col gap-3 rounded-lg border border-line-2 bg-panel p-4 text-left transition-colors duration-150 hover:bg-panel-2"
    >
      <div className="flex items-start gap-3">
        <TemplateLogo t={t} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-head text-[15px] font-medium text-text">{t.name}</div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-faint">{t.category}</div>
        </div>
        <KindPill kind={kindOf(t)} />
      </div>
      <p className="line-clamp-2 min-h-10 text-[13px] leading-5 text-muted-foreground">{t.summary || "No summary."}</p>
    </button>
  );
}

function BrowserBones() {
  return (
    <div className="grid md:grid-cols-[220px_1fr]" aria-hidden>
      <div className="hidden space-y-2 border-r border-line p-3 md:block">
        {Array.from({ length: 8 }, (_, i) => <Bone key={i} className="h-8 w-full" />)}
      </div>
      <div className="p-4">
        <Bone className="mb-4 h-10 w-full" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => <Bone key={i} className="h-[118px] w-full rounded-lg" />)}
        </div>
      </div>
    </div>
  );
}
