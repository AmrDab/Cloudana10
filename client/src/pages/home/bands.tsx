// The homepage bands. ≤ 200 words total; every section is a statement, not a demo.
import { ArrowRight } from "lucide-react";
import { CATALOG, GROUPS } from "@/lib/services";
import { SECURITY } from "@/lib/security";
import { btn } from "@/components/cld/cta";
import { openWaitlist } from "@/components/waitlist";
import { Reveal } from "./parts";
import { Band } from "./band";

const link = "inline-flex items-center gap-2 font-head text-base font-semibold text-ok underline-offset-4 hover:underline";

export function Statement() {
  return (
    <Band id="thesis" photo={0} kicker="Thesis" title={<>A datacenter made of <span className="text-ok">everyone's</span> hardware.</>}
      line="One orchestrator. Home PCs to full racks. Every job assigned, proven, and paid in CLD." />
  );
}

const ROLES = [
  ["Use", "Submit work. The network picks the hardware and returns the result with its proof.", "/control/run"],
  ["Provide", "One command. Your PC or your racks. Paid for every job you prove.", "/control/provide"],
  ["Verify", "Your browser re-checks finished work. No install, no wallet.", "/control/verify"],
] as const;

export function Roles() {
  return (
    <Band id="roles" photo={1} kicker="Three ways in" title="Use it. Power it. Check it.">
      <Reveal delay={0.05}>
        <ul className="grid gap-px overflow-hidden rounded-lg border border-line-2 bg-line md:grid-cols-3">
          {ROLES.map(([name, text, href]) => (
            <li key={name} className="bg-[rgba(7,9,13,.78)] p-6 backdrop-blur-sm">
              <h3 className="font-head text-2xl font-bold text-text">{name}</h3>
              <p className="mt-2 text-sm leading-[1.55] text-muted-foreground">{text}</p>
              <a href={href} className={`${link} mt-5`}>{name} <ArrowRight className="size-4" /></a>
            </li>
          ))}
        </ul>
      </Reveal>
    </Band>
  );
}

const NUMBERS = [["95 %", "of the fee minted to the provider", "text-ok"], ["3 %", "to the treasury", "text-chain"], ["2 %", "burned for good", "text-burn"]];

export function Pays() {
  return (
    <Band id="pays" photo={2} kicker="How it pays" title="No bidding. No idle emission."
      line="The fee is burned; CLD is minted for the verified job and settled on Base in batches. No work, no CLD.">
      <Reveal delay={0.05}>
        <dl className="grid gap-6 sm:grid-cols-3">
          {NUMBERS.map(([n, l, c]) => (
            <div key={l} className="border-l border-line-2 pl-5">
              <dt className={`font-head text-[clamp(40px,5vw,64px)] font-bold leading-none tracking-[-.03em] ${c}`}>{n}</dt>
              <dd className="mt-2 font-mono text-xs uppercase tracking-[.1em] text-faint">{l}</dd>
            </div>
          ))}
        </dl>
      </Reveal>
    </Band>
  );
}

const DOT = { live: "bg-ok", early: "bg-work", planned: "bg-faint/60" } as const;

export function ServicesBand() {
  return (
    <Band id="services" photo={3} kicker="Services" title="Everything a datacenter does." line="Two live on testnet. The rest labelled honestly.">
      <Reveal delay={0.05}>
        <div className="grid gap-6 md:grid-cols-2">
          {GROUPS.filter((g) => g.id !== "coming").map((g) => (
            <div key={g.id}>
              <p className="font-mono text-[11px] uppercase tracking-[.12em] text-faint">{g.label}</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {CATALOG.filter((s) => s.group === g.id).map((s) => (
                  <li key={s.id} className="inline-flex items-center gap-2 rounded-full border border-line-2 bg-[rgba(7,9,13,.6)] px-3 py-1 font-head text-sm text-text">
                    <i className={`size-1.5 rounded-full ${DOT[s.status]}`} aria-hidden /> {s.name}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-6 flex flex-wrap gap-5 font-mono text-[11px] uppercase tracking-[.1em] text-faint">
          <span><i className="mr-2 inline-block size-1.5 rounded-full bg-ok" />live · testnet</span>
          <span><i className="mr-2 inline-block size-1.5 rounded-full bg-work" />early access</span>
          <span><i className="mr-2 inline-block size-1.5 rounded-full bg-faint/60" />planned</span>
          <a href="/control/services" className="text-ok normal-case tracking-normal underline-offset-4 hover:underline">Full catalog →</a>
        </p>
      </Reveal>
    </Band>
  );
}

export function SecurityBand() {
  return (
    <Band id="security" photo={4} kicker="Security" title={<>Signed, sealed, re&#8209;checked.</>}
      line="Every message signed. Every proof re-checked. Secrets sealed to the node that runs them.">
      <Reveal delay={0.05}>
        <ul className="flex flex-wrap gap-2">
          {SECURITY.live.map((s) => (
            <li key={s.label} className="rounded-md border border-line-2 bg-[rgba(7,9,13,.6)] px-3 py-1.5 font-mono text-xs text-muted-foreground">
              <span className="text-text">{s.label}</span> · {s.tag}
            </li>
          ))}
        </ul>
        <a href="/control/docs#security" className={`${link} mt-6`}>What is live, building, planned <ArrowRight className="size-4" /></a>
      </Reveal>
    </Band>
  );
}

export function ProvideBand() {
  return (
    <Band id="provide" photo={5} kicker="Provide" title="From one PC to a whole hall."
      line="Home nodes join with one command. Datacenters join with one fleet token. No stake, no bidding.">
      <Reveal delay={0.05}>
        <div className="flex flex-wrap gap-3">
          <a href="/control/provide" className={btn.primary()}>Start providing</a>
          <button type="button" onClick={() => openWaitlist({ role: "datacenter" })} className={btn.ghost()}>Datacenters: talk to us</button>
        </div>
      </Reveal>
    </Band>
  );
}
