// New endpoint (docs/V4_ENDPOINTS_CONTRACT.md): the user's own image, one port, a health path, GPUs per replica,
// 1–8 replicas, key or public. Prices are dollars, paid in CLD at the quoted rate (lib/prices.ts).
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BrainCircuit, Loader2, Plus, Wallet, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/cld";
import { cldAmount, GPU_TIER_HINT, GPU_TIER_LABEL, GPU_TIERS, hourlyUsd, usd, usdToCld, usePrices, type GpuTier } from "@/lib/prices";
import { btn, MonoLabel, Panel, PanelHeader, Pill, Updated } from "@/components/console/primitives";
import { useSession } from "@/components/console/data";
import { errText, signInWithToast } from "@/components/console/actions";
import { useNetwork } from "@/hooks/useNetwork";
import { savePendingSecrets } from "@/pages/console/deploy/model";
import { NumberField, Section, Segmented, SubLabel } from "@/pages/console/workstations/spec-picker";

const IMAGE = /^[a-zA-Z0-9][a-zA-Z0-9._\-/:@]*$/;
const HEALTH = /^\/[A-Za-z0-9._~/?=&%-]*$/;
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const GPU_COUNTS = [0, 1, 2, 4, 8];
const VRAM = [0, 16, 24, 40, 80];
const CPUS = [1, 2, 4, 8, 16];
const RAM_GB = [4, 8, 16, 32, 64, 128];
const DISK_GB = [20, 50, 100, 200, 500];
const REPLICAS = [1, 2, 3, 4, 8];
const GRACE_MIN = [2, 5, 10, 20, 30];
const input = "h-10 w-full rounded-md border border-line-2 bg-bg-2 px-3 text-sm text-text placeholder:text-faint";

