// Your workstations — table (cards under 640 px) with an expandable detail: hours, GPUs, Connect, Extend, Stop, events.
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ChevronDown, ExternalLink, Loader2, MonitorPlay, Plus, Square, Terminal, Wallet, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { api, cld } from "@/lib/cld";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  btn, Bone, Empty, Hash, MonoLabel, Panel, PanelHeader, Pill, RelTime, Unavailable, Updated, freshRow, useCopy, useDelayed, useFreshIds, useNow,
} from "@/components/console/primitives";
import {
  extendWorkstation, isTerminal, isUnavailable, useSession, useWorkstation, useWorkstations, type Workstation, type WorkstationDetail,
} from "@/components/console/data";
import { errText, signInWithToast } from "@/components/console/actions";
import { DeployChip } from "@/pages/console/deploy/deployments";
import { dur } from "./spec-picker";

const preempted = (w: Workstation) => w.status === "stopped" && /preempt/i.test(w.statusReason ?? "");

export function WsChip({ w }: { w: Workstation }) {
  if (preempted(w)) return <Pill key="preempted" tone="work" className="animate-in fade-in-0 duration-250">preempted</Pill>;
  return <DeployChip status={w.status} />;
}

function specLine(w: Workstation) {
  const s = w.spec;
  const g = s.gpu?.count
    ? `${s.gpu.count}× GPU${s.gpu.minVramGb ? ` ≥${s.gpu.minVramGb} GB` : ""}${s.gpu.class && s.gpu.class !== "any" ? ` ${s.gpu.class}` : ""}`
    : "CPU";
  return `${g} · ${s.cpu / 1000} vCPU · ${Math.round(s.memMb / 1024)} GB`;
}

/** Why it isn't running yet, in plain words. */
function waitingLine(w: Workstation) {
  if (w.statusReason) return w.statusReason;
  if (w.status === "queued") return w.spec.gpu?.count ? "waiting for a GPU node that fits" : "waiting for a node that fits";
  return null;
}

/** Hours used/left: the API's numbers when the detail has them, else from startedAt and maxHours. */
function hoursOf(w: Workstation, now: number, d?: WorkstationDetail) {
  const total = w.spec.maxHours;
  if (d?.hoursUsed != null) return { used: d.hoursUsed, left: d.hoursLeft ?? Math.max(0, total - d.hoursUsed), total };
  const used = w.startedAt ? Math.max(0, ((w.stoppedAt ?? now) - w.startedAt) / 3.6e6) : 0;
  return { used, left: Math.max(0, total - used), total };
}

function HoursBar({ w, d, compact }: { w: Workstation; d?: WorkstationDetail; compact?: boolean }) {
  const now = useNow(30_000);
  const { used, left, total } = hoursOf(w, now, d);
  const pct = total ? Math.min(100, (used / total) * 100) : 0;
  const low = !isTerminal(w.status) && left < Math.min(1, total * 0.1);
  return (
    <div className={cn("min-w-[140px]", compact && "max-w-[180px]")}>
      <div className="h-1.5 overflow-hidden rounded-full bg-panel-2" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={+used.toFixed(2)} aria-label="Hours used">
        <div className={cn("h-full rounded-full transition-[width] duration-500", low ? "bg-burn" : isTerminal(w.status) ? "bg-faint" : "bg-ok")} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 font-mono text-[11px] tabular-nums text-faint">
        {dur(used)} used · {isTerminal(w.status) ? `of ${dur(total)}` : <span className={low ? "text-burn" : undefined}>{dur(left)} left</span>}
      </div>
    </div>
  );
}

// ── List ────────────────────────────────────────────────────────────────────
const COLS = ["Name", "Status", "Machine", "Hours", "Price / h", "Created", ""];

