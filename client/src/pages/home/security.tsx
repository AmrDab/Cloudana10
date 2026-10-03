// Security: what is live, being built, and planned — exactly V3 contract §9 (data in @/lib/security).
import { cn } from "@/lib/utils";
import { SECURITY, type SecurityItem } from "@/lib/security";
import { Reveal, Section } from "./parts";

const COLUMNS = [
  { key: "live", label: "Live today", chip: "bg-ok text-[#04201C]", icon: "text-ok" },
  { key: "building", label: "Building", chip: "border border-work/60 text-work", icon: "text-work" },
  { key: "planned", label: "Planned", chip: "border border-line-2 text-muted-foreground", icon: "text-faint" },
] as const;

function Row({ item, iconCls }: { item: SecurityItem; iconCls: string }) {
  const Icon = item.icon;
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <Icon className={cn("size-4 shrink-0", iconCls)} aria-hidden />
      <span className="min-w-0 flex-1 text-sm text-text">{item.label}</span>
      <span className="shrink-0 font-mono text-[11px] text-faint">{item.tag}</span>
    </li>
  );
}

export function Security() {
  return (
    <Section id="security" kicker="Security" title={<>Signed, sealed, <span className="whitespace-nowrap">re-checked.</span></>} lede="Each claim is labelled: running, being built, or planned.">
      <div className="grid items-start gap-4 lg:grid-cols-3">
        {COLUMNS.map((c, i) => (
          <Reveal key={c.key} delay={i * 0.04}>
            <div className="rounded-lg border border-line-2 bg-panel">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[11px] leading-5", c.chip)}>
                  {c.key === "live" && <span className="size-1.5 rounded-full bg-[#04201C]" aria-hidden />}
                  {c.label}
                </span>
                <span className="font-mono text-xs tabular-nums text-faint">{SECURITY[c.key].length}</span>
              </div>
              <ul className="divide-y divide-line">
                {SECURITY[c.key].map((item) => (
                  <Row key={item.label} item={item} iconCls={c.icon} />
                ))}
              </ul>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
