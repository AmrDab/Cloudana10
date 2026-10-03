// Deploy form — static (upload a folder / paste HTML) or container (image, ports, env with secret toggle, size).
import { useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FolderUp, KeyRound, Loader2, Lock, Plus, Rocket, Trash2, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { api, ApiError, cld } from "@/lib/cld";
import { STATIC_STARTER } from "@/lib/static-starter";
import { Switch } from "@/components/ui/switch";
import { btn, MonoLabel } from "@/components/console/primitives";
import { useSession } from "@/components/console/data";
import { errText, signInWithToast } from "@/components/console/actions";
import {
  bytes, containerDefaults, kindOf, MAX_STATIC, mb, priceEstimate, readFolder, savePendingSecrets, SIZES, sizeFor, textToBase64,
  type Size, type StaticFile,
} from "./model";
import type { ListedTemplate } from "./templates";

type EnvRow = { key: string; value: string; secret: boolean };
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const input = "h-10 w-full rounded-md border border-line-2 bg-bg-2 px-3 text-sm text-text placeholder:text-faint";

export function DeployForm({ template, onDone }: { template: ListedTemplate | null; onDone: (id: string) => void }) {
  const session = useSession();
  const qc = useQueryClient();
  const kind = template ? kindOf(template) : "static";
  const d = useMemo(() => containerDefaults(template), [template]);
  const tplFiles = useMemo(
    () => (template?.files ?? []).map((f) => ({ ...f, size: Math.floor((f.contentBase64.length * 3) / 4) - (f.contentBase64.match(/=*$/)?.[0].length ?? 0) })),
    [template],
  );

  const [name, setName] = useState(() => (template?.name ?? "my-site").slice(0, 40));
  const [source, setSource] = useState<"template" | "paste" | "upload">(tplFiles.length ? "template" : "paste");
  const [html, setHtml] = useState(STATIC_STARTER);
  const [files, setFiles] = useState<StaticFile[] | null>(null);
  const [reading, setReading] = useState(false);
  const [image, setImage] = useState(d.image);
  const [ports, setPorts] = useState(d.ports.length ? d.ports.join(", ") : "80");
  const [env, setEnv] = useState<EnvRow[]>(() => [
    ...Object.entries(template?.env ?? {}).map(([key, value]) => ({ key, value, secret: false })),
    ...(template?.secretEnv ?? []).map((key) => ({ key, value: "", secret: true })),
  ]);
  const [size, setSize] = useState<Size>(() => sizeFor(d));
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  // ── Validation ──
  const nameErr = !name.trim() ? "Name is required." : name.trim().length > 40 ? "40 characters at most." : null;
  const staticFiles: StaticFile[] | null = useMemo(
    () =>
      kind !== "static" ? null
      : source === "template" ? tplFiles
      : source === "paste" ? [{ path: "index.html", contentBase64: textToBase64(html), size: new TextEncoder().encode(html).length }]
      : files,
    [kind, source, html, files, tplFiles],
  );
  const rawSize = staticFiles?.reduce((s, f) => s + f.size, 0) ?? 0;
  const encSize = staticFiles?.reduce((s, f) => s + f.contentBase64.length + f.path.length, 0) ?? 0;
  const staticErr =
    kind !== "static" ? null
    : !staticFiles?.length ? (source === "upload" ? "Choose a folder." : "Paste some HTML.")
    : !staticFiles.some((f) => f.path === "index.html") ? "The folder needs an index.html at its root."
    : encSize > MAX_STATIC ? `Too large: ${bytes(encSize)} encoded, the limit is 2 MB.`
    : null;
  const portList = ports.split(/[\s,]+/).filter(Boolean).map(Number);
  const portsErr = kind === "container" && (!portList.length || portList.some((p) => !Number.isInteger(p) || p < 1 || p > 65535)) ? "Ports are numbers from 1 to 65535." : null;
  const imageErr = kind === "container" && !image.trim() ? "Image is required." : null;
  const envErr =
    env.some((r) => r.key && !ENV_KEY.test(r.key)) ? "Variable names use letters, digits and _, and don't start with a digit."
    : new Set(env.filter((r) => r.key).map((r) => r.key)).size !== env.filter((r) => r.key).length ? "Variable names must be unique."
    : env.some((r) => r.key && r.secret && !r.value) ? "Enter a value for every secret."
    : null;
  const err = nameErr || staticErr || portsErr || imageErr || envErr;
  const price = priceEstimate(kind, SIZES[size]);

  async function pickFolder(list: FileList | null) {
    if (!list?.length) return;
    setReading(true);
    try {
      setFiles(await readFolder(list));
    } catch {
      toast.error("Couldn't read those files");
    } finally {
      setReading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!session) return void signInWithToast();
    if (err) return;
    setBusy(true);
    const rows = env.filter((r) => r.key);
    const plain = Object.fromEntries(rows.filter((r) => !r.secret).map((r) => [r.key, r.value]));
    const secrets = Object.fromEntries(rows.filter((r) => r.secret).map((r) => [r.key, r.value]));
    const spec =
      kind === "static"
        ? { files: staticFiles!.map(({ path, contentBase64 }) => ({ path, contentBase64 })) }
        : {
            image: image.trim(),
            ...(d.command.length ? { command: d.command } : {}),
            ...(Object.keys(plain).length ? { env: plain } : {}),
            ports: portList.map((p) => ({ container: p, protocol: "tcp" as const })),
            ...SIZES[size],
          };
    try {
      const r = await api<{ id: string; priceUcldPerHour: number; status: string }>("/deployments", {
        method: "POST",
        auth: true,
        body: { ...(template ? { templateId: template.id } : {}), name: name.trim(), kind, spec },
      });
      if (Object.keys(secrets).length) savePendingSecrets(r.id, secrets);
      toast.success("Deployment queued", { description: `${name.trim()} · ${cld(r.priceUcldPerHour)} / h · the orchestrator places it on a capable node` });
      qc.invalidateQueries({ queryKey: ["cld", "deployments"] });
      qc.invalidateQueries({ queryKey: ["cld", "account"] });
      onDone(r.id);
    } catch (e) {
      toast.error("Couldn't deploy", {
        description: e instanceof ApiError && e.status === 422 ? "Your balance doesn't cover the first hour. Get test credits on the Compute job tab." : errText(e),
      });
    } finally {
      setBusy(false);
    }
  }

  const show = (m: string | null) => touched && m;

  return (
    <form onSubmit={submit} className="space-y-6 px-6 py-5" noValidate>
      <Field label="Name" htmlFor="dep-name" error={show(nameErr)}>
        <input id="dep-name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} className={cn(input, show(nameErr) && "border-burn/70")} aria-invalid={!!show(nameErr)} autoFocus />
      </Field>

      {kind === "static" ? (
        <Field label="Files">
          <Segmented
            value={source}
            onChange={setSource}
            options={[...(tplFiles.length ? [["template", "Template files"] as ["template", string]] : []), ["paste", "Paste HTML"], ["upload", "Upload files"]]}
            label="Static source"
          />
          {source === "template" ? (
            <ul className="mt-3 max-h-40 overflow-y-auto rounded-md border border-line bg-bg-2 p-3 font-mono text-[12px] text-muted-foreground">
              {tplFiles.map((f) => (
                <li key={f.path} className="flex justify-between gap-3">
                  <span className={cn("truncate", f.path === "index.html" && "text-ok")}>{f.path}</span>
                  <span className="shrink-0 tabular-nums text-faint">{bytes(f.size)}</span>
                </li>
              ))}
            </ul>
          ) : source === "paste" ? (
            <textarea
              aria-label="index.html"
              value={html}
              onChange={(e) => setHtml(e.target.value)}
              spellCheck={false}
              className="mt-3 h-64 w-full resize-y rounded-md border border-line-2 bg-bg-2 p-3 font-mono text-[12px] leading-[1.6] text-text"
            />
          ) : (
            <div className="mt-3 rounded-md border border-dashed border-line-2 bg-bg-2 p-4">
              <label className={cn(btn.ghost, "cursor-pointer focus-within:ring-2 focus-within:ring-ok focus-within:ring-offset-2 focus-within:ring-offset-bg")}>
                {reading ? <Loader2 className="animate-spin" /> : <FolderUp />}
                Choose folder
                <input
                  type="file"
                  multiple
                  className="sr-only"
                  onChange={(e) => pickFolder(e.target.files)}
                  {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
                />
              </label>
              {files && (
                <ul className="mt-3 max-h-40 overflow-y-auto font-mono text-[12px] text-muted-foreground">
                  {files.slice(0, 50).map((f) => (
                    <li key={f.path} className="flex justify-between gap-3">
                      <span className={cn("truncate", f.path === "index.html" && "text-ok")}>{f.path}</span>
                      <span className="shrink-0 tabular-nums text-faint">{bytes(f.size)}</span>
                    </li>
                  ))}
                  {files.length > 50 && <li className="text-faint">… {files.length - 50} more</li>}
                </ul>
              )}
            </div>
          )}
          <p className={cn("mt-1.5 font-mono text-[12px] tabular-nums", show(staticErr) || (staticErr && encSize > MAX_STATIC) ? "text-burn" : "text-faint")} aria-live="polite">
            {(touched || encSize > MAX_STATIC) && staticErr ? staticErr : `${staticFiles?.length ?? 0} file${staticFiles?.length === 1 ? "" : "s"} · ${bytes(rawSize)} · ${bytes(encSize)} of 2 MB encoded`}
          </p>
        </Field>
      ) : (
        <>
          <Field label="Image" htmlFor="dep-image" error={show(imageErr)}>
            <input id="dep-image" value={image} onChange={(e) => setImage(e.target.value)} placeholder="nginx:alpine" className={cn(input, "font-mono")} spellCheck={false} />
          </Field>
          <Field label="Ports" htmlFor="dep-ports" error={show(portsErr)} hint="Container ports, comma-separated. The first one becomes the endpoint.">
            <input id="dep-ports" value={ports} onChange={(e) => setPorts(e.target.value)} className={cn(input, "font-mono tabular-nums")} inputMode="numeric" />
          </Field>
          <Field label="Size">
            <div role="radiogroup" aria-label="Size" className="grid grid-cols-3 gap-1 rounded-md border border-line-2 bg-bg-2 p-1">
              {(Object.keys(SIZES) as Size[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={size === s}
                  onClick={() => setSize(s)}
                  className={cn("rounded-[5px] px-2 py-2 text-left transition-colors duration-150", size === s ? "bg-panel-2 ring-1 ring-line-2" : "hover:bg-panel")}
                >
                  <span className={cn("block font-mono text-[13px]", size === s ? "text-text" : "text-muted-foreground")}>{s}</span>
                  <span className="block font-mono text-[11px] tabular-nums text-faint">
                    {SIZES[s].cpu / 1000} vCPU · {mb(SIZES[s].memMb)} · {mb(SIZES[s].storageMb)}
                  </span>
                </button>
              ))}
            </div>
          </Field>
          <Field label="Environment" error={show(envErr)}>
            <div className="space-y-2">
              {env.map((r, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-2">
                  <input aria-label={`Variable ${i + 1} name`} value={r.key} placeholder="KEY" onChange={(e) => setEnv(env.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} className={cn(input, "h-9 font-mono text-[12px]")} spellCheck={false} />
                  <input aria-label={`Variable ${i + 1} value`} value={r.value} placeholder="value" type={r.secret ? "password" : "text"} autoComplete="off" onChange={(e) => setEnv(env.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} className={cn(input, "h-9 font-mono text-[12px]")} spellCheck={false} />
                  <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground" title="Encrypted in this browser to the assigned node's key">
                    <Switch checked={r.secret} onCheckedChange={(v) => setEnv(env.map((x, j) => (j === i ? { ...x, secret: v } : x)))} aria-label={`Variable ${i + 1} is secret`} />
                    <Lock className={cn("size-3.5", r.secret ? "text-ok" : "text-faint")} aria-hidden />
                  </label>
                  <button type="button" className={cn(btn.quiet, "w-8 px-0")} onClick={() => setEnv(env.filter((_, j) => j !== i))} aria-label={`Remove variable ${i + 1}`}>
                    <Trash2 />
                  </button>
                </div>
              ))}
              <button type="button" className={cn(btn.ghost, btn.sm)} onClick={() => setEnv([...env, { key: "", value: "", secret: false }])}>
                <Plus /> Add variable
              </button>
            </div>
            {env.some((r) => r.secret) && (
              <p className="mt-2 flex items-start gap-1.5 text-[12px] leading-4 text-faint">
                <KeyRound className="mt-px size-3.5 shrink-0 text-ok" aria-hidden />
                Secret values never leave this browser in plain text: once a node is assigned they are sealed to its key, and the orchestrator stores only ciphertext.
              </p>
            )}
          </Field>
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
        <div>
          <MonoLabel>Price estimate</MonoLabel>
          <div className="mt-1 font-mono text-[18px] tabular-nums text-text">≈ {cld(price)} <span className="text-[12px] text-faint">/ hour</span></div>
          <p className="mt-0.5 text-[12px] text-faint">First hour held from your balance · live price set by the orchestrator.</p>
        </div>
        <button type="submit" className={cn(btn.primary, "min-w-[140px]")} disabled={busy || reading || (touched && !!err)}>
          {busy ? <Loader2 className="animate-spin" /> : session ? <Rocket /> : <Wallet />}
          {busy ? "Deploying…" : session ? "Deploy" : "Sign in to deploy"}
        </button>
      </div>
      <p className="-mt-3 text-[12px] text-faint">The orchestrator places it on a capable node. Hosting is probed every minute, not proven.</p>
    </form>
  );
}

function Field({ label, htmlFor, hint, error, children }: { label: string; htmlFor?: string; hint?: string; error?: string | null | false; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-2 block font-mono text-[11px] uppercase tracking-[.08em] text-faint">{label}</label>
      {children}
      {error ? <p className="mt-1.5 text-[12px] text-burn" aria-live="polite">{error}</p> : hint ? <p className="mt-1.5 text-[12px] leading-4 text-faint">{hint}</p> : null}
    </div>
  );
}

function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: [T, string][]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line-2 bg-bg-2 p-0.5">
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)} className={cn("h-8 rounded-[5px] px-3 text-[13px] transition-colors duration-150", value === v ? "bg-panel-2 text-text ring-1 ring-line-2" : "text-muted-foreground hover:text-text")}>
          {l}
        </button>
      ))}
    </div>
  );
}
