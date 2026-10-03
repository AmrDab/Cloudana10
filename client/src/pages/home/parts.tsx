// Layout pieces shared by the homepage sections (docs/V2_BRIEF.md §1: 1120px, 8px rhythm).
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { BlurFade } from "@/components/magicui/blur-fade";

export const wrap = "mx-auto w-full max-w-[1120px] px-6 max-[480px]:px-4";

export function Section({ id, kicker, title, lede, children, className }: {
  id?: string;
  kicker: string;
  title: ReactNode;
  lede?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cn("scroll-mt-20 py-32 max-md:py-20", className)} aria-labelledby={id ? `${id}-h` : undefined}>
      <div className={wrap}>
        <Reveal>
          <p className="font-mono text-xs uppercase tracking-[.08em] text-work">{kicker}</p>
          <h2 id={id ? `${id}-h` : undefined} className="mt-3 max-w-[18ch] font-head text-[clamp(32px,4.4vw,56px)] font-bold leading-[1.02] tracking-[-.03em] text-text">
            {title}
          </h2>
          {lede && <p className="mt-4 max-w-[56ch] text-base leading-[1.55] text-muted-foreground">{lede}</p>}
        </Reveal>
        <div className="mt-12 max-md:mt-8">{children}</div>
      </div>
    </section>
  );
}

/** Opacity + 8px, once, at 20 % visibility (brief §1 motion rules). */
export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <BlurFade inView inViewMargin="0px 0px -20% 0px" direction="up" offset={8} blur="0px" duration={0.4} delay={delay} className={className}>
      {children}
    </BlurFade>
  );
}
