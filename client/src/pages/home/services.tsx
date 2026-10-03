// Services: the full surface with honest status, grouped (V3 contract §8). Statuses live in @/lib/services.
import { ArrowRight } from "lucide-react";
import { CATALOG, GROUPS, interestOf, type Service } from "@/lib/services";
import { StatusChip } from "@/components/cld/status-chip";
import { ShineBorder } from "@/components/magicui/shine-border";
import { openWaitlist } from "@/components/waitlist";
import { Reveal, Section } from "./parts";

function ServiceCard({ s }: { s: Service }) {
  const Icon = s.icon;
  const cta = "inline-flex items-center gap-1.5 text-sm font-medium text-ok underline-offset-4 hover:underline";
  return (
    <article className="group relative flex h-full flex-col rounded-lg border border-line-2 bg-panel p-5 transition-colors duration-150 ease-settle hover:bg-panel-2">
      <ShineBorder shineColor={["#F2A93B", "#3FD6C2"]} duration={10} className="opacity-0 transition-opacity duration-250 group-hover:opacity-100" />
      <div className="flex items-start justify-between gap-3">
        <span className="grid size-9 place-items-center rounded-lg border border-line-2 bg-bg-2 text-muted-foreground">
          <Icon className="size-4" aria-hidden />
        </span>
        <StatusChip status={s.status} />
      </div>
      <h4 className="mt-5 font-head text-base font-medium text-text">{s.name}</h4>
      <p className="mt-1.5 flex-1 text-sm leading-[1.55] text-muted-foreground">{s.line}</p>
      <div className="mt-5 flex justify-end">
        {s.status === "live" ? (
          <a href={s.id === "hosting" ? "/control/run?tab=deploy" : "/control/run"} className={cta}>
            {s.id === "hosting" ? "Deploy a site" : "Run"} <ArrowRight className="size-3.5" aria-hidden />
          </a>
        ) : (
          <button type="button" onClick={() => openWaitlist({ role: "use", interests: [interestOf(s)] })} className={cta}>
            Request early access
          </button>
        )}
      </div>
    </article>
  );
}

export function Services() {
  return (
    <Section id="services" kicker="Services" title="Everything a datacenter does." lede="Same orchestrator, same proof rule. Status is the truth today.">
      <div className="grid gap-12 max-md:gap-10">
        {GROUPS.map((g) => {
          const list = CATALOG.filter((s) => s.group === g.id);
          return (
            <div key={g.id} role="group" aria-labelledby={`svc-${g.id}`}>
              <h3 id={`svc-${g.id}`} className="mb-4 flex items-center gap-3 font-mono text-xs uppercase tracking-[.08em] text-faint">
                {g.label}
                <span className="h-px flex-1 bg-line" aria-hidden />
                <span className="tabular-nums">{list.length}</span>
              </h3>
              <div className="grid grid-cols-1 gap-4 min-[481px]:grid-cols-2 lg:grid-cols-4">
                {list.map((s, i) => (
                  <Reveal key={s.id} delay={Math.min(i, 5) * 0.04}>
                    <ServiceCard s={s} />
                  </Reveal>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
