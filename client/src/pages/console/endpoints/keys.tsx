// Endpoint keys (docs/V4_ENDPOINTS_CONTRACT.md): create (shown once), list by prefix, revoke.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KeyRound, Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/cld";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { btn, Bone, CopyButton, MonoLabel, Pill, RelTime } from "@/components/console/primitives";
import { isTerminal, useEndpointKeys, type Endpoint, type EndpointKey } from "@/components/console/data";
import { errText } from "@/components/console/actions";

export function EndpointKeys({ e }: { e: Endpoint }) {
  const qc = useQueryClient();
  const q = useEndpointKeys(e.auth === "key" ? e.id : null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<{ name: string; key: string } | null>(null);

  if (e.auth === "public") {
    return (
      <div className="rounded-md border border-line bg-panel p-3">
        <MonoLabel>Access</MonoLabel>
        <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">Public: anyone with the address can call it. Your server's own auth, if any, still applies.</p>
      </div>
    );
  }

  const live = (q.data ?? []).filter((k) => !k.revokedAt);
  const ended = isTerminal(e.status);
  async function create(ev: React.FormEvent) {
    ev.preventDefault();
    const n = name.trim() || `key-${live.length + 1}`;
    setBusy(true);
    try {
      const r = await api<{ key: EndpointKey & { key: string } }>(`/deployments/${e.id}/keys`, { method: "POST", auth: true, body: { name: n } });
      setShown({ name: r.key.name, key: r.key.key });
      setName("");
      qc.invalidateQueries({ queryKey: ["cld", "endpoint-keys", e.id] });
    } catch (err) {
      toast.error("Couldn't create the key", { description: errText(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-line bg-panel p-3">
      <div className="flex items-baseline justify-between gap-3">
        <MonoLabel>Keys</MonoLabel>
        <span className="text-[12px] text-faint">callers send Authorization: Bearer</span>
      </div>
      {shown && (
        <div className="mt-2.5 rounded-md border border-ok/40 bg-ok/[.07] p-3" role="status">
          <div className="font-mono text-[11px] uppercase tracking-[.08em] text-ok">New key “{shown.name}” — copy it now, it is shown once</div>
          <div className="mt-2 flex items-start gap-2">
            <code className="min-w-0 flex-1 font-mono text-[12px] leading-5 break-all text-text">{shown.key}</code>
            <CopyButton text={shown.key} className="shrink-0 bg-panel" />
          </div>
        </div>
      )}
      <ul className="mt-2.5 divide-y divide-line" aria-label="Keys">
        {q.isLoading ? (
          <li className="py-2"><Bone className="h-4 w-full" /></li>
        ) : q.isError ? (
          <li className="py-2 text-[13px] text-muted-foreground">{errText(q.error)}</li>
        ) : (q.data ?? []).length === 0 ? (
          <li className="py-2 text-[13px] text-faint">{ended ? "No keys." : "No keys yet. Nobody can call it until you create one."}</li>
        ) : (
          (q.data ?? []).map((k) => (
            <li key={k.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <div className={cn("truncate text-[13px]", k.revokedAt ? "text-faint line-through" : "text-text")}>{k.name}</div>
                <div className="font-mono text-[12px] text-faint">cld_ek_{k.prefix}… · <RelTime ms={k.createdAt} className="text-[12px]" /></div>
              </div>
              {k.revokedAt ? <Pill>revoked</Pill> : ended ? <Pill>unused</Pill> : <Revoke e={e} k={k} />}
            </li>
          ))
        )}
      </ul>
      {ended ? (
        <p className="mt-1.5 text-[12px] leading-4 text-faint">This endpoint has ended; its address no longer answers.</p>
      ) : (
      <>
      <form onSubmit={create} className="mt-2.5 flex gap-2">
        <input
          value={name}
          onChange={(ev) => setName(ev.target.value)}
          maxLength={80}
          placeholder="name, e.g. prod"
          aria-label="New key name"
          className="h-8 min-w-0 flex-1 rounded-md border border-line-2 bg-bg-2 px-2.5 text-[13px] text-text placeholder:text-faint"
        />
        <button type="submit" className={cn(btn.ghost, btn.sm)} disabled={busy || live.length >= 20}>
          {busy ? <Loader2 className="animate-spin" /> : <Plus />} New key
        </button>
      </form>
      <p className="mt-1.5 text-[12px] leading-4 text-faint">Up to 20 live keys · 600 requests a minute each · a revoked key stops working within 30 s.</p>
      </>
      )}
    </div>
  );
}

function Revoke({ e, k }: { e: Endpoint; k: EndpointKey }) {
  const qc = useQueryClient();
  async function revoke() {
    try {
      await api(`/deployments/${e.id}/keys/${k.id}`, { method: "DELETE", auth: true });
      toast.success(`Key “${k.name}” revoked`);
      qc.invalidateQueries({ queryKey: ["cld", "endpoint-keys", e.id] });
    } catch (err) {
      toast.error("Couldn't revoke the key", { description: errText(err) });
    }
  }
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button type="button" className={cn(btn.ghost, btn.sm, "border-burn/50 text-burn")}><KeyRound /> Revoke</button>
      </AlertDialogTrigger>
      <AlertDialogContent className="border-line-2 bg-panel">
        <AlertDialogHeader>
          <AlertDialogTitle className="font-head text-text">Revoke “{k.name}”?</AlertDialogTitle>
          <AlertDialogDescription>Anything still using cld_ek_{k.prefix}… gets 401 within 30 seconds. This can't be undone; create a new key instead.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className={btn.ghost}>Keep it</AlertDialogCancel>
          <AlertDialogAction className={cn(btn.primary, "bg-burn text-white")} onClick={revoke}>Revoke key</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
