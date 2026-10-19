// Console · API keys (Docs → API): mint, list and revoke developer keys. The token is shown once; only its hash is
// stored. Keys carry scopes and can never manage keys, credits or provider state — the API enforces it, this page
// only says so.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KeyRound, Loader2, Plus, Trash2, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/cld";
import { btn, CopyButton, MonoLabel, Panel, Pill, RelTime } from "@/components/console/primitives";
import { useSession } from "@/components/console/data";
import { errText, signInWithToast } from "@/components/console/actions";

type Scope = "read" | "jobs" | "deployments";
export type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  scopes: Scope[];
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;
  revokedAt: number | null;
};
const SCOPES: [Scope, string][] = [
  ["read", "read — GET what you own"],
  ["jobs", "jobs — queue and cancel jobs"],
  ["deployments", "deployments — create, change and stop deployments"],
];
const MAX_LIVE = 20;
const input = "h-9 w-full rounded-md border border-line-2 bg-bg-2 px-3 text-sm text-text placeholder:text-faint";

export function ApiKeys() {
  const session = useSession();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["cld", "api-keys", session?.address],
    queryFn: () => api<{ keys: ApiKey[] }>("/keys", { auth: true }).then((r) => r.keys ?? []),
    enabled: !!session,
    retry: false,
  });
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Scope[]>(["read", "jobs"]);
  const [busy, setBusy] = useState(false);
  const [minted, setMinted] = useState<{ token: string; name: string } | null>(null);
  const live = (q.data ?? []).filter((k) => !k.revokedAt && (!k.expiresAt || k.expiresAt > Date.now()));

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return void signInWithToast();
    if (!name.trim() || scopes.length === 0) return;
    setBusy(true);
    try {
      const r = await api<{ key: ApiKey & { token: string } }>("/keys", { method: "POST", auth: true, body: { name: name.trim(), scopes } });
      setMinted({ token: r.key.token, name: r.key.name });
      setName("");
      void qc.invalidateQueries({ queryKey: ["cld", "api-keys"] });
    } catch (err) {
      toast.error("Couldn't create the key", { description: errText(err) });
    } finally {
      setBusy(false);
    }
  }
  async function revoke(k: ApiKey) {
    try {
      await api(`/keys/${k.id}`, { method: "DELETE", auth: true });
      toast.success(`Key ${k.name} revoked`, { description: "Requests with it are refused from now on." });
      void qc.invalidateQueries({ queryKey: ["cld", "api-keys"] });
    } catch (err) {
      toast.error("Couldn't revoke the key", { description: errText(err) });
    }
  }

  return (
    <Panel className="p-4">
      <div className="flex items-center justify-between gap-3">
        <MonoLabel>API keys</MonoLabel>
        {session && <span className="font-mono text-[12px] tabular-nums text-faint">{live.length} / {MAX_LIVE} live</span>}
      </div>
      {!session ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          Sign in to create keys for scripts, CI and SDKs.
          <button type="button" className={cn(btn.ghost, btn.sm)} onClick={() => signInWithToast()}><Wallet /> Sign in</button>
        </div>
      ) : (
        <>
          {minted && (
            <div className="mt-3 rounded-md border border-ok/40 bg-ok/[.06] p-3" role="status">
              <p className="text-[13px] leading-5 text-text">
                Key <b className="font-medium">{minted.name}</b> created. Copy it now — it is shown once; only its hash is kept.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-bg px-2 py-1.5 font-mono text-[12px] text-text">{minted.token}</code>
                <CopyButton text={minted.token} label="Copy key" />
                <button type="button" className={cn(btn.quiet, btn.sm)} onClick={() => setMinted(null)}>Done</button>
              </div>
            </div>
          )}
          <form onSubmit={create} className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
            <div className="grid gap-2">
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Key name, e.g. ci-deploy" aria-label="Key name" className={input} />
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {SCOPES.map(([s, label]) => (
                  <label key={s} className="flex items-center gap-2 text-[13px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={scopes.includes(s)}
                      onChange={(e) => setScopes(e.target.checked ? [...scopes, s] : scopes.filter((x) => x !== s))}
                      className="accent-ok"
                    />
                    <span className="font-mono text-[12px]">{label}</span>
                  </label>
                ))}
              </div>
            </div>
            <button type="submit" className={cn(btn.primary, btn.sm)} disabled={busy || !name.trim() || scopes.length === 0}>
              {busy ? <Loader2 className="animate-spin" /> : <Plus />} Create key
            </button>
          </form>
          <ul className="mt-4 divide-y divide-line rounded-md border border-line" aria-label="Your API keys">
            {q.isLoading ? (
              <li className="px-3 py-2 font-mono text-[12px] text-faint">Loading…</li>
            ) : q.isError ? (
              <li className="px-3 py-2 font-mono text-[12px] text-burn">{errText(q.error)}</li>
            ) : live.length === 0 ? (
              <li className="px-3 py-2 font-mono text-[12px] text-faint">No live keys.</li>
            ) : (
              live.map((k) => (
                <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <KeyRound className="size-3.5 text-faint" aria-hidden />
                    <span className="text-[13px] text-text">{k.name}</span>
                    <span className="font-mono text-[12px] text-faint">cld_sk_{k.prefix}…</span>
                    {k.scopes.map((s) => <Pill key={s}>{s}</Pill>)}
                  </span>
                  <span className="flex items-center gap-3 font-mono text-[12px] text-muted-foreground">
                    <span>{k.lastUsedAt ? <>used <RelTime ms={k.lastUsedAt} className="text-[12px]" /></> : "never used"}</span>
                    <button type="button" className={cn(btn.quiet, btn.sm, "text-burn")} onClick={() => revoke(k)} aria-label={`Revoke key ${k.name}`}>
                      <Trash2 /> Revoke
                    </button>
                  </span>
                </li>
              ))
            )}
          </ul>
          <p className="mt-2 text-[12px] leading-4 text-faint">
            Send it as <code className="font-mono">Authorization: Bearer cld_sk_…</code>. Keys cannot create keys, buy credits or touch provider
            settings — those need this wallet session, which ends when you sign out.
          </p>
        </>
      )}
    </Panel>
  );
}
