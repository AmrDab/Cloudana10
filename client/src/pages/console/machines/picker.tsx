// Machines — rent one (docs/WORKSTATIONS.md §11): a size, your SSH key, how long, the trust tier. The orchestrator
// assigns a node with gVisor and encrypted volumes; you connect with `cloudana ssh <id>`.
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Coins, Loader2, Lock, Server, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { api, ApiError, cld } from "@/lib/cld";
import { cldAmount, hourlyUsd, ucldToUsd, usd, usdToCld, usePrices } from "@/lib/prices";
import { useNetwork } from "@/hooks/useNetwork";
import { btn, MonoLabel, Panel, PanelHeader, Updated } from "@/components/console/primitives";
import { isWorkstationTemplate, useSession, useTemplates, type TrustTier } from "@/components/console/data";
import { errText, signInWithToast } from "@/components/console/actions";
import { NumberField, Section, Segmented, SubLabel, dur } from "@/pages/console/workstations/spec-picker";
import { TrustPicker } from "@/pages/console/deploy/trust";
import { connectCommand, draftError, MACHINE_HOME, MACHINE_TEMPLATE_ID, machineSpec, ROOT_DISK_MB, SIZES, VOLUME_GB, type Size } from "./model";

const DURATIONS = [1, 6, 24, 72, 168, 720];
const input = "h-10 w-full rounded-md border border-line-2 bg-bg-2 px-3 text-sm text-text placeholder:text-faint";

/** The machine template's image, as the API lists it (it pins the published version). */
function useMachineImage(): string | null {
  const q = useTemplates();
  return useMemo(() => {
    for (const c of q.data ?? []) for (const t of c.templates ?? []) if (t.id === MACHINE_TEMPLATE_ID && isWorkstationTemplate(t)) return (t as { image?: string }).image ?? null;
    return null;
  }, [q.data]);
}

