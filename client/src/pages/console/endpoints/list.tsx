// Your endpoints — table (cards under 640 px) with an expandable detail: replicas, failure logs, how to call it, keys,
// events, stop. Concept A ("ledger") with concept C's inline log tail; mirrors the Deploy and Workstations lists.
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BrainCircuit, ChevronDown, Loader2, Square, Wallet, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ago, api } from "@/lib/cld";
import { perHour, tierOf, GPU_TIER_LABEL, ucldToUsd, usePrices } from "@/lib/prices";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  btn, Bone, CodeBlock, CopyButton, Empty, Hash, MonoLabel, Panel, PanelHeader, RelTime, Unavailable, Updated, freshRow, useDelayed, useFreshIds, useNow,
} from "@/components/console/primitives";
import {
  isEndpoint, isTerminal, isUnavailable, useDeployments, useEndpoint, useSession, type Endpoint, type Replica,
} from "@/components/console/data";
import { errText, signInWithToast } from "@/components/console/actions";
import { DeployChip } from "@/pages/console/deploy/deployments";
import { EndpointKeys } from "./keys";

export function specLine(e: Endpoint) {
  const s = e.spec;
  const g = s.gpu?.count ? `${s.gpu.count}× ${GPU_TIER_LABEL[tierOf(s.gpu.class)]} GPU${s.gpu.minVramGb ? ` ≥${s.gpu.minVramGb} GB` : ""}` : "CPU";
  return `${g} · ${s.cpu / 1000} vCPU · ${Math.round(s.memMb / 1024)} GB`;
}

const running = (e: Endpoint) => e.replicas.filter((r) => r.status === "running").length;

/** One square per replica, coloured by status. */
function ReplicaDots({ e }: { e: Endpoint }) {
  const tone = (r: Replica) => (r.status === "running" ? "bg-ok" : r.status === "failed" || r.status === "unreachable" ? "bg-burn" : r.status === "assigned" ? "bg-work" : "bg-line-2");
  return (
    <span className="inline-flex gap-[3px] align-middle" aria-label={`${running(e)} of ${e.replicas.length} replicas running`}>
      {e.replicas.map((r) => <span key={r.id} className={cn("size-2 rounded-[2px]", tone(r))} aria-hidden />)}
    </span>
  );
}

/** Why it isn't serving yet, in plain words. */
function waitingLine(e: Endpoint) {
  if (e.status === "running" || isTerminal(e.status)) return e.statusReason;
  // A replica keeps the reason it was last re-queued for; once a node has it, "starting" is what is true.
  if (e.status === "assigned") return `starting: waiting for ${e.spec.health?.path ?? "/"} (up to ${Math.round((e.spec.health?.startupGraceSec ?? 600) / 60)} min)`;
  const r = e.replicas.find((x) => x.status === "queued" && x.statusReason) ?? null;
  if (r?.statusReason) return r.statusReason;
  if (e.status === "queued") return e.spec.gpu?.count ? "waiting for a GPU node that fits" : "waiting for a node that fits";
  return null;
}

const COLS = ["Name", "Status", "Per replica", "Replicas", "Cost / h", ""];

