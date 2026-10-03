// Workstations — spec picker (docs/WORKSTATIONS.md §7). The user describes a machine; the orchestrator assigns a node.
import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Gpu, Loader2, MonitorPlay, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { api, cld, int } from "@/lib/cld";
import { useNetwork } from "@/hooks/useNetwork";
import { Switch } from "@/components/ui/switch";
import { btn, MonoLabel, Panel, PanelHeader, Updated } from "@/components/console/primitives";
import {
  useSession, type GpuClass, type WorkstationCapacity, type WorkstationSpec, type WorkstationTemplate, type WorkstationTier,
} from "@/components/console/data";
import { errText, signInWithToast } from "@/components/console/actions";
import { EnvironmentCards, hasSsh, hasWeb } from "./templates";

// ── Options ─────────────────────────────────────────────────────────────────
const GPU_COUNTS = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const VRAM = [0, 8, 16, 24, 48, 80];
const CLASSES: GpuClass[] = ["any", "consumer", "datacenter"];
export const PRESETS = {
  S: { cpu: 2000, memMb: 4 * 1024, storageMb: 20 * 1024 },
  M: { cpu: 4000, memMb: 16 * 1024, storageMb: 50 * 1024 },
  L: { cpu: 8000, memMb: 32 * 1024, storageMb: 100 * 1024 },
  XL: { cpu: 16000, memMb: 64 * 1024, storageMb: 200 * 1024 },
} as const;
type Preset = keyof typeof PRESETS;
const DURATIONS = [1, 6, 24, 72, 168, 720];
export const dur = (h: number) => (h < 24 ? `${+h.toFixed(1)} h` : `${+(h / 24).toFixed(1)} d`);

// ── Price (§2 contract defaults; the live values are protocol-set) ───────────
const PRICE = { consumer: 2000, datacenter: 6000, cpu: 200, memGb: 100, storageGb: 20, volumeGbHour: 2, min: 50, interruptible: 0.5 };
type Draft = { preset: Preset; gpuCount: number; gpuClass: GpuClass; tier: WorkstationTier; volumeGb: number | null };

/** µCLD per hour as [low, high]: class "any" may land on a consumer or a datacenter GPU. */
function hourly(d: Draft): [number, number] {
  const r = PRESETS[d.preset];
  const machine = (r.cpu / 1000) * PRICE.cpu + (r.memMb / 1024) * PRICE.memGb + (r.storageMb / 1024) * PRICE.storageGb;
  const at = (gpuRate: number) => {
    const run = (machine + d.gpuCount * gpuRate) * (d.tier === "interruptible" ? 1 - PRICE.interruptible : 1);
    return Math.max(PRICE.min, Math.ceil(run + (d.volumeGb ?? 0) * PRICE.volumeGbHour));
  };
  const lo = d.gpuClass === "datacenter" ? PRICE.datacenter : PRICE.consumer;
  const hi = d.gpuClass === "consumer" ? PRICE.consumer : PRICE.datacenter;
  return d.gpuCount ? [at(lo), at(hi)] : [at(0), at(0)];
}
const range = ([lo, hi]: [number, number]) => (lo === hi ? cld(lo) : `${cld(lo)} – ${cld(hi)}`);

const SSH_KEY = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)) [A-Za-z0-9+/]+={0,3}( [^\r\n]*)?$/;
const input = "h-10 w-full rounded-md border border-line-2 bg-bg-2 px-3 text-sm text-text placeholder:text-faint";