export function MachinePicker({ onDone }: { onDone: (id: string) => void }) {
  const session = useSession();
  const net = useNetwork();
  const qc = useQueryClient();
  const image = useMachineImage();
  const { prices, usdPerCld } = usePrices();
  const [name, setName] = useState("my-machine");
  const [size, setSize] = useState<Size>("S");
  const [hours, setHours] = useState(24);
  const [publicKey, setPublicKey] = useState("");
  const [volumeGb, setVolumeGb] = useState(20);
  const [keepDays, setKeepDays] = useState(3);
  const [trust, setTrust] = useState<TrustTier>("verified");
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  const err = !image ? "The machine image is not listed by the network API yet." : draftError({ name, publicKey, hours, volumeGb, keepDays, size });
  const price = hourlyUsd(prices, "workstation", { ...SIZES[size], storageMb: ROOT_DISK_MB }, { volumeGb });
  const keptAfter = volumeGb * prices.volumeUsdPerGbHour * 24 * keepDays;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!session) return void signInWithToast();
    if (err || !image) return;
    setBusy(true);
    try {
      const spec = machineSpec({ image, size, hours, publicKey, volumeGb, keepDays, trust });
      const r = await api<{ id: string; priceUcldPerHour: number }>("/deployments", {
        method: "POST",
        auth: true,
        body: { templateId: MACHINE_TEMPLATE_ID, name: name.trim(), kind: "workstation", spec },
      });
      toast.success("Machine queued", { description: `${name.trim()} · ${usd(ucldToUsd(r.priceUcldPerHour, usdPerCld))}/h · once it runs: ${connectCommand(r.id)}` });
      qc.invalidateQueries({ queryKey: ["cld", "deployments"] });
      qc.invalidateQueries({ queryKey: ["cld", "account"] });
      onDone(r.id);
    } catch (e) {
      toast.error("Couldn't rent the machine", { description: errText(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel id="rent-machine" className="mt-6 scroll-mt-6" aria-labelledby="rent-machine-h">
      <PanelHeader title={<span id="rent-machine-h">Rent a machine</span>} kicker="Ubuntu 24.04 · SSH" right={<Updated at={net.updatedAt} offline={net.offline} />} />
      <form onSubmit={submit} noValidate className="grid lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-7 p-5">
          <Section label="Size" hint="CPU only. For GPUs, rent a workstation.">
            <div role="radiogroup" aria-label="Size" className="grid grid-cols-3 gap-2 sm:max-w-md">
              {(Object.keys(SIZES) as Size[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={size === s}
                  onClick={() => setSize(s)}
                  className={cn("rounded-md border px-3 py-2 text-left transition-colors duration-150", size === s ? "border-ok/60 bg-panel-2" : "border-line-2 bg-bg-2 hover:bg-panel-2")}
                >
                  <div className={cn("font-mono text-[13px]", size === s ? "text-ok" : "text-text")}>{s}</div>
                  <div className="mt-0.5 font-mono text-[11px] leading-4 text-faint">{SIZES[s].cpu / 1000} vCPU · {SIZES[s].memMb / 1024} GB</div>
                </button>
              ))}
            </div>
          </Section>

          <Section label="SSH public key" hint="Keys only: no passwords. You log in as root of the box, inside a gVisor sandbox (cloudana is the unprivileged user, same key).">
            <SubLabel htmlFor="m-ssh">Paste the contents of ~/.ssh/id_ed25519.pub (or another public key)</SubLabel>
            <textarea
              id="m-ssh"
              value={publicKey}
              onChange={(e) => setPublicKey(e.target.value)}
              rows={3}
              spellCheck={false}
              placeholder="ssh-ed25519 AAAAC3Nza… you@laptop"
              className="w-full resize-y rounded-md border border-line-2 bg-bg-2 px-3 py-2 font-mono text-[12px] leading-5 text-text placeholder:text-faint"
            />
          </Section>

          <Section label="Duration" hint="It stops itself when the time runs out or your credits do. You can extend it while it runs.">
            <Segmented label="Duration" options={DURATIONS.map((h) => [h, dur(h)])} value={hours} onChange={setHours} mono />
          </Section>

          <Section label="Volume" hint={`Mounted at ${MACHINE_HOME} (your home), encrypted on the provider's disk with a key only the assigned node can open, erased when it is purged or its keep period ends. The rest of the disk (installed packages, /tmp) is not encrypted.`}>
            <div className="flex flex-wrap items-end gap-3">
              <span className="flex h-10 items-center gap-2 text-[14px] text-text"><Lock className="size-4 text-ok" aria-hidden /> Encrypted</span>
              <NumberField label="Size" unit="GB" min={VOLUME_GB.min} max={VOLUME_GB.max} value={volumeGb} onChange={setVolumeGb} />
              <NumberField label="Keep after stop" unit="days" min={0} max={30} value={keepDays} onChange={setKeepDays} />
            </div>
          </Section>

          <Section label="Trust">
            <div className="max-w-md"><TrustPicker value={trust} onChange={setTrust} /></div>
          </Section>

          <Section label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="my-machine" aria-label="Name" className={cn(input, "max-w-sm")} />
          </Section>
        </div>

        <aside className="border-t border-line bg-bg-2/50 p-5 lg:border-t-0 lg:border-l">
          <div className="space-y-5 lg:sticky lg:top-6">
            <div>
              <MonoLabel>Price per hour</MonoLabel>
              <div className="mt-2 font-mono text-[24px] leading-8 tabular-nums text-text">{usd(price)}</div>
              <div className="font-mono text-[13px] tabular-nums text-muted-foreground">≈ {cldAmount(usdToCld(price, usdPerCld))} at ${usdPerCld.toFixed(2)} per CLD</div>
              <p className="mt-1 font-mono text-[12px] text-faint">the CPU, memory and volume rates; estimate</p>
            </div>
            <div className="border-t border-line pt-4">
              <div className="flex items-baseline justify-between gap-3">
                <MonoLabel>Total for {dur(hours)}</MonoLabel>
                <span className="font-mono text-[15px] tabular-nums text-text">{usd(price * hours)}</span>
              </div>
              {keptAfter > 0 && <p className="mt-1.5 text-[12px] leading-4 text-faint">Plus up to {usd(keptAfter)} while the volume is kept {keepDays} {keepDays === 1 ? "day" : "days"} after it stops.</p>}
            </div>
            <BetaCredits />
            <div className="flex items-start gap-2.5">
              <Server className="mt-0.5 size-4 shrink-0 text-faint" aria-hidden />
              <p className="text-[13px] leading-5 text-muted-foreground">
                Runs in a gVisor sandbox on a node that encrypts volumes. Connect with <code className="font-mono text-[12px] text-text">cloudana ssh &lt;id&gt;</code> (the CLI in <code className="font-mono text-[12px]">cli/</code>): the provider's address is never shown.
              </p>
            </div>
            <div>
              <button type="submit" className={cn(btn.primary, "w-full")} disabled={busy || (touched && !!err && !!session)}>
                {busy ? <Loader2 className="animate-spin" /> : session ? <Server /> : <Wallet />}
                {busy ? "Requesting…" : session ? "Rent machine" : "Sign in to rent"}
              </button>
              {session && err && touched && <p className="mt-2 text-[12px] leading-4 text-burn" aria-live="polite">{err}</p>}
            </div>
          </div>
        </aside>
      </form>
    </Panel>
  );
}

/** Beta: machines are paid from the balance, which test credits fill for free (POST /dev/credits, as on Compute). */
function BetaCredits() {
  const session = useSession();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  async function credits() {
    setBusy(true);
    try {
      const r = await api<{ balanceUcld: number }>("/dev/credits", { method: "POST", auth: true });
      toast.success("+10 CLD free beta credits", { description: `Balance ${cld(r.balanceUcld)}` });
      qc.invalidateQueries({ queryKey: ["cld", "account"] });
    } catch (e) {
      toast.error("No beta credits", { description: e instanceof ApiError && e.status === 404 ? "Free credits are not offered on this network." : errText(e) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="rounded-md border border-line bg-panel px-3 py-2.5">
      <p className="text-[13px] leading-5 text-muted-foreground"><b className="font-medium text-text">Free beta credits.</b> Machines are billed by the hour from your balance; during the beta you can top it up for free.</p>
      {session && (
        <button type="button" className={cn(btn.ghost, btn.sm, "mt-2")} onClick={credits} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Coins />} Get free credits
        </button>
      )}
    </div>
  );
}
