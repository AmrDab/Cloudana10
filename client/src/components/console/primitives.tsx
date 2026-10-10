// Console building blocks — one place for the anti-MVP rules (docs/V2_BRIEF.md §5):
// designed empty states, geometry-matched skeletons after 300 ms, copy-on-click hashes,
// relative times with absolute tooltips, "updated N s ago" captions, calm offline states.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy, WifiOff, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ago, short } from "@/lib/cld";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NumberTicker } from "@/components/magicui/number-ticker";

// ── Buttons (radius 8, brighten 8 % on hover, no scale) ────────────────────
const BTN_BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-[filter,background-color,border-color,color] duration-150 ease-settle hover:brightness-[1.08] disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0";
export const btn = {
  primary: cn(BTN_BASE, "h-9 px-4 bg-ok text-bg"),
  ghost: cn(BTN_BASE, "h-9 px-4 border border-line-2 text-text hover:bg-panel-2"),
  quiet: cn(BTN_BASE, "h-8 px-3 text-muted-foreground hover:text-text hover:bg-panel-2"),
  sm: "h-8 px-3 text-xs",
};

// ── Surfaces ───────────────────────────────────────────────────────────────
export function Panel({ className, children, as: As = "section", ...rest }: { className?: string; children: ReactNode; as?: "section" | "div" | "article" } & React.HTMLAttributes<HTMLElement>) {
  return (
    <As className={cn("rounded-lg border border-line-2 bg-panel", className)} {...rest}>
      {children}
    </As>
  );
}

export function PanelHeader({ title, kicker, right, className }: { title: ReactNode; kicker?: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5", className)}>
      <div className="min-w-0">
        {kicker && <MonoLabel className="mb-0.5 block">{kicker}</MonoLabel>}
        <h2 className="font-head text-base font-medium text-text">{title}</h2>
      </div>
      {right && <div className="flex items-center gap-3">{right}</div>}
    </div>
  );
}

export function MonoLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono text-[11px] uppercase tracking-[.08em] text-faint", className)}>{children}</span>;
}

export function PageHeader({ kicker, title, lede, right }: { kicker: string; title: string; lede?: ReactNode; right?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        <MonoLabel className="text-work">{kicker}</MonoLabel>
        <h1 className="mt-2 font-display text-[44px] font-normal leading-none tracking-[-.02em] text-text">{title}</h1>
        {lede && <p className="mt-2 text-sm leading-[1.55] text-muted-foreground">{lede}</p>}
      </div>
      {right}
    </header>
  );
}

// ── Loading ────────────────────────────────────────────────────────────────
/** True only once `loading` has lasted 300 ms — fast responses never flash a skeleton. */
export function useDelayed(loading: boolean, ms = 300) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!loading) return setShow(false);
    const t = setTimeout(() => setShow(true), ms);
    return () => clearTimeout(t);
  }, [loading, ms]);
  return show;
}

export function Bone({ className }: { className?: string }) {
  return <span aria-hidden className={cn("block animate-pulse rounded-md bg-panel-2", className)} />;
}

// ── Empty / unavailable ────────────────────────────────────────────────────
export function Empty({ icon: Icon, title, action, className }: { icon: LucideIcon; title: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-10 text-center", className)}>
      <span className="grid size-10 place-items-center rounded-lg border border-line-2 bg-panel-2 text-faint">
        <Icon className="size-[18px]" aria-hidden />
      </span>
      <p className="max-w-sm text-sm text-muted-foreground">{title}</p>
      {action && <div className="flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}

/** Offline, or the route isn't deployed yet — both are calm, never an error wall. */
export function Unavailable({ what, className }: { what: string; className?: string }) {
  return <Empty icon={WifiOff} className={className} title={<>{what} will appear here when the network API answers.</>} />;
}

// ── Hashes, copy, times ────────────────────────────────────────────────────
export function useCopy(ms = 1500) {
  const [copied, setCopied] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(t.current), []);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return false;
    }
    setCopied(true);
    clearTimeout(t.current);
    t.current = setTimeout(() => setCopied(false), ms);
    return true;
  };
  return { copied, copy };
}

/** `0x3fa2…9c1e`, click to copy, full value in the tooltip. */
export function Hash({ value, head = 6, tail = 4, className }: { value?: string | null; head?: number; tail?: number; className?: string }) {
  const { copied, copy } = useCopy();
  if (!value) return <span className="font-mono text-faint">—</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            copy(value);
          }}
          className={cn("group inline-flex items-center gap-1.5 rounded-md font-mono text-[13px] tabular-nums text-text hover:text-ok", className)}
          aria-label={`Copy ${value}`}
        >
          {short(value, head, tail)}
          <span className="relative inline-block size-3 text-faint opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
            {copied ? <Check className="size-3 text-ok" /> : <Copy className="size-3" />}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-[360px] break-all border border-line-2 bg-panel-2 font-mono text-[11px] text-text">
        {copied ? "Copied" : value}
      </TooltipContent>
    </Tooltip>
  );
}

/** Re-render every `ms` so relative times stay honest. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const ABS = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "medium" });
export const absTime = (ms: number) => ABS.format(new Date(ms));

export function RelTime({ ms, className }: { ms?: number | null; className?: string }) {
  const now = useNow(5000);
  if (!ms) return <span className={cn("font-mono text-faint", className)}>—</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <time dateTime={new Date(ms).toISOString()} className={cn("cursor-default font-mono text-[13px] tabular-nums text-muted-foreground", className)} tabIndex={0}>
          {ago(ms, now)}
        </time>
      </TooltipTrigger>
      <TooltipContent className="border border-line-2 bg-panel-2 font-mono text-[11px] text-text">{absTime(ms)}</TooltipContent>
    </Tooltip>
  );
}

/** The 12px "updated 4 s ago" caption every polled block carries. */
export function Updated({ at, offline, className }: { at?: number | null; offline?: boolean; className?: string }) {
  const now = useNow(1000);
  return (
    <span className={cn("font-mono text-[12px] tabular-nums text-faint", className)} aria-live="off">
      {offline ? "api offline" : at ? `updated ${ago(at, now)}` : "connecting…"}
    </span>
  );
}

