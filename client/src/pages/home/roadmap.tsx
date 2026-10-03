// Coming up: the roadmap list, no dates (V3 contract §10; data in @/lib/roadmap).
import { ROADMAP } from "@/lib/roadmap";
import { openWaitlist } from "@/components/waitlist";
import { Reveal, Section } from "./parts";

export function ComingUp() {
  return (
    <Section id="coming-up" kicker="Roadmap" title="What's next.">
      <div className="grid grid-cols-1 gap-3 min-[481px]:grid-cols-2 lg:grid-cols-3">
        {ROADMAP.map((r, i) => (
          <Reveal key={r.id} delay={Math.min(i, 5) * 0.04} className="h-full">
            <article className="flex h-full flex-col rounded-lg border border-line-2 bg-panel p-4 transition-colors duration-150 ease-settle hover:bg-panel-2">
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-[11px] tabular-nums text-faint">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="font-head text-[15px] font-medium text-text">{r.name}</h3>
              </div>
              <p className="mt-1 flex-1 pl-[30px] text-sm leading-[1.55] text-muted-foreground">{r.line}</p>
              <button
                type="button"
                onClick={() => openWaitlist({ role: "use", interests: [r.interest] })}
                className="mt-3 self-end text-sm font-medium text-ok underline-offset-4 hover:underline"
              >
                Request early access
              </button>
            </article>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
