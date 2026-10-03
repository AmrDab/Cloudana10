// The browser verifier: fetch a finished job, re-run Freivalds locally, post the verdict.
// Some tasks are planted wrong; a correct verdict earns credits (points, not CLD).
import { useEffect, useRef, useState } from "react";
import { Play, Square } from "lucide-react";
import { ApiError, isOffline, int } from "@/lib/cld";
import { GAP, RATE_LIMIT_BACKOFF, checkTask, fetchTask, postVerdict, verifySession, type Intensity } from "@/lib/verifier";
import { NumberTicker } from "@/components/magicui/number-ticker";
import { cn } from "@/lib/utils";
import { StatusChip } from "./status-chip";
import { Segmented } from "./segmented";
import { Led } from "./miner-instrument";
import { btn, monoLabel } from "./cta";
import { openWaitlist } from "@/components/waitlist";

type LogLine = { id: number; at: number; msg: string; tone: "ev" | "ok" | "bad" };
type Phase = "idle" | "checking" | "verified" | "waiting" | "offline" | "pacing" | "stopped";

const PHASE_TEXT: Record<Phase, string> = {
  idle: "ready",
  checking: "checking",
  verified: "verifying",
  waiting: "waiting for work",
  offline: "api offline",
  pacing: "pacing — rate limited",
  stopped: "stopped",
};

const INTENSITY = [
  { value: "low" as const, label: "Low" },
  { value: "med" as const, label: "Med" },
  { value: "high" as const, label: "High" },
];

