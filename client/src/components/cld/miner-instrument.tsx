// The live cuPOW instrument (hero) and its reusable pieces. Real matrices, real SHA-256,
// σ from the latest Base Sepolia block — see @/lib/miner. Runs only while on screen.
import { useEffect, useRef, useState } from "react";
import { MineCancelled, getSigma, hex, mine } from "@/lib/miner";
import { cn } from "@/lib/utils";
import { BorderBeam } from "@/components/magicui/border-beam";
import { monoLabel } from "./cta";

type CellState = "idle" | "work" | "done";
export type MinerState = {
  nb: number;
  a: { s: CellState; t: string }[];
  b: { s: CellState; t: string }[];
  done: number;
  status: string;
  verified: boolean;
  sigma: string;
  sigSrc: string;
  transcript: string;
  z: string;
  attempts: number;
};

const blank = (nb: number): MinerState => ({
  nb,
  a: Array.from({ length: nb * nb }, () => ({ s: "idle" as CellState, t: "··" })),
  b: Array.from({ length: nb * nb }, () => ({ s: "idle" as CellState, t: "··" })),
  done: 0,
  status: "waiting to start",
  verified: false,
  sigma: "—",
  sigSrc: "fetching latest base sepolia block…",
  transcript: "—",
  z: "awaiting transcript…",
  attempts: 0,
});

/** Mines certificates on a loop while the returned ref is on screen. */
export function useMinerLoop({ n = 32, r = 8, d = 8, paceMs = 300, gapMs = 3200 } = {}) {
  const nb = n / r;
  const ref = useRef<HTMLDivElement>(null);
  const [st, setSt] = useState<MinerState>(() => blank(nb));

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!(window.crypto && crypto.subtle)) {
      setSt((s) => ({ ...s, status: "webcrypto unavailable in this browser" }));
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let alive = true;
    let visible = false;
    let running = false;
    const active = () => alive && visible && !document.hidden;
    const wait = (ms: number) =>
      new Promise<void>((res) => {
        const end = Date.now() + ms;
        const tick = () => (!active() || Date.now() >= end ? res() : setTimeout(tick, 100));
        tick();
      });

    const cycle = async () => {
      setSt((s) => ({ ...blank(nb), sigma: s.sigma, sigSrc: s.sigSrc, status: `mining cuPOW · n=${n} r=${r}`, z: "computing transcript…" }));
      const sg = await getSigma();
      setSt((s) => ({ ...s, sigma: `${sg.sigma.slice(0, 26)}…`, sigSrc: sg.src }));
      let done = 0;
      const cert = await mine(n, r, d, sg.sigma, {
        cancelled: () => !active(),
        onBlock: async (bi, bj, bh, t) => {
          done++;
          const k = done;
          setSt((s) => ({
            ...s,
            a: s.a.map((c, i) =>
              i === bi * nb + bj ? { s: "done", t: hex(bh).slice(0, 2) } : { s: c.s === "done" ? "done" : Math.floor(i / nb) === bi ? "work" : "idle", t: c.t },
            ),
            b: s.b.map((c, i) => ({ s: i % nb === bj ? "work" : "idle", t: c.t })),
            done: k,
            transcript: hex(t).slice(0, 40),
          }));
          if (!reduce) await wait(paceMs);
        },
      });
      const hb = hex(cert.hB);
      setSt((s) => ({
        ...s,
        a: s.a.map((c) => ({ s: "done", t: c.t })),
        b: s.b.map((_, i) => ({ s: "done", t: hb.slice(i * 2, i * 2 + 2) })),
        verified: true,
        attempts: cert.attempts,
        status: `proof verified · ${cert.attempts} attempt${cert.attempts === 1 ? "" : "s"}`,
        z: hex(cert.z),
      }));
    };

    const loop = async () => {
      if (running) return;
      running = true;
      while (active()) {
        try {
          await cycle();
        } catch (e) {
          if (!(e instanceof MineCancelled)) {
            console.warn("[cupow]", e);
            break;
          }
        }
        await wait(gapMs);
      }
      running = false;
    };

    const io = new IntersectionObserver(
      ([e]) => {
        visible = e.isIntersecting;
        if (visible) loop();
      },
      { threshold: 0.05, rootMargin: "200px 0px" },
    );
    io.observe(el);
    const onVis = () => active() && loop();
    document.addEventListener("visibilitychange", onVis);
    // Some embedded webviews report a zero-height viewport and never fire IO — start anyway.
    const kick = setTimeout(() => {
      if (!running && window.innerHeight === 0) {
        visible = true;
        loop();
      }
    }, 1200);
    return () => {
      alive = false;
      clearTimeout(kick);
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [n, r, d, nb, paceMs, gapMs]);

  return { ref, state: st };
}

