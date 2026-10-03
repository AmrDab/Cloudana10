import { ArrowRight } from "lucide-react";
import { useNetwork } from "@/hooks/useNetwork";
import { int } from "@/lib/cld";
import { btn } from "@/components/cld/cta";
import { NetworkGlobe } from "@/components/cld/globe/NetworkGlobe";
import { openWaitlist } from "@/components/waitlist";
import { wrap } from "./parts";

function Hud() {
  const { data } = useNetwork();
  const row = "flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[.08em] text-muted-foreground";
  return (
    <div className="pointer-events-none grid gap-2 rounded-lg border border-line-2 bg-[rgba(7,9,13,.72)] px-4 py-3 backdrop-blur-[14px]">
      <div className={row}><i className="size-2 rounded-full bg-ok shadow-[0_0_0_3px_rgba(63,214,194,.18)]" /> Datacenter</div>
      <div className={row}><i className="size-1.5 rounded-full bg-faint" /> Home node</div>
      <div className={row}><i className="h-px w-4 bg-gradient-to-r from-work to-ok" /> Live link</div>
      <div className="mt-1 border-t border-line pt-2 font-mono text-[11px] tabular-nums text-faint">
        {data ? `${int(data.nodesOnline)} online now` : "—"} · positions illustrative
      </div>
    </div>
  );
}

export function Hero() {
  return (
    <section className="relative overflow-hidden" aria-labelledby="hero-h">
      {/* Scanlines + vignette: the only decoration; the globe does the rest. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(0deg,rgba(148,163,184,.035)_0_1px,transparent_1px_3px)]" />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_70%_50%,transparent_45%,#07090D_88%)]" />

      {/* Globe: bleeds off the right edge on desktop, stacks under the copy on small screens. */}
      <div className="pointer-events-none absolute right-[-9vw] top-1/2 hidden w-[min(60vw,860px)] -translate-y-1/2 lg:block">
        <NetworkGlobe className="pointer-events-auto" />
        <div className="absolute bottom-[9%] left-[4%]">
          <Hud />
        </div>
      </div>

      <div className={`${wrap} relative flex min-h-[min(calc(100dvh-64px),820px)] flex-col justify-center py-20 max-md:py-14`}>
        <div className="max-w-[600px]">
          <p className="font-mono text-xs uppercase tracking-[.08em] text-faint">Decentralized datacenter · Base</p>
          <h1 id="hero-h" className="mt-5 font-head text-[clamp(44px,6.6vw,88px)] font-bold leading-[.96] tracking-[-.04em] text-text">
            The proof is <span className="block">the work.</span>
          </h1>
          <p className="mt-6 max-w-[40ch] text-lg leading-[1.5] text-muted-foreground md:text-xl">
            A decentralized datacenter. Every job assigned, proven, and paid.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <button type="button" onClick={() => openWaitlist()} className={btn.primary()}>
              Join the waitlist
            </button>
            <a href="/control" className={btn.ghost()}>
              Open console <ArrowRight className="size-4" aria-hidden />
            </a>
          </div>
          <p className="mt-4 font-mono text-xs text-faint">Testnet is open. The waitlist is for services not yet live.</p>
        </div>

        <div className="mx-auto mt-10 w-full max-w-[440px] lg:hidden">
          <NetworkGlobe />
          <div className="mt-2"><Hud /></div>
        </div>
      </div>
    </section>
  );
}
