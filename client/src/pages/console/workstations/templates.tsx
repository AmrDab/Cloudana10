// Workstations — environment template cards (docs/WORKSTATIONS.md §6): curated templates with kind "workstation".
import { useMemo } from "react";
import { Check, Code2, Cpu, Monitor, PackageOpen, Terminal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { errText } from "@/components/console/actions";
import { Bone, Empty, Pill, Unavailable, useDelayed } from "@/components/console/primitives";
import { isUnavailable, isWorkstationTemplate, useTemplates, type WorkstationTemplate } from "@/components/console/data";

export function useWorkstationTemplates() {
  const q = useTemplates();
  const list = useMemo(() => {
    const seen = new Map<string, WorkstationTemplate>();
    for (const c of q.data ?? []) for (const t of c.templates ?? []) if (isWorkstationTemplate(t) && !seen.has(t.id)) seen.set(t.id, t as unknown as WorkstationTemplate);
    return [...seen.values()];
  }, [q.data]);
  return { q, list };
}

/** Does the environment run an SSH server? (`access.ssh` or a declared `sshPort`.) */
export const hasSsh = (t: WorkstationTemplate | null) => !!t && (!!t.access?.ssh || t.sshPort != null);
export const hasWeb = (t: WorkstationTemplate | null) => !!t?.access?.web;

function iconFor(t: WorkstationTemplate) {
  const s = `${t.id} ${t.name}`.toLowerCase();
  if (/code|vscode/.test(s)) return Code2;
  if (/desktop|webtop|blender/.test(s)) return Monitor;
  if (/ssh/.test(s)) return Terminal;
  return Cpu;
}

export function EnvironmentCards({ value, onChange }: { value: string | null; onChange: (t: WorkstationTemplate) => void }) {
  const { q, list } = useWorkstationTemplates();
  const bone = useDelayed(q.isLoading);

  if (q.isError) return isUnavailable(q.error) ? <Unavailable what="Environment templates" className="py-6" /> : <Empty icon={X} title={errText(q.error)} className="py-6" />;
  if (q.isLoading)
    return bone ? (
      <div className="grid gap-2 sm:grid-cols-2" aria-hidden>
        {Array.from({ length: 4 }, (_, i) => <Bone key={i} className="h-[92px] w-full rounded-lg" />)}
      </div>
    ) : (
      <div className="h-[192px]" />
    );
  if (!list.length)
    return (
      <Empty
        icon={PackageOpen}
        className="rounded-lg border border-dashed border-line-2 py-6"
        title="No workstation environments are listed yet. They appear here once the network API serves the curated set (Jupyter, VS Code, a Linux desktop…)."
      />
    );

  return (
    <div role="radiogroup" aria-label="Environment" className="grid gap-2 sm:grid-cols-2">
      {list.map((t) => {
        const on = value === t.id;
        const Icon = iconFor(t);
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(t)}
            className={cn(
              "flex h-full flex-col gap-2 rounded-lg border p-3 text-left transition-colors duration-150",
              on ? "border-ok/60 bg-panel-2" : "border-line-2 bg-bg-2 hover:bg-panel-2",
            )}
          >
            <div className="flex items-start gap-2.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-md border border-line-2 bg-panel">
                <Icon className={cn("size-4", on ? "text-ok" : "text-faint")} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-medium text-text">{t.name}</div>
                <div className="truncate font-mono text-[11px] text-faint">{t.image ?? t.id}</div>
              </div>
              {on && <Check className="size-4 shrink-0 text-ok" aria-hidden />}
            </div>
            <p className="line-clamp-2 text-[12px] leading-4 text-muted-foreground">{t.summary || "No summary."}</p>
            <div className="mt-auto flex flex-wrap gap-1">
              {hasWeb(t) && <Pill>web :{t.access!.web!.port}</Pill>}
              {hasSsh(t) && <Pill>ssh</Pill>}
              {t.gpu && t.gpu.count > 0 ? <Pill tone="work">{t.gpu.count}× GPU</Pill> : <Pill>CPU ok</Pill>}
            </div>
          </button>
        );
      })}
    </div>
  );
}
