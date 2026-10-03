// /lab — the live instruments that used to sit on the homepage: real miner, live numbers, verifier, payment
// diagram, FAQ. Linked from the litepaper and the footer.
import { useEffect } from "react";
import { MotionConfig } from "motion/react";
import { WaitlistHost } from "@/components/waitlist";
import { SiteNav } from "@/pages/home/nav";
import { LiveStrip } from "@/pages/home/strip";
import { ProofBand } from "@/pages/home/proof";
import { Branches } from "@/pages/home/branches";
import { HowItPays } from "@/pages/home/pays";
import { VerifyNow } from "@/pages/home/verify";
import { Faq } from "@/pages/home/faq";
import { SiteFooter } from "@/pages/home/footer";
import { wrap } from "@/pages/home/parts";

export default function LabPage() {
  useEffect(() => {
    document.title = "Lab · Cloudana";
  }, []);
  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-dvh overflow-x-clip bg-bg text-text">
        <SiteNav />
        <header className={`${wrap} pb-6 pt-20`}>
          <p className="font-mono text-xs uppercase tracking-[.14em] text-work">Lab</p>
          <h1 className="mt-4 font-head text-[clamp(40px,6vw,76px)] font-bold leading-[.98] tracking-[-.035em]">Run it yourself.</h1>
          <p className="mt-5 max-w-[52ch] text-lg text-muted-foreground">
            Real proofs mined in your tab, live network numbers, and the verifier. Everything here is computed in front of you.
          </p>
        </header>
        <main id="main">
          <LiveStrip />
          <ProofBand />
          <Branches />
          <HowItPays />
          <VerifyNow />
          <Faq />
        </main>
        <SiteFooter />
        <WaitlistHost />
      </div>
    </MotionConfig>
  );
}
