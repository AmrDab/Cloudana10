// Secret sealing shared by containers and endpoint replicas: the per-target seal (key check, v2 payload bound to the
// target id, PATCH) and the small form used to enter secrets again. Plaintext lives in sessionStorage only (model.ts)
// until every target is sealed; the API only ever sees ciphertext.
import { useState } from "react";
import { Lock, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/cld";
import { btn } from "@/components/console/primitives";
import { errText } from "@/components/console/actions";
import { setSealState } from "./model";

/** A deployment or an endpoint replica: the row the secrets are PATCHed to, and the node (and key) that will open them. */
export type SealTarget = { id: string; node: string | null; nodePubkey?: string };

/** Seal `secrets` to `target`'s node and PATCH them. Records the seal state under target.id; true on success. */
export async function sealSecretsTo(target: SealTarget, secrets: Record<string, string>): Promise<boolean> {
  const node = target.node ?? undefined;
  setSealState(target.id, { phase: "sealing", node });
  try {
    if (!target.node || !target.nodePubkey) throw new Error("No node is assigned yet.");
    // Loaded on demand: the crypto only ships to tabs that seal something.
    const [{ seal, sealedEnvAad }, { publicKeyToAddress }] = await Promise.all([import("@/lib/sealed"), import("viem/accounts")]);
    // Trust the node's address (the deployment names it), never the key alone: the API relays the key, and a wrong
    // or substituted key would hand the secrets to whoever holds it. The key must derive to the assigned node.
    const hex = (target.nodePubkey.startsWith("0x") ? target.nodePubkey : `0x${target.nodePubkey}`) as `0x${string}`;
    if (publicKeyToAddress(hex).toLowerCase() !== target.node.toLowerCase()) {
      throw new Error("The key the API returned is not the assigned node's key. Secrets were not sealed; try again or report this.");
    }
    // Bound to this deployment (or replica) id: the node opens them only for it (shared/sealed.ts v2).
    const sealedEnv = seal(target.nodePubkey, JSON.stringify(secrets), sealedEnvAad(target.id));
    await api(`/deployments/${target.id}/secrets`, { method: "PATCH", auth: true, body: { sealedEnv } });
    setSealState(target.id, { phase: "sealed", node });
    return true;
  } catch (e) {
    setSealState(target.id, { phase: "error", node, message: errText(e) });
    return false;
  }
}

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const input = "h-9 w-full rounded-md border border-line-2 bg-bg-2 px-3 font-mono text-[12px] text-text placeholder:text-faint";

/** Enter secrets (again): the node changed since they were sealed, or this tab never had them. */
export function SecretsForm({ onSave }: { onSave: (secrets: Record<string, string>) => void }) {
  const [rows, setRows] = useState<[string, string][]>([["", ""]]);
  const filled = rows.filter(([k, v]) => k.trim() || v);
  const bad = filled.find(([k]) => !ENV_KEY.test(k.trim()));
  const err =
    filled.length === 0 ? "Enter at least one variable."
    : bad ? `"${bad[0]}" must be letters, digits and _ (not starting with a digit).`
    : filled.some(([, v]) => !v) ? "Enter a value for every variable."
    : null;
  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!err) onSave(Object.fromEntries(filled.map(([k, v]) => [k.trim(), v])));
      }}
    >
      {rows.map(([k, v], i) => (
        <div key={i} className="flex gap-2">
          <input value={k} onChange={(e) => setRows(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))} placeholder="KEY" spellCheck={false} aria-label={`Secret ${i + 1} name`} className={cn(input, "w-[40%]")} />
          <input value={v} onChange={(e) => setRows(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))} placeholder="value" type="password" autoComplete="off" spellCheck={false} aria-label={`Secret ${i + 1} value`} className={cn(input, "min-w-0 flex-1")} />
          <button type="button" className={cn(btn.quiet, "h-9 w-9 px-0")} onClick={() => setRows(rows.length > 1 ? rows.filter((_, j) => j !== i) : [["", ""]])} aria-label={`Remove secret ${i + 1}`}><X /></button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={cn(btn.quiet, btn.sm)} onClick={() => setRows([...rows, ["", ""]])}><Plus /> Add</button>
        <button type="submit" className={cn(btn.ghost, btn.sm)} disabled={!!err}><Lock /> Seal to the node</button>
      </div>
      {err && filled.length > 0 && <p className="text-[12px] leading-4 text-faint">{err}</p>}
    </form>
  );
}
