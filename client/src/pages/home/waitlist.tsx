// The acquisition core (brief §2.8): one inline form, once, at the end.
import { CATALOG } from "@/lib/services";
import { StatusChip } from "@/components/cld/status-chip";
import { BorderBeam } from "@/components/magicui/border-beam";
import { Marquee } from "@/components/magicui/marquee";
import { WaitlistForm } from "@/components/waitlist";
import { Reveal, wrap } from "./parts";

export function WaitlistSection() {
  return (
    <section id="waitlist" className="scroll-mt-20 border-t border-line py-32 max-md:py-20" aria-labelledby="waitlist-h">
      <div className={wrap}>
        <Reveal className="mx-auto max-w-[560px] text-center">
          <h2 id="waitlist-h" className="font-head text-[40px] font-medium leading-[1.15] tracking-[-.02em] text-text max-md:text-[28px]">
            Get in early.
          </h2>
          <p className="mt-4 text-base leading-[1.55] text-muted-foreground">
            One list for users, providers, verifiers and datacenters. We email when your branch opens.
          </p>
        </Reveal>
        <Reveal delay={0.04} className="mx-auto mt-10 max-w-[560px]">
          <div className="relative rounded-xl border border-line-2 bg-panel p-8 text-left max-sm:p-5">
            <WaitlistForm inline />
            <BorderBeam size={120} duration={12} colorFrom="#F2A93B" colorTo="#3FD6C2" />
          </div>
        </Reveal>
      </div>
      <div aria-hidden className="relative mt-16 [mask-image:linear-gradient(90deg,transparent,#000_12%,#000_88%,transparent)]">
        <Marquee pauseOnHover className="[--duration:40s] [--gap:1rem]">
          {CATALOG.map((s) => (
            <span key={s.id} className="flex items-center gap-3 rounded-full border border-line px-4 py-2">
              <span className="font-head text-sm text-muted-foreground">{s.name}</span>
              <StatusChip status={s.status} />
            </span>
          ))}
        </Marquee>
      </div>
    </section>
  );
}