export function CopyButton({ text, label = "Copy", className }: { text: string; label?: string; className?: string }) {
  const { copied, copy } = useCopy();
  return (
    <button type="button" onClick={() => copy(text)} className={cn(btn.ghost, btn.sm, "min-w-[84px]", className)} aria-live="polite">
      {copied ? <Check className="text-ok" /> : <Copy />}
      {copied ? "Copied" : label}
    </button>
  );
}

export function CodeBlock({ code, className, copyText }: { code: string; className?: string; copyText?: string }) {
  return (
    <div className={cn("flex items-start gap-2 rounded-md border border-line bg-bg-2 p-2.5 pl-4", className)}>
      {/* Copy sits beside the code, never over it — long lines scroll inside the pre. */}
      <pre className="min-w-0 flex-1 overflow-x-auto py-1.5 font-mono text-[12.5px] leading-[1.7] text-text">
        <code>{code}</code>
      </pre>
      <CopyButton text={copyText ?? code} className="shrink-0 bg-panel" />
    </div>
  );
}

// ── Chips ──────────────────────────────────────────────────────────────────
export type JobStatus = "queued" | "assigned" | "done" | "failed" | string;
export function JobChip({ status }: { status: JobStatus }) {
  const map: Record<string, [string, string]> = {
    queued: ["queued", "border border-line-2 text-muted-foreground"],
    assigned: ["assigned", "border border-work/60 text-work"],
    done: ["done ✓", "bg-ok/15 text-ok border border-ok/40"],
    failed: ["failed", "border border-burn/60 text-burn"],
  };
  const [label, cls] = map[status] ?? [status, "border border-line-2 text-muted-foreground"];
  return (
    <span key={status} className={cn("inline-flex animate-in fade-in-0 items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[11px] leading-5 whitespace-nowrap duration-250", cls)}>
      {status === "assigned" && <span className="size-1.5 animate-pulse rounded-full bg-work" aria-hidden />}
      {label}
    </span>
  );
}

export function Pill({ children, tone = "muted", className }: { children: ReactNode; tone?: "muted" | "work" | "ok" | "chain" | "burn"; className?: string }) {
  const tones = {
    muted: "border-line-2 text-muted-foreground",
    work: "border-work/60 text-work",
    ok: "border-ok/50 text-ok",
    chain: "border-chain/60 text-chain",
    burn: "border-burn/60 text-burn",
  };
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px] leading-5 whitespace-nowrap", tones[tone], className)}>{children}</span>;
}

/** New rows fade in and highlight --ok at 8 % for 1.2 s. Pass the ids seen on first render as "old". */
export function useFreshIds(ids: string[]) {
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const key = ids.join(",");
  useEffect(() => {
    if (!seen.current) {
      if (ids.length) seen.current = new Set(ids);
      return;
    }
    const added = ids.filter((id) => !seen.current!.has(id));
    added.forEach((id) => seen.current!.add(id));
    if (!added.length) return;
    setFresh(new Set(added));
    const t = setTimeout(() => setFresh(new Set()), 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return fresh;
}
export const freshRow = (isFresh: boolean) =>
  cn("transition-colors duration-[1200ms] ease-settle", isFresh && "animate-in fade-in-0 slide-in-from-top-1 bg-ok/[.08] duration-400");

// ── Stat tile ──────────────────────────────────────────────────────────────

/** Mono stat tile. `value` null + `loading` → skeleton after 300 ms; null otherwise → "—". µCLD values pass `unit="cld"`. */
export function Tile({
  label, value, unit, loading, caption, tone, className, icon: Icon,
}: {
  label: ReactNode;
  value: number | null | undefined;
  unit?: "cld";
  loading?: boolean;
  caption?: ReactNode;
  tone?: "ok" | "work" | "chain" | "burn";
  className?: string;
  icon?: LucideIcon;
}) {
  const showBone = useDelayed(!!loading && value == null);
  const v = value == null ? null : unit === "cld" ? value / 1e6 : value;
  const decimals = unit === "cld" ? (v !== null && v !== 0 && Math.abs(v) < 0.01 ? 4 : 2) : 0;
  const toneCls = { ok: "text-ok", work: "text-work", chain: "text-chain", burn: "text-burn" }[tone ?? "ok"];
  return (
    <div className={cn("rounded-lg border border-line-2 bg-panel p-4 transition-colors duration-150 hover:bg-panel-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <MonoLabel>{label}</MonoLabel>
        {Icon && <Icon className={cn("size-3.5", tone ? toneCls : "text-faint")} aria-hidden />}
      </div>
      <div className="mt-3 flex h-8 items-baseline gap-1.5 font-mono text-[24px] leading-none tabular-nums text-text">
        {v == null ? (
          showBone ? <Bone className="h-7 w-20" /> : loading ? null : <span className="text-faint">—</span>
        ) : (
          <>
            <NumberTicker value={v} decimalPlaces={decimals} className="tracking-normal text-text" />
            {unit === "cld" && <span className="text-[13px] text-faint">CLD</span>}
          </>
        )}
      </div>
      {caption && <div className="mt-2 min-h-4 text-[12px] leading-4 text-faint">{caption}</div>}
    </div>
  );
}