export function VerifierInstrument({ variant = "card", header }: { variant?: "card" | "full"; header?: React.ReactNode }) {
  const [running, setRunning] = useState(false);
  const [level, setLevel] = useState<Intensity>("med");
  const [phase, setPhase] = useState<Phase>("idle");
  const [stats, setStats] = useState({ checks: 0, correct: 0, credits: 0, caught: 0 });
  const [log, setLog] = useState<LogLine[]>([]);
  const levelRef = useRef(level);
  levelRef.current = level;
  const seq = useRef(0);

  const push = (msg: string, tone: LogLine["tone"] = "ev") =>
    setLog((l) => [{ id: ++seq.current, at: Date.now(), msg, tone }, ...l].slice(0, 6));

  useEffect(() => {
    if (!running) return;
    // Per-run flag: a stale loop from an earlier Start can never keep running.
    let alive = true;
    const session = verifySession();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const sleep = (ms: number) =>
      new Promise<void>((res) => {
        const end = Date.now() + ms;
        const tick = () => (!alive || Date.now() >= end ? res() : setTimeout(tick, 100));
        tick();
      });

    (async () => {
      while (alive) {
        setPhase("checking");
        try {
          const t = await fetchTask(session);
          const { ok, ms } = checkTask(t);
          const r = await postVerdict(session, t.taskId, ok ? "valid" : "invalid");
          if (!alive) break;
          setStats((s) => ({
            checks: s.checks + 1,
            correct: s.correct + (r.correct ? 1 : 0),
            credits: r.credits ?? s.credits,
            caught: s.caught + (!ok && r.correct ? 1 : 0),
          }));
          const tail = r.correct ? "" : " · graded incorrect";
          if (!ok) push(`${t.n}×${t.n} · wrong answer caught · ${ms.toFixed(1)} ms${tail}`, r.correct ? "bad" : "ev");
          else push(`${t.n}×${t.n} · answer ✓ · ${ms.toFixed(1)} ms${tail}`, r.correct ? "ok" : "bad");
          setPhase("verified");
        } catch (e) {
          if (!alive) break;
          if (isOffline(e)) {
            setPhase("offline");
            push("API offline — retrying in 5 s");
            await sleep(5000);
            continue;
          }
          const code = e instanceof ApiError ? e.code : "";
          if (code === "not_found") {
            setPhase("waiting");
            await sleep(4000);
            continue;
          }
          if (code === "rate_limited") {
            setPhase("pacing");
            push("rate limited — backing off 15 s");
            await sleep(RATE_LIMIT_BACKOFF);
            continue;
          }
          push(`error: ${(e as Error).message}`, "bad");
          await sleep(3000);
        }
        await sleep(reduce ? Math.max(GAP[levelRef.current], 600) : GAP[levelRef.current]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [running]);

  const toggle = () => {
    if (running) {
      setRunning(false);
      setPhase("stopped");
      push("stopped");
    } else {
      push(`started · ${levelRef.current}`);
      setRunning(true);
    }
  };

  const led = phase === "verified" ? "ok" : phase === "checking" ? "work" : phase === "offline" ? "off" : "idle";
  const rate = stats.checks ? Math.round((stats.correct / stats.checks) * 100) : null;

  const instrument = (
    <div className="rounded-xl border border-line-2 bg-panel p-4 min-[481px]:p-6" role="group" aria-label="Browser verifier">
      <div className={cn(monoLabel, "flex flex-wrap items-center justify-between gap-2 text-muted-foreground")}>
        <span className="flex items-center gap-2">
          <Led state={led} />
          <span aria-live="polite">{PHASE_TEXT[phase]}</span>
        </span>
        {header}
      </div>

      <div className="mt-6 grid grid-cols-3 border-y border-line">
        {(
          [
            ["Checks", stats.checks, "text-text"],
            ["Correct", stats.correct, "text-ok"],
            ["Credits", stats.credits, "text-text"],
          ] as const
        ).map(([k, v, c], i) => (
          <div key={k} className={cn("py-4", i > 0 && "border-l border-line pl-4")}>
            <NumberTicker value={v} className={cn("font-mono text-[28px] leading-none font-medium tracking-[-.02em]", c)} />
            <div className={cn(monoLabel, "mt-2")}>{k}</div>
          </div>
        ))}
      </div>

      <ol className="mt-4 h-[calc(6*1.75rem)] overflow-hidden font-mono text-xs" aria-live="polite" aria-label="Verifier log">
        {log.length === 0 ? (
          <li className="flex h-7 items-center text-faint">Press start. Nothing is sent until you do.</li>
        ) : (
          log.map((l) => (
            <li key={l.id} className="flex h-7 items-center gap-3 border-b border-line last:border-b-0 animate-in fade-in duration-250">
              <span className="shrink-0 text-faint tabular-nums">{new Date(l.at).toLocaleTimeString([], { hour12: false })}</span>
              <span className={cn("truncate", l.tone === "ok" && "text-ok", l.tone === "bad" && "text-burn", l.tone === "ev" && "text-muted-foreground")}>
                {l.msg}
              </span>
            </li>
          ))
        )}
      </ol>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={toggle} className={running ? btn.ghost("md") : btn.primary("md")} aria-pressed={running}>
          {running ? <Square className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
          <span className="inline-block min-w-[108px] text-left">{running ? "Stop" : "Start verifying"}</span>
        </button>
        <div className="flex items-center gap-2">
          <span className={monoLabel} id="verify-intensity">
            Intensity
          </span>
          <Segmented options={INTENSITY} value={level} onChange={setLevel} labelledBy="verify-intensity" size="sm" />
        </div>
      </div>
      <p className="mt-4 font-mono text-xs text-faint">Credits, not CLD. No monetary value.</p>
    </div>
  );

  if (variant === "card") return instrument;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      {instrument}
      <aside className="flex flex-col gap-4">
        <section className="rounded-lg border border-line-2 bg-panel p-6" aria-labelledby="vs-session">
          <h3 id="vs-session" className={monoLabel}>
            Session
          </h3>
          <dl className="mt-4 grid grid-cols-[1fr_auto] gap-y-2 font-mono text-xs">
            <dt className="text-muted-foreground">Credits</dt>
            <dd className="text-text tabular-nums">{int(stats.credits)}</dd>
            <dt className="text-muted-foreground">Correct rate</dt>
            <dd className="text-text tabular-nums">{rate == null ? "—" : `${rate} %`}</dd>
            <dt className="text-muted-foreground">Planted wrong caught</dt>
            <dd className="text-ok tabular-nums">{int(stats.caught)}</dd>
          </dl>
        </section>
        <section className="rounded-lg border border-line-2 bg-panel p-6" aria-labelledby="vs-grading">
          <h3 id="vs-grading" className={monoLabel}>
            How grading works
          </h3>
          <ul className="mt-4 grid gap-2 font-sans text-sm text-muted-foreground">
            <li>Tasks are finished jobs, drawn at random.</li>
            <li>About 1 in 6 is planted wrong.</li>
            <li>Credits stay with this browser until wallet binding opens.</li>
          </ul>
        </section>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled className={btn.ghost("md")}>
            Bind credits to wallet
          </button>
          <button type="button" title="Request early access" onClick={() => openWaitlist({ role: "verify" })}>
            <StatusChip status="early" className="transition-colors hover:border-work" />
          </button>
        </div>
      </aside>
    </div>
  );
}
