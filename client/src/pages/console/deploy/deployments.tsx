// Your deployments — table (cards under 640 px), expandable detail with events, Stop, Open site, and secret sealing.
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, ExternalLink, FileCode2, KeyRound, Loader2, Lock, Rocket, Square, Wallet, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ago, api, cld, short } from "@/lib/cld";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  btn, Bone, Empty, Hash, MonoLabel, Panel, PanelHeader, Pill, RelTime, Unavailable, Updated, freshRow, useDelayed, useFreshIds, useNow,
} from "@/components/console/primitives";
import {
  isTerminal, isUnavailable, useDeployment, useDeployments, useSession, type Deployment, type DeploymentDetail,
} from "@/components/console/data";
import { errText, signInWithToast } from "@/components/console/actions";
import { KindPill } from "./templates";
import { autoSeal, clearPendingSecrets, getSealState, pendingSecrets, setSealState, useSealVersion } from "./model";

// ── Status chip ─────────────────────────────────────────────────────────────
const TONE: Record<string, "muted" | "work" | "ok" | "burn"> = {
  queued: "muted", assigned: "work", running: "ok", unreachable: "burn", stopped: "muted", failed: "burn",
};
export function DeployChip({ status }: { status: string }) {
  return (
    <Pill key={status} tone={TONE[status] ?? "muted"} className="animate-in fade-in-0 duration-250">
      {(status === "assigned" || status === "queued") && <span className={cn("size-1.5 animate-pulse rounded-full", status === "assigned" ? "bg-work" : "bg-faint")} aria-hidden />}
      {status === "running" && <span className="size-1.5 rounded-full bg-ok" aria-hidden />}
      {status}
    </Pill>
  );
}

function Probe({ d }: { d: Deployment }) {
  const now = useNow(5000);
  if (d.probeOk == null) return <span className="font-mono text-[13px] text-faint">—</span>;
  return d.probeOk ? (
    <span className="font-mono text-[13px] tabular-nums text-ok">ok <span className="text-muted-foreground">{ago(d.lastProbeAt, now)}</span></span>
  ) : (
    <span className="font-mono text-[13px] text-burn">failed</span>
  );
}