export function Workstations({ focusId, onRent }: { focusId: string | null; onRent: () => void }) {
  const session = useSession();
  const q = useWorkstations();
  const list = q.data ?? [];
  const [open, setOpen] = useState<string | null>(null);
  const fresh = useFreshIds(list.map((w) => w.id));
  const bone = useDelayed(q.isLoading);

  useEffect(() => {
    if (focusId) setOpen(focusId);
  }, [focusId]);

  const prev = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    for (const w of list) {
      const was = prev.current.get(w.id);
      if (was && was !== w.status) {
        if (w.status === "running") toast.success(`${w.name} is running`, { description: "Connect from its row." });
        if (w.status === "failed") toast.error(`${w.name} failed`, { description: w.statusReason ?? undefined });
        if (preempted(w)) toast.warning(`${w.name} was preempted`, { description: "On-demand work needed the node. You were charged for time used; the volume is kept." });
        else if (w.status === "stopped" && /max hours/i.test(w.statusReason ?? "")) toast(`${w.name} stopped`, { description: "Its time ran out." });
      }
      prev.current.set(w.id, w.status);
    }
  }, [list]);

  const toggle = (id: string) => setOpen(open === id ? null : id);

  return (
    <Panel id="workstations" className="scroll-mt-6 overflow-hidden" aria-labelledby="ws-h">
      <PanelHeader title={<span id="ws-h">Your workstations</span>} kicker="Rented time" right={session && <Updated at={q.dataUpdatedAt || null} offline={q.isError} />} />
      {!session ? (
        <Empty icon={Wallet} title="Sign in to rent a workstation and see yours." action={<button type="button" className={btn.primary} onClick={() => signInWithToast()}><Wallet /> Sign in</button>} />
      ) : q.isError && !q.data ? (
        isUnavailable(q.error) ? <Unavailable what="Your workstations" /> : <Empty icon={X} title={errText(q.error)} />
      ) : q.isLoading ? (
        bone ? <RowBones /> : <div className="h-[140px]" />
      ) : list.length === 0 ? (
        <Empty
          icon={MonitorPlay}
          title="No workstations yet. Describe one below — Jupyter, VS Code or a desktop — and the orchestrator assigns a node that fits."
          action={<button type="button" className={btn.ghost} onClick={onRent}><Plus /> Rent a workstation</button>}
        />
      ) : (
        <>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  {COLS.map((h, i) => (
                    <th key={i} scope="col" className={cn("px-4 py-2.5 font-mono text-[11px] font-normal uppercase tracking-[.08em] whitespace-nowrap text-faint first:pl-5", i === 4 && "text-right")}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.map((w) => (
                  <Row key={w.id} w={w} open={open === w.id} fresh={fresh.has(w.id)} onToggle={() => toggle(w.id)} />
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-line sm:hidden">
            {list.map((w) => (
              <li key={w.id} className={freshRow(fresh.has(w.id))}>
                <button type="button" className="flex w-full flex-col gap-2 px-4 py-3 text-left" onClick={() => toggle(w.id)} aria-expanded={open === w.id} aria-label={`${w.name}, ${w.status} — ${open === w.id ? "hide" : "show"} details`}>
                  <div className="flex w-full items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[14px] text-text">{w.name}</div>
                      <div className="mt-0.5 truncate font-mono text-[12px] text-faint">{specLine(w)} · {cld(w.priceUcldPerHour)}/h</div>
                    </div>
                    <WsChip w={w} />
                  </div>
                  {!isTerminal(w.status) && waitingLine(w) && w.status !== "running" && <span className="text-[12px] text-faint">{waitingLine(w)}</span>}
                  <HoursBar w={w} />
                </button>
                {open === w.id && <Detail w={w} />}
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

function Row({ w, open, fresh, onToggle }: { w: Workstation; open: boolean; fresh: boolean; onToggle: () => void }) {
  const wait = !isTerminal(w.status) && w.status !== "running" ? waitingLine(w) : null;
  return (
    <>
      <tr
        className={cn("cursor-pointer border-b border-line hover:bg-panel-2", freshRow(fresh), open && "bg-panel-2")}
        onClick={onToggle}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && (e.preventDefault(), onToggle())}
        tabIndex={0}
        aria-expanded={open}
        aria-label={`${w.name}, ${w.status}`}
      >
        <td className="max-w-[240px] py-2.5 pr-4 pl-5">
          <div className="truncate text-text">{w.name}</div>
          {wait && <div className="truncate text-[12px] text-faint">{wait}</div>}
          {w.spec.tier === "interruptible" && !isTerminal(w.status) && <div className="truncate text-[12px] text-work">may be preempted by on-demand work</div>}
        </td>
        <td className="px-4 py-2.5"><WsChip w={w} /></td>
        <td className="px-4 py-2.5 font-mono text-[12px] whitespace-nowrap text-muted-foreground">{specLine(w)}</td>
        <td className="px-4 py-2.5"><HoursBar w={w} compact /></td>
        <td className="px-4 py-2.5 text-right font-mono text-[13px] whitespace-nowrap tabular-nums text-muted-foreground">{cld(w.priceUcldPerHour)}</td>
        <td className="px-4 py-2.5 whitespace-nowrap"><RelTime ms={w.createdAt} /></td>
        <td className="w-10 pr-4 text-right"><ChevronDown className={cn("inline size-4 text-faint transition-transform duration-250", open && "rotate-180")} aria-hidden /></td>
      </tr>
      {open && (
        <tr className="border-b border-line">
          <td colSpan={COLS.length} className="p-0"><Detail w={w} /></td>
        </tr>
      )}
    </>
  );
}

// ── Detail ──────────────────────────────────────────────────────────────────
/** connect.ssh is "ssh -p <port> user@host"; tolerate a bare "host:port" too. */
function sshCommand(s?: string) {
  if (!s) return null;
  if (/^ssh\s/.test(s)) return s;
  const m = s.match(/^(?:([^@\s]+)@)?([^:\s]+):(\d+)$/);
  return m ? `ssh -p ${m[3]} ${m[1] ?? "root"}@${m[2]}` : s;
}

function Detail({ w }: { w: Workstation }) {
  const q = useWorkstation(w.id, isTerminal(w.status) ? false : 5_000);
  const bone = useDelayed(q.isLoading);
  const d = q.data;
  const events = (d?.events ?? []).slice(0, 50);
  const running = w.status === "running";
  const ssh = sshCommand(d?.connect?.ssh);
  const web = d?.connect?.web;
  const { copied, copy } = useCopy();
  const gpuNames = d?.gpu?.names?.length ? d.gpu.names.join(", ") : w.spec.gpu?.count ? (w.status === "queued" ? "assigned with the node" : "—") : "none (CPU)";

  return (
    <div className="animate-in fade-in-0 bg-bg-2 px-5 py-5 duration-250">
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0 space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <MonoLabel>Hours</MonoLabel>
              <div className="mt-2"><HoursBar w={w} d={d} /></div>
            </div>
            <dl className="grid grid-cols-[80px_1fr] gap-x-3 gap-y-1.5 font-mono text-[12px]">
              <dt className="text-faint">GPUs</dt><dd className="break-words text-text">{gpuNames}</dd>
              <dt className="text-faint">Tier</dt>
              <dd className="text-text">{w.spec.tier}{w.spec.tier === "interruptible" && <span className="block font-sans text-work">may be preempted by on-demand work</span>}</dd>
              <dt className="text-faint">Volume</dt>
              <dd className="text-text">{w.spec.volume ? `${w.spec.volume.sizeGb} GB · kept ${w.spec.volume.keepDays} d after stop` : "none"}</dd>
              <dt className="text-faint">Node</dt><dd><Hash value={w.node} className="text-[12px]" /></dd>
            </dl>
          </div>
          <div>
            <MonoLabel>Events</MonoLabel>
            <div className="mt-2 max-h-[260px] overflow-y-auto rounded-md border border-line bg-bg p-3" role="log" aria-label={`Events for ${w.name}`}>
              {q.isLoading ? (
                bone ? <div className="space-y-2">{Array.from({ length: 4 }, (_, i) => <Bone key={i} className="h-4 w-full" />)}</div> : <div className="h-20" />
              ) : q.isError ? (
                <p className="text-[13px] text-muted-foreground">{isUnavailable(q.error) ? "Events will appear here when the network API answers." : errText(q.error)}</p>
              ) : events.length === 0 ? (
                <p className="font-mono text-[12px] text-faint">No events yet.</p>
              ) : (
                <ol className="space-y-1 font-mono text-[12px] leading-5">
                  {events.map((e, i) => (
                    <li key={e.id ?? i} className="flex gap-3">
                      <RelTime ms={e.at} className="w-20 shrink-0 text-[12px]" />
                      <span className={cn("w-12 shrink-0", e.level === "error" ? "text-burn" : e.level === "warn" ? "text-work" : "text-faint")}>{e.level}</span>
                      <span className="min-w-0 break-words text-text">{e.message}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <MonoLabel>Connect</MonoLabel>
          {web && running ? (
            <a href={web} target="_blank" rel="noopener noreferrer" className={btn.primary}><ExternalLink /> Open web</a>
          ) : (
            <button type="button" className={btn.primary} disabled><ExternalLink /> Open web</button>
          )}
          <button type="button" className={cn(btn.ghost, "min-w-0")} disabled={!ssh || !running} onClick={() => ssh && copy(ssh)} aria-live="polite">
            {copied ? <Check className="text-ok" /> : <Terminal />} {copied ? "Copied" : "Copy SSH command"}
          </button>
          <p className="text-[12px] leading-4 text-faint">
            {running
              ? ssh ? <span className="break-all font-mono">{ssh}</span> : !w.spec.access.ssh ? "No SSH key was added; web access only." : "The SSH endpoint appears when the node reports it."
              : isTerminal(w.status) ? "It has stopped." : "Available once it is running."}
          </p>
          {!isTerminal(w.status) && (
            <>
              <div className="mt-2 border-t border-line pt-3"><MonoLabel>Extend</MonoLabel></div>
              <Extend w={w} />
              <StopButton w={w} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Extend({ w }: { w: Workstation }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<number | null>(null);
  const can = w.status === "running" || w.status === "assigned";
  async function extend(h: number) {
    const next = Math.min(720, w.spec.maxHours + h);
    setBusy(h);
    try {
      await extendWorkstation(w.id, next);
      toast.success(`Extended to ${dur(next)}`, { description: `${w.name} · +${dur(h)} at ${cld(w.priceUcldPerHour)}/h` });
      qc.invalidateQueries({ queryKey: ["cld", "deployments"] });
      qc.invalidateQueries({ queryKey: ["cld", "deployment", w.id] });
    } catch (e) {
      toast.error("Couldn't extend it", { description: errText(e) });
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        {[1, 6, 24].map((h) => (
          <button key={h} type="button" className={cn(btn.ghost, btn.sm, "font-mono")} disabled={!can || busy != null || w.spec.maxHours >= 720} onClick={() => extend(h)}>
            {busy === h ? <Loader2 className="animate-spin" /> : `+${h} h`}
          </button>
        ))}
      </div>
      {!can && <p className="text-[12px] leading-4 text-faint">You can extend it once a node is assigned.</p>}
    </>
  );
}

function StopButton({ w }: { w: Workstation }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  async function stop() {
    setBusy(true);
    try {
      await api(`/deployments/${w.id}`, { method: "DELETE", auth: true });
      toast.success("Stop requested", { description: `${w.name} · the node confirms shortly` });
      qc.invalidateQueries({ queryKey: ["cld", "deployments"] });
      qc.invalidateQueries({ queryKey: ["cld", "deployment", w.id] });
    } catch (e) {
      toast.error("Couldn't stop it", { description: errText(e) });
    } finally {
      setBusy(false);
    }
  }
  const vol = w.spec.volume;
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button type="button" className={cn(btn.ghost, "mt-1 border-burn/50 text-burn")} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Square />} Stop
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent className="border-line-2 bg-panel">
        <AlertDialogHeader>
          <AlertDialogTitle className="font-head text-text">Stop {w.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            The workstation stops and billing ends; you pay only for the time used.{" "}
            {vol ? `The ${vol.sizeGb} GB volume is kept on that node for ${vol.keepDays} ${vol.keepDays === 1 ? "day" : "days"}.` : "It has no volume, so its files are lost."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className={btn.ghost}>Keep running</AlertDialogCancel>
          <AlertDialogAction className={cn(btn.primary, "bg-burn text-white")} onClick={stop}>Stop workstation</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RowBones() {
  return (
    <div className="divide-y divide-line" aria-hidden>
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="flex h-[58px] items-center gap-6 px-5">
          <Bone className="h-4 w-32" />
          <Bone className="h-5 w-16 rounded-full" />
          <Bone className="h-4 w-40" />
          <Bone className="h-2 w-36" />
          <Bone className="ml-auto h-4 w-20" />
        </div>
      ))}
    </div>
  );
}