export function Endpoints({ focusId }: { focusId: string | null }) {
  const session = useSession();
  const q = useDeployments();
  const eps = (q.data ?? []).filter(isEndpoint) as Endpoint[];
  const [open, setOpen] = useState<string | null>(null);
  const fresh = useFreshIds(eps.map((e) => e.id));
  const bone = useDelayed(q.isLoading);

  useEffect(() => {
    if (focusId) setOpen(focusId);
  }, [focusId]);

  // Toast on the transitions that matter.
  const prev = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    for (const e of eps) {
      const was = prev.current.get(e.id);
      if (was && was !== e.status) {
        if (e.status === "running") toast.success(`${e.name} is serving`, { description: e.url ?? undefined });
        if (e.status === "failed") toast.error(`${e.name} failed`, { description: waitingLine(e) ?? "every replica failed — open it for the logs" });
      }
      prev.current.set(e.id, e.status);
    }
  }, [eps]);

  const toggle = (id: string) => setOpen(open === id ? null : id);

  return (
    <Panel id="endpoints" className="scroll-mt-6 overflow-hidden" aria-labelledby="ep-h">
      <PanelHeader title={<span id="ep-h">Your endpoints</span>} kicker="Endpoints" right={session && <Updated at={q.dataUpdatedAt || null} offline={q.isError} />} />
      {!session ? (
        <Empty icon={Wallet} title="Sign in to serve your model and see your endpoints." action={<button type="button" className={btn.primary} onClick={() => signInWithToast()}><Wallet /> Sign in</button>} />
      ) : q.isError && !q.data ? (
        isUnavailable(q.error) ? <Unavailable what="Your endpoints" /> : <Empty icon={X} title={errText(q.error)} />
      ) : q.isLoading ? (
        bone ? <RowBones /> : <div className="h-[180px]" />
      ) : eps.length === 0 ? (
        <Empty icon={BrainCircuit} title="No endpoints yet. Bring your own image below — vLLM, Ollama, TGI or your own server — and the network gives it an address." />
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
                {eps.map((e) => <Row key={e.id} e={e} open={open === e.id} fresh={fresh.has(e.id)} onToggle={() => toggle(e.id)} />)}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-line sm:hidden">
            {eps.map((e) => (
              <li key={e.id} className={freshRow(fresh.has(e.id))}>
                <button type="button" className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left" onClick={() => toggle(e.id)} aria-expanded={open === e.id} aria-label={`${e.name}, ${e.status} — ${open === e.id ? "hide" : "show"} details`}>
                  <div className="min-w-0">
                    <div className="truncate text-[14px] text-text">{e.name}</div>
                    <div className="mt-0.5 truncate font-mono text-[12px] text-faint">{specLine(e)} · {running(e)}/{e.replicas.length}</div>
                  </div>
                  <DeployChip status={e.status} />
                </button>
                {open === e.id && <Detail e={e} />}
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

function Cost({ e }: { e: Endpoint }) {
  const { usdPerCld } = usePrices();
  if (isTerminal(e.status)) return <span className="text-faint">—</span>;
  return <span title="all replicas, per hour">{perHour(ucldToUsd(e.priceUcldPerHour, usdPerCld), usdPerCld)}</span>;
}

function Row({ e, open, fresh, onToggle }: { e: Endpoint; open: boolean; fresh: boolean; onToggle: () => void }) {
  const why = waitingLine(e);
  return (
    <>
      <tr
        className={cn("cursor-pointer border-b border-line hover:bg-panel-2", freshRow(fresh), open && "bg-panel-2")}
        onClick={onToggle}
        onKeyDown={(ev) => (ev.key === "Enter" || ev.key === " ") && ev.target === ev.currentTarget && (ev.preventDefault(), onToggle())}
        tabIndex={0}
        aria-expanded={open}
        aria-label={`${e.name}, ${e.status}`}
      >
        <td className="max-w-[260px] py-2.5 pr-4 pl-5">
          <div className="truncate text-text">{e.name}</div>
          <div className="truncate font-mono text-[12px] text-chain" title={e.url ?? undefined}>{e.url?.replace(/^https:\/\//, "") ?? e.spec.image}</div>
        </td>
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-2"><DeployChip status={e.status} /><ReplicaDots e={e} /></div>
          {why && <div className="mt-1 max-w-[220px] truncate text-[12px] text-faint" title={why}>{why}</div>}
        </td>
        <td className="px-4 py-2.5 text-[13px] whitespace-nowrap text-muted-foreground">{specLine(e)}</td>
        <td className="px-4 py-2.5 font-mono text-[13px] tabular-nums text-text">{running(e)} / {e.replicas.length}</td>
        <td className="px-4 py-2.5 text-right font-mono text-[13px] whitespace-nowrap tabular-nums text-muted-foreground"><Cost e={e} /></td>
        <td className="w-10 pr-4 text-right"><ChevronDown className={cn("inline size-4 text-faint transition-transform duration-250", open && "rotate-180")} aria-hidden /></td>
      </tr>
      {open && (
        <tr className="border-b border-line">
          <td colSpan={COLS.length} className="p-0"><Detail e={e} /></td>
        </tr>
      )}
    </>
  );
}

// ── Detail ──────────────────────────────────────────────────────────────────
function Detail({ e }: { e: Endpoint }) {
  const q = useEndpoint(e.id, isTerminal(e.status) ? false : 5_000);
  const bone = useDelayed(q.isLoading);
  const d = q.data?.deployment ?? e;
  const events = (q.data?.events ?? []).slice(0, 50);
  const withLogs = d.replicas.map((r, i) => ({ r, n: i + 1 })).filter(({ r }) => r.logs);
  const url = d.url ?? "";
  const auth = d.auth === "key" ? ` \\\n  -H "Authorization: Bearer cld_ek_…"` : "";
  const curl = `curl ${url}${d.spec.health?.path && d.spec.health.path !== "/" ? d.spec.health.path : "/"}${auth}`;

  return (
    <div className="animate-in fade-in-0 bg-bg-2 px-5 py-5 duration-250">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <div>
            <MonoLabel>Replicas</MonoLabel>
            <ul className="mt-2 divide-y divide-line rounded-md border border-line bg-panel" aria-label="Replicas">
              {d.replicas.map((r, i) => <ReplicaRow key={r.id} r={r} n={i + 1} />)}
            </ul>
          </div>
          {withLogs.map(({ r, n }) => (
            <div key={r.id}>
              <MonoLabel className="text-burn">#{n} · last lines from the node{r.statusReason ? ` · ${r.statusReason}` : ""}</MonoLabel>
              <pre className="mt-2 max-h-[260px] overflow-auto rounded-md bg-[#1d1c1a] p-3.5 font-mono text-[12px] leading-[1.55] whitespace-pre-wrap text-[#d7d2c6]" aria-label={`Logs of replica ${n}`}>{r.logs}</pre>
            </div>
          ))}
          <div>
            <MonoLabel>Call it</MonoLabel>
            <CodeBlock className="mt-2" code={curl} />
            <p className="mt-1.5 text-[12px] leading-4 text-faint">Your server's own routes work as they are — for vLLM, point an OpenAI SDK at {url ? `${url}/v1` : "the address + /v1"}.</p>
          </div>
          <div>
            <MonoLabel>Events</MonoLabel>
            <div className="mt-2 max-h-[240px] overflow-y-auto rounded-md border border-line bg-bg p-3" role="log" aria-label={`Events for ${d.name}`}>
              {q.isLoading ? (
                bone ? <div className="space-y-2">{Array.from({ length: 4 }, (_, i) => <Bone key={i} className="h-4 w-full" />)}</div> : <div className="h-20" />
              ) : q.isError ? (
                <p className="text-[13px] text-muted-foreground">{isUnavailable(q.error) ? "Events will appear here when the network API answers." : errText(q.error)}</p>
              ) : events.length === 0 ? (
                <p className="font-mono text-[12px] text-faint">No events yet.</p>
              ) : (
                <ol className="space-y-1 font-mono text-[12px] leading-5">
                  {events.map((ev, i) => (
                    <li key={ev.id ?? i} className="flex gap-3">
                      <RelTime ms={ev.at} className="w-20 shrink-0 text-[12px]" />
                      <span className={cn("w-12 shrink-0", ev.level === "error" ? "text-burn" : ev.level === "warn" ? "text-work" : "text-faint")}>{ev.level}</span>
                      <span className="min-w-0 break-words text-text">{ev.message}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <EndpointKeys e={d} />
          <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5 rounded-md border border-line bg-panel p-3 font-mono text-[12px]">
            <dt className="text-faint">Address</dt><dd className="min-w-0 truncate text-chain" title={url}>{url || "—"}</dd>
            <dt className="text-faint">Image</dt><dd className="min-w-0 truncate text-text" title={d.spec.image}>{d.spec.image}</dd>
            <dt className="text-faint">Health</dt><dd className="text-text">GET {d.spec.health?.path ?? "/"} on port {d.spec.port}</dd>
            <dt className="text-faint">Cost</dt><dd className="text-text"><Cost e={d} /></dd>
            <dt className="text-faint">Check</dt><dd className="text-muted-foreground">probed every minute; a failing replica is replaced</dd>
          </dl>
          <div className="flex flex-wrap gap-2">
            {url && <CopyButton text={url} label="Copy address" />}
            {!isTerminal(d.status) && <StopButton e={d} />}
          </div>
          {!isTerminal(d.status) && <p className="text-[12px] leading-4 text-faint">Stopping bills the part of the hour used and releases the rest of the hold.</p>}
        </div>
      </div>
    </div>
  );
}

function ReplicaRow({ r, n }: { r: Replica; n: number }) {
  const now = useNow(5000);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
      <span className="flex items-center gap-2"><DeployChip status={r.status} /><span className="font-mono text-[12px] text-faint">#{n}</span></span>
      <span className="font-mono text-[12px] text-muted-foreground">
        {r.node ? <>node <Hash value={r.node} className="text-[12px]" /></> : "no node yet"}
        {r.probeOk != null && <> · <span className={r.probeOk ? "text-ok" : "text-burn"}>{r.probeOk ? "healthy" : "probe failed"}</span></>}
        {r.startedAt && r.status === "running" && <> · up {ago(r.startedAt, now).replace(" ago", "")}</>}
      </span>
    </li>
  );
}

function StopButton({ e }: { e: Endpoint }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  async function stop() {
    setBusy(true);
    try {
      await api(`/deployments/${e.id}`, { method: "DELETE", auth: true });
      toast.success("Stop requested", { description: `${e.name} · every replica stops shortly` });
      qc.invalidateQueries({ queryKey: ["cld", "deployments"] });
      qc.invalidateQueries({ queryKey: ["cld", "deployment", e.id] });
    } catch (err) {
      toast.error("Couldn't stop it", { description: errText(err) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button type="button" className={cn(btn.ghost, "border-burn/50 text-burn")} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Square />} Stop endpoint
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent className="border-line-2 bg-panel">
        <AlertDialogHeader>
          <AlertDialogTitle className="font-head text-text">Stop {e.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            All {e.replicas.length} {e.replicas.length === 1 ? "replica stops" : "replicas stop"} and billing ends; the address stops answering. This can't be undone; create it again to bring it back.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className={btn.ghost}>Keep serving</AlertDialogCancel>
          <AlertDialogAction className={cn(btn.primary, "bg-burn text-white")} onClick={stop}>Stop endpoint</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RowBones() {
  return (
    <div className="divide-y divide-line" aria-hidden>
      {Array.from({ length: 2 }, (_, i) => (
        <div key={i} className="flex h-[58px] items-center gap-6 px-5">
          <Bone className="h-4 w-32" />
          <Bone className="h-5 w-20 rounded-full" />
          <Bone className="h-4 w-40" />
          <Bone className="ml-auto h-4 w-24" />
        </div>
      ))}
    </div>
  );
}