function Endpoint({ url }: { url: string | null }) {
  if (!url) return <span className="font-mono text-[13px] text-faint">—</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex max-w-[220px] items-center gap-1 truncate font-mono text-[13px] text-text hover:text-ok hover:underline"
      aria-label={`Open ${url} in a new tab`}
    >
      <span className="truncate">{url.replace(/^https?:\/\//, "")}</span>
      <ExternalLink className="size-3 shrink-0 text-faint" aria-hidden />
    </a>
  );
}

// ── Secret sealing ──────────────────────────────────────────────────────────
async function sealNow(id: string, nodePubkey: string, node: string | null) {
  const secrets = pendingSecrets(id);
  if (!secrets) return;
  setSealState(id, { phase: "sealing", node: node ?? undefined });
  try {
    // Loaded on demand: the crypto only ships to tabs that seal something.
    const { seal } = await import("@/lib/sealed");
    const sealedEnv = await seal(nodePubkey, JSON.stringify(secrets));
    await api(`/deployments/${id}/secrets`, { method: "PATCH", auth: true, body: { sealedEnv } });
    clearPendingSecrets(id);
    setSealState(id, { phase: "sealed", node: node ?? undefined });
  } catch (e) {
    setSealState(id, { phase: "error", node: node ?? undefined, message: errText(e) });
  }
}

/** Polls one deployment until a node is assigned, then seals its pending secrets to that node's key. Renders nothing. */
function Sealer({ id }: { id: string }) {
  const q = useDeployment(id, 2_000);
  const started = useRef(false);
  const dep = q.data?.deployment;
  const pub = q.data?.nodePubkey;
  useEffect(() => {
    if (!dep || started.current) return;
    if (dep.status !== "queued" && dep.status !== "assigned") {
      started.current = true;
      autoSeal.delete(id);
      setSealState(id, { phase: "error", message: `The deployment is ${dep.status}; secrets can only be sealed before it starts.` });
    } else if (pub) {
      started.current = true;
      void sealNow(id, pub, dep.node);
    } else if (!getSealState(id)) {
      setSealState(id, { phase: "waiting" });
    }
  }, [id, dep, pub]);
  return null;
}

function SealLine({ d }: { d: Deployment }) {
  useSealVersion();
  const s = getSealState(d.id);
  const pending = !!pendingSecrets(d.id);
  if (!s && !pending) return null;
  const node = s?.node ?? d.node;
  if (s?.phase === "sealed") return <Pill tone="ok"><Lock className="size-3" aria-hidden /> Sealed</Pill>;
  if (s?.phase === "sealing") return <Pill tone="work"><Loader2 className="size-3 animate-spin" aria-hidden /> Sealing secrets to node {short(node)}</Pill>;
  if (s?.phase === "error") return <Pill tone="burn" className="whitespace-normal">Secrets not sealed</Pill>;
  return <Pill tone="muted"><KeyRound className="size-3" aria-hidden /> Secrets wait for a node</Pill>;
}

function SecretsControl({ d, detail }: { d: Deployment; detail?: DeploymentDetail }) {
  useSealVersion();
  const s = getSealState(d.id);
  const pending = !!pendingSecrets(d.id);
  if (!pending && s?.phase !== "sealed" && s?.phase !== "error") return null;
  const canSeal = !!detail?.nodePubkey && (d.status === "queued" || d.status === "assigned");
  const auto = autoSeal.has(d.id) && s?.phase !== "error";
  return (
    <div className="rounded-md border border-line bg-panel p-3">
      <MonoLabel>Secrets</MonoLabel>
      <div className="mt-2" aria-live="polite"><SealLine d={d} /></div>
      {s?.phase === "error" && s.message && <p className="mt-2 text-[12px] leading-4 text-burn">{s.message}</p>}
      {pending && !auto && (
        <>
          <button type="button" className={cn(btn.ghost, btn.sm, "mt-3 w-full")} disabled={!canSeal || s?.phase === "sealing"} onClick={() => detail?.nodePubkey && sealNow(d.id, detail.nodePubkey, d.node)}>
            <Lock /> Seal secrets now
          </button>
          <p className="mt-1.5 text-[12px] leading-4 text-faint">
            {canSeal ? "Encrypts them in this browser to the assigned node's key." : "Available once a node is assigned. Kept in this tab only until sealed."}
          </p>
        </>
      )}
    </div>
  );
}

// ── Table ───────────────────────────────────────────────────────────────────
const COLS = ["Name", "Kind", "Status", "Node", "Endpoint", "Price / h", "Probe", "Created", ""];

export function Deployments({ focusId, onBlank }: { focusId: string | null; onBlank: () => void }) {
  const session = useSession();
  const q = useDeployments();
  // Workstations have their own tab.
  const deps = (q.data ?? []).filter((d) => (d.kind as string) !== "workstation");
  const [open, setOpen] = useState<string | null>(null);
  const fresh = useFreshIds(deps.map((d) => d.id));
  const bone = useDelayed(q.isLoading);
  useSealVersion();

  useEffect(() => {
    if (focusId) setOpen(focusId);
  }, [focusId]);

  // Toast on the transitions that matter.
  const prev = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    for (const d of deps) {
      const was = prev.current.get(d.id);
      if (was && was !== d.status) {
        if (d.status === "running") toast.success(`${d.name} is running`, { description: d.endpoint ?? undefined });
        if (d.status === "failed") toast.error(`${d.name} failed`, { description: d.statusReason ?? undefined });
        if (d.status === "unreachable") toast.error(`${d.name} is unreachable`, { description: "3 probes failed · billing paused" });
      }
      prev.current.set(d.id, d.status);
    }
  }, [deps]);

  const toggle = (id: string) => setOpen(open === id ? null : id);

  return (
    <Panel id="deployments" className="scroll-mt-6 overflow-hidden" aria-labelledby="dep-h">
      {deps.filter((d) => autoSeal.has(d.id)).map((d) => <Sealer key={d.id} id={d.id} />)}
      <PanelHeader title={<span id="dep-h">Your deployments</span>} kicker="Hosting" right={session && <Updated at={q.dataUpdatedAt || null} offline={q.isError} />} />
      {!session ? (
        <Empty icon={Wallet} title="Sign in to deploy and see your sites and containers." action={<button type="button" className={btn.primary} onClick={() => signInWithToast()}><Wallet /> Sign in</button>} />
      ) : q.isError && !q.data ? (
        isUnavailable(q.error) ? <Unavailable what="Your deployments" /> : <Empty icon={X} title={errText(q.error)} />
      ) : q.isLoading ? (
        bone ? <RowBones /> : <div className="h-[180px]" />
      ) : deps.length === 0 ? (
        <Empty
          icon={Rocket}
          title="No deployments yet. Pick a template below, or paste one HTML file — the orchestrator places it on a capable node."
          action={<button type="button" className={btn.ghost} onClick={onBlank}><FileCode2 /> Paste HTML</button>}
        />
      ) : (
        <>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  {COLS.map((h, i) => (
                    <th key={i} scope="col" className={cn("px-4 py-2.5 font-mono text-[11px] font-normal uppercase tracking-[.08em] whitespace-nowrap text-faint first:pl-5", i === 5 && "text-right")}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {deps.map((d) => (
                  <Row key={d.id} d={d} open={open === d.id} fresh={fresh.has(d.id)} onToggle={() => toggle(d.id)} />
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-line sm:hidden">
            {deps.map((d) => (
              <li key={d.id} className={freshRow(fresh.has(d.id))}>
                <button type="button" className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left" onClick={() => toggle(d.id)} aria-expanded={open === d.id} aria-label={`${d.name}, ${d.status} — ${open === d.id ? "hide" : "show"} details`}>
                  <div className="min-w-0">
                    <div className="truncate text-[14px] text-text">{d.name}</div>
                    <div className="mt-0.5 truncate font-mono text-[12px] text-faint">
                      {d.endpoint ? d.endpoint.replace(/^https?:\/\//, "") : d.statusReason ?? d.kind} · {cld(d.priceUcldPerHour)}/h
                    </div>
                  </div>
                  <DeployChip status={d.status} />
                </button>
                {open === d.id && <Detail d={d} />}
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

function Row({ d, open, fresh, onToggle }: { d: Deployment; open: boolean; fresh: boolean; onToggle: () => void }) {
  return (
    <>
      <tr
        className={cn("cursor-pointer border-b border-line hover:bg-panel-2", freshRow(fresh), open && "bg-panel-2")}
        onClick={onToggle}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && (e.preventDefault(), onToggle())}
        tabIndex={0}
        aria-expanded={open}
        aria-label={`${d.name}, ${d.status}`}
      >
        <td className="max-w-[220px] py-2.5 pr-4 pl-5">
          <div className="truncate text-text">{d.name}</div>
          {d.statusReason && !isTerminal(d.status) && d.status !== "running" && <div className="truncate text-[12px] text-faint">{d.statusReason}</div>}
          <div className="mt-1 empty:hidden"><SealLine d={d} /></div>
        </td>
        <td className="px-4 py-2.5"><KindPill kind={d.kind} /></td>
        <td className="px-4 py-2.5"><DeployChip status={d.status} /></td>
        <td className="px-4 py-2.5 whitespace-nowrap"><Hash value={d.node} /></td>
        <td className="px-4 py-2.5"><Endpoint url={d.endpoint} /></td>
        <td className="px-4 py-2.5 text-right font-mono text-[13px] whitespace-nowrap tabular-nums text-muted-foreground">{cld(d.priceUcldPerHour)}</td>
        <td className="px-4 py-2.5 whitespace-nowrap"><Probe d={d} /></td>
        <td className="px-4 py-2.5 whitespace-nowrap"><RelTime ms={d.createdAt} /></td>
        <td className="w-10 pr-4 text-right"><ChevronDown className={cn("inline size-4 text-faint transition-transform duration-250", open && "rotate-180")} aria-hidden /></td>
      </tr>
      {open && (
        <tr className="border-b border-line">
          <td colSpan={COLS.length} className="p-0"><Detail d={d} /></td>
        </tr>
      )}
    </>
  );
}

// ── Detail ──────────────────────────────────────────────────────────────────
function Detail({ d }: { d: Deployment }) {
  const q = useDeployment(d.id, isTerminal(d.status) ? false : 5_000);
  const bone = useDelayed(q.isLoading);
  const events = (q.data?.events ?? []).slice(0, 50);
  const live = d.status === "running" || d.status === "unreachable";

  return (
    <div className="animate-in fade-in-0 bg-bg-2 px-5 py-5 duration-250">
      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="min-w-0">
          <MonoLabel>Events</MonoLabel>
          <div className="mt-2 max-h-[300px] overflow-y-auto rounded-md border border-line bg-bg p-3" role="log" aria-label={`Events for ${d.name}`}>
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
        <div className="flex flex-col gap-3">
          <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5 font-mono text-[12px]">
            <dt className="text-faint">Id</dt><dd><Hash value={d.id} head={8} tail={4} className="text-[12px]" /></dd>
            <dt className="text-faint">Status</dt><dd className="text-text">{d.status}{d.statusReason ? <span className="text-muted-foreground"> · {d.statusReason}</span> : null}</dd>
            <dt className="text-faint">Node</dt><dd><Hash value={d.node} className="text-[12px]" /></dd>
            <dt className="text-faint">Started</dt><dd><RelTime ms={d.startedAt} className="text-[12px]" /></dd>
            {d.stoppedAt && (<><dt className="text-faint">Stopped</dt><dd><RelTime ms={d.stoppedAt} className="text-[12px]" /></dd></>)}
            <dt className="text-faint">Probe</dt><dd><Probe d={d} /></dd>
          </dl>
          <SecretsControl d={d} detail={q.data} />
          {d.kind === "static" && d.endpoint && live && (
            <a href={d.endpoint} target="_blank" rel="noopener noreferrer" className={btn.primary}>
              <ExternalLink /> Open site
            </a>
          )}
          {!isTerminal(d.status) && <StopButton d={d} />}
        </div>
      </div>
    </div>
  );
}

function StopButton({ d }: { d: Deployment }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  async function stop() {
    setBusy(true);
    try {
      await api(`/deployments/${d.id}`, { method: "DELETE", auth: true });
      toast.success("Stop requested", { description: `${d.name} · the node confirms shortly` });
      qc.invalidateQueries({ queryKey: ["cld", "deployments"] });
      qc.invalidateQueries({ queryKey: ["cld", "deployment", d.id] });
    } catch (e) {
      toast.error("Couldn't stop it", { description: errText(e) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button type="button" className={cn(btn.ghost, "border-burn/50 text-burn")} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Square />} Stop
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent className="border-line-2 bg-panel">
        <AlertDialogHeader>
          <AlertDialogTitle className="font-head text-text">Stop {d.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            The node stops serving it and billing ends. {d.kind === "static" ? "The endpoint stops answering." : "The container is removed with its local storage."} This can't be undone; deploy again to bring it back.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className={btn.ghost}>Keep running</AlertDialogCancel>
          <AlertDialogAction className={cn(btn.primary, "bg-burn text-white")} onClick={stop}>Stop deployment</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RowBones() {
  return (
    <div className="divide-y divide-line" aria-hidden>
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="flex h-[45px] items-center gap-6 px-5">
          <Bone className="h-4 w-32" />
          <Bone className="h-5 w-16 rounded-full" />
          <Bone className="h-5 w-16 rounded-full" />
          <Bone className="h-4 w-28" />
          <Bone className="ml-auto h-4 w-20" />
        </div>
      ))}
    </div>
  );
}