export function SpecPicker({ onDone }: { onDone: (id: string) => void }) {
  const session = useSession();
  const net = useNetwork();
  const qc = useQueryClient();

  const [tpl, setTpl] = useState<WorkstationTemplate | null>(null);
  const [name, setName] = useState("");
  const [gpuCount, setGpuCount] = useState(1);
  const [vram, setVram] = useState(0);
  const [gpuClass, setGpuClass] = useState<GpuClass>("any");
  const [preset, setPreset] = useState<Preset>("M");
  const [hours, setHours] = useState(6);
  const [tier, setTier] = useState<WorkstationTier>("on-demand");
  const [web, setWeb] = useState(true);
  const [sshKey, setSshKey] = useState("");
  const [volumeOn, setVolumeOn] = useState(true);
  const [volumeGb, setVolumeGb] = useState(20);
  const [keepDays, setKeepDays] = useState(3);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  function pickTemplate(t: WorkstationTemplate) {
    setTpl(t);
    if (!name || name === tpl?.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")) setName(t.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40));
    if (t.gpu) setGpuCount(t.gpu.count);
    if (t.gpu?.minVramGb != null) setVram(VRAM.includes(t.gpu.minVramGb) ? t.gpu.minVramGb : 0);
    setWeb(hasWeb(t));
  }

  // ── Validation ──
  const key = sshKey.trim();
  const sshOk = hasSsh(tpl);
  const webOn = web && hasWeb(tpl);
  const keyErr = key && !SSH_KEY.test(key) ? "A public key starts with ssh-ed25519, ssh-rsa or ecdsa-sha2-… followed by the key." : null;
  const err =
    !tpl ? "Pick an environment."
    : !name.trim() ? "Name is required."
    : name.trim().length > 40 ? "Name: 40 characters at most."
    : keyErr ? keyErr
    : !webOn && !(sshOk && key) ? (sshOk ? "Turn on web access or paste an SSH public key." : "Turn on web access — this environment has no SSH server.")
    : !Number.isFinite(hours) || hours < 1 || hours > 720 ? "Duration is 1 hour to 30 days."
    : volumeOn && (volumeGb < 1 || volumeGb > 500) ? "Volume is 1–500 GB."
    : volumeOn && (keepDays < 0 || keepDays > 30) ? "Keep the volume 0–30 days."
    : null;

  const draft: Draft = { preset, gpuCount, gpuClass, tier, volumeGb: volumeOn ? volumeGb : null };
  const price = hourly(draft);
  const other = hourly({ ...draft, tier: tier === "on-demand" ? "interruptible" : "on-demand" });
  const [onDemand, interruptible] = tier === "on-demand" ? [price, other] : [other, price];
  const keptAfter = volumeOn ? volumeGb * PRICE.volumeGbHour * 24 * keepDays : 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!session) return void signInWithToast();
    if (err || !tpl) return;
    setBusy(true);
    const sshPort = typeof tpl.access?.ssh === "object" && tpl.access.ssh.port ? tpl.access.ssh.port : tpl.sshPort ?? 22;
    const useSsh = sshOk && !!key;
    const spec: WorkstationSpec = {
      image: tpl.image ?? "",
      ...(tpl.command?.length ? { command: tpl.command } : {}),
      ...(tpl.env && Object.keys(tpl.env).length ? { env: tpl.env } : {}),
      ports: [...(webOn ? [{ container: tpl.access!.web!.port, protocol: "tcp" as const }] : []), ...(useSsh ? [{ container: sshPort, protocol: "tcp" as const }] : [])],
      ...PRESETS[preset],
      gpu: gpuCount ? { count: gpuCount, ...(vram ? { minVramGb: vram } : {}), class: gpuClass } : { count: 0 },
      tier,
      maxHours: Math.round(hours),
      access: { ...(webOn ? { web: tpl.access!.web! } : {}), ...(useSsh ? { ssh: { publicKey: key } } : {}) },
      ...(volumeOn ? { volume: { sizeGb: volumeGb, keepDays } } : {}),
    };
    try {
      const r = await api<{ id: string; priceUcldPerHour: number; deploymentStatus: string }>("/deployments", {
        method: "POST",
        auth: true,
        body: { templateId: tpl.id, name: name.trim(), kind: "workstation", spec },
      });
      toast.success("Workstation queued", { description: `${name.trim()} · ${cld(r.priceUcldPerHour)} / h · the orchestrator assigns a node that fits` });
      qc.invalidateQueries({ queryKey: ["cld", "deployments"] });
      qc.invalidateQueries({ queryKey: ["cld", "account"] });
      onDone(r.id);
    } catch (e) {
      toast.error("Couldn't rent the workstation", { description: errText(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel id="rent" className="mt-6 scroll-mt-6" aria-labelledby="rent-h">
      <PanelHeader title={<span id="rent-h">Rent a workstation</span>} kicker="Describe it" right={<Updated at={net.updatedAt} offline={net.offline} />} />
      <form onSubmit={submit} noValidate className="grid lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-7 p-5">
          <Section label="Environment">
            <EnvironmentCards value={tpl?.id ?? null} onChange={pickTemplate} />
          </Section>

          <Section label="GPUs" hint={gpuCount === 0 ? "0 GPUs is a CPU workstation." : undefined}>
            <Segmented label="GPU count" options={GPU_COUNTS.map((n) => [n, String(n)])} value={gpuCount} onChange={setGpuCount} mono />
            <div className={cn("mt-3 grid gap-3 sm:grid-cols-2", gpuCount === 0 && "pointer-events-none opacity-45")} aria-disabled={gpuCount === 0}>
              <div>
                <SubLabel>vRAM per GPU</SubLabel>
                <Segmented label="Minimum vRAM" options={VRAM.map((v) => [v, v ? `≥${v}` : "any"])} value={vram} onChange={setVram} mono />
              </div>
              <div>
                <SubLabel>Class</SubLabel>
                <Segmented label="GPU class" options={CLASSES.map((c) => [c, c])} value={gpuClass} onChange={setGpuClass} />
              </div>
            </div>
          </Section>

          <Section label="Machine">
            <div role="radiogroup" aria-label="CPU, memory and disk" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(Object.keys(PRESETS) as Preset[]).map((p) => {
                const r = PRESETS[p];
                return (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={preset === p}
                    onClick={() => setPreset(p)}
                    className={cn(
                      "rounded-md border px-3 py-2 text-left transition-colors duration-150",
                      preset === p ? "border-ok/60 bg-panel-2" : "border-line-2 bg-bg-2 hover:bg-panel-2",
                    )}
                  >
                    <div className={cn("font-mono text-[13px]", preset === p ? "text-ok" : "text-text")}>{p}</div>
                    <div className="mt-0.5 font-mono text-[11px] leading-4 text-faint">
                      {r.cpu / 1000} vCPU · {r.memMb / 1024} GB<br />{r.storageMb / 1024} GB disk
                    </div>
                  </button>
                );
              })}
            </div>
          </Section>

          <Section label="Duration" hint="It stops itself when the time runs out or your credits do. You can extend it while it runs.">
            <div className="flex flex-wrap items-center gap-2">
              <Segmented label="Duration" options={DURATIONS.map((h) => [h, dur(h)])} value={hours} onChange={setHours} mono />
              <div className="relative w-[120px]">
                <input
                  type="number"
                  min={1}
                  max={720}
                  value={hours}
                  onChange={(e) => setHours(Math.min(720, Math.max(0, Number(e.target.value))))}
                  aria-label="Duration in hours"
                  className={cn(input, "h-9 pr-8 font-mono tabular-nums")}
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-mono text-[12px] text-faint">h</span>
              </div>
            </div>
          </Section>

          <Section label="Tier">
            <div role="radiogroup" aria-label="Tier" className="grid gap-2 sm:grid-cols-2">
              {([
                ["on-demand", "On-demand", "Runs until you stop it or the time runs out.", onDemand],
                ["interruptible", "Interruptible", "Half price. May be preempted by on-demand work; the volume is kept.", interruptible],
              ] as const).map(([id, label, line, p]) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={tier === id}
                  onClick={() => setTier(id)}
                  className={cn(
                    "rounded-md border p-3 text-left transition-colors duration-150",
                    tier === id ? "border-ok/60 bg-panel-2" : "border-line-2 bg-bg-2 hover:bg-panel-2",
                  )}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={cn("text-[14px] font-medium", tier === id ? "text-ok" : "text-text")}>{label}</span>
                    <span className="font-mono text-[12px] tabular-nums text-muted-foreground">{range(p)}/h</span>
                  </div>
                  <p className="mt-1 text-[12px] leading-4 text-faint">{line}</p>
                </button>
              ))}
            </div>
            <p className="mt-2 font-mono text-[12px] text-faint" aria-live="polite">
              interruptible saves {range([onDemand[0] - interruptible[0], onDemand[1] - interruptible[1]])} per hour
            </p>
          </Section>

          <Section label="Access">
            <div className="space-y-3">
              <label className={cn("flex items-center justify-between gap-3 rounded-md border border-line-2 bg-bg-2 px-3 py-2.5", !hasWeb(tpl) && "opacity-45")}>
                <span>
                  <span className="block text-[14px] text-text">Web</span>
                  <span className="block text-[12px] text-faint">
                    {!tpl ? "From the environment." : hasWeb(tpl) ? `Port ${tpl.access!.web!.port}${tpl.tokenEnv ? " · opens with a one-click token" : ""}` : "This environment has no web interface."}
                  </span>
                </span>
                <Switch checked={webOn} onCheckedChange={setWeb} disabled={!hasWeb(tpl)} aria-label="Web access" />
              </label>
              <div className={cn(!sshOk && tpl && "opacity-45")}>
                <SubLabel htmlFor="ws-ssh">SSH public key (optional)</SubLabel>
                <textarea
                  id="ws-ssh"
                  value={sshKey}
                  onChange={(e) => setSshKey(e.target.value)}
                  disabled={!!tpl && !sshOk}
                  rows={3}
                  spellCheck={false}
                  placeholder="ssh-ed25519 AAAAC3Nza… you@laptop"
                  aria-invalid={!!keyErr}
                  className={cn("w-full resize-y rounded-md border bg-bg-2 px-3 py-2 font-mono text-[12px] leading-5 text-text placeholder:text-faint", keyErr ? "border-burn/70" : "border-line-2")}
                />
                <p className={cn("mt-1 text-[12px] leading-4", keyErr ? "text-burn" : "text-faint")}>
                  {keyErr ?? (tpl && !sshOk ? "This environment has no SSH server — web access only." : "Public keys only. It is passed to the container as plain config.")}
                </p>
              </div>
            </div>
          </Section>

          <Section label="Volume" hint={volumeOn ? `Mounted at ${tpl?.workdir ?? "/workspace"}. Kept on the same node after a stop so you can resume there.` : "Without a volume, files are gone when it stops."}>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex h-10 items-center gap-2 text-[14px] text-text">
                <Switch checked={volumeOn} onCheckedChange={setVolumeOn} aria-label="Keep a volume" /> Keep a volume
              </label>
              <NumberField label="Size" unit="GB" min={1} max={500} value={volumeGb} onChange={setVolumeGb} disabled={!volumeOn} />
              <NumberField label="Keep after stop" unit="days" min={0} max={30} value={keepDays} onChange={setKeepDays} disabled={!volumeOn} />
            </div>
          </Section>

          <Section label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="my-workstation" aria-label="Name" className={cn(input, "max-w-sm")} />
          </Section>
        </div>

        {/* Summary — sticky beside the form on desktop, after it on mobile. */}
        <aside className="border-t border-line bg-bg-2/50 p-5 lg:border-t-0 lg:border-l">
          <div className="space-y-5 lg:sticky lg:top-6">
            <div>
              <MonoLabel>Price per hour</MonoLabel>
              <div className={cn("mt-2 font-mono leading-8 tabular-nums text-text", price[0] === price[1] ? "text-[24px]" : "text-[18px]")}>{range(price)}</div>
              <p className="mt-1 font-mono text-[12px] text-faint">estimate; the orchestrator sets the live price</p>
            </div>
            <div className="border-t border-line pt-4">
              <div className="flex items-baseline justify-between gap-3">
                <MonoLabel>Total for {dur(hours || 0)}</MonoLabel>
                <span className="font-mono text-[15px] tabular-nums text-text">{range([price[0] * (hours || 0), price[1] * (hours || 0)])}</span>
              </div>
              {keptAfter > 0 && (
                <p className="mt-1.5 text-[12px] leading-4 text-faint">
                  Plus up to {cld(keptAfter)} while the {volumeGb} GB volume is kept {keepDays} {keepDays === 1 ? "day" : "days"} after it stops.
                </p>
              )}
              <p className="mt-1.5 text-[12px] leading-4 text-faint">Billed by the hour for time used; the first hour is held from your balance.</p>
            </div>
            <Capacity gpuCount={gpuCount} />
            <p className="rounded-md border border-line bg-panel px-3 py-2.5 text-[13px] leading-5 text-muted-foreground">
              The orchestrator assigns a node that fits. You never pick one.
            </p>
            <div>
              <button type="submit" className={cn(btn.primary, "w-full")} disabled={busy || (touched && !!err && !!session)}>
                {busy ? <Loader2 className="animate-spin" /> : session ? <MonitorPlay /> : <Wallet />}
                {busy ? "Requesting…" : session ? "Rent workstation" : "Sign in to rent"}
              </button>
              {session && err && (touched || tpl) && <p className="mt-2 text-[12px] leading-4 text-burn" aria-live="polite">{err}</p>}
            </div>
          </div>
        </aside>
      </form>
    </Panel>
  );
}

function Capacity({ gpuCount }: { gpuCount: number }) {
  const net = useNetwork();
  const cap = net.data as (typeof net.data & WorkstationCapacity) | null;
  const gpus = cap?.gpusOnline;
  let text: ReactNode;
  let tone = "text-muted-foreground";
  if (!cap) text = net.offline ? "— · capacity unknown while the API is offline" : "reading capacity…";
  else if (gpuCount === 0) text = `${int(cap.nodesOnline)} ${cap.nodesOnline === 1 ? "node" : "nodes"} online now`;
  else if (gpus == null) text = "— · GPU capacity appears when the network API reports it";
  else if (gpus === 0) {
    text = "Your workstation will wait for a GPU node — none online right now.";
    tone = "text-work";
  } else text = `${int(gpus)} ${gpus === 1 ? "GPU" : "GPUs"} online now`;
  return (
    <div className="flex items-start gap-2.5">
      <Gpu className="mt-0.5 size-4 shrink-0 text-faint" aria-hidden />
      <p className={cn("text-[13px] leading-5", tone)} aria-live="polite">{text}</p>
    </div>
  );
}

// ── Small form parts ────────────────────────────────────────────────────────
function Section({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2.5 font-mono text-[11px] uppercase tracking-[.08em] text-faint">{label}</legend>
      {children}
      {hint && <p className="mt-2 text-[12px] leading-4 text-faint">{hint}</p>}
    </fieldset>
  );
}

function SubLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return <label htmlFor={htmlFor} className="mb-1.5 block text-[12px] text-muted-foreground">{children}</label>;
}

function Segmented<T extends string | number>({ label, options, value, onChange, mono }: { label: string; options: [T, string][]; value: T; onChange: (v: T) => void; mono?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex max-w-full flex-wrap gap-1 rounded-md border border-line-2 bg-bg-2 p-1">
      {options.map(([v, text]) => (
        <button
          key={String(v)}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "h-8 min-w-9 rounded-[5px] px-2.5 text-[13px] transition-colors duration-150",
            mono && "font-mono tabular-nums",
            value === v ? "bg-panel-2 text-text ring-1 ring-line-2" : "text-muted-foreground hover:text-text",
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function NumberField({ label, unit, min, max, value, onChange, disabled }: { label: string; unit: string; min: number; max: number; value: number; onChange: (n: number) => void; disabled?: boolean }) {
  return (
    <label className={cn("block", disabled && "opacity-45")}>
      <span className="mb-1.5 block text-[12px] text-muted-foreground">{label}</span>
      <span className="relative block w-[130px]">
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Math.round(Number(e.target.value)))}
          className={cn(input, "pr-12 font-mono tabular-nums")}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-mono text-[12px] text-faint">{unit}</span>
      </span>
    </label>
  );
}
