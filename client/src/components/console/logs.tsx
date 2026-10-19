// Console · container logs (ENGINEERING_BACKLOG B-14): the last lines of a container's output, read live from its
// node through the relay when the owner asks. Nothing is stored; a deployment that left its node shows the tail kept
// from its last failure.
import { useState } from "react";
import { Loader2, RefreshCw, ScrollText } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/cld";
import { btn, MonoLabel } from "@/components/console/primitives";
import { errText } from "@/components/console/actions";

type Logs = { id: string; node: string | null; tail: number; source: "node" | "last_failure"; logs: string; truncated: boolean };
type State = { phase: "idle" } | { phase: "loading" } | { phase: "ok"; logs: Logs } | { phase: "error"; message: string };

export function LogsPanel({ id, name, className, compact }: { id: string; name: string; className?: string; compact?: boolean }) {
  const [state, setState] = useState<State>({ phase: "idle" });
  async function load() {
    setState({ phase: "loading" });
    try {
      setState({ phase: "ok", logs: await api<Logs>(`/deployments/${id}/logs?tail=200`, { auth: true }) });
    } catch (e) {
      setState({ phase: "error", message: errText(e) });
    }
  }
  return (
    <div className={className}>
      <div className="flex min-h-8 items-center justify-between gap-3">
        <MonoLabel>Logs</MonoLabel>
        <button type="button" className={cn(btn.quiet, btn.sm, "-mr-3")} onClick={load} disabled={state.phase === "loading"} aria-label={`Fetch logs of ${name}`}>
          {state.phase === "loading" ? <Loader2 className="animate-spin" /> : state.phase === "ok" ? <RefreshCw /> : <ScrollText />}
          {state.phase === "ok" ? "Refresh" : "Fetch logs"}
        </button>
      </div>
      {state.phase === "idle" && !compact && <p className="mt-1 text-[12px] leading-4 text-faint">The last 200 lines, read from the node when you ask. Nothing is stored.</p>}
      {state.phase === "error" && <p className="mt-1 text-[12px] leading-4 text-burn">{state.message}</p>}
      {state.phase === "ok" && (
        <>
          <pre className="mt-2 max-h-[320px] overflow-auto rounded-md bg-[#1d1c1a] p-3.5 font-mono text-[12px] leading-[1.55] whitespace-pre-wrap text-[#d7d2c6]" aria-label={`Logs of ${name}`}>
            {state.logs.logs || "(no output)"}
          </pre>
          <p className="mt-1 font-mono text-[11px] text-faint">
            {state.logs.source === "node" ? `live from the node · last ${state.logs.tail} lines` : "kept from its last failure"}
            {state.logs.truncated ? " · cut to the last 64 KiB" : ""}
          </p>
        </>
      )}
    </div>
  );
}