export function MatrixCells({ cells, nb, size = "md", label }: { cells: MinerState["a"]; nb: number; size?: "sm" | "md"; label?: string }) {
  return (
    <div
      className={cn("grid", size === "md" ? "gap-[3px] min-[481px]:gap-1" : "gap-[3px]")}
      style={{ gridTemplateColumns: `repeat(${nb}, minmax(0, 1fr))` }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {cells.map((c, i) => (
        <div
          key={i}
          className={cn(
            "flex items-center justify-center rounded-[4px] font-mono tabular-nums transition-colors duration-250",
            size === "md" ? "size-[26px] text-[10px] min-[481px]:size-10 min-[481px]:text-xs" : "size-4 text-[0px]",
            c.s === "idle" && "bg-[rgba(148,163,184,.06)] text-faint",
            c.s === "work" && "bg-work/15 text-work shadow-[inset_0_0_0_1px_rgba(242,169,59,.55)]",
            c.s === "done" && "bg-ok/15 text-ok shadow-[inset_0_0_0_1px_rgba(63,214,194,.45)]",
          )}
        >
          {size === "md" ? c.t : null}
        </div>
      ))}
    </div>
  );
}

export function Led({ state, className }: { state: "idle" | "work" | "ok" | "off"; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-2 shrink-0 rounded-full transition-[background-color,box-shadow] duration-400",
        state === "work" && "animate-pulse bg-work",
        state === "ok" && "bg-ok shadow-[0_0_0_3px_rgba(63,214,194,.18)]",
        state === "idle" && "bg-faint",
        state === "off" && "bg-burn",
        className,
      )}
    />
  );
}

/** Hero instrument: A × B with the live transcript and proof. */
export function MinerInstrument({ className, d = 8 }: { className?: string; d?: number }) {
  const { ref, state: s } = useMinerLoop({ d });
  const total = s.nb * s.nb;
  return (
    <div className={className}>
      <div ref={ref} className="relative rounded-xl border border-line-2 bg-panel p-4 min-[481px]:p-6" aria-label="Live proof-of-useful-work computation" role="group">
        <div className={cn(monoLabel, "mb-4 flex items-center justify-between gap-2 text-muted-foreground")}>
          <span className="flex min-w-0 items-center gap-2">
            <Led state={s.verified ? "ok" : "work"} />
            <span className="truncate" aria-live="polite">
              {s.status}
            </span>
          </span>
          <span className="shrink-0 tabular-nums">
            block {s.done}/{total}
          </span>
        </div>
        <div className="flex items-center justify-center gap-2 min-[481px]:gap-4">
          <MatrixCells cells={s.a} nb={s.nb} />
          <span className="font-mono text-xl text-faint" aria-hidden>
            ×
          </span>
          <MatrixCells cells={s.b} nb={s.nb} />
        </div>
        <div className="mt-4 h-[3px] overflow-hidden rounded-sm bg-[rgba(148,163,184,.1)]">
          <i className="block h-full bg-ok transition-[width] duration-250" style={{ width: `${(s.done / total) * 100}%` }} />
        </div>
        <dl className="mt-4 grid gap-2 border-t border-dashed border-line-2 pt-4 font-mono text-xs leading-[1.7] break-all">
          <div>
            <dt className={monoLabel}>Seed <span className="normal-case">σ</span> · {s.sigSrc}</dt>
            <dd className="text-muted-foreground">{s.sigma}</dd>
          </div>
          <div>
            <dt className={monoLabel}>Transcript · SHA-256 chain</dt>
            <dd className="min-h-[1.7em] text-work">{s.transcript}</dd>
          </div>
          <div>
            <dt className={monoLabel}>Proof z · H(σ‖nonce‖t‖A‖B)</dt>
            <dd className={cn("min-h-[3.4em] min-[481px]:min-h-[1.7em]", s.verified ? "text-ok" : "text-faint")}>{s.z}</dd>
          </div>
        </dl>
        <BorderBeam size={120} duration={12} colorFrom="#F2A93B" colorTo="#3FD6C2" />
      </div>
      <p className="mt-2 font-mono text-xs tracking-[.04em] text-faint">Live · n=32 r=8 d={d} · WebCrypto</p>
    </div>
  );
}
