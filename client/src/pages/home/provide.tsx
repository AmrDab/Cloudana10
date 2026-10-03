// Providers — home and datacenter: both scales, one rule, zero stake (brief §2.6).
import { lazy, Suspense } from "react";
import { ArrowRight } from "lucide-react";
import { useNetwork } from "@/hooks/useNetwork";
import { CopyButton } from "@/components/cld/copy-button";
import { StatusChip } from "@/components/cld/status-chip";
import { btn } from "@/components/cld/cta";
import { openWaitlist } from "@/components/waitlist";
import { Reveal, Section } from "./parts";

const Globe = lazy(() => import("@/components/magicui/globe").then((m) => ({ default: m.Globe })));

// TODO(owner): replace with real node regions once nodes report coarse location.
const TESTNET_REGIONS = [
  { location: [50.11, 8.68] as [number, number], size: 0.03 },
  { location: [37.77, -122.42] as [number, number], size: 0.03 },
];

// TODO(owner): swap for the one-line installer once it ships. Same command as the console until then.
const INSTALL = "git clone https://github.com/AmrDab/Cloudana10 && cd Cloudana10/node-agent && npm i && npm start";

const FLEET_YAML = `kind: DaemonSet
spec:
  template:
    spec:
      containers:
        - name: cloudana-node
          image: ghcr.io/amrdab/cloudana-node-agent # TODO(owner): publish
          env:
            - name: CLOUDANA_FLEET_TOKEN
              valueFrom:
                secretKeyRef: { name: cloudana-fleet, key: CLOUDANA_FLEET_TOKEN }`;

function Toggle({ label, on, chip }: { label: string; on?: boolean; chip?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="font-mono text-xs text-muted-foreground">{label}</span>
      {chip ? (
        <StatusChip status="early" />
      ) : (
        <span aria-label={on ? "on" : "off"} className={`relative h-5 w-9 rounded-full ${on ? "bg-ok" : "bg-line-2"}`}>
          <i className={`absolute top-0.5 size-4 rounded-full bg-bg transition-[left] ${on ? "left-[18px]" : "left-0.5"}`} />
        </span>
      )}
    </div>
  );
}

export function Provide() {
  const { data } = useNetwork();
  return (
    <Section id="provide" kicker="Provide" title="From one PC to a whole hall." className="relative overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute right-[-4%] top-4 w-[560px] max-w-[90vw] opacity-40 max-md:hidden">
        <Suspense fallback={null}>
          <Globe markers={TESTNET_REGIONS} className="relative aspect-square w-full" />
        </Suspense>
      </div>
      <div className="relative grid gap-4 md:grid-cols-2">
        <Reveal>
          <article className="flex h-full flex-col rounded-lg border border-line-2 bg-panel p-6">
            <h3 className="font-head text-xl font-medium text-text">Home node</h3>
            <div className="mt-5 flex items-center gap-2 rounded-md border border-line bg-bg-2 py-2 pl-4 pr-2">
              <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-text">
                <span className="text-faint">$ </span>{INSTALL}
              </code>
              <CopyButton text={INSTALL} />
            </div>
            <p className="mt-2 font-mono text-[11px] text-faint">Node 22+ · Windows, macOS, Linux</p>
            <div className="mt-4 divide-y divide-line">
              <Toggle label="Compute" on />
              <Toggle label="Hosting" on />
              <Toggle label="Storage" chip />
            </div>
            <p className="mt-4 flex-1 text-sm leading-[1.55] text-muted-foreground">
              Auto-detects GPU, CPU, RAM, disk. Toggle what you share. Optional floor price (coming). No stake.
            </p>
            <a href="/control/provide" className={btn.link("mt-5")}>Start providing <ArrowRight className="size-3.5" aria-hidden /></a>
          </article>
        </Reveal>
        <Reveal delay={0.04}>
          <article className="flex h-full flex-col rounded-lg border border-line-2 bg-panel p-6">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="font-head text-xl font-medium text-text">Datacenter fleet</h3>
              <span className="font-mono text-xs tabular-nums text-faint">{data ? `${data.nodesBound} node${data.nodesBound === 1 ? "" : "s"} bound network-wide` : "—"}</span>
            </div>
            <pre className="mt-5 overflow-x-auto rounded-md border border-line bg-bg-2 p-4 font-mono text-[12px] leading-[1.7] text-muted-foreground"><code>{FLEET_YAML}</code></pre>
            <p className="mt-3 font-mono text-xs text-muted-foreground">payout: one wallet · floor: network price (coming)</p>
            <p className="mt-4 flex-1 text-sm leading-[1.55] text-muted-foreground">
              One fleet token, deployed with Docker or Kubernetes. One payout wallet, one fleet-wide floor. Fees uncapped; subsidy capped per operator.
            </p>
            <button type="button" onClick={() => openWaitlist({ role: "datacenter" })} className={btn.link("mt-5 w-fit")}>
              Talk to us <ArrowRight className="size-3.5" aria-hidden />
            </button>
          </article>
        </Reveal>
      </div>
    </Section>
  );
}