/** "--model X --max-model-len 8192" → argv, honouring "double" and 'single' quotes. */
function argv(s: string): string[] {
  return [...s.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

export function NewEndpoint({ onDone }: { onDone: (id: string) => void }) {
  const session = useSession();
  const net = useNetwork();
  const { prices, usdPerCld } = usePrices();
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [image, setImage] = useState("vllm/vllm-openai:v0.6.3");
  const [command, setCommand] = useState("--model Qwen/Qwen2.5-7B-Instruct --max-model-len 8192");
  const [port, setPort] = useState(8000);
  const [health, setHealth] = useState("/health");
  const [grace, setGrace] = useState(10);
  const [gpuCount, setGpuCount] = useState(1);
  const [vram, setVram] = useState(16);
  const [tier, setTier] = useState<GpuTier>("standard");
  const [cpus, setCpus] = useState(4);
  const [ramGb, setRamGb] = useState(16);
  const [diskGb, setDiskGb] = useState(50);
  const [replicas, setReplicas] = useState(2);
  const [auth, setAuth] = useState<"key" | "public">("key");
  const [env, setEnv] = useState<[string, string][]>([["HF_TOKEN", ""]]);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  const resources = { cpu: cpus * 1000, memMb: ramGb * 1024, storageMb: diskGb * 1024 };
  const perReplica = hourlyUsd(prices, "endpoint", resources, { gpuCount, tier });
  const total = perReplica * replicas;
  const envRows = env.filter(([k, v]) => k.trim() || v);
  const badEnv = envRows.find(([k]) => !ENV_KEY.test(k.trim()));

  const err =
    !name.trim() ? "Name is required."
    : name.trim().length > 80 ? "Name: 80 characters at most."
    : !IMAGE.test(image.trim()) ? "Image must be a Docker image reference, e.g. vllm/vllm-openai:v0.6.3."
    : !(port >= 1 && port <= 65535) ? "Port is 1–65535."
    : !HEALTH.test(health.trim()) ? "Health path starts with / and is a plain path, e.g. /health."
    : badEnv ? `Environment key "${badEnv[0]}" must be letters, digits and _ (not starting with a digit).`
    : null;

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setTouched(true);
    if (!session) return void signInWithToast();
    if (err) return;
    setBusy(true);
    const spec = {
      image: image.trim(),
      ...(command.trim() ? { command: argv(command.trim()) } : {}),
      // Environment values are secrets: they never go to the API in the clear. Each replica's are sealed in this
      // browser to its node's key once it is assigned (Sealer in list.tsx); the start waits for them.
      ...(envRows.length ? { expectsSecrets: true } : {}),
      port,
      ...resources,
      ...(gpuCount ? { gpu: { count: gpuCount, ...(vram ? { minVramGb: vram } : {}), class: tier } } : {}),
      health: { path: health.trim(), startupGraceSec: grace * 60 },
      replicas,
      auth,
    };
    try {
      const r = await api<{ id: string; priceUcldPerHour: number; priceUsdPerHour?: number }>("/deployments", {
        method: "POST",
        auth: true,
        body: { name: name.trim(), kind: "endpoint", spec },
      });
      if (envRows.length) savePendingSecrets(r.id, Object.fromEntries(envRows.map(([k, v]) => [k.trim(), v])));
      toast.success("Endpoint queued", {
        description: `${name.trim()} · ${usd(r.priceUsdPerHour ?? total)}/h for ${replicas} ${replicas === 1 ? "replica" : "replicas"} · ${auth === "key" ? "create a key once it runs" : "public"}${envRows.length ? " · keep this tab open: the environment seals to each replica's node" : ""}`,
      });
      qc.invalidateQueries({ queryKey: ["cld", "deployments"] });
      setName("");
      setTouched(false);
      onDone(r.id);
    } catch (e) {
      toast.error("Couldn't create the endpoint", { description: errText(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel id="new-endpoint" className="mt-6 scroll-mt-6" aria-labelledby="ne-h">
      <PanelHeader title={<span id="ne-h">Serve your model</span>} kicker="New endpoint" right={<Updated at={net.updatedAt} offline={net.offline} />} />
      <form onSubmit={submit} noValidate className="grid lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-7 p-5">
          <Section label="Image" hint="Any image the node can pull: your own server, vLLM, Ollama, TGI. Cloudana runs it; it never picks or hosts a model for you.">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div>
                <SubLabel htmlFor="ep-name">Name</SubLabel>
                <input id="ep-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="qwen-chat" className={input} />
              </div>
              <div>
                <SubLabel htmlFor="ep-image">Image</SubLabel>
                <input id="ep-image" value={image} onChange={(e) => setImage(e.target.value)} spellCheck={false} className={cn(input, "font-mono text-[13px]")} />
              </div>
            </div>
            <div className="mt-3">
              <SubLabel htmlFor="ep-cmd">Command (optional)</SubLabel>
              <input id="ep-cmd" value={command} onChange={(e) => setCommand(e.target.value)} spellCheck={false} placeholder="arguments after the image" className={cn(input, "font-mono text-[13px]")} />
            </div>
          </Section>

          <Section label="Serving" hint={`It counts as running only once GET ${health || "/"} answers; until then nothing is billed.`}>
            <div className="flex flex-wrap items-end gap-3">
              <NumberField label="Port" unit="tcp" min={1} max={65535} value={port} onChange={setPort} />
              <label className="block">
                <span className="mb-1.5 block text-[12px] text-muted-foreground">Health path</span>
                <input value={health} onChange={(e) => setHealth(e.target.value)} spellCheck={false} aria-label="Health path" className={cn(input, "w-[160px] font-mono text-[13px]")} />
              </label>
              <div>
                <SubLabel>Startup grace</SubLabel>
                <Segmented label="Startup grace" options={GRACE_MIN.map((m) => [m, `${m} min`])} value={grace} onChange={setGrace} mono />
              </div>
            </div>
          </Section>

          <Section label="GPUs per replica" hint={gpuCount === 0 ? "0 GPUs serves from CPU." : GPU_TIER_HINT[tier]}>
            <Segmented label="GPU count" options={GPU_COUNTS.map((n) => [n, String(n)])} value={gpuCount} onChange={setGpuCount} mono />
            <div className={cn("mt-3 grid gap-3 sm:grid-cols-2", gpuCount === 0 && "pointer-events-none opacity-45")} aria-disabled={gpuCount === 0}>
              <div>
                <SubLabel>Tier</SubLabel>
                <Segmented label="GPU tier" options={GPU_TIERS.map((t) => [t, `${GPU_TIER_LABEL[t]} · ${usd(prices.gpuUsdPerHour[t])}`])} value={tier} onChange={setTier} />
              </div>
              <div>
                <SubLabel>vRAM per GPU</SubLabel>
                <Segmented label="Minimum vRAM" options={VRAM.map((v) => [v, v ? `≥${v}` : "any"])} value={vram} onChange={setVram} mono />
              </div>
            </div>
          </Section>

          <Section label="Machine per replica">
            <div className="grid gap-3 sm:grid-cols-3">
              <div><SubLabel>vCPU</SubLabel><Segmented label="vCPU" options={CPUS.map((c) => [c, String(c)])} value={cpus} onChange={setCpus} mono /></div>
              <div><SubLabel>RAM (GB)</SubLabel><Segmented label="RAM" options={RAM_GB.map((g) => [g, String(g)])} value={ramGb} onChange={setRamGb} mono /></div>
              <div><SubLabel>Disk (GB)</SubLabel><Segmented label="Disk" options={DISK_GB.map((g) => [g, String(g)])} value={diskGb} onChange={setDiskGb} mono /></div>
            </div>
          </Section>

          <Section label="Replicas and access" hint="Replicas run on different nodes; requests are spread across them, and one that fails its health checks is replaced.">
            <div className="flex flex-wrap gap-6">
              <div><SubLabel>Replicas</SubLabel><Segmented label="Replicas" options={REPLICAS.map((n) => [n, String(n)])} value={replicas} onChange={setReplicas} mono /></div>
              <div>
                <SubLabel>Who may call it</SubLabel>
                <Segmented label="Who may call it" options={[["key", "Key"], ["public", "Public"]]} value={auth} onChange={setAuth} />
              </div>
            </div>
          </Section>

          <Section label="Environment" hint="Variables for your container, such as a model name or a Hugging Face token. They are encrypted in this browser to each replica's node once it is assigned — the API never sees the values — so keep this tab open until the replicas start. The provider's node can read them.">
            <div className="space-y-2">
              {env.map(([k, v], i) => (
                <div key={i} className="flex gap-2">
                  <input value={k} onChange={(e) => setEnv(env.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))} placeholder="KEY" spellCheck={false} aria-label={`Variable ${i + 1} name`} className={cn(input, "w-[38%] font-mono text-[13px]")} />
                  <input value={v} onChange={(e) => setEnv(env.map((r, j) => (j === i ? [r[0], e.target.value] : r)))} placeholder="value" spellCheck={false} aria-label={`Variable ${i + 1} value`} type="password" autoComplete="off" className={cn(input, "min-w-0 flex-1 font-mono text-[13px]")} />
                  <button type="button" className={cn(btn.quiet, "h-10 w-10 px-0")} onClick={() => setEnv(env.filter((_, j) => j !== i))} aria-label={`Remove variable ${i + 1}`}><X /></button>
                </div>
              ))}
              <button type="button" className={cn(btn.quiet, btn.sm)} onClick={() => setEnv([...env, ["", ""]])}><Plus /> Add variable</button>
            </div>
            <p className="mt-3 rounded-md border border-work/30 bg-work/[.06] px-3 py-2 text-[12px] leading-5 text-muted-foreground">
              Your container runs on a provider's machine; the provider can see what it processes. Don't send data you couldn't share with them.
            </p>
          </Section>
        </div>

        <aside className="border-t border-line bg-bg-2/50 p-5 lg:border-t-0 lg:border-l">
          <div className="space-y-5 lg:sticky lg:top-6">
            <div>
              <MonoLabel>Price per hour</MonoLabel>
              <div className="mt-2 font-mono text-[24px] leading-8 tabular-nums text-text">{usd(total)}</div>
              <div className="font-mono text-[13px] tabular-nums text-muted-foreground">≈ {cldAmount(usdToCld(total, usdPerCld))} at ${usdPerCld.toFixed(2)} per CLD</div>
              <p className="mt-2 font-mono text-[12px] leading-5 text-faint">
                {replicas} × {usd(perReplica)} per replica
                {gpuCount ? <><br />GPU {gpuCount} × {usd(prices.gpuUsdPerHour[tier])} + machine {usd(perReplica - gpuCount * prices.gpuUsdPerHour[tier])}</> : null}
              </p>
            </div>
            <div className="border-t border-line pt-4">
              <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
                <dt className="text-faint">Address</dt><dd className="font-mono text-[12px] text-text">https://&lt;id&gt;.&lt;content domain&gt;</dd>
                <dt className="text-faint">Health checks</dt><dd className="text-muted-foreground">every minute, through the relay</dd>
                <dt className="text-faint">Failed replica</dt><dd className="text-muted-foreground">replaced on another node</dd>
                <dt className="text-faint">Label</dt><dd><Pill tone="work">probed</Pill></dd>
              </dl>
              <p className="mt-3 text-[12px] leading-4 text-faint">Prices are in US dollars; you pay in CLD at the rate on your quote. The first hour of every replica is held from your balance.</p>
            </div>
            <div>
              <button type="submit" className={cn(btn.primary, "w-full")} disabled={busy || (touched && !!err && !!session)}>
                {busy ? <Loader2 className="animate-spin" /> : session ? <BrainCircuit /> : <Wallet />}
                {busy ? "Creating…" : session ? "Create endpoint" : "Sign in to create"}
              </button>
              {session && err && touched && <p className="mt-2 text-[12px] leading-4 text-burn" aria-live="polite">{err}</p>}
            </div>
          </div>
        </aside>
      </form>
    </Panel>
  );
}
