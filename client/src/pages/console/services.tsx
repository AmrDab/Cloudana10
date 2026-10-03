// Console · Services catalog (docs/V2_BRIEF.md §4): the whole surface, honest status, one CTA each.
import { useState } from "react";
import { Link } from "wouter";
import { ArrowRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { CATALOG, GROUPS, STATUS_LABEL, interestOf, type Service, type ServiceStatus } from "@/lib/services";
import { StatusChip } from "@/components/cld/status-chip";
import { openWaitlist } from "@/components/waitlist";
import { btn, MonoLabel, PageHeader } from "@/components/console/primitives";

type Filter = "all" | ServiceStatus;
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "live", label: STATUS_LABEL.live },
  { value: "early", label: STATUS_LABEL.early },
  { value: "planned", label: STATUS_LABEL.planned },
];

function ServiceRow({ s }: { s: Service }) {
  const [open, setOpen] = useState(false);
  const Icon = s.icon;
  const id = `svc-${s.id}`;
  return (
    <article className="rounded-lg border border-line-2 bg-panel transition-colors duration-150 hover:bg-panel-2">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={id} className="flex w-full items-center gap-4 p-5 text-left">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-line-2 bg-bg-2 text-muted-foreground">
          <Icon className="size-[18px]" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-head text-base font-medium text-text">{s.name}</span>
          <span className="block truncate text-sm text-muted-foreground">{s.line}</span>
        </span>
        <StatusChip status={s.status} className="max-sm:hidden" />
        <ChevronDown className={cn("size-4 shrink-0 text-faint transition-transform duration-250", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div id={id} className="grid animate-in fade-in-0 gap-4 border-t border-line px-5 py-4 duration-250 sm:grid-cols-[1fr_auto] sm:items-end">
          <dl className="grid gap-3 text-sm">
            <div className="sm:hidden"><StatusChip status={s.status} /></div>
            <div>
              <dt><MonoLabel>How it's checked</MonoLabel></dt>
              <dd className="mt-1 text-muted-foreground">{s.proof}</dd>
            </div>
            <div>
              <dt><MonoLabel>Rewards</MonoLabel></dt>
              <dd className="mt-1 text-muted-foreground">
                {s.subsidy ? "Fees, plus the capped subsidy on verified units." : "Fees only — no subsidy until it can be proven."}
              </dd>
            </div>
          </dl>
          {s.status === "live" ? (
            <Link href={s.id === "hosting" ? "/run?tab=deploy" : "/run"} className={btn.primary}>{s.id === "hosting" ? "Deploy a site" : "Run a job"} <ArrowRight /></Link>
          ) : (
            <button type="button" className={btn.ghost} onClick={() => openWaitlist({ role: "use", interests: [interestOf(s)] })}>
              Request early access
            </button>
          )}
        </div>
      )}
    </article>
  );
}

export default function ServicesPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const list = CATALOG.filter((s) => filter === "all" || s.status === filter);
  return (
    <>
      <PageHeader kicker="Services" title="Everything a datacenter does." lede="Same orchestrator, same proof rule. Status is the truth today." />
      <div role="radiogroup" aria-label="Filter by status" className="mb-5 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const n = f.value === "all" ? CATALOG.length : CATALOG.filter((s) => s.status === f.value).length;
          const on = filter === f.value;
          return (
            <button
              key={f.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setFilter(f.value)}
              className={cn(
                "h-8 rounded-md border px-3 font-mono text-xs transition-colors duration-150",
                on ? "border-work/60 bg-work/10 text-work" : "border-line-2 text-muted-foreground hover:text-text",
              )}
            >
              {f.label} <span className="ml-1 text-faint">{n}</span>
            </button>
          );
        })}
      </div>
      <div className="grid gap-8">
        {GROUPS.map((g) => {
          const rows = list.filter((s) => s.group === g.id);
          if (!rows.length) return null;
          return (
            <section key={g.id} aria-labelledby={`grp-${g.id}`}>
              <h2 id={`grp-${g.id}`} className="mb-3 flex items-center gap-3">
                <MonoLabel>{g.label}</MonoLabel>
                <span className="h-px flex-1 bg-line" aria-hidden />
                <span className="font-mono text-[11px] tabular-nums text-faint">{rows.length}</span>
              </h2>
              <div className="grid gap-3">
                {rows.map((s) => (
                  <ServiceRow key={s.id} s={s} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
