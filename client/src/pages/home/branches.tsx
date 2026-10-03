// Three ways in — each card's background is live, not an illustration (brief §2.3).
import { useEffect, useRef, useState } from "react";
import { Play, Server, ShieldCheck } from "lucide-react";
import { api, ago, short } from "@/lib/cld";
import { checkTask, fetchTask, verifySession } from "@/lib/verifier";
import { BentoCard, BentoGrid } from "@/components/magicui/bento-grid";
import { HardwareReadout } from "@/components/cld/hardware-readout";
import { Led } from "@/components/cld/miner-instrument";
import { Reveal, Section } from "./parts";

type Recent = { id: string; n: number; node: string | null; z: string | null; finishedAt: number };

/** Runs `fn` every `ms` while `ref` is on screen and the tab is visible. */
function useVisibleInterval(ref: React.RefObject<HTMLElement | null>, fn: () => void, ms: number) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let t: ReturnType<typeof setInterval> | null = null;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !t) {
        fnRef.current();
        t = setInterval(() => !document.hidden && fnRef.current(), ms);
      } else if (!e.isIntersecting && t) {
        clearInterval(t);
        t = null;
      }
    });
    io.observe(el);
    return () => {
      io.disconnect();
      if (t) clearInterval(t);
    };
  }, [ref, ms]);
}

function LatestProof() {
  const ref = useRef<HTMLDivElement>(null);
  const [job, setJob] = useState<Recent | null | undefined>(undefined);
  useVisibleInterval(ref, () => {
    api<{ jobs: Recent[] }>("/network/recent")
      .then((r) => setJob(r.jobs[0] ?? null))
      .catch(() => setJob(null));
  }, 10_000);
  const cells = Array.from({ length: 16 }, (_, i) => i);
  return (
    <div ref={ref} className="absolute inset-0 flex flex-col justify-between p-6">
      <div className="grid w-fit grid-cols-4 gap-1.5" aria-hidden>
        {cells.map((i) => (
          <i key={i} className={`size-5 rounded-[3px] border ${job ? "border-ok/40 bg-ok/25" : "border-line-2 bg-panel-2"}`} style={{ transitionDelay: `${i * 30}ms` }} />
        ))}
      </div>
      <div className="font-mono text-xs leading-[1.7]">
        <p className="text-[11px] uppercase tracking-[.08em] text-faint">Latest verified job</p>
        {job ? (
          <>
            <p className="text-ok">z {short(job.z, 10, 6)}</p>
            <p className="text-muted-foreground">{job.n}×{job.n} · ran on {short(job.node)} · {ago(job.finishedAt)}</p>
          </>
        ) : (
          <p className="text-faint">{job === null ? "No public jobs yet." : "reading…"}</p>
        )}
      </div>
    </div>
  );
}

function FreivaldsTicker() {
  const ref = useRef<HTMLDivElement>(null);
  const session = useRef<string | null>(null);
  const [line, setLine] = useState<{ n: number; ok: boolean; ms: number } | null>(null);
  const [state, setState] = useState<"idle" | "work" | "ok" | "off">("idle");
  useVisibleInterval(ref, async () => {
    session.current ??= verifySession();
    setState("work");
    try {
      const t = await fetchTask(session.current);
      if (!t) return setState("idle");
      const r = checkTask(t);
      setLine({ n: t.n, ok: r.ok, ms: r.ms });
      setState(r.ok ? "ok" : "idle");
    } catch {
      setState("off");
    }
  }, 5_000);
  return (
    <div ref={ref} className="absolute inset-0 flex flex-col justify-between p-6">
      <p className="font-mono text-sm text-muted-foreground">
        A·(B·r) <span className="text-faint">=?</span> C·r <span className="text-faint">mod p</span>
      </p>
      <div className="font-mono text-xs leading-[1.7]">
        <p className="flex items-center gap-2 text-[11px] uppercase tracking-[.08em] text-faint">
          <Led state={state} /> Freivalds · this tab
        </p>
        {line ? (
          <p className={line.ok ? "text-ok" : "text-burn"}>
            n={line.n} · {line.ok ? "✓" : "✗ planted wrong — caught"} {line.ms.toFixed(1)} ms
          </p>
        ) : (
          <p className="text-faint">{state === "off" ? "api offline" : "waiting for work"}</p>
        )}
      </div>
    </div>
  );
}

export function Branches() {
  return (
    <Section id="branches" kicker="Three ways in" title="Use it. Power it. Check it.">
      <BentoGrid>
        <Reveal>
          <BentoCard
            className="h-full"
            name="Use"
            Icon={Play}
            description="Submit a job. The network picks the hardware, sets the price, returns the result with its proof."
            href="/control/run"
            cta="Run a job"
            background={<LatestProof />}
          />
        </Reveal>
        <Reveal delay={0.04}>
          <BentoCard
            className="h-full"
            name="Provide"
            Icon={Server}
            description="One command. Your PC or your racks. CLD is minted to you for every job you prove."
            href="/control/provide"
            cta="Start providing"
            background={<HardwareReadout className="absolute inset-0 flex flex-col justify-between p-6" />}
          />
        </Reveal>
        <Reveal delay={0.08}>
          <BentoCard
            className="h-full"
            name="Verify"
            Icon={ShieldCheck}
            description="Your browser re-checks finished work. No install, no wallet."
            href="/control/verify"
            cta="Verify in browser"
            background={<FreivaldsTicker />}
          />
        </Reveal>
      </BentoGrid>
    </Section>
  );
}
