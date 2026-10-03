// How it pays: the orchestrator + per-job minting in one diagram (brief §2.4).
import { forwardRef, useRef, type ReactNode } from "react";
import { Boxes, Flame, Link2, Server, ShieldCheck, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNetwork } from "@/hooks/useNetwork";
import { AnimatedBeam } from "@/components/magicui/animated-beam";
import { Reveal, Section } from "./parts";

const MUTED = "#8B95A7", WORK = "#F2A93B", OK = "#3FD6C2", CHAIN = "#5B8DEF", BURN = "#E5484D";

const Node = forwardRef<HTMLDivElement, { icon: ReactNode; label: string; tone: string; className?: string }>(
  ({ icon, label, tone, className }, ref) => (
    <div className={cn("z-10 flex flex-col items-center gap-2", className)}>
      <div ref={ref} className="grid size-14 place-items-center rounded-lg border border-line-2 bg-panel-2 max-sm:size-11" style={{ color: tone }}>
        {icon}
      </div>
      <span className="font-mono text-[11px] uppercase tracking-[.08em] text-muted-foreground max-sm:text-[10px]">{label}</span>
    </div>
  ),
);
Node.displayName = "Node";

function Diagram() {
  const box = useRef<HTMLDivElement>(null);
  const user = useRef<HTMLDivElement>(null);
  const orch = useRef<HTMLDivElement>(null);
  const prov = useRef<HTMLDivElement>(null);
  const proof = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLDivElement>(null);
  const burn = useRef<HTMLDivElement>(null);
  const icon = "size-5 max-sm:size-4";
  const beam = { containerRef: box, pathColor: "#94A3B8", pathOpacity: 0.14, pathWidth: 1.5, duration: 4 };
  return (
    <div ref={box} className="relative rounded-xl border border-line-2 bg-panel px-6 pb-8 pt-10 max-sm:px-3" role="img"
      aria-label="User pays a fee to the orchestrator, which assigns the job to a provider; the provider's proof is verified and settled on Base; the fee is burned.">
      <div className="flex items-start justify-between">
        <Node ref={user} icon={<User className={icon} />} label="User" tone={MUTED} />
        <Node ref={orch} icon={<Boxes className={icon} />} label="Orchestrator" tone={WORK} />
        <Node ref={prov} icon={<Server className={icon} />} label="Provider" tone={WORK} />
        <Node ref={proof} icon={<ShieldCheck className={icon} />} label="Proof ✓" tone={OK} />
        <Node ref={base} icon={<Link2 className={icon} />} label="Base" tone={CHAIN} />
      </div>
      <div className="mt-10 flex justify-center max-sm:mt-8">
        <Node ref={burn} icon={<Flame className="size-4" />} label="fee burned" tone={BURN} className="[&>div]:size-10" />
      </div>
      <AnimatedBeam {...beam} fromRef={user} toRef={orch} gradientStartColor={MUTED} gradientStopColor={MUTED} />
      <AnimatedBeam {...beam} fromRef={orch} toRef={prov} gradientStartColor={WORK} gradientStopColor={WORK} delay={0.5} />
      <AnimatedBeam {...beam} fromRef={prov} toRef={proof} gradientStartColor={WORK} gradientStopColor={OK} delay={1} />
      <AnimatedBeam {...beam} fromRef={proof} toRef={base} gradientStartColor={CHAIN} gradientStopColor={CHAIN} delay={1.5} />
      <AnimatedBeam {...beam} fromRef={orch} toRef={burn} gradientStartColor={BURN} gradientStopColor={BURN} curvature={-20} delay={0.8} />
    </div>
  );
}

function Param({ value, label, tone }: { value: string; label: string; tone: string }) {
  return (
    <div className="rounded-lg border border-line-2 bg-panel px-5 py-4">
      <p className="font-mono text-[28px] leading-none tabular-nums" style={{ color: tone }}>{value}</p>
      <p className="mt-2 font-mono text-[11px] uppercase tracking-[.08em] text-faint">{label}</p>
    </div>
  );
}

export function HowItPays() {
  const { data } = useNetwork();
  return (
    <Section
      id="pays"
      kicker="How it pays"
      title="No bidding. No idle emission."
      lede="You pay a fee. The orchestrator assigns the job; the provider computes and proves it. The fee is burned and CLD worth 97.5 % of it is minted to the provider, plus a capped subsidy when the random draw picks them."
    >
      <Reveal>
        <Diagram />
        <div className="mt-4 grid grid-cols-[1fr_1fr_2fr] gap-4 max-md:grid-cols-2">
          <Param value="97.5 %" label="of the fee, minted to provider" tone={OK} />
          <Param value="2 %" label="net burn before subsidy · 0.5 % treasury" tone={BURN} />
          <div className="flex flex-col justify-center rounded-lg border border-line bg-bg-2 px-5 py-4 font-mono text-xs leading-[1.7] text-muted-foreground max-md:col-span-2">
            <span className="text-text">Minted per verified job. Settled on-chain in batches.</span>
            <span className="text-faint">
              Current price · {data ? `${data.priceUcldPerMmac.toLocaleString("en-US")} µCLD per M multiply-adds` : "—"}
            </span>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}
